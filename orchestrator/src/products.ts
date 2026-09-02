import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = join(ROOT, "orchestrator/products/registry.json");
const DEFAULT_PRODUCT = "win-predict-ai";
const LEGACY_PRODUCT_LABEL_RE = /^product:(.+)$/;
/** Старые id/лейблы → текущий id в registry */
const LEGACY_PRODUCT_IDS: Record<string, string> = {
  games: "ios-games",
};

export type ProductStatus = "active" | "stub";

export type BoardProject = {
  id: string;
  statusFieldId: string;
  statusOptions?: Partial<Record<string, string>>;
};

export type ProductSurface = {
  repo: string;
  trigger: "sdk" | "slash" | "issue_only";
  command?: string;
  description?: string;
};

export type ProductEntry = {
  status: ProductStatus;
  label: string;
  /** GitHub template for per-Goal scaffold (ios-games). */
  templateRepo?: string;
  board?: BoardProject;
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
    if (typeof entry.label !== "string" || entry.label !== id) {
      throw new Error(`registry: ${id}.label must equal product id`);
    }
    if (!entry.surfaces || typeof entry.surfaces !== "object") {
      throw new Error(`registry: ${id}.surfaces`);
    }
    if (entry.board) {
      if (typeof entry.board.id !== "string" || !entry.board.id.startsWith("PVT_")) {
        throw new Error(`registry: ${id}.board.id`);
      }
      if (typeof entry.board.statusFieldId !== "string" || !entry.board.statusFieldId.startsWith("PVT")) {
        throw new Error(`registry: ${id}.board.statusFieldId`);
      }
    }
  }
  if (!raw[DEFAULT_PRODUCT]?.board) {
    throw new Error(`registry: ${DEFAULT_PRODUCT}.board required`);
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
    if (registry[name]) return name;
    const renamed = LEGACY_PRODUCT_IDS[name];
    if (renamed && registry[renamed]) return renamed;
    const legacy = name.match(LEGACY_PRODUCT_LABEL_RE);
    if (legacy && registry[legacy[1]]) return legacy[1];
    if (legacy) {
      const renamedFromPrefix = LEGACY_PRODUCT_IDS[legacy[1]];
      if (renamedFromPrefix && registry[renamedFromPrefix]) return renamedFromPrefix;
    }
  }
  return DEFAULT_PRODUCT;
}

export function getProduct(id: string, registry = loadProductRegistry()): ProductEntry {
  const entry = registry[id];
  if (!entry) throw new Error(`неизвестный продукт: ${id}`);
  return entry;
}

/** GitHub Project board for product Goals (defaults to win-predict-ai board). */
export function getBoardProject(productId: string, registry = loadProductRegistry()): BoardProject {
  const entry = getProduct(productId, registry);
  const board = entry.board ?? registry[DEFAULT_PRODUCT]?.board;
  if (!board) throw new Error(`registry: нет board для ${productId}`);
  return board;
}

/** Unique boards referenced by products (watch polls all). */
export function listBoardProjects(registry = loadProductRegistry()): BoardProject[] {
  const seen = new Set<string>();
  const out: BoardProject[] = [];
  for (const id of Object.keys(registry)) {
    const board = getBoardProject(id, registry);
    if (seen.has(board.id)) continue;
    seen.add(board.id);
    out.push(board);
  }
  return out;
}

export function resolveBoardProject(productId: string, registry = loadProductRegistry()): BoardProject {
  return getBoardProject(productId, registry);
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
    summary: `Продукт \`${productId}\` ещё не активен (status: stub). Шаблон может быть в registry, но оркестратор пока не создаёт репо игры под Goal и не открывает PR — нужны surfaces + scaffold из templateRepo. Повтори после подключения.`,
    status: "needs_human",
    surfaces: [],
    human_gates: [`подключить репозитории продукта ${productId} в registry`],
    tasks: [],
  };
}

/** Task surface+repo must belong to the Goal product. */
export function taskMatchesProduct(
  productId: string,
  surface: string,
  repo: string,
  registry = loadProductRegistry(),
): boolean {
  const meta = getProduct(productId, registry).surfaces[surface];
  return Boolean(meta && meta.repo === repo);
}

/** Markdown table for manager prompt: allowed surfaces for this product. */
export function formatProductContext(productId: string, registry = loadProductRegistry()): string {
  const entry = getProduct(productId, registry);
  const lines = [
    `Продукт Goal: \`${productId}\` (лейбл \`${entry.label}\`, status: \`${entry.status}\`).`,
    "Планируй child только для surfaces этого продукта. Не подмешивай репо других продуктов.",
  ];
  if (entry.templateRepo) {
    lines.push(`Шаблон новых репо: \`${entry.templateRepo}\` (GitHub Template).`);
  }
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
