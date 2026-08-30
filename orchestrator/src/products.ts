import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = join(ROOT, "orchestrator/products/registry.json");
const DEFAULT_PRODUCT = "win-predict-ai";
const PRODUCT_LABEL_RE = /^product:(.+)$/;

export type ProductStatus = "active" | "stub";

export type ProductSurface = {
  repo: string;
  trigger: "sdk" | "slash" | "issue_only";
  command?: string;
  description?: string;
};

export type ProductEntry = {
  status: ProductStatus;
  label: string;
  surfaces: Record<string, ProductSurface>;
};

export type ProductRegistry = Record<string, ProductEntry>;

let cached: ProductRegistry | null = null;

export function loadProductRegistry(path = REGISTRY_PATH): ProductRegistry {
  if (cached && path === REGISTRY_PATH) return cached;
  const raw = JSON.parse(readFileSync(path, "utf8")) as ProductRegistry;
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || (entry.status !== "active" && entry.status !== "stub")) {
      throw new Error(`registry: ${id}.status must be active|stub`);
    }
    if (typeof entry.label !== "string" || !entry.label.startsWith("product:")) {
      throw new Error(`registry: ${id}.label must be product:…`);
    }
    if (!entry.surfaces || typeof entry.surfaces !== "object") {
      throw new Error(`registry: ${id}.surfaces`);
    }
  }
  if (path === REGISTRY_PATH) cached = raw;
  return raw;
}

/** Reset cache (tests). */
export function clearProductRegistryCache(): void {
  cached = null;
}

export function resolveProductId(labelNames: string[], registry = loadProductRegistry()): string {
  for (const name of labelNames) {
    const match = name.match(PRODUCT_LABEL_RE);
    if (!match) continue;
    const id = match[1];
    if (registry[id]) return id;
  }
  return DEFAULT_PRODUCT;
}

export function getProduct(id: string, registry = loadProductRegistry()): ProductEntry {
  const entry = registry[id];
  if (!entry) throw new Error(`неизвестный продукт: ${id}`);
  return entry;
}

export function stubNeedsHumanPlan(goalNumber: number, productId: string): {
  goal_number: number;
  summary: string;
  status: "needs_human";
  surfaces: [];
  human_gates: string[];
  tasks: [];
} {
  return {
    goal_number: goalNumber,
    summary: `Продукт \`${productId}\` ещё не подключён: в \`orchestrator/products/registry.json\` нет рабочих репо (status: stub). Добавь surfaces/repos и повтори Inbox → In Progress.`,
    status: "needs_human",
    surfaces: [],
    human_gates: [`подключить репозитории продукта ${productId} в registry`],
    tasks: [],
  };
}

/** Markdown table for manager prompt: allowed surfaces for this product. */
export function formatProductContext(productId: string, registry = loadProductRegistry()): string {
  const entry = getProduct(productId, registry);
  const lines = [
    `Продукт Goal: \`${productId}\` (лейбл \`${entry.label}\`, status: \`${entry.status}\`).`,
    "Планируй child только для surfaces этого продукта. Не подмешивай репо других продуктов.",
  ];
  const surfaces = Object.entries(entry.surfaces);
  if (!surfaces.length) {
    lines.push("Поверхностей нет (stub) — верни status `needs_human` и пустой `tasks`.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("| surface | repo | trigger |");
  lines.push("|---|---|---|");
  for (const [surface, meta] of surfaces) {
    const trigger =
      meta.trigger === "slash" ? `slash ${meta.command ?? ""}`.trim() : meta.trigger;
    lines.push(`| \`${surface}\` | \`${meta.repo}\` | ${trigger} |`);
  }
  return lines.join("\n");
}
