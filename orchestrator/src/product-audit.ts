import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForPreviewUrls, type PreviewWaitResult } from "./visual-review.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const AUDIT_ROUTES_PATH = join(ROOT, "orchestrator/config/audit-routes.json");
export const AUDIT_LABEL = "product-audit";
export const AUDIT_GOAL_TITLE_PREFIX = "[audit] ";

export type AuditSeverity = "low" | "medium" | "high";

export type AuditRoute = {
  id: string;
  url: string;
  surface: string;
  checks: string[];
};

export type AuditProductConfig = {
  productLabel: string;
  routes: AuditRoute[];
};

export type AuditRoutesRegistry = Record<string, AuditProductConfig>;

export type AuditFinding = {
  id: string;
  severity: AuditSeverity;
  surface: string;
  title: string;
  result: string;
  evidence: string;
};

export type AuditReport = {
  product_id: string;
  summary: string;
  findings: AuditFinding[];
};

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function loadAuditRoutes(path = AUDIT_ROUTES_PATH): AuditRoutesRegistry {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("audit-routes: не объект");
  const registry = raw as AuditRoutesRegistry;
  for (const [productId, config] of Object.entries(registry)) {
    if (!config || typeof config !== "object") throw new Error(`audit-routes: ${productId}`);
    if (typeof config.productLabel !== "string" || !config.productLabel.trim()) {
      throw new Error(`audit-routes: ${productId}.productLabel`);
    }
    if (!Array.isArray(config.routes) || config.routes.length === 0) {
      throw new Error(`audit-routes: ${productId}.routes`);
    }
    for (const route of config.routes) {
      if (!route?.id || !route.url || !route.surface || !Array.isArray(route.checks) || !route.checks.length) {
        throw new Error(`audit-routes: ${productId} route ${route?.id ?? "?"}`);
      }
    }
  }
  return registry;
}

export function getAuditProductConfig(productId: string, path = AUDIT_ROUTES_PATH): AuditProductConfig {
  const config = loadAuditRoutes(path)[productId];
  if (!config) throw new Error(`audit-routes: нет продукта ${productId}`);
  return config;
}

export function parseMinSeverity(raw = process.env.ORCHESTRATOR_AUDIT_MIN_SEVERITY?.trim() || "medium"): AuditSeverity {
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  throw new Error(`ORCHESTRATOR_AUDIT_MIN_SEVERITY: ${raw}`);
}

export function shouldCreateGoal(severity: AuditSeverity, minSeverity: AuditSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity];
}

export function normalizeTitleForFingerprint(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function fingerprintFinding(productId: string, surface: string, title: string): string {
  const payload = `${productId}\n${surface}\n${normalizeTitleForFingerprint(title)}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function fingerprintMarker(fingerprint: string): string {
  return `<!-- product-audit:fingerprint=${fingerprint} -->`;
}

export function hasFingerprintInBody(body: string, fingerprint: string): boolean {
  return body.includes(fingerprintMarker(fingerprint));
}

export function validateAudit(raw: unknown): AuditReport {
  if (!raw || typeof raw !== "object") throw new Error("audit не объект");
  const p = raw as Record<string, unknown>;
  if (typeof p.product_id !== "string" || !p.product_id.trim()) throw new Error("пустой product_id");
  if (typeof p.summary !== "string" || !p.summary.trim()) throw new Error("пустой summary");
  if (!Array.isArray(p.findings)) throw new Error("findings не массив");

  const findings: AuditFinding[] = [];
  for (const item of p.findings) {
    if (!item || typeof item !== "object") throw new Error("finding не объект");
    const f = item as Record<string, unknown>;
    const severity = f.severity;
    if (severity !== "low" && severity !== "medium" && severity !== "high") {
      throw new Error(`некорректный severity: ${String(severity)}`);
    }
    for (const key of ["id", "surface", "title", "result", "evidence"] as const) {
      if (typeof f[key] !== "string" || !String(f[key]).trim()) {
        throw new Error(`finding.${key} пустой`);
      }
    }
    findings.push({
      id: String(f.id).trim(),
      severity,
      surface: String(f.surface).trim(),
      title: String(f.title).trim(),
      result: String(f.result).trim(),
      evidence: String(f.evidence).trim(),
    });
  }

  return {
    product_id: p.product_id.trim(),
    summary: p.summary.trim(),
    findings,
  };
}

export function formatGoalTitle(finding: AuditFinding): string {
  const title = finding.title.trim();
  if (title.startsWith(AUDIT_GOAL_TITLE_PREFIX)) return title;
  return `${AUDIT_GOAL_TITLE_PREFIX}${title}`;
}

export function formatGoalBody(finding: AuditFinding, productId: string, runAt: string): string {
  const fingerprint = fingerprintFinding(productId, finding.surface, finding.title);
  return [
    "## Результат",
    finding.result,
    "",
    "---",
    fingerprintMarker(fingerprint),
    `<!-- product-audit-run:${runAt} -->`,
    "Источник: product-audit",
    `Severity: ${finding.severity}`,
    `Surface: ${finding.surface}`,
    `Evidence: ${finding.evidence}`,
  ].join("\n");
}

export async function probeAuditUrls(
  urls: string[],
  opts: Parameters<typeof waitForPreviewUrls>[1] = {},
): Promise<PreviewWaitResult[]> {
  return waitForPreviewUrls(urls, opts);
}

export function formatAuditBrowserBlock(
  routes: AuditRoute[],
  probeResults: PreviewWaitResult[],
): string {
  const byUrl = new Map(probeResults.map((item) => [item.url, item]));
  const lines = [
    "## Визуальный аудит (Playwright MCP)",
    "",
    "Подключён MCP `playwright`. Пройди маршруты ниже, сделай скриншоты, сверь с `design.md`.",
    "Ищи регрессии UX, контраст, «голый» zinc/shadcn, сломанный layout, нечитаемые таблицы.",
    "",
    "### Маршруты",
  ];

  for (const route of routes) {
    const probe = byUrl.get(route.url);
    const flag = probe?.ready ? "готов" : "не ответил";
    const detail = probe?.status ? ` HTTP ${probe.status}` : probe?.error ? ` (${probe.error})` : "";
    lines.push(
      `- **${route.id}** (${route.surface}): ${route.url} — ${flag}${detail}`,
      `  checks: ${route.checks.join(", ")}`,
    );
  }

  lines.push(
    "",
    "### Чеклист",
    "- Открой каждый **готовый** URL. 404/пустая страница → finding с severity high.",
    "- Для app с темой — light и dark (переключатель или system preference).",
    "- Для ui/Storybook — Light/Dark stories, charts, sidebar.",
    "- Не выдумывай проблем без визуального evidence.",
    "- Admin и экраны с логином в MVP не входят — не блокируй из‑за недоступности.",
    "",
    "После browser-check верни только JSON по схеме audit. Никакого текста снаружи.",
  );

  const ready = probeResults.filter((item) => item.ready);
  if (ready.length === 0) {
    lines.push("", "**Ни один URL не ответил.** Верни findings: [] и summary с причиной.");
  } else if (ready.length < probeResults.length) {
    lines.push("", "Часть URL недоступна — аудируй только готовые; упомяни в summary.");
  }

  return lines.join("\n");
}
