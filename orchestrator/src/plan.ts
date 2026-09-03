import { isGameRepo } from "./scaffold.js";
import { taskMatchesProduct } from "./products.js";

export const REPOS = [
  "onlyzoran/win-predict-ai-ui",
  "onlyzoran/win-predict-ai-icons",
  "onlyzoran/win-predict-ai-data",
  "onlyzoran/win-predict-ai",
  "onlyzoran/win-predict-ai-admin",
  "onlyzoran/win-predict-ai-ios",
  "onlyzoran/shoppable-feed",
  "onlyzoran/gift-sales",
] as const;

export const SURFACES = ["ui", "icons", "data", "app", "admin", "ios", "feed", "sales", "game"] as const;

export type Surface = (typeof SURFACES)[number];

export type Trigger =
  | { type: "slash"; command: "/ui-agent" | "/new-icon" }
  | { type: "sdk" }
  | { type: "issue_only" };

export type Task = {
  id: string;
  surface: Surface;
  repo: string;
  title: string;
  body: string;
  depends_on: string[];
  parallel_group: number;
  trigger: Trigger;
  done_when: string;
};

export type Plan = {
  goal_number: number;
  summary: string;
  status: "ready" | "needs_human" | "out_of_scope";
  surfaces: Surface[];
  human_gates?: string[];
  tasks: Task[];
};

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("менеджер не вернул JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && (SURFACES as readonly string[]).includes(value);
}

function isRepo(value: unknown, gameRepo?: string): value is string {
  if (typeof value !== "string") return false;
  if ((REPOS as readonly string[]).includes(value)) return true;
  if (isGameRepo(value)) return !gameRepo || value === gameRepo;
  return false;
}

export function validatePlan(
  raw: unknown,
  goalNumber: number,
  productId?: string,
  gameRepo?: string,
): Plan {
  if (!raw || typeof raw !== "object") throw new Error("план не объект");
  const p = raw as Record<string, unknown>;
  const status = p.status;
  if (status !== "ready" && status !== "needs_human" && status !== "out_of_scope") {
    throw new Error("некорректный status");
  }
  if (typeof p.summary !== "string" || !p.summary.trim()) throw new Error("пустой summary");
  if (!Array.isArray(p.surfaces) || !p.surfaces.every(isSurface)) {
    throw new Error("некорректные surfaces");
  }
  if (!Array.isArray(p.tasks)) throw new Error("tasks должен быть массивом");
  if (status !== "ready" && p.tasks.length > 0) {
    throw new Error("при needs_human/out_of_scope tasks должен быть пустым");
  }

  const tasks: Task[] = p.tasks.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`task[${index}] не объект`);
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || !/^[a-z0-9-]+$/.test(t.id)) {
      throw new Error(`task[${index}].id`);
    }
    if (!isSurface(t.surface) || !isRepo(t.repo, gameRepo)) {
      throw new Error(`task[${index}] surface/repo`);
    }
    if (productId && !taskMatchesProduct(productId, t.surface, t.repo, undefined, gameRepo)) {
      throw new Error(`task[${index}] не из продукта ${productId}`);
    }
    if (typeof t.title !== "string" || !t.title.trim()) throw new Error(`task[${index}].title`);
    if (typeof t.body !== "string" || !t.body.trim()) throw new Error(`task[${index}].body`);
    if (!Array.isArray(t.depends_on) || !t.depends_on.every((d) => typeof d === "string")) {
      throw new Error(`task[${index}].depends_on`);
    }
    if (typeof t.parallel_group !== "number" || t.parallel_group < 1) {
      throw new Error(`task[${index}].parallel_group`);
    }
    if (typeof t.done_when !== "string" || !t.done_when.trim()) {
      throw new Error(`task[${index}].done_when`);
    }
    const triggerRaw = t.trigger;
    if (!triggerRaw || typeof triggerRaw !== "object") throw new Error(`task[${index}].trigger`);
    const tr = triggerRaw as Record<string, unknown>;
    let trigger: Trigger;
    if (tr.type === "issue_only" || tr.type === "sdk") {
      trigger = { type: tr.type };
    } else if (tr.type === "slash" && (tr.command === "/ui-agent" || tr.command === "/new-icon")) {
      trigger = { type: "slash", command: tr.command };
    } else {
      throw new Error(`task[${index}].trigger`);
    }
    return {
      id: t.id,
      surface: t.surface,
      repo: t.repo,
      title: t.title,
      body: t.body,
      depends_on: t.depends_on as string[],
      parallel_group: t.parallel_group,
      trigger,
      done_when: t.done_when,
    };
  });

  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) throw new Error("дубли id задач");
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) throw new Error(`depends_on неизвестен: ${dep}`);
    }
  }
  if (status === "ready" && tasks.length === 0) {
    throw new Error("при ready tasks не должен быть пустым");
  }

  return {
    goal_number: goalNumber,
    summary: p.summary,
    status,
    surfaces: p.surfaces,
    human_gates: Array.isArray(p.human_gates)
      ? p.human_gates.filter((g): g is string => typeof g === "string")
      : [],
    tasks,
  };
}
