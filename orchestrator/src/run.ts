import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, CursorAgentError } from "@cursor/sdk";
import {
  matchExistingChild,
  parentLine,
  taskMarker,
  type ChildIssueRef,
} from "./child-issue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOAL_REPO = "onlyzoran/win-predict-ai-orchestrator";
const PROJECT_ID = "PVT_kwHOAom_KM4BgVLq";
const STATUS_FIELD_ID = "PVTSSF_lAHOAom_KM4BgVLqzhahv2g";
const STATUS_OPTION_ID = {
  Inbox: "f75ad846",
  "In Progress": "47fc9ee4",
  Review: "57240b08",
} as const;
const PLAN_MARKER = "<!-- orchestrator-plan -->";
const DISPATCH_MARKER = "<!-- orchestrator-dispatch -->";
const STATE_RE = /<!-- orchestrator-state:(.*?) -->/;
const WORKING_STALE_MS = 3 * 60 * 60 * 1000;
const REVIEW_MAX_CHANGES = 2;
const REVIEW_CHANGES_DEBOUNCE_MS = 60_000;
const PR_DIFF_MAX_CHARS = 100_000;
const RESOURCE_BACKOFF_MS = 15 * 60 * 1000;
const MACHINE_NAME = process.env.CURSOR_MACHINE_NAME?.trim() || "win-predict-vps";
const MACHINE_SLOTS = 1;
const INVENTORY_PATH =
  process.env.ORCHESTRATOR_INVENTORY?.trim() ||
  join(process.env.HOME || tmpdir(), "data", "inventory.json");
const SLASH_WAIT_MS = 40 * 60 * 1000;
const SLASH_POLL_MS = 20_000;
const CLAIM_WAIT_MS = 15_000;
const GH_RETRY = 5;
const GH_RETRY_MS = 8_000;
const TG_ERROR_STAMP = "/tmp/orchestrator-watch-tg-error";
const TG_ERROR_COOLDOWN_MS = 20 * 60 * 1000;
const REPOS = [
  "onlyzoran/win-predict-ai-ui",
  "onlyzoran/win-predict-ai-icons",
  "onlyzoran/win-predict-ai-data",
  "onlyzoran/win-predict-ai",
  "onlyzoran/win-predict-ai-admin",
] as const;
const SURFACES = ["ui", "icons", "data", "app", "admin"] as const;
const LABEL_META: Record<(typeof SURFACES)[number], { color: string; description: string }> = {
  ui: { color: "1d76db", description: "win-predict-ai-ui" },
  icons: { color: "fbca04", description: "win-predict-ai-icons" },
  data: { color: "0e8a16", description: "win-predict-ai-data" },
  app: { color: "d93f0b", description: "win-predict-ai" },
  admin: { color: "5319e7", description: "win-predict-ai-admin" },
};
const REPO_SURFACE: Record<(typeof REPOS)[number], Surface> = {
  "onlyzoran/win-predict-ai-ui": "ui",
  "onlyzoran/win-predict-ai-icons": "icons",
  "onlyzoran/win-predict-ai-data": "data",
  "onlyzoran/win-predict-ai": "app",
  "onlyzoran/win-predict-ai-admin": "admin",
};

type Surface = (typeof SURFACES)[number];
type Trigger =
  | { type: "slash"; command: "/ui-agent" | "/new-icon" }
  | { type: "sdk" }
  | { type: "issue_only" };
type DispatchPhase = "working" | "reviewing" | "review" | "error";
type ReviewVerdict = "pass" | "changes" | "blocked";
type DispatchState = {
  phase: DispatchPhase;
  agentId?: string;
  runId?: string;
  prUrls?: string[];
  headRef?: string;
  at?: string;
  reviewVerdict?: ReviewVerdict;
  reviewRound?: number;
};
type Review = {
  verdict: ReviewVerdict;
  summary: string;
  findings: string[];
};

type Task = {
  id: string;
  surface: Surface;
  repo: (typeof REPOS)[number];
  title: string;
  body: string;
  depends_on: string[];
  parallel_group: number;
  trigger: Trigger;
  done_when: string;
};

type Plan = {
  goal_number: number;
  summary: string;
  status: "ready" | "needs_human" | "out_of_scope";
  surfaces: Surface[];
  human_gates?: string[];
  tasks: Task[];
};

type IssueCommentEvent = {
  comment: { body: string; user: { login: string } };
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<{ name: string }>;
  };
};

type IssueComment = {
  body: string;
  user: { login: string };
  created_at: string;
};

type BoardIssue = {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  status: string;
  closed: boolean;
};

type OpenPr = { url: string; headRefName: string };

type InventoryStatus = "starting" | "running" | "retry" | "review" | "error" | "quota";

type InventoryRun = {
  taskId: string;
  issueUrl: string;
  status: InventoryStatus;
  attempt: number;
  startedAt: string;
  agentId?: string;
  runId?: string;
  prUrls?: string[];
  detail?: string;
};

type Inventory = {
  machine: string;
  slots: number;
  updatedAt: string;
  active: InventoryRun[];
  last?: InventoryRun & { endedAt: string };
};

function commentToken(): string {
  return process.env.GITHUB_TOKEN || process.env.ORCHESTRATOR_GITHUB_TOKEN || "";
}

function writeToken(): string {
  return process.env.ORCHESTRATOR_GITHUB_TOKEN || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransientGithub(text: string): boolean {
  return /HTTP 502|HTTP 503|HTTP 429|No server is currently available|secondary rate limit|Something went wrong while executing your query/i.test(
    text,
  );
}

function shouldNotifyWatchError(message: string): boolean {
  if (!isTransientGithub(message)) return true;
  const fingerprint = `${Date.now()}\n${message.slice(0, 200)}`;
  try {
    const prev = readFileSync(TG_ERROR_STAMP, "utf8");
    const nl = prev.indexOf("\n");
    const at = Number(prev.slice(0, nl >= 0 ? nl : undefined));
    const last = nl >= 0 ? prev.slice(nl + 1) : "";
    if (
      Number.isFinite(at) &&
      Date.now() - at < TG_ERROR_COOLDOWN_MS &&
      last === message.slice(0, 200)
    ) {
      return false;
    }
  } catch {
    /* first error */
  }
  try {
    writeFileSync(TG_ERROR_STAMP, fingerprint);
  } catch {
    /* /tmp busy — всё равно напишем в чат */
  }
  return true;
}

async function notifyTelegram(text: string): Promise<void> {
  const bot = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!bot || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn(`telegram ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  } catch (err) {
    console.warn(`telegram: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function emptyInventory(): Inventory {
  return {
    machine: MACHINE_NAME,
    slots: MACHINE_SLOTS,
    updatedAt: new Date().toISOString(),
    active: [],
  };
}

function readInventory(): Inventory {
  try {
    const parsed = JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) as Inventory;
    if (!parsed || !Array.isArray(parsed.active)) return emptyInventory();
    return {
      machine: MACHINE_NAME,
      slots: MACHINE_SLOTS,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      active: parsed.active,
      last: parsed.last,
    };
  } catch {
    return emptyInventory();
  }
}

function writeInventory(inventory: Inventory): Inventory {
  const cutoff = Date.now() - WORKING_STALE_MS;
  inventory.active = inventory.active.filter((run) => {
    const started = Date.parse(run.startedAt);
    return Number.isNaN(started) || started > cutoff;
  });
  inventory.machine = MACHINE_NAME;
  inventory.slots = MACHINE_SLOTS;
  inventory.updatedAt = new Date().toISOString();
  mkdirSync(dirname(INVENTORY_PATH), { recursive: true });
  const tmp = `${INVENTORY_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(inventory, null, 2)}\n`);
  renameSync(tmp, INVENTORY_PATH);
  return inventory;
}

function formatRunAge(startedAt: string): string {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return "?";
  const minutes = Math.max(0, Math.round((Date.now() - started) / 60_000));
  return minutes < 1 ? "<1м" : `${minutes}м`;
}

function formatInventorySnapshot(inventory: Inventory, event: string): string {
  const lines = [`${inventory.machine} слот ${inventory.active.length}/${inventory.slots}`, event];
  if (inventory.active.length) {
    for (const run of inventory.active) {
      const attempt = run.attempt > 1 ? ` · попытка ${run.attempt}/4` : "";
      lines.push(`${run.status} · ${run.taskId} · ${formatRunAge(run.startedAt)}${attempt}`);
      if (run.detail) lines.push(run.detail.slice(0, 300));
      lines.push(run.issueUrl);
    }
  } else {
    lines.push("свободно");
    if (inventory.last) {
      lines.push(`последний: ${inventory.last.taskId} · ${inventory.last.status}`);
      if (inventory.last.prUrls?.length) lines.push(inventory.last.prUrls.join("\n"));
      else lines.push(inventory.last.issueUrl);
    }
  }
  return lines.join("\n");
}

async function publishActiveRun(run: InventoryRun, event: string): Promise<void> {
  try {
    const inventory = readInventory();
    inventory.active = inventory.active.filter((item) => item.issueUrl !== run.issueUrl);
    inventory.active.push(run);
    writeInventory(inventory);
    await notifyTelegram(formatInventorySnapshot(inventory, event));
  } catch (err) {
    console.warn(`inventory: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function closeActiveRun(run: InventoryRun, event: string): Promise<void> {
  try {
    const inventory = readInventory();
    inventory.active = inventory.active.filter((item) => item.issueUrl !== run.issueUrl);
    inventory.last = { ...run, endedAt: new Date().toISOString() };
    writeInventory(inventory);
    await notifyTelegram(formatInventorySnapshot(inventory, event));
  } catch (err) {
    console.warn(`inventory: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function gh(args: string[], token: string): string {
  let last = "";
  for (let attempt = 1; attempt <= GH_RETRY; attempt++) {
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
    });
    if (result.status === 0) return (result.stdout || "").trim();
    last = (result.stderr || result.stdout || `gh ${args.join(" ")}`).trim();
    if (!isTransientGithub(last) || attempt === GH_RETRY) throw new Error(last);
    const waitMs = GH_RETRY_MS * attempt;
    console.warn(`gh retry ${attempt}/${GH_RETRY} in ${waitMs}ms: ${last.slice(0, 200)}`);
    sleepSync(waitMs);
  }
  throw new Error(last);
}

function commentOnGoal(issueNumber: number, body: string): void {
  const token = commentToken();
  if (!token) {
    console.error(body);
    return;
  }
  commentOnIssue(GOAL_REPO, issueNumber, body, token);
}

function commentOnIssue(repo: string, issueNumber: number, body: string, token: string): void {
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const file = join(dir, "comment.md");
  writeFileSync(file, body);
  gh(["issue", "comment", String(issueNumber), "-R", repo, "--body-file", file], token);
}

function parseIssueUrl(url: string): { repo: string; number: number } {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!match) throw new Error(`не URL issue: ${url}`);
  return { repo: match[1], number: Number(match[2]) };
}

function parsePrUrl(url: string): { repo: string; number: number } {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`не URL PR: ${url}`);
  return { repo: match[1], number: Number(match[2]) };
}

function listIssueComments(repo: string, issueNumber: number, token: string): IssueComment[] {
  const raw = gh(
    ["api", `repos/${repo}/issues/${issueNumber}/comments?per_page=100`],
    token,
  );
  const parsed = JSON.parse(raw) as IssueComment | IssueComment[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseDispatchState(body: string): DispatchState | undefined {
  const tagged = body.match(STATE_RE);
  if (tagged) {
    try {
      const raw = JSON.parse(tagged[1]) as DispatchState;
      if (
        raw.phase === "working" ||
        raw.phase === "reviewing" ||
        raw.phase === "review" ||
        raw.phase === "error"
      ) {
        return raw;
      }
    } catch {
      /* ignore */
    }
  }
  if (!body.includes(DISPATCH_MARKER)) return undefined;
  if (/Ревьюер смотрит/.test(body)) return { phase: "reviewing" };
  if (/Нужна приёмка/.test(body)) return { phase: "review" };
  if (/\*\*В работе\.\*\*/.test(body)) return { phase: "working" };
  if (/Не удалось запустить воркера/.test(body)) return { phase: "error" };
  return undefined;
}

function lastDispatchState(comments: IssueComment[]): DispatchState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchState(comment.body);
    if (state) return state;
  }
  return undefined;
}

function isActiveWorking(state: DispatchState | undefined): boolean {
  return isActivePhase(state, "working");
}

function isActiveReviewing(state: DispatchState | undefined): boolean {
  return isActivePhase(state, "reviewing");
}

function isActivePhase(state: DispatchState | undefined, phase: DispatchPhase): boolean {
  if (state?.phase !== phase) return false;
  if (!state.at) return true;
  const started = Date.parse(state.at);
  return !Number.isNaN(started) && Date.now() - started < WORKING_STALE_MS;
}

function lastPhaseIndex(comments: IssueComment[], phase: DispatchPhase): number {
  let index = -1;
  comments.forEach((comment, i) => {
    if (parseDispatchState(comment.body)?.phase === phase) index = i;
  });
  return index;
}

function notesAfterLastPhase(comments: IssueComment[], phase: DispatchPhase): string {
  const after = lastPhaseIndex(comments, phase);
  const slice = after >= 0 ? comments.slice(after + 1) : comments;
  return slice
    .filter(isHumanNote)
    .map((comment) => comment.body.trim())
    .join("\n\n---\n\n");
}

function isResourceBackoff(state: DispatchState | undefined, comments: IssueComment[]): boolean {
  if (state?.phase !== "error") return false;
  const lastError = [...comments].reverse().find((comment) => parseDispatchState(comment.body)?.phase === "error");
  if (!lastError || !/resource_exhausted/i.test(lastError.body)) return false;
  if (!state.at) return true;
  const at = Date.parse(state.at);
  return !Number.isNaN(at) && Date.now() - at < RESOURCE_BACKOFF_MS;
}

function slotFailedFor(issueUrl: string): boolean {
  const inventory = readInventory();
  if (inventory.active.some((run) => run.issueUrl === issueUrl)) return false;
  const last = inventory.last;
  return Boolean(
    last && last.issueUrl === issueUrl && (last.status === "error" || last.status === "quota"),
  );
}

function shouldWakeChild(
  state: DispatchState | undefined,
  comments: IssueComment[],
  issueUrl: string,
): boolean {
  if (state?.phase === "error") {
    if (isResourceBackoff(state, comments)) return false;
    return true;
  }
  if (state?.phase === "reviewing") return !isActiveReviewing(state);
  if (state?.phase === "review") {
    if (state.reviewVerdict === "changes" && state.at) {
      const at = Date.parse(state.at);
      if (!Number.isNaN(at) && Date.now() - at < REVIEW_CHANGES_DEBOUNCE_MS) return false;
    }
    return true;
  }
  if (state?.phase === "working") {
    if (notesAfterLastPhase(comments, "working")) return true;
    if (slotFailedFor(issueUrl)) return true;
    return !isActiveWorking(state);
  }
  return false;
}

function formatDispatchComment(state: DispatchState, lines: string[]): string {
  return [DISPATCH_MARKER, `<!-- orchestrator-state:${JSON.stringify(state)} -->`, ...lines].join(
    "\n",
  );
}

function claimWorking(repo: string, issueNumber: number, token: string): void {
  commentOnIssue(
    repo,
    issueNumber,
    formatDispatchComment(
      { phase: "working", at: new Date().toISOString() },
      ["", "**В работе.** Карточка In Progress. Не дублирую запуск."],
    ),
    token,
  );
}

function claimReviewing(
  repo: string,
  issueNumber: number,
  token: string,
  state: Pick<DispatchState, "agentId" | "runId" | "prUrls" | "headRef">,
): void {
  commentOnIssue(
    repo,
    issueNumber,
    formatDispatchComment(
      { phase: "reviewing", ...state, at: new Date().toISOString() },
      ["", "**Ревьюер смотрит.** PR сдан, карточка In Progress. Не дублирую запуск."],
    ),
    token,
  );
}

function isHumanNote(comment: IssueComment): boolean {
  const login = comment.user?.login ?? "";
  if (!login || login.endsWith("[bot]")) return false;
  if (comment.body.includes(DISPATCH_MARKER) || comment.body.includes(PLAN_MARKER)) return false;
  const first = comment.body.trim().split(/\s+/)[0]?.toLowerCase();
  if (first === "/orchestrate" || first === "/new-icon" || first === "/ui-agent") return false;
  return comment.body.trim().length > 0;
}

function notesAfterLastReview(comments: IssueComment[]): string {
  let lastReview = -1;
  comments.forEach((comment, index) => {
    const state = parseDispatchState(comment.body);
    if (state?.phase === "review" || (comment.body.includes(DISPATCH_MARKER) && /Нужна приёмка/.test(comment.body))) {
      lastReview = index;
    }
  });
  const slice = lastReview >= 0 ? comments.slice(lastReview + 1) : comments;
  return slice
    .filter(isHumanNote)
    .map((comment) => comment.body.trim())
    .join("\n\n---\n\n");
}

function stripDispatchChrome(body: string): string {
  return body
    .replace(DISPATCH_MARKER, "")
    .replace(STATE_RE, "")
    .replace(/^\s+|\s+$/g, "")
    .trim();
}

function lastReviewerChanges(comments: IssueComment[]): string {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchState(comment.body);
    if (state?.phase !== "review") continue;
    if (state.reviewVerdict === "changes") return stripDispatchChrome(comment.body);
    return "";
  }
  return "";
}

function notesForWorker(comments: IssueComment[]): string {
  return [lastReviewerChanges(comments), notesAfterLastReview(comments)].filter(Boolean).join("\n\n---\n\n");
}

function countReviewChanges(comments: IssueComment[]): number {
  let lastReset = -1;
  comments.forEach((comment, index) => {
    const verdict = parseDispatchState(comment.body)?.reviewVerdict;
    if (verdict === "pass" || verdict === "blocked") lastReset = index;
  });
  return comments
    .slice(lastReset + 1)
    .filter((comment) => parseDispatchState(comment.body)?.reviewVerdict === "changes").length;
}

function extractStoredPlan(comments: IssueComment[], goalNumber: number): Plan | undefined {
  for (const comment of [...comments].reverse()) {
    if (!comment.body.includes(PLAN_MARKER)) continue;
    try {
      return validatePlan(extractJson(comment.body), goalNumber);
    } catch {
      /* старый комментарий без JSON */
    }
  }
  return undefined;
}

function childAlreadyDispatched(url: string, token: string): boolean {
  return findOpenPrs(url, token).length > 0;
}

function findOpenPrs(issueUrl: string, token: string): OpenPr[] {
  const { repo, number } = parseIssueUrl(issueUrl);
  const raw = gh(
    ["pr", "list", "-R", repo, "--state", "open", "--limit", "30", "--json", "url,body,title,headRefName"],
    token,
  );
  const items = JSON.parse(raw) as Array<{
    url: string;
    body: string;
    title: string;
    headRefName: string;
  }>;
  const closeRe = new RegExp(`(?:closes|fixes|resolves)\\s+#${number}\\b`, "i");
  const issueRe = new RegExp(`github\\.com/${repo}/issues/${number}\\b`, "i");
  return items
    .filter((pr) => closeRe.test(pr.body || "") || closeRe.test(pr.title || "") || issueRe.test(pr.body || ""))
    .map((pr) => ({ url: pr.url, headRefName: pr.headRefName }));
}

function findOpenPrsForIssue(issueUrl: string, token: string): string[] {
  return findOpenPrs(issueUrl, token).map((pr) => pr.url);
}

async function waitForOpenPr(issueUrl: string, token: string, timeoutMs: number): Promise<string[]> {
  const started = Date.now();
  for (;;) {
    const prs = findOpenPrsForIssue(issueUrl, token);
    if (prs.length) return prs;
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `slash-воркер не открыл PR за ${Math.round(timeoutMs / 60000)} мин (часто rate limit). Повтор: верни карточку в In Progress.`,
      );
    }
    const left = Math.round((timeoutMs - (Date.now() - started)) / 1000);
    console.log(`wait PR ${issueUrl} (${left}s left)`);
    await sleep(SLASH_POLL_MS);
  }
}

function extractJson(text: string): unknown {
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

function isRepo(value: unknown): value is Task["repo"] {
  return typeof value === "string" && (REPOS as readonly string[]).includes(value);
}

function validatePlan(raw: unknown, goalNumber: number): Plan {
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
    if (!isSurface(t.surface) || !isRepo(t.repo)) {
      throw new Error(`task[${index}] surface/repo`);
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

function ensureLabel(repo: string, name: Surface, token: string): void {
  const meta = LABEL_META[name];
  gh(
    [
      "label",
      "create",
      name,
      "-R",
      repo,
      "--color",
      meta.color,
      "--description",
      meta.description,
      "--force",
    ],
    token,
  );
}

function graphql<T>(token: string, query: string, variables: Record<string, string>): T {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push("-f", `${key}=${value}`);
  }
  const raw = gh(args, token);
  const payload = JSON.parse(raw) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }
  if (!payload.data) throw new Error("пустой GraphQL data");
  return payload.data;
}

function issueNodeId(url: string, token: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!match) throw new Error(`не URL issue: ${url}`);
  return gh(["api", `repos/${match[1]}/issues/${match[2]}`, "--jq", ".node_id"], token);
}

function addToProject(url: string, status: keyof typeof STATUS_OPTION_ID, token: string): void {
  try {
    const contentId = issueNodeId(url, token);
    const added = graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      token,
      "mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}",
      { projectId: PROJECT_ID, contentId },
    );
    graphql(
      token,
      "mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}",
      {
        projectId: PROJECT_ID,
        itemId: added.addProjectV2ItemById.item.id,
        fieldId: STATUS_FIELD_ID,
        optionId: STATUS_OPTION_ID[status],
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`project add ${url}: ${message}`);
  }
}

function listProjectIssues(token: string): BoardIssue[] {
  const query = `query($projectId:ID!){node(id:$projectId){...on ProjectV2{items(first:100){nodes{id fieldValues(first:20){nodes{...on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2SingleSelectField{id}}}}} content{__typename ...on Issue{number title body url state repository{nameWithOwner} labels(first:20){nodes{name}}}}}}}}}`;
  const data = graphql<{
    node: {
      items: {
        nodes: Array<{
          fieldValues: { nodes: Array<{ name?: string; field?: { id?: string } }> };
          content: {
            __typename: string;
            number?: number;
            title?: string;
            body?: string | null;
            url?: string;
            state?: string;
            repository?: { nameWithOwner: string };
            labels?: { nodes: Array<{ name: string }> };
          } | null;
        }>;
      };
    };
  }>(token, query, { projectId: PROJECT_ID });
  const issues: BoardIssue[] = [];
  for (const item of data.node.items.nodes) {
    const content = item.content;
    if (!content || content.__typename !== "Issue" || !content.repository || !content.number || !content.url) {
      continue;
    }
    const status =
      item.fieldValues.nodes.find((node) => node.field?.id === STATUS_FIELD_ID)?.name ?? "";
    issues.push({
      repo: content.repository.nameWithOwner,
      number: content.number,
      title: content.title ?? "",
      body: content.body ?? "",
      url: content.url,
      labels: (content.labels?.nodes ?? []).map((label) => label.name),
      status,
      closed: content.state === "CLOSED",
    });
  }
  return issues;
}

function fetchIssue(repo: string, number: number, token: string): IssueCommentEvent["issue"] {
  const raw = gh(["api", `repos/${repo}/issues/${number}`], token);
  const issue = JSON.parse(raw) as {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<{ name: string }>;
  };
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    html_url: issue.html_url,
    labels: (issue.labels ?? []).map((label) => ({ name: label.name })),
  };
}

function findExistingChild(task: Task, goalNumber: number, token: string): ChildIssueRef | undefined {
  const raw = gh(
    [
      "issue",
      "list",
      "-R",
      task.repo,
      "--state",
      "all",
      "--limit",
      "100",
      "--json",
      "url,title,body,state",
    ],
    token,
  );
  const items = JSON.parse(raw) as Array<{
    url: string;
    title: string;
    body: string;
    state: string;
  }>;
  return matchExistingChild(items, task, parentLine(GOAL_REPO, goalNumber));
}

function resolveChild(
  task: Task,
  goalNumber: number,
  created: Map<string, string>,
  token: string,
): ChildIssueRef | undefined {
  const found = findExistingChild(task, goalNumber, token);
  if (found) return found;
  const url = created.get(task.id);
  return url ? { url, closed: false } : undefined;
}

function createChildIssue(task: Task, goalNumber: number, created: Map<string, string>, token: string): string {
  ensureLabel(task.repo, task.surface, token);
  const existing = findExistingChild(task, goalNumber, token);
  if (existing) return existing.url;
  const deps = task.depends_on
    .map((id) => created.get(id))
    .filter((url): url is string => Boolean(url));
  const triggerLine =
    task.trigger.type === "slash"
      ? `Воркер: комментарий \`${task.trigger.command}\` от диспетчера.`
      : `Воркер: My Machines (\`worker.md\`) на \`${MACHINE_NAME}\`.`;
  const body = [
    taskMarker(task.id),
    task.body.trim(),
    "",
    triggerLine,
    `Критерий куска: ${task.done_when}`,
    deps.length ? `Зависит от: ${deps.join(", ")}` : "",
    parentLine(GOAL_REPO, goalNumber),
  ]
    .filter(Boolean)
    .join("\n");

  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const file = join(dir, "issue.md");
  writeFileSync(file, body);
  const url = gh(
    [
      "issue",
      "create",
      "-R",
      task.repo,
      "--title",
      task.title,
      "--body-file",
      file,
      "--label",
      task.surface,
    ],
    token,
  );
  addToProject(url, "Inbox", token);
  return url;
}

function extractPrUrls(text: string): string[] {
  const matches = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g);
  return [...new Set(matches ?? [])];
}

function isRetryableWorkerStart(err: unknown): boolean {
  if (err instanceof CursorAgentError && err.isRetryable) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /resource_exhausted|unavailable|not (found|connected|online)|no matching (worker|machine)|machine.+(offline|not)/i.test(
    message,
  );
}

function runFailureMessage(result: { id?: string; status: string; error?: unknown }): string {
  const err = result.error;
  const nested =
    err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message.trim()
      : "";
  const detail =
    (typeof err === "string" && err.trim()) ||
    nested ||
    (err && typeof err === "object" ? JSON.stringify(err) : "") ||
    result.status;
  return result.id ? `run status ${detail} (${result.id})` : `run status ${detail}`;
}

function isNewIconTask(task: Task): task is Task & { trigger: { type: "slash"; command: "/new-icon" } } {
  return task.trigger.type === "slash" && task.trigger.command === "/new-icon";
}

function triggerFromBoardIssue(body: string, surface: Surface): Trigger {
  const slash = body.match(/комментарий `(\/new-icon|\/ui-agent)`/);
  if (slash?.[1] === "/new-icon" || slash?.[1] === "/ui-agent") {
    return { type: "slash", command: slash[1] };
  }
  if (surface === "icons") return { type: "slash", command: "/new-icon" };
  return { type: "sdk" };
}

function isVisualTask(task: Task, notes = ""): boolean {
  return (
    task.surface === "ui" ||
    task.surface === "app" ||
    task.surface === "admin" ||
    /цвет|палитр|theme|токен|dark|light|контраст/i.test(`${task.title}\n${task.body}\n${notes}`)
  );
}

function parentGoalNumber(body: string): number | undefined {
  const tagged = body.match(
    /Parent:\s*(?:https:\/\/github\.com\/)?onlyzoran\/win-predict-ai-orchestrator(?:\/issues\/|#)(\d+)/i,
  );
  return tagged ? Number(tagged[1]) : undefined;
}

function checksFailed(rollup: unknown): boolean {
  if (!Array.isArray(rollup)) return false;
  return rollup.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as { state?: string; conclusion?: string };
    const flag = `${row.state ?? ""} ${row.conclusion ?? ""}`.toLowerCase();
    return /fail|error|timed_out|cancelled/.test(flag);
  });
}

function gatherPrContext(prUrl: string, token: string): { text: string; checksFailed: boolean } {
  const { repo, number } = parsePrUrl(prUrl);
  let view = "";
  let failed = false;
  try {
    view = gh(
      [
        "pr",
        "view",
        String(number),
        "-R",
        repo,
        "--json",
        "title,body,url,files,additions,deletions,author,statusCheckRollup",
      ],
      token,
    );
    const parsed = JSON.parse(view) as { statusCheckRollup?: unknown };
    failed = checksFailed(parsed.statusCheckRollup);
  } catch (err) {
    view = `не удалось прочитать PR: ${err instanceof Error ? err.message : String(err)}`;
  }
  let diff = "";
  try {
    diff = gh(["pr", "diff", String(number), "-R", repo], token);
    if (diff.length > PR_DIFF_MAX_CHARS) {
      diff = `${diff.slice(0, PR_DIFF_MAX_CHARS)}\n… truncated`;
    }
  } catch (err) {
    diff = `не удалось снять diff: ${err instanceof Error ? err.message : String(err)}`;
  }
  return {
    checksFailed: failed,
    text: [`PR: ${prUrl}`, "", "gh pr view:", view, "", "gh pr diff:", diff || "(пусто)"].join("\n"),
  };
}

function validateReview(raw: unknown): Review {
  if (!raw || typeof raw !== "object") throw new Error("ревью не объект");
  const p = raw as Record<string, unknown>;
  const verdict = p.verdict;
  if (verdict !== "pass" && verdict !== "changes" && verdict !== "blocked") {
    throw new Error("некорректный verdict");
  }
  if (typeof p.summary !== "string" || !p.summary.trim()) throw new Error("пустой summary");
  if (!Array.isArray(p.findings) || !p.findings.every((item) => typeof item === "string" && item.trim())) {
    throw new Error("некорректные findings");
  }
  return {
    verdict,
    summary: p.summary.trim(),
    findings: (p.findings as string[]).map((item) => item.trim()),
  };
}

async function runReviewer(task: Task, issueUrl: string, prUrls: string[], token: string, extra = ""): Promise<Review> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");
  const reviewer = readFileSync(join(ROOT, "orchestrator/prompts/reviewer.md"), "utf8");
  const schema = readFileSync(join(ROOT, "orchestrator/schema/review.schema.json"), "utf8");
  const design = isVisualTask(task)
    ? readFileSync(join(ROOT, "orchestrator/prompts/design.md"), "utf8")
    : "";
  const prBlocks = prUrls.map((url) => gatherPrContext(url, token));
  const failedChecks = prBlocks.some((block) => block.checksFailed);
  const prompt = [
    reviewer,
    design ? `\n${design}\n` : "",
    "",
    "Схема вердикта (соблюдай строго):",
    schema,
    "",
    `Репозиторий: ${task.repo}`,
    `Поверхность: ${task.surface}`,
    `Child issue: ${issueUrl}`,
    `Заголовок: ${task.title}`,
    `Критерий куска: ${task.done_when}`,
    "",
    "Тело задачи:",
    task.body,
    extra,
    "",
    prBlocks.map((block) => block.text).join("\n\n---\n\n"),
    failedChecks ? "\nChecks PR красные — verdict не может быть pass." : "",
    "",
    "Верни только один блок ```json ... ``` с объектом вердикта. Никакого текста снаружи.",
  ].join("\n");

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    local: { cwd: ROOT },
  });
  console.log(`reviewer run=${result.id} status=${result.status} task=${task.id}`);
  if (result.status !== "finished") {
    throw new Error(runFailureMessage(result));
  }
  const review = validateReview(extractJson(result.result ?? ""));
  if (failedChecks && review.verdict === "pass") {
    return {
      verdict: "changes",
      summary: `${review.summary} Checks красные — pass снят.`,
      findings: [...review.findings, "Почини красные checks на PR."],
    };
  }
  if (review.verdict === "changes" && review.findings.length === 0) {
    return { ...review, verdict: "blocked", summary: `${review.summary} Ревьюер не дал пунктов — нужен человек.` };
  }
  return review;
}

async function maybePromoteGoal(childBody: string, token: string): Promise<void> {
  const goalNumber = parentGoalNumber(childBody);
  if (!goalNumber) return;
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  if (lastDispatchState(comments)?.phase === "review") return;
  const plan = extractStoredPlan(comments, goalNumber);
  if (!plan || plan.status !== "ready" || plan.tasks.length === 0) return;
  for (const task of plan.tasks) {
    const child = findExistingChild(task, plan.goal_number, token);
    if (!child) return;
    if (child.closed) continue;
    const { repo, number } = parseIssueUrl(child.url);
    const state = lastDispatchState(listIssueComments(repo, number, token));
    if (state?.phase !== "review") return;
    if (state.reviewVerdict === "changes") return;
  }
  const goalUrl = `https://github.com/${GOAL_REPO}/issues/${goalNumber}`;
  addToProject(goalUrl, "Review", token);
  commentOnGoal(
    goalNumber,
    formatDispatchComment(
      { phase: "review", at: new Date().toISOString() },
      [
        "**Воркеры.** Нужна приёмка — колонка Review. Замечания в Goal или child issue, карточку верни в In Progress. Merge сам.",
      ],
    ),
  );
  await notifyTelegram(`Goal #${goalNumber}: Review, нужна приёмка\n${goalUrl}`);
}

async function settleWithReviewer(
  task: Task,
  issueUrl: string,
  token: string,
  ctx: {
    prUrls: string[];
    source: string;
    agentId?: string;
    runId?: string;
    headRef?: string;
  },
): Promise<string> {
  const { repo, number } = parseIssueUrl(issueUrl);
  // Fallback: worker иногда забывает вставить URL PR в финальный summary.
  // Тогда берём открытые PR по child issue и отдаём ревьюеру их URL.
  let prUrls = ctx.prUrls;
  if (!prUrls.length) {
    try {
      prUrls = findOpenPrsForIssue(issueUrl, token);
    } catch {
      /* ignore fallback error */
    }
  }
  const prLines = prUrls.length ? prUrls.map((url) => `- ${url}`).join("\n") : "- (URL PR не найден)";
  const baseState = {
    agentId: ctx.agentId,
    runId: ctx.runId,
    prUrls,
    headRef: ctx.headRef,
  };

  if (!prUrls.length) {
    addToProject(issueUrl, "Review", token);
    commentOnIssue(
      repo,
      number,
      formatDispatchComment(
        { phase: "review", ...baseState, reviewVerdict: "blocked", at: new Date().toISOString() },
        [
          ctx.source,
          "",
          "**Нужна приёмка.** PR нет — реши сам. Замечания — комментарий в этот issue, карточку верни в In Progress. Merge сам.",
          prLines,
        ],
      ),
      token,
    );
    return `${issueUrl} — review blocked — нет PR`;
  }

  addToProject(issueUrl, "In Progress", token);
  claimReviewing(repo, number, token, baseState);
  const comments = listIssueComments(repo, number, token);
  const previousChanges = countReviewChanges(comments);
  const roundCap =
    previousChanges >= REVIEW_MAX_CHANGES
      ? `\nРаунд автоправок исчерпан (${previousChanges}/${REVIEW_MAX_CHANGES}). Не ставь changes — только pass или blocked.`
      : `\nУже было changes от ревьюера: ${previousChanges}/${REVIEW_MAX_CHANGES}.`;
  const iconGate = isNewIconTask(task)
    ? "\nЭто PR от `/new-icon` с вариантами A–D. Не ставь changes с требованием канонических IconFoo без суффикса и не зови MODE B на VPS. Выбор варианта — человек комментарием в PR. verdict: pass если варианты на месте и checks не красные, иначе blocked."
    : "";

  let review: Review;
  try {
    review = await runReviewer(
      task,
      issueUrl,
      prUrls,
      token,
      `${roundCap}${iconGate}\n\nСдача воркера:\n${ctx.source}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`reviewer ${task.id}: ${message}`);
    review = {
      verdict: "blocked",
      summary: `Ревьюер не смог: ${message.slice(0, 400)}`,
      findings: ["Автопроверка упала — посмотри PR сам."],
    };
  }

  if (review.verdict === "changes" && previousChanges >= REVIEW_MAX_CHANGES) {
    review = {
      verdict: "blocked",
      summary: `${review.summary} Лимит автоправок (${REVIEW_MAX_CHANGES}) — решай ты.`,
      findings: review.findings,
    };
  }

  const findingLines = review.findings.map((item) => `- ${item}`);
  const at = new Date().toISOString();
  if (review.verdict === "changes") {
    addToProject(issueUrl, "In Progress", token);
    commentOnIssue(
      repo,
      number,
      formatDispatchComment(
        {
          phase: "review",
          ...baseState,
          reviewVerdict: "changes",
          reviewRound: previousChanges + 1,
          at,
        },
        [
          ctx.source,
          "",
          `**Ревьюер: правки** (раунд ${previousChanges + 1}/${REVIEW_MAX_CHANGES}). Карточка In Progress — воркер MODE B на следующем тике.`,
          prLines,
          "",
          review.summary,
          ...findingLines,
        ],
      ),
      token,
    );
    await notifyTelegram(`Ревьюер: правки ${task.id}\n${issueUrl}\n${review.summary}`);
    return `${issueUrl} — review changes — ${prUrls.join(" ")}`;
  }

  addToProject(issueUrl, "Review", token);
  const headline =
    review.verdict === "pass"
      ? "**Нужна приёмка.** Ревьюер пропустил. Замечания — комментарий в этот issue, карточку верни в In Progress. Merge сам."
      : "**Нужна приёмка.** Ревьюер заблокировал (нужен человек). Замечания — комментарий в этот issue, карточку верни в In Progress. Merge сам.";
  commentOnIssue(
    repo,
    number,
    formatDispatchComment(
      { phase: "review", ...baseState, reviewVerdict: review.verdict, reviewRound: previousChanges, at },
      [ctx.source, "", headline, prLines, "", review.summary, ...findingLines],
    ),
    token,
  );
  await notifyTelegram(
    `Ревьюер: ${review.verdict} ${task.id}\n${issueUrl}\n${review.summary}\n${prUrls.join("\n")}`,
  );
  return `${issueUrl} — review ${review.verdict} — ${prUrls.join(" ")}`;
}

function taskFromBoardIssue(item: BoardIssue): Task {
  if (!isRepo(item.repo)) throw new Error(`не рабочий репо: ${item.repo}`);
  const fromLabel = item.labels.find((name) => isSurface(name));
  const surface = fromLabel && isSurface(fromLabel) ? fromLabel : REPO_SURFACE[item.repo];
  const id =
    item.body.match(/<!-- orchestrator-task:([a-z0-9-]+) -->/)?.[1] ?? `issue-${item.number}`;
  const doneWhen =
    item.body.match(/Критерий куска:\s*(.+)/)?.[1]?.trim() ?? "PR готов к merge.";
  return {
    id,
    surface,
    repo: item.repo,
    title: item.title,
    body: item.body,
    depends_on: [],
    parallel_group: 1,
    trigger: triggerFromBoardIssue(item.body, surface),
    done_when: doneWhen,
  };
}

async function finishNewIconWithoutMachine(
  issueUrl: string,
  token: string,
  prUrls: string[],
): Promise<string> {
  const { repo, number } = parseIssueUrl(issueUrl);
  addToProject(issueUrl, "Review", token);
  const prLines = prUrls.map((url) => `- ${url}`).join("\n");
  commentOnIssue(
    repo,
    number,
    formatDispatchComment(
      {
        phase: "review",
        prUrls,
        reviewVerdict: "blocked",
        at: new Date().toISOString(),
      },
      [
        "Slash `/new-icon` уже открыл PR с вариантами. Это не слот My Machines (`win-predict-vps`).",
        "",
        "**Нужна приёмка.** Выбери вариант A–D комментарием в PR — дальше choose-or-revise. Канонические имена и README — после выбора. Merge сам.",
        prLines,
      ],
    ),
    token,
  );
  await notifyTelegram(`Иконки: выбор в PR, не VPS\n${issueUrl}\n${prUrls.join("\n")}`);
  return `${issueUrl} — review blocked — ${prUrls.join(" ")}`;
}

async function runMachineWorker(
  task: Task,
  issueUrl: string,
  token: string,
  notes = "",
): Promise<{ runId: string; prUrls: string[]; agentId: string; headRef: string; summary: string }> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");
  addToProject(issueUrl, "In Progress", token);
  const occupancy: InventoryRun = {
    taskId: task.id,
    issueUrl,
    status: "starting",
    attempt: 1,
    startedAt: new Date().toISOString(),
  };
  await publishActiveRun(occupancy, "старт");
  const worker = readFileSync(join(ROOT, "orchestrator/prompts/worker.md"), "utf8");
  const design = isVisualTask(task, notes)
    ? readFileSync(join(ROOT, "orchestrator/prompts/design.md"), "utf8")
    : "";
  const { repo } = parseIssueUrl(issueUrl);
  const openPrs = findOpenPrs(issueUrl, token);
  const mode = openPrs.length ? "B" : "A";
  const headRef = mode === "B" ? openPrs[0].headRefName || "main" : "main";
  const prompt = [
    worker,
    design ? `\n${design}\n` : "",
    "",
    `Репозиторий: ${task.repo}`,
    `Child issue: ${issueUrl}`,
    `Заголовок: ${task.title}`,
    `Критерий куска: ${task.done_when}`,
    `Режим: MODE ${mode}`,
    mode === "B" ? `Открытый PR: ${openPrs[0].url}` : "Открытого PR нет.",
    `Ветка startingRef: ${headRef}`,
    "",
    "Тело задачи:",
    task.body,
    "",
    notes
      ? `Комментарии после последней сдачи (ревьюер и человек):\n${notes}`
      : "Новых комментариев после сдачи нет — перечитай issue и открытый PR, исправь недочёты.",
    "",
    mode === "B"
      ? "Это правка существующего PR. Новый PR не открывай. В конце — URL того же PR."
      : "Сделай задачу в этом репо. В конце — URL PR или причина, почему PR нет.",
  ].join("\n");

  const attempts = 4;
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      occupancy.attempt = attempt;
      try {
        await using agent = await Agent.create({
          apiKey,
          model: { id: "composer-2.5" },
          cloud: {
            env: { type: "machine", name: MACHINE_NAME },
            repos: [{ url: `https://github.com/${repo}`, startingRef: headRef }],
            skipReviewerRequest: true,
            envVars: { GH_TOKEN: token },
          },
        });
        const run = await agent.send(prompt);
        occupancy.status = "running";
        occupancy.agentId = agent.agentId;
        occupancy.runId = run.id;
        occupancy.detail = undefined;
        await publishActiveRun(occupancy, "слот занят");
        console.log(
          `worker task=${task.id} mode=${mode} ref=${headRef} agent=${agent.agentId} run=${run.id} machine=${MACHINE_NAME} attempt=${attempt}`,
        );
        const result = await run.wait();
        if (result.status !== "finished") {
          throw new Error(runFailureMessage(result));
        }
        const summary = (result.result ?? "").trim().slice(0, 1500) || "(нет текста)";
        const prUrls = extractPrUrls(summary);
        if (mode === "B" && !prUrls.length) prUrls.push(openPrs[0].url);
        occupancy.status = "review";
        occupancy.runId = result.id;
        occupancy.prUrls = prUrls;
        await closeActiveRun(occupancy, "готов");
        return { runId: result.id, prUrls, agentId: agent.agentId, headRef, summary };
      } catch (err) {
        lastError = err;
        if (!isRetryableWorkerStart(err) || attempt === attempts) throw err;
        const waitMs = 30_000 * attempt;
        const message = err instanceof Error ? err.message : String(err);
        occupancy.status = "retry";
        occupancy.detail = message.slice(0, 400);
        console.warn(`worker ${task.id} start failed, retry ${attempt}/${attempts} in ${waitMs}ms: ${message}`);
        await publishActiveRun(occupancy, "повтор");
        await sleep(waitMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    occupancy.status = isRetryableWorkerStart(err) ? "quota" : "error";
    occupancy.detail = message.slice(0, 400);
    await closeActiveRun(occupancy, occupancy.status === "quota" ? "квота" : "ошибка");
    throw err;
  }
}

async function dispatchTask(
  task: Task,
  issueUrl: string,
  token: string,
  opts: { skipIfOpenPr?: boolean; notes?: string } = {},
): Promise<string> {
  const { repo, number } = parseIssueUrl(issueUrl);
  const skipIfOpenPr = opts.skipIfOpenPr !== false;
  if (skipIfOpenPr && childAlreadyDispatched(issueUrl, token)) {
    const prs = findOpenPrsForIssue(issueUrl, token);
    const prNote = prs.length ? ` — ${prs.join(" ")}` : "";
    return `${issueUrl} — уже запускали${prNote}`;
  }
  if (task.trigger.type === "issue_only") {
    if (skipIfOpenPr) addToProject(issueUrl, "Inbox", token);
    return `${issueUrl} — issue_only, воркера нет`;
  }
  if (isNewIconTask(task)) {
    const existing = findOpenPrsForIssue(issueUrl, token);
    if (existing.length) {
      return finishNewIconWithoutMachine(issueUrl, token, existing);
    }
    addToProject(issueUrl, "In Progress", token);
    commentOnIssue(repo, number, task.trigger.command, token);
    await notifyTelegram(`Slash ${task.trigger.command}: ждём PR\n${issueUrl}`);
    const prUrls = await waitForOpenPr(issueUrl, token, SLASH_WAIT_MS);
    await notifyTelegram(`Slash ${task.trigger.command}: PR\n${prUrls.join("\n")}`);
    return settleWithReviewer(task, issueUrl, token, {
      prUrls,
      source: `Slash \`${task.trigger.command}\` открыл PR.`,
    });
  }
  const { runId, prUrls, agentId, headRef, summary } = await runMachineWorker(
    task,
    issueUrl,
    token,
    opts.notes ?? "",
  );
  return settleWithReviewer(task, issueUrl, token, {
    prUrls,
    agentId,
    runId,
    headRef,
    source: `My Machines воркер завершился (\`${runId}\`, agent \`${agentId}\`, \`${MACHINE_NAME}\`).\n\n${summary}`,
  });
}

async function dispatchPlan(
  plan: Plan,
  created: Map<string, string>,
  token: string,
  opts: { skipIfOpenPr?: boolean; notes?: string } = {},
): Promise<string[]> {
  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );
  const notes: string[] = [];
  for (const task of ordered) {
    const child = resolveChild(task, plan.goal_number, created, token);
    if (!child) {
      notes.push(`\`${task.id}\` — нет child issue`);
      continue;
    }
    const url = child.url;
    if (child.closed) {
      notes.push(`${url} — уже закрыт`);
      continue;
    }
    try {
      if (task.depends_on.length) {
        const unmet = task.depends_on.filter((id) => {
          const depTask = plan.tasks.find((t) => t.id === id);
          const dep = depTask
            ? resolveChild(depTask, plan.goal_number, created, token)
            : undefined;
          if (!dep) return true;
          if (dep.closed) return false;
          return findOpenPrsForIssue(dep.url, token).length === 0;
        });
        if (unmet.length) {
          notes.push(`${url} — жду PR у ${unmet.join(", ")}`);
          continue;
        }
      }
      notes.push(await dispatchTask(task, url, token, opts));
    } catch (err) {
      const prs = findOpenPrsForIssue(url, token);
      if (prs.length && isRetryableWorkerStart(err)) {
        notes.push(`${url} — квота Cursor, PR на месте ${prs.join(" ")}`);
        await notifyTelegram(`Квота Cursor, PR уже есть: ${task.id}\n${prs.join("\n")}`);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`${url} — ошибка: ${message}`);
      await reportChildFailure(url, task.id, err, token);
    }
  }
  return notes;
}

async function reportChildFailure(
  issueUrl: string,
  taskId: string,
  err: unknown,
  token: string,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  await notifyTelegram(`Ошибка воркера: ${taskId}\n${issueUrl}\n${message.slice(0, 500)}`);
  try {
    const { repo, number } = parseIssueUrl(issueUrl);
    commentOnIssue(
      repo,
      number,
      formatDispatchComment(
        { phase: "error", at: new Date().toISOString() },
        [
          `Не удалось запустить воркера: ${message}`,
          "",
          "Повтор: комментарий в issue и карточку верни в In Progress.",
        ],
      ),
      token,
    );
  } catch {
    /* ignore */
  }
}

async function decompose(issue: IssueCommentEvent["issue"], extra = ""): Promise<Plan> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");

  const manager = readFileSync(join(ROOT, "orchestrator/prompts/manager.md"), "utf8");
  const schema = readFileSync(join(ROOT, "orchestrator/schema/plan.schema.json"), "utf8");
  const labels = issue.labels.map((l) => l.name).join(", ") || "(нет)";
  const prompt = [
    manager,
    "",
    "Схема плана (соблюдай строго):",
    schema,
    "",
    "Goal Issue:",
    `номер: ${issue.number}`,
    `заголовок: ${issue.title}`,
    `лейблы: ${labels}`,
    "тело:",
    issue.body || "(пусто)",
    extra,
    "",
    "Верни только один блок ```json ... ``` с объектом плана. Никакого текста снаружи.",
  ].join("\n");

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    local: { cwd: ROOT },
  });

  console.log(`manager run=${result.id} status=${result.status}`);
  if (result.status !== "finished") {
    throw new Error(runFailureMessage(result));
  }
  return validatePlan(extractJson(result.result ?? ""), issue.number);
}

function loadEvent(): IssueCommentEvent {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("нет GITHUB_EVENT_PATH — запускай из GitHub Action");
  return JSON.parse(readFileSync(path, "utf8")) as IssueCommentEvent;
}

function isIdleDispatchNote(note: string): boolean {
  return note.includes("уже запускали") || note.includes("уже закрыт");
}

async function commentDispatch(
  goalNumber: number,
  goalUrl: string,
  notes: string[],
  token: string,
): Promise<boolean> {
  const failed = notes.some((n) => n.includes("ошибка") || n.includes("нет child"));
  const allSkipped = notes.length > 0 && notes.every(isIdleDispatchNote);
  const machineDone = notes.some((n) => /\/pull\/\d+/.test(n) || n.includes(" — machine ") || n.includes(" — review "));
  const bounced = notes.some((n) => n.includes("review changes"));
  const waiting = notes.some((n) => n.includes("жду PR"));
  const toReview = Boolean(token) && !failed && !allSkipped && machineDone && !bounced && !waiting;
  if (toReview) addToProject(goalUrl, "Review", token);
  const prefix = failed
    ? formatDispatchComment(
        { phase: "error", at: new Date().toISOString() },
        ["**Воркеры (есть ошибки).** Верни карточку в In Progress или `/orchestrate`."],
      )
    : toReview
      ? formatDispatchComment(
          {
            phase: "review",
            prUrls: notes.flatMap((n) => extractPrUrls(n)),
            at: new Date().toISOString(),
          },
          ["**Воркеры.** Нужна приёмка — колонка Review. Замечания в Goal или child issue, карточку верни в In Progress. Merge сам."],
        )
      : formatDispatchComment(
          { phase: "working", at: new Date().toISOString() },
          ["**Воркеры.**"],
        );
  commentOnGoal(goalNumber, `${prefix}\n\n${notes.map((n) => `- ${n}`).join("\n")}`);
  const digest = notes.map((n) => `- ${n}`).join("\n");
  if (failed) await notifyTelegram(`Goal #${goalNumber}: ошибки\n${goalUrl}\n${digest}`);
  else if (toReview) await notifyTelegram(`Goal #${goalNumber}: Review, нужна приёмка\n${goalUrl}\n${digest}`);
  else if (!allSkipped) await notifyTelegram(`Goal #${goalNumber}: воркеры\n${goalUrl}\n${digest}`);
  return !failed && !allSkipped;
}

function postPlanComment(issue: IssueCommentEvent["issue"], plan: Plan, created: Map<string, string>): void {
  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );
  const rows = ordered
    .map((task) => {
      const trigger = task.trigger.type === "slash" ? task.trigger.command : task.trigger.type;
      return `| \`${task.id}\` | ${task.repo} | ${created.get(task.id)} | ${trigger} |`;
    })
    .join("\n");
  const gates = plan.human_gates?.length
    ? `\n\nНужен человек: ${plan.human_gates.join("; ")}.`
    : "";
  commentOnGoal(
    issue.number,
    [
      PLAN_MARKER,
      `**План.** ${plan.summary}`,
      "",
      "| id | repo | issue | trigger |",
      "|---|---|---|---|",
      rows,
      gates,
      "",
      "```json",
      JSON.stringify(plan, null, 2),
      "```",
    ].join("\n"),
  );
}

function createChildrenFromPlan(plan: Plan, issue: IssueCommentEvent["issue"], token: string): Map<string, string> {
  const created = new Map<string, string>();
  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );
  for (const task of ordered) {
    created.set(task.id, createChildIssue(task, issue.number, created, token));
  }
  for (const surface of plan.surfaces) {
    ensureLabel(GOAL_REPO, surface, token);
  }
  if (plan.surfaces.length) {
    gh(
      ["issue", "edit", String(issue.number), "-R", GOAL_REPO, "--add-label", plan.surfaces.join(",")],
      token,
    );
  }
  addToProject(issue.html_url, "In Progress", token);
  postPlanComment(issue, plan, created);
  return created;
}

async function runGoalFirst(issue: IssueCommentEvent["issue"], token: string, redo: boolean): Promise<void> {
  const plan = await decompose(issue);
  if (plan.status !== "ready") {
    commentOnGoal(
      issue.number,
      `${PLAN_MARKER}\n**Статус:** \`${plan.status}\`\n\n${plan.summary}`,
    );
    await notifyTelegram(`Goal #${issue.number}: ${plan.status}\n${plan.summary}\n${issue.html_url}`);
    return;
  }
  const created = createChildrenFromPlan(plan, issue, token);
  await notifyTelegram(`Goal #${issue.number}: план готов, запускаю воркеров\n${plan.summary}\n${issue.html_url}`);
  const notes = await dispatchPlan(plan, created, token, { skipIfOpenPr: !redo });
  if (!(await commentDispatch(issue.number, issue.html_url, notes, token))) process.exitCode = 2;
}

async function runGoalRevision(
  issue: IssueCommentEvent["issue"],
  stored: Plan,
  humanNotes: string,
  token: string,
): Promise<void> {
  let plan = stored;
  try {
    plan = await decompose(
      issue,
      [
        "",
        "Это ПРАВКА существующего Goal, не новый план с нуля.",
        "Сохрани id существующих задач, если работа та же. Обнови body, если требования изменились.",
        "Добавь tasks только на новую работу. Не включай отменённые куски.",
        "Текущий план:",
        "```json",
        JSON.stringify(stored, null, 2),
        "```",
        humanNotes
          ? `Комментарии человека после Review:\n${humanNotes}`
          : "Новых комментариев нет — перечитай Goal и child, доведи незакрытое.",
      ].join("\n"),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`revise plan fallback to stored: ${message}`);
    plan = stored;
  }
  if (plan.status !== "ready") {
    commentOnGoal(
      issue.number,
      `${PLAN_MARKER}\n**Статус:** \`${plan.status}\`\n\n${plan.summary}`,
    );
    addToProject(issue.html_url, "Review", token);
    return;
  }
  const created = createChildrenFromPlan(plan, issue, token);
  if (humanNotes) {
    for (const url of created.values()) {
      const { repo, number } = parseIssueUrl(url);
      commentOnIssue(
        repo,
        number,
        `Правка с Goal #${issue.number}:\n\n${humanNotes}`,
        token,
      );
    }
  }
  const notes = await dispatchPlan(plan, created, token, {
    skipIfOpenPr: false,
    notes: humanNotes,
  });
  if (!(await commentDispatch(issue.number, issue.html_url, notes, token))) process.exitCode = 2;
}

function childWakeReason(state: DispatchState | undefined, comments: IssueComment[]): string {
  if (state?.phase === "error") return "после ошибки";
  if (state?.phase === "review" && state.reviewVerdict === "changes") return "после ревьюера";
  if (state?.phase === "review") return "после Review";
  if (state?.phase === "reviewing") return "повтор: ревьюер завис";
  if (state?.phase === "working" && notesAfterLastPhase(comments, "working")) {
    return "повтор: комментарий пока working";
  }
  if (state?.phase === "working") return "повтор: working завис";
  return state?.phase ?? "старт";
}

async function handleGoalFromBoard(item: BoardIssue, token: string): Promise<void> {
  if (item.closed) {
    console.log(`skip goal #${item.number}: closed`);
    return;
  }
  const comments = listIssueComments(item.repo, item.number, token);
  const state = lastDispatchState(comments);
  if (state?.phase === "error" && !notesAfterLastPhase(comments, "error")) {
    console.log(`skip goal #${item.number}: error, нет новых комментариев`);
    return;
  }
  if (isResourceBackoff(state, comments)) {
    console.log(`skip goal #${item.number}: resource_exhausted backoff`);
    return;
  }
  if (isActiveWorking(state) && !notesAfterLastPhase(comments, "working")) {
    console.log(`skip goal #${item.number}: already working`);
    return;
  }
  const stored = extractStoredPlan(comments, item.number);
  const issue = fetchIssue(item.repo, item.number, token);
  const why =
    state?.phase === "review"
      ? "правка после Review"
      : stored
        ? "догоняю воркеров"
        : "первый прогон";
  await notifyTelegram(`Доска: Goal #${item.number} — ${why}\n${item.url}`);
  claimWorking(item.repo, item.number, token);
  await sleep(CLAIM_WAIT_MS);
  const fresh = listIssueComments(item.repo, item.number, token);
  const humanNotes = notesAfterLastReview(fresh);
  if (state?.phase === "review" && stored) {
    await runGoalRevision(issue, stored, humanNotes, token);
    return;
  }
  if (stored) {
    await commentDispatchFromStored(issue, stored, token);
    return;
  }
  await runGoalFirst(issue, token, false);
}

async function handleChildFromBoard(item: BoardIssue, token: string): Promise<void> {
  if (item.closed) {
    console.log(`skip child ${item.url}: closed`);
    return;
  }
  const comments = listIssueComments(item.repo, item.number, token);
  const state = lastDispatchState(comments);
  if (state?.phase === "reviewing" && isActiveReviewing(state)) {
    console.log(`skip child ${item.url}: reviewing`);
    return;
  }
  if (!shouldWakeChild(state, comments, item.url)) {
    console.log(`skip child ${item.url}: phase=${state?.phase ?? "none"}`);
    return;
  }
  await notifyTelegram(
    `Доска: ${item.repo} #${item.number} — ${childWakeReason(state, comments)}\n${item.url}`,
  );
  claimWorking(item.repo, item.number, token);
  await sleep(CLAIM_WAIT_MS);
  const fresh = listIssueComments(item.repo, item.number, token);
  const humanNotes = notesForWorker(fresh);
  const task = taskFromBoardIssue(item);
  try {
    await dispatchTask(task, item.url, token, { skipIfOpenPr: false, notes: humanNotes });
    await maybePromoteGoal(item.body, token);
  } catch (err) {
    await reportChildFailure(item.url, task.id, err, token);
  }
}

async function watchBoard(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || !process.env.TELEGRAM_CHAT_ID?.trim()) {
    console.warn("telegram: нет TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID — в чат не пишу");
  }
  try {
    const inventory = writeInventory(readInventory());
    console.log(`inventory ${INVENTORY_PATH}: ${inventory.active.length}/${inventory.slots}`);
    const token = writeToken();
    if (!token) throw new Error("нет секрета ORCHESTRATOR_GITHUB_TOKEN");
    const items = listProjectIssues(token).filter(
      (item) => item.status === "In Progress" && !item.closed,
    );
    const goals = items.filter((item) => item.repo === GOAL_REPO && item.labels.includes("goal"));
    const children = items.filter((item) => isRepo(item.repo));
    console.log(`watch: ${goals.length} goal, ${children.length} child in In Progress`);
    for (const goal of goals) {
      await handleGoalFromBoard(goal, token);
    }
    const afterGoals = listProjectIssues(token).filter(
      (item) => item.status === "In Progress" && !item.closed,
    );
    const remaining = afterGoals.filter((item) => isRepo(item.repo));
    for (const child of remaining) {
      await handleChildFromBoard(child, token);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (shouldNotifyWatchError(message)) {
      const hint = isTransientGithub(message) ? "\nGitHub недоступен, повторю сам." : "";
      await notifyTelegram(`board-watch ошибка\n${message.slice(0, 500)}${hint}`);
    } else {
      console.warn(`telegram skip (тот же GitHub сбой): ${message.slice(0, 200)}`);
    }
    throw err;
  }
}

async function commentDispatchFromStored(
  issue: IssueCommentEvent["issue"],
  stored: Plan,
  token: string,
): Promise<void> {
  const notes = await dispatchPlan(stored, new Map(), token, { skipIfOpenPr: true });
  const allSkipped = notes.length > 0 && notes.every(isIdleDispatchNote);
  if (allSkipped) {
    commentOnGoal(
      issue.number,
      "Воркеры по этому плану уже запускались. Правка: комментарий в issue и карточку Review → In Progress. С нуля: `/orchestrate redo`.",
    );
    await notifyTelegram(`Goal #${issue.number}: уже запускали\n${issue.html_url}`);
    return;
  }
  if (!(await commentDispatch(issue.number, issue.html_url, notes, token))) process.exitCode = 2;
}

async function main(): Promise<void> {
  const event = loadEvent();
  const { comment, issue } = event;
  const login = comment.user.login;
  if (login.endsWith("[bot]")) {
    console.log("skip bot comment");
    return;
  }

  const first = comment.body.trim().split(/\s+/)[0]?.toLowerCase();
  if (first !== "/orchestrate") {
    console.log("skip: /orchestrate не команда");
    return;
  }
  const redo = /\/orchestrate\s+redo\b/i.test(comment.body);

  if (!issue.labels.some((l) => l.name === "goal")) {
    commentOnGoal(issue.number, "Команда `/orchestrate` только для Goal Issue (лейбл `goal`).");
    return;
  }

  await notifyTelegram(
    `Оркестратор: ${redo ? "redo " : ""}старт\n#${issue.number} ${issue.title}\n${issue.html_url}`,
  );

  const token = writeToken();
  const comments = listIssueComments(GOAL_REPO, issue.number, commentToken());
  if (isActiveWorking(lastDispatchState(comments))) {
    commentOnGoal(issue.number, "Уже в работе. Дождись Review или ошибки.");
    return;
  }
  const stored = extractStoredPlan(comments, issue.number);

  if (!redo && stored) {
    if (!token) {
      commentOnGoal(issue.number, "Нет `ORCHESTRATOR_GITHUB_TOKEN` — воркеров не запускаю.");
      return;
    }
    try {
      await commentDispatchFromStored(issue, stored, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      commentOnGoal(issue.number, `Диспетчер не смог запустить воркеров: ${message}`);
      await notifyTelegram(`Goal #${issue.number}: диспетчер упал\n${issue.html_url}\n${message.slice(0, 500)}`);
      process.exitCode = 2;
    }
    return;
  }

  if (!token) {
    commentOnGoal(
      issue.number,
      "План готов, но нет секрета `ORCHESTRATOR_GITHUB_TOKEN` (PAT с `repo` + `project` на все шесть репо). Child issues не созданы.",
    );
    return;
  }

  try {
    claimWorking(GOAL_REPO, issue.number, token);
    await runGoalFirst(issue, token, redo);
  } catch (err) {
    console.error(err);
    const extra =
      err instanceof CursorAgentError
        ? ` (${[err.code, err.isRetryable ? "retryable" : "not-retryable", err.requestId]
            .filter(Boolean)
            .join(", ")})`
        : "";
    const message = err instanceof Error ? err.message : String(err);
    commentOnGoal(
      issue.number,
      formatDispatchComment(
        { phase: "error", at: new Date().toISOString() },
        [`Оркестратор не смог собрать план: ${message}${extra}`],
      ),
    );
    await notifyTelegram(`Goal #${issue.number}: план не собрался\n${issue.html_url}\n${message.slice(0, 500)}${extra}`);
    process.exitCode = err instanceof CursorAgentError ? 1 : 2;
  }
}

const command = process.argv[2];
const boot =
  command === "watch"
    ? watchBoard()
    : main();

boot.catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
