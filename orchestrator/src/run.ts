import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { bumpMarker, matchGoalBumpPrs, matchGoalTaskPrs, parentLine, parseParentGoalNumber, taskMarker } from "./child-issue.js";
import {
  flattenPrUrls,
  formatGoalAcceptanceComment,
  type GoalTaskPrs,
} from "./acceptance.js";
import { unmetDependencyIds } from "./depends.js";
import {
  formatPublisherComment,
  isActivePublisher,
  isPrereleaseReady,
  latestPublisherState,
  needsPublisherRun,
  type PublisherState,
} from "./publisher-loop.js";
import {
  formatProductContext,
  getProduct,
  listBoardProjects,
  resolveBoardProject,
  resolveProductId,
  stubNeedsHumanPlan,
  taskMatchesProduct,
  type BoardProject,
} from "./products.js";
import {
  branchNameForPrerelease,
  bumpPackageOnBranch,
  isLibraryPackageRepo,
  openOrFindBumpPr,
  packageNameForLibraryRepo,
  publishLibraryPrerelease,
  waitForStablePackageVersion,
  type ConsumerBump,
} from "./prerelease.js";
import { formatPrLinkLines } from "./preview-url.js";
import {
  bumpSemver,
  buildVersionedChangelogEntry,
  createChangelogFile,
  insertVersionedChangelogEntry,
  resolveBumpTypeFromFiles,
  setPackageJsonVersion,
  setPackageLockRootVersion,
  stripPrerelease,
} from "./release.js";
import { goalQueueWaiting, pickGoalQueueHead } from "./goal-queue.js";
import {
  isPostPromoteWorkingEcho,
  REVIEWING_LABEL,
  shouldHaveReviewingLabel,
  shouldHaveWorkingLabel,
  WORKING_LABEL,
} from "./goal-working-label.js";
import { IDLE_DISPATCH_HINT, recentlyIdleDispatchNotified, taskOpenPrNeedsReview } from "./goal-idle.js";
import { formatHumanGatesForReviewer } from "./human-gates.js";
import {
  collectPreviewUrls,
  formatBrowserReviewBlock,
  isVisualTask,
  needsBrowserReview,
  playwrightMcpServers,
  waitForPreviewUrls,
} from "./visual-review.js";
import { goalRevisionFollowUpPending, goalRevisionPending } from "./goal-revision.js";
import { ensureGameScaffold, isGameRepo } from "./scaffold.js";
import { shouldReleaseForBoardPhase } from "./release-intent.js";
import { shouldSyncMainFromBoard, syncMainWorkerNotes } from "./sync-main.js";
import { shouldWakeOnPhase, type WakePhase } from "./wake-child.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOAL_REPO = "onlyzoran/win-predict-ai-orchestrator";

function isHqIssue(repo: string): boolean {
  return repo === GOAL_REPO;
}
const STATUS_NAMES = ["Inbox", "In Progress", "Review", "Done"] as const;
type StatusName = (typeof STATUS_NAMES)[number];
/** Legacy-колонка: ещё могут лежать старые карточки, новые не создаём. */
const LEGACY_READY_TO_RELEASE = "Ready to Release";
const STATUS_OPTION_COLOR: Record<StatusName, string> = {
  Inbox: "BLUE",
  "In Progress": "YELLOW",
  Review: "PURPLE",
  Done: "GREEN",
};
const statusOptionCaches = new Map<string, Partial<Record<StatusName, string>>>();
const PLAN_MARKER = "<!-- orchestrator-plan -->";
const DISPATCH_MARKER = "<!-- orchestrator-dispatch -->";
const STATE_RE = /<!-- orchestrator-state:(.*?) -->/;
const WORKING_STALE_MS = 3 * 60 * 60 * 1000;
const REVIEW_MAX_CHANGES = 2;
const REVIEW_CHANGES_DEBOUNCE_MS = 60_000;
const PR_DIFF_MAX_CHARS = 100_000;
const RESOURCE_BACKOFF_MS = 15 * 60 * 1000;
const PR_MERGEABLE_POLL_MS = 5_000;
const PR_MERGEABLE_POLLS = 6;
const MACHINE_NAME = process.env.CURSOR_MACHINE_NAME?.trim() || "win-predict-vps";
const MACHINE_SLOTS = 1;
const INVENTORY_PATH =
  process.env.ORCHESTRATOR_INVENTORY?.trim() ||
  join(process.env.HOME || tmpdir(), "data", "inventory.json");
const STATUS_DIR_FALLBACK = "/var/www/orchestrator-status";
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
  "onlyzoran/win-predict-ai-ios",
  "onlyzoran/shoppable-feed",
  "onlyzoran/gift-sales",
] as const;
const SURFACES = ["ui", "icons", "data", "app", "admin", "ios", "feed", "sales", "game"] as const;
const LABEL_META: Record<(typeof SURFACES)[number], { color: string; description: string }> = {
  ui: { color: "1d76db", description: "win-predict-ai-ui" },
  icons: { color: "fbca04", description: "win-predict-ai-icons" },
  data: { color: "0e8a16", description: "win-predict-ai-data" },
  app: { color: "d93f0b", description: "win-predict-ai" },
  admin: { color: "5319e7", description: "win-predict-ai-admin" },
  ios: { color: "e99695", description: "win-predict-ai-ios" },
  feed: { color: "006b75", description: "shoppable-feed" },
  sales: { color: "0052cc", description: "gift-sales" },
  game: { color: "c2e0c6", description: "ios-games" },
};
const REPO_SURFACE: Record<(typeof REPOS)[number], Surface> = {
  "onlyzoran/win-predict-ai-ui": "ui",
  "onlyzoran/win-predict-ai-icons": "icons",
  "onlyzoran/win-predict-ai-data": "data",
  "onlyzoran/win-predict-ai": "app",
  "onlyzoran/win-predict-ai-admin": "admin",
  "onlyzoran/win-predict-ai-ios": "ios",
  "onlyzoran/shoppable-feed": "feed",
  "onlyzoran/gift-sales": "sales",
};

type Surface = (typeof SURFACES)[number];
type Trigger =
  | { type: "slash"; command: "/ui-agent" | "/new-icon" }
  | { type: "sdk" }
  | { type: "issue_only" };
type DispatchPhase = "working" | "reviewing" | "review" | "releasing" | "error";
type ReviewVerdict = "pass" | "changes" | "blocked";
type DispatchState = {
  phase: DispatchPhase;
  taskId?: string;
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
  repo: string;
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
  title?: string;
  surface?: Surface;
  repo?: string;
  issueUrl: string;
  status: InventoryStatus;
  attempt: number;
  startedAt: string;
  model?: string;
  agentId?: string;
  runId?: string;
  prUrls?: string[];
  detail?: string;
};

type InventoryCard = {
  kind: "goal" | "child";
  repo: string;
  number: number;
  title: string;
  url: string;
  surface?: Surface;
};

type InventoryBoard = {
  inProgress: InventoryCard[];
  review: InventoryCard[];
  readyToRelease: InventoryCard[];
};

type Inventory = {
  machine: string;
  slots: number;
  updatedAt: string;
  active: InventoryRun[];
  last?: InventoryRun & { endedAt: string };
  board?: InventoryBoard;
};

function githubPat(): string {
  return process.env.GITHUB_PAT || process.env.ORCHESTRATOR_GITHUB_TOKEN || "";
}

function commentToken(): string {
  return process.env.GITHUB_TOKEN || githubPat() || "";
}

function writeToken(): string {
  return githubPat();
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

const TELEGRAM_TIMEOUT_MS = 15_000;

async function notifyTelegram(text: string): Promise<void> {
  const bot = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!bot || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
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

function emptyBoard(): InventoryBoard {
  return { inProgress: [], review: [], readyToRelease: [] };
}

function emptyInventory(): Inventory {
  return {
    machine: MACHINE_NAME,
    slots: MACHINE_SLOTS,
    updatedAt: new Date().toISOString(),
    active: [],
    board: emptyBoard(),
  };
}

function normalizeBoard(value: Inventory["board"] | undefined): InventoryBoard {
  if (!value || !Array.isArray(value.inProgress) || !Array.isArray(value.review)) {
    return emptyBoard();
  }
  return {
    inProgress: value.inProgress,
    review: value.review,
    readyToRelease: Array.isArray(value.readyToRelease) ? value.readyToRelease : [],
  };
}

function statusDir(): string {
  const fromEnv = process.env.ORCHESTRATOR_STATUS_DIR?.trim();
  if (fromEnv) return fromEnv;
  try {
    if (existsSync(STATUS_DIR_FALLBACK)) return STATUS_DIR_FALLBACK;
  } catch {
    /* no public copy */
  }
  return "";
}

function writePublicStatus(inventory: Inventory): void {
  const dir = statusDir();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "inventory.json");
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, dest);
  } catch (err) {
    console.warn(`status copy: ${err instanceof Error ? err.message : String(err)}`);
  }
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
      board: normalizeBoard(parsed.board),
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
  inventory.board = normalizeBoard(inventory.board);
  mkdirSync(dirname(INVENTORY_PATH), { recursive: true });
  const tmp = `${INVENTORY_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o644 });
  renameSync(tmp, INVENTORY_PATH);
  writePublicStatus(inventory);
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
      const title = run.title ? ` · ${run.title}` : "";
      const model = run.model ? ` · ${run.model}` : "";
      lines.push(`${run.status} · ${run.taskId}${title}${model} · ${formatRunAge(run.startedAt)}${attempt}`);
      if (run.detail) lines.push(run.detail.slice(0, 300));
      lines.push(run.issueUrl);
    }
  } else {
    lines.push("свободно");
    if (inventory.last) {
      const lastModel = inventory.last.model ? ` · ${inventory.last.model}` : "";
      lines.push(`последний: ${inventory.last.taskId} · ${inventory.last.status}${lastModel}`);
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
    const env = { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token };
    delete env.ORCHESTRATOR_PROJECT_ID;
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      env,
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

function parseGhJsonArray<T>(raw: string): T[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length && Array.isArray(parsed[0])) return (parsed as T[][]).flat();
      return parsed as T[];
    }
    return [parsed as T];
  } catch {
    const pages = `[${text.replace(/\]\s*\[/g, "],[")}]`;
    return (JSON.parse(pages) as T[][]).flat();
  }
}

function listIssueComments(repo: string, issueNumber: number, token: string): IssueComment[] {
  const raw = gh(
    ["api", "--paginate", `repos/${repo}/issues/${issueNumber}/comments?per_page=100`],
    token,
  );
  return parseGhJsonArray<IssueComment>(raw);
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
        raw.phase === "releasing" ||
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

/** Состояние всей Goal (без taskId). Комментарии по кускам плана не считаются. */
function lastGoalDispatchState(comments: IssueComment[]): DispatchState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchState(comment.body);
    if (state && !state.taskId) return state;
  }
  return undefined;
}

/** Goal-level dispatch for phase labels; skips post-promote working echo. */
function goalDispatchStateForLabels(comments: IssueComment[]): DispatchState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchState(comment.body);
    if (!state || state.taskId) continue;
    if (state.phase === "working" && isPostPromoteWorkingEcho(comment.body)) continue;
    return state;
  }
  return undefined;
}

function lastDispatchStateForTask(comments: IssueComment[], taskId: string): DispatchState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchState(comment.body);
    if (state?.taskId === taskId) return state;
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
  let reviewChangesDebounce = false;
  if (state?.phase === "review" && state.reviewVerdict === "changes" && state.at) {
    const at = Date.parse(state.at);
    reviewChangesDebounce = !Number.isNaN(at) && Date.now() - at < REVIEW_CHANGES_DEBOUNCE_MS;
  }
  return shouldWakeOnPhase({
    phase: state?.phase as WakePhase | undefined,
    resourceBackoff: isResourceBackoff(state, comments),
    reviewingActive: isActiveReviewing(state),
    reviewChangesDebounce,
    notesAfterWorking: Boolean(notesAfterLastPhase(comments, "working")),
    slotFailed: slotFailedFor(issueUrl),
    workingActive: isActiveWorking(state),
    releasingActive: isActivePhase(state, "releasing"),
  });
}

function phaseVisibleLine(state: DispatchState): string | undefined {
  switch (state.phase) {
    case "working":
      return "working";
    case "reviewing":
      return "reviewing";
    case "releasing":
      return "releasing";
    default:
      return undefined;
  }
}

function formatDispatchComment(state: DispatchState, lines: string[]): string {
  const bodyLines = lines.length ? lines : phaseVisibleLine(state) ? [phaseVisibleLine(state)!] : [];
  return [DISPATCH_MARKER, `<!-- orchestrator-state:${JSON.stringify(state)} -->`, ...bodyLines].join(
    "\n",
  );
}

function claimWorking(repo: string, issueNumber: number, token: string): void {
  commentGoalDispatch(
    issueNumber,
    { phase: "working", at: new Date().toISOString() },
    [],
    token,
  );
}

function claimReviewing(
  repo: string,
  issueNumber: number,
  token: string,
  state: Pick<DispatchState, "agentId" | "runId" | "prUrls" | "headRef">,
): void {
  commentGoalDispatch(
    issueNumber,
    { phase: "reviewing", ...state, at: new Date().toISOString() },
    [],
    token,
  );
}

function claimReleasing(
  repo: string,
  issueNumber: number,
  token: string,
  state: Pick<DispatchState, "prUrls"> = {},
): void {
  commentGoalDispatch(
    issueNumber,
    { phase: "releasing", ...state, at: new Date().toISOString() },
    [],
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
  return [lastReviewerChanges(comments), notesAfterLastReview(comments), lastReleaseConflictNote(comments)]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function hadGoalReviewAcceptance(comments: IssueComment[]): boolean {
  return comments.some((comment) => {
    const state = parseDispatchState(comment.body);
    if (state?.phase === "review" && !state.taskId) return true;
    return comment.body.includes(DISPATCH_MARKER) && /Нужна приёмка/.test(comment.body);
  });
}

/** Review → In Progress + фраза про релиз → релизer, иначе воркер. */
function shouldReleaseFromBoard(
  state: DispatchState | undefined,
  comments: IssueComment[],
): boolean {
  const notes = notesAfterLastReview(comments);
  if (!shouldReleaseForBoardPhase(state?.phase, notes, hadGoalReviewAcceptance(comments))) return false;
  if (lastReleaseConflictNote(comments)) return false;
  const phase = state?.phase;
  if (phase === "error") {
    const lastError = [...comments]
      .reverse()
      .find((comment) => parseDispatchState(comment.body)?.phase === "error");
    // Merge уже был, упал только promote — не крутить полный релиз снова.
    if (lastError && /promote stable/i.test(lastError.body)) return false;
    if (isResourceBackoff(state, comments)) return false;
    return true;
  }
  return true;
}

const ACCEPT_HINT =
  "Замечания — комментарий в этот issue, карточку верни в In Progress. Ок — комментарий вроде «релизь» / «можно релизить» и снова In Progress.";

function lastReleaseConflictNote(comments: IssueComment[]): string {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchState(comment.body);
    if (!state) continue;
    // Только последний dispatch: старые конфликты не должны снова слать в In Progress.
    if (
      state.phase === "error" &&
      /конфликт|conflict|не mergeable|cannot be cleanly created|cannot update pr branch/i.test(
        comment.body,
      )
    ) {
      return stripDispatchChrome(comment.body);
    }
    return "";
  }
  return "";
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

function goalUrl(goalNumber: number): string {
  return `https://github.com/${GOAL_REPO}/issues/${goalNumber}`;
}

function listRepoPrs(
  repo: string,
  state: "open" | "merged",
  token: string,
): Array<{ url: string; body: string; title: string; headRefName: string }> {
  const raw = gh(
    ["pr", "list", "-R", repo, "--state", state, "--limit", "30", "--json", "url,body,title,headRefName"],
    token,
  );
  return JSON.parse(raw) as Array<{ url: string; body: string; title: string; headRefName: string }>;
}

function findOpenPrsForGoalTask(goalNumber: number, taskId: string, repo: string, token: string): OpenPr[] {
  const parent = parentLine(GOAL_REPO, goalNumber);
  return matchGoalTaskPrs(listRepoPrs(repo, "open", token), parent, taskId).map((pr) => ({
    url: pr.url,
    headRefName: pr.headRefName,
  }));
}

function findOpenBumpPrsForGoalTask(goalNumber: number, taskId: string, repo: string, token: string): OpenPr[] {
  const parent = parentLine(GOAL_REPO, goalNumber);
  return matchGoalBumpPrs(listRepoPrs(repo, "open", token), parent, taskId).map((pr) => ({
    url: pr.url,
    headRefName: pr.headRefName,
  }));
}

function collectOpenPrsForGoal(plan: Plan, token: string): GoalTaskPrs {
  const map: GoalTaskPrs = new Map();
  for (const task of plan.tasks) {
    const seen = new Set<string>();
    const urls: string[] = [];
    const add = (url: string) => {
      if (seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };
    for (const pr of findOpenPrsForGoalTask(plan.goal_number, task.id, task.repo, token)) add(pr.url);
    for (const pr of findOpenBumpPrsForGoalTask(plan.goal_number, task.id, task.repo, token)) add(pr.url);
    if (urls.length) map.set(task.id, urls);
  }
  return map;
}

function findOpenConsumerPrsForGoalTask(
  goalNumber: number,
  taskId: string,
  repo: string,
  token: string,
): OpenPr[] {
  const worker = findOpenPrsForGoalTask(goalNumber, taskId, repo, token);
  if (worker.length) return worker;
  return findOpenBumpPrsForGoalTask(goalNumber, taskId, repo, token);
}

function prHeadSha(prUrl: string, token: string): string {
  const { repo, number } = parsePrUrl(prUrl);
  const raw = gh(["pr", "view", String(number), "-R", repo, "--json", "headRefOid"], token);
  const parsed = JSON.parse(raw) as { headRefOid?: string };
  if (!parsed.headRefOid) throw new Error(`нет headRefOid для ${prUrl}`);
  return parsed.headRefOid;
}

function findMergedPrsForGoalTask(goalNumber: number, taskId: string, repo: string, token: string): OpenPr[] {
  const parent = parentLine(GOAL_REPO, goalNumber);
  return matchGoalTaskPrs(listRepoPrs(repo, "merged", token), parent, taskId).map((pr) => ({
    url: pr.url,
    headRefName: pr.headRefName,
  }));
}

function taskProgress(
  task: Task,
  goalNumber: number,
  token: string,
): { url: string; closed: boolean } | undefined {
  const open = findOpenPrsForGoalTask(goalNumber, task.id, task.repo, token);
  if (open.length) return { url: open[0].url, closed: false };
  const merged = findMergedPrsForGoalTask(goalNumber, task.id, task.repo, token);
  if (merged.length) return { url: merged[0].url, closed: true };
  return undefined;
}

function linkPrToGoal(prUrl: string, goalNumber: number, taskId: string, token: string): void {
  const { repo, number } = parsePrUrl(prUrl);
  const view = JSON.parse(
    gh(["pr", "view", String(number), "-R", repo, "--json", "body"], token),
  ) as { body: string };
  const parent = parentLine(GOAL_REPO, goalNumber);
  const marker = taskMarker(taskId);
  let body = view.body || "";
  if (!body.includes(parent)) body = `${parent}\n${body}`;
  if (!body.includes(marker)) body = `${marker}\n${body}`;
  if (body === (view.body || "")) return;
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const file = join(dir, "pr.md");
  writeFileSync(file, body);
  gh(["pr", "edit", String(number), "-R", repo, "--body-file", file], token);
}

async function waitForGoalTaskPr(
  goalNumber: number,
  task: Task,
  token: string,
  timeoutMs: number,
): Promise<string[]> {
  const started = Date.now();
  for (;;) {
    const prs = findOpenPrsForGoalTask(goalNumber, task.id, task.repo, token);
    if (prs.length) return prs.map((p) => p.url);
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `воркер не открыл PR за ${Math.round(timeoutMs / 60000)} мин. Повтор: Goal снова In Progress.`,
      );
    }
    const left = Math.round((timeoutMs - (Date.now() - started)) / 1000);
    console.log(`wait PR Goal #${goalNumber} ${task.id} (${left}s left)`);
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

function isRepo(value: unknown, gameRepo?: string): value is string {
  if (typeof value !== "string") return false;
  if ((REPOS as readonly string[]).includes(value)) return true;
  if (isGameRepo(value)) return !gameRepo || value === gameRepo;
  return false;
}

function validatePlan(raw: unknown, goalNumber: number, productId?: string, gameRepo?: string): Plan {
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

const PRODUCT_LABEL_META: Record<string, { color: string; description: string }> = {
  "win-predict-ai": { color: "5319e7", description: "продукт win-predict-ai" },
  "telegram-bots": { color: "1d76db", description: "продукт telegram-bots (stub)" },
  "ios-games": { color: "d93f0b", description: "продукт ios-games" },
  "shoppable-feed": { color: "006b75", description: "продукт shoppable-feed" },
  "gift-sales": { color: "0052cc", description: "продукт gift-sales" },
};

function ensureProductLabel(productId: string, token: string): void {
  const entry = getProduct(productId);
  const meta = PRODUCT_LABEL_META[productId] ?? {
    color: "ededed",
    description: `продукт ${productId}`,
  };
  gh(
    [
      "label",
      "create",
      entry.label,
      "-R",
      GOAL_REPO,
      "--color",
      meta.color,
      "--description",
      meta.description,
      "--force",
    ],
    token,
  );
}

function ensureGoalProductLabel(issueNumber: number, productId: string, token: string): void {
  const entry = getProduct(productId);
  ensureProductLabel(productId, token);
  const labels = fetchIssue(GOAL_REPO, issueNumber, token).labels.map((l) => l.name);
  if (labels.includes(entry.label)) return;
  gh(
    ["issue", "edit", String(issueNumber), "-R", GOAL_REPO, "--add-label", entry.label],
    token,
  );
}

function ensureWorkingLabel(token: string): void {
  gh(
    [
      "label",
      "create",
      WORKING_LABEL,
      "-R",
      GOAL_REPO,
      "--color",
      "fbca04",
      "--description",
      "оркестратор сейчас работает над Goal",
      "--force",
    ],
    token,
  );
}

function ensureReviewingLabel(token: string): void {
  gh(
    [
      "label",
      "create",
      REVIEWING_LABEL,
      "-R",
      GOAL_REPO,
      "--color",
      "5319e7",
      "--description",
      "ревьюер смотрит PR Goal",
      "--force",
    ],
    token,
  );
}

function syncGoalPhaseLabel(
  issueNumber: number,
  label: string,
  want: boolean,
  labels: string[],
  token: string,
): void {
  if (want && !labels.includes(label)) {
    gh(["issue", "edit", String(issueNumber), "-R", GOAL_REPO, "--add-label", label], token);
  } else if (!want && labels.includes(label)) {
    gh(["issue", "edit", String(issueNumber), "-R", GOAL_REPO, "--remove-label", label], token);
  }
}

function syncGoalPhaseLabels(issueNumber: number, state: DispatchState | undefined, token: string): void {
  ensureWorkingLabel(token);
  ensureReviewingLabel(token);
  const labels = fetchIssue(GOAL_REPO, issueNumber, token).labels.map((l) => l.name);
  const now = Date.now();
  syncGoalPhaseLabel(
    issueNumber,
    WORKING_LABEL,
    shouldHaveWorkingLabel(state, now, WORKING_STALE_MS),
    labels,
    token,
  );
  syncGoalPhaseLabel(
    issueNumber,
    REVIEWING_LABEL,
    shouldHaveReviewingLabel(state, now, WORKING_STALE_MS),
    labels,
    token,
  );
}

function commentGoalDispatch(
  issueNumber: number,
  state: DispatchState,
  lines: string[],
  token?: string,
): void {
  const t = token ?? commentToken();
  const body = formatDispatchComment(state, lines);
  if (!t) {
    console.error(body);
    return;
  }
  commentOnIssue(GOAL_REPO, issueNumber, body, t);
  syncGoalPhaseLabels(issueNumber, state, t);
}

function graphql<T>(token: string, query: string, variables: Record<string, string | null | undefined>): T {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value == null || value === "") continue;
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

type StatusOption = { id: string; name: string; color: string };

function productIdForGoalUrl(url: string, token: string): string {
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (!match || !url.includes(GOAL_REPO)) return resolveProductId([]);
  const issue = fetchIssue(GOAL_REPO, Number(match[1]), token);
  return resolveProductId(issue.labels.map((l) => l.name));
}

function boardStatusFallback(board: BoardProject): Partial<Record<StatusName, string>> {
  const out: Partial<Record<StatusName, string>> = {};
  for (const name of STATUS_NAMES) {
    const id = board.statusOptions?.[name];
    if (id) out[name] = id;
  }
  return out;
}

function listStatusOptions(token: string, board: BoardProject): StatusOption[] {
  const data = graphql<{
    node: {
      field: { options: StatusOption[] } | null;
    } | null;
  }>(
    token,
    'query($projectId:ID!){node(id:$projectId){...on ProjectV2{field(name:"Status"){...on ProjectV2SingleSelectField{options{id name color}}}}}}',
    { projectId: board.id },
  );
  if (!data.node) {
    throw new Error(`GitHub Project ${board.id} not found (deleted or stale ORCHESTRATOR_PROJECT_ID?)`);
  }
  return data.node.field?.options ?? [];
}

function ensureStatusOptions(token: string, board: BoardProject): Partial<Record<StatusName, string>> {
  const cached = statusOptionCaches.get(board.id);
  if (cached) return cached;
  let options = listStatusOptions(token, board);
  const byName = new Map(options.map((option) => [option.name, option]));
  const missing = STATUS_NAMES.filter((name) => !byName.has(name));
  if (missing.length) {
    const next = [
      ...options.map((option) => ({
        id: option.id,
        name: option.name,
        color: option.color || "GRAY",
        description: "",
      })),
      ...missing.map((name) => ({
        name,
        color: STATUS_OPTION_COLOR[name],
        description: "",
      })),
    ];
    const mutation = `mutation($input:UpdateProjectV2FieldInput!){updateProjectV2Field(input:$input){projectV2Field{...on ProjectV2SingleSelectField{options{id name color}}}}}`;
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const file = join(dir, "graphql.json");
    writeFileSync(
      file,
      JSON.stringify({
        query: mutation,
        variables: {
          input: {
            fieldId: board.statusFieldId,
            singleSelectOptions: next,
          },
        },
      }),
    );
    const raw = gh(["api", "graphql", "--input", file], token);
    const payload = JSON.parse(raw) as {
      data?: {
        updateProjectV2Field?: {
          projectV2Field?: { options?: StatusOption[] };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((e) => e.message).join("; "));
    }
    options = payload.data?.updateProjectV2Field?.projectV2Field?.options ?? listStatusOptions(token, board);
    console.log(`project Status: созданы колонки ${missing.join(", ")}`);
  }
  const map: Partial<Record<StatusName, string>> = { ...boardStatusFallback(board) };
  for (const option of options) {
    if ((STATUS_NAMES as readonly string[]).includes(option.name)) {
      map[option.name as StatusName] = option.id;
    }
  }
  statusOptionCaches.set(board.id, map);
  return map;
}

function statusOptionId(status: StatusName, token: string, board: BoardProject): string {
  const id = ensureStatusOptions(token, board)[status] ?? boardStatusFallback(board)[status];
  if (!id) throw new Error(`нет option id для колонки ${status}`);
  return id;
}

function ensureAllBoardStatusOptions(token: string): void {
  for (const board of listBoardProjects()) {
    ensureStatusOptions(token, board);
  }
}

function addToProject(url: string, status: StatusName, token: string, productId?: string): void {
  try {
    const pid = productId ?? productIdForGoalUrl(url, token);
    const board = resolveBoardProject(pid);
    const contentId = issueNodeId(url, token);
    const added = graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      token,
      "mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}",
      { projectId: board.id, contentId },
    );
    graphql(
      token,
      "mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}",
      {
        projectId: board.id,
        itemId: added.addProjectV2ItemById.item.id,
        fieldId: board.statusFieldId,
        optionId: statusOptionId(status, token, board),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`project add ${url}: ${message}`);
  }
}

function listProjectIssuesFor(token: string, board: BoardProject): BoardIssue[] {
  const query = `query($projectId:ID!,$after:String){node(id:$projectId){...on ProjectV2{items(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{id fieldValues(first:20){nodes{...on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2SingleSelectField{id}}}}} content{__typename ...on Issue{number title body url state repository{nameWithOwner} labels(first:20){nodes{name}}}}}}}}}`;
  const issues: BoardIssue[] = [];
  let after: string | null = null;
  for (;;) {
    const data = graphql<{
      node: {
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
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
      } | null;
    }>(token, query, { projectId: board.id, after });
    if (!data.node) {
      throw new Error(`GitHub Project ${board.id} not found (deleted or stale ORCHESTRATOR_PROJECT_ID?)`);
    }
    for (const item of data.node.items.nodes) {
      const content = item.content;
      if (!content || content.__typename !== "Issue" || !content.repository || !content.number || !content.url) {
        continue;
      }
      const status =
        item.fieldValues.nodes.find((node) => node.field?.id === board.statusFieldId)?.name ?? "";
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
    if (!data.node.items.pageInfo.hasNextPage) break;
    after = data.node.items.pageInfo.endCursor;
  }
  return issues;
}

function listProjectIssues(token: string): BoardIssue[] {
  const seen = new Set<string>();
  const issues: BoardIssue[] = [];
  for (const board of listBoardProjects()) {
    for (const item of listProjectIssuesFor(token, board)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      issues.push(item);
    }
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

const VPS_PREVIEW_SCRIPTS: Record<string, { script: string; ifMissingEnv: string }> = {
  "onlyzoran/gift-sales": {
    script: "gift-sales-preview-up.sh",
    ifMissingEnv: "GIFT_SALES_PREVIEW_IF_MISSING",
  },
  "onlyzoran/shoppable-feed": {
    script: "shoppable-feed-preview-up.sh",
    ifMissingEnv: "SHOPPABLE_FEED_PREVIEW_IF_MISSING",
  },
};

function ensureVpsPreview(
  task: Task,
  goalNumber: number,
  headRef?: string,
  opts?: { ifMissing?: boolean },
): void {
  const config = VPS_PREVIEW_SCRIPTS[task.repo];
  if (!config) return;
  const scriptOverride =
    task.repo === "onlyzoran/gift-sales"
      ? process.env.ORCHESTRATOR_GIFT_SALES_PREVIEW_SCRIPT?.trim()
      : task.repo === "onlyzoran/shoppable-feed"
        ? process.env.ORCHESTRATOR_SHOPPABLE_FEED_PREVIEW_SCRIPT?.trim()
        : undefined;
  const script = scriptOverride || join(ROOT, `orchestrator/ops/${config.script}`);
  if (!existsSync(script)) {
    console.warn(`preview ${task.repo}: нет ${script}`);
    return;
  }
  const args = [script, String(goalNumber)];
  if (headRef?.trim()) args.push(headRef.trim());
  console.log(`preview ${task.repo}: bash ${args.join(" ")}`);
  const result = spawnSync("bash", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(opts?.ifMissing ? { [config.ifMissingEnv]: "1" } : {}),
    },
  });
  if (result.status !== 0) {
    console.warn(`preview ${task.repo}: ${(result.stderr || result.stdout || "failed").trim()}`);
  }
}

async function runReviewer(
  task: Task,
  goalIssueUrl: string,
  goalNumber: number,
  prUrls: string[],
  token: string,
  extra = "",
  humanGates: string[] = [],
  headRef?: string,
): Promise<Review> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");
  const reviewer = readFileSync(join(ROOT, "orchestrator/prompts/reviewer.md"), "utf8");
  const schema = readFileSync(join(ROOT, "orchestrator/schema/review.schema.json"), "utf8");
  const design = isVisualTask(task, extra)
    ? readFileSync(join(ROOT, "orchestrator/prompts/design.md"), "utf8")
    : "";
  const prBlocks = prUrls.map((url) => gatherPrContext(url, token));
  const failedChecks = prBlocks.some((block) => block.checksFailed);
  const humanGatesBlock = formatHumanGatesForReviewer(humanGates);
  ensureVpsPreview(task, goalNumber, headRef);
  const browserReview = needsBrowserReview(task, prUrls, goalNumber, extra);
  let browserBlock = "";
  let mcpServers: ReturnType<typeof playwrightMcpServers> | undefined;
  if (browserReview) {
    const previewUrls = collectPreviewUrls(prUrls, goalNumber);
    console.log(`reviewer ${task.id}: browser review, demo ${previewUrls.join(", ")}`);
    const previewResults = await waitForPreviewUrls(previewUrls);
    browserBlock = formatBrowserReviewBlock(previewResults, task);
    mcpServers = playwrightMcpServers(ROOT);
  }
  const prompt = [
    reviewer,
    design ? `\n${design}\n` : "",
    "",
    "Схема вердикта (соблюдай строго):",
    schema,
    "",
    `Репозиторий: ${task.repo}`,
    `Поверхность: ${task.surface}`,
    `Goal: ${goalIssueUrl}`,
    `task id: ${task.id}`,
    `Заголовок: ${task.title}`,
    `Критерий куска: ${task.done_when}`,
    "",
    "Тело задачи:",
    task.body,
    humanGatesBlock ? `\n${humanGatesBlock}` : "",
    extra,
    "",
    prBlocks.map((block) => block.text).join("\n\n---\n\n"),
    failedChecks ? "\nChecks PR красные — verdict не может быть pass." : "",
    browserBlock ? `\n${browserBlock}` : "",
    "",
    "Верни только один блок ```json ... ``` с объектом вердикта. Никакого текста снаружи.",
  ].join("\n");

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    local: { cwd: ROOT },
    ...(mcpServers ? { mcpServers } : {}),
  });
  console.log(
    `reviewer run=${result.id} status=${result.status} task=${task.id}${browserReview ? " browser" : ""}`,
  );
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

function countReviewChangesForTask(comments: IssueComment[], taskId: string): number {
  let lastReset = -1;
  comments.forEach((comment, index) => {
    const state = parseDispatchState(comment.body);
    if (state?.taskId !== taskId) return;
    if (state.reviewVerdict === "pass" || state.reviewVerdict === "blocked") lastReset = index;
  });
  return comments.slice(lastReset + 1).filter((comment) => {
    const state = parseDispatchState(comment.body);
    return state?.taskId === taskId && state.reviewVerdict === "changes";
  }).length;
}

function taskNeedsLocalReview(
  task: Task,
  goalNumber: number,
  comments: IssueComment[],
  token: string,
): OpenPr[] | undefined {
  const progress = taskProgress(task, goalNumber, token);
  if (!progress || progress.closed) return undefined;
  const state = lastDispatchStateForTask(comments, task.id);
  const open = findOpenPrsForGoalTask(goalNumber, task.id, task.repo, token);
  if (
    !taskOpenPrNeedsReview(
      state
        ? { phase: state.phase, reviewVerdict: state.reviewVerdict, reviewingActive: isActiveReviewing(state) }
        : undefined,
      open.length > 0,
      false,
    )
  ) {
    return undefined;
  }
  return open;
}

/** Open PR exists but reviewer never finished (e.g. worker error after opening PR). */
async function maybeReviewOpenPrsWithoutVerdict(plan: Plan, token: string): Promise<boolean> {
  const comments = listIssueComments(GOAL_REPO, plan.goal_number, token);
  let reviewed = false;
  for (const task of plan.tasks) {
    const open = taskNeedsLocalReview(task, plan.goal_number, comments, token);
    if (!open) continue;
    const state = lastDispatchStateForTask(comments, task.id);
    await settleWithReviewer(task, plan.goal_number, token, {
      prUrls: open.map((p) => p.url),
      source: "PR открыт, ревью не завершено — local reviewer.",
      agentId: state?.agentId,
      runId: state?.runId,
      headRef: state?.headRef ?? open[0]?.headRefName,
    });
    reviewed = true;
  }
  return reviewed;
}

async function finishIdleGoalDispatch(goalNumber: number, comments: IssueComment[], token: string): Promise<boolean> {
  const plan = extractStoredPlan(comments, goalNumber);
  if (!plan || plan.status !== "ready") return false;
  if (goalRevisionFollowUpPending(comments, plan.tasks.map((task) => task.id))) {
    console.log(`goal #${goalNumber}: revision follow-up pending, skip idle promote`);
    return false;
  }
  await maybeReviewOpenPrsWithoutVerdict(plan, token);
  await maybePromoteGoal(goalNumber, token);
  const fresh = listIssueComments(GOAL_REPO, goalNumber, token);
  if (lastGoalDispatchState(fresh)?.phase === "review") {
    console.log(`goal #${goalNumber}: idle workers → Review`);
    return true;
  }
  if (recentlyIdleDispatchNotified(fresh, DISPATCH_MARKER)) {
    console.log(`goal #${goalNumber}: idle, skip duplicate notify`);
    return false;
  }
  commentOnGoal(goalNumber, IDLE_DISPATCH_HINT);
  await notifyTelegram(`Goal #${goalNumber}: уже запускали\n${goalUrl(goalNumber)}`);
  return false;
}

async function maybePromoteGoal(goalNumber: number, token: string): Promise<boolean> {
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  if (lastGoalDispatchState(comments)?.phase === "review") return false;
  const plan = extractStoredPlan(comments, goalNumber);
  if (!plan || plan.status !== "ready" || plan.tasks.length === 0) return false;
  for (const task of plan.tasks) {
    const progress = taskProgress(task, plan.goal_number, token);
    if (!progress) return false;
    if (progress.closed) continue;
    const state = lastDispatchStateForTask(comments, task.id);
    if (state?.phase !== "review") return false;
    if (state.reviewVerdict === "changes") return false;
  }
  addToProject(goalUrl(goalNumber), "Review", token);
  const prsByTask = collectOpenPrsForGoal(plan, token);
  const allPrUrls = flattenPrUrls(prsByTask);
  commentGoalDispatch(
    goalNumber,
    { phase: "review", at: new Date().toISOString(), prUrls: allPrUrls },
    formatGoalAcceptanceComment(plan, prsByTask, ACCEPT_HINT),
    token,
  );
  await notifyTelegram(
    `Goal #${goalNumber}: Review, нужна приёмка\n${goalUrl(goalNumber)}${allPrUrls.length ? `\n${allPrUrls.join("\n")}` : ""}`,
  );
  return true;
}

async function settleWithReviewer(
  task: Task,
  goalNumber: number,
  token: string,
  ctx: {
    prUrls: string[];
    source: string;
    agentId?: string;
    runId?: string;
    headRef?: string;
  },
): Promise<string> {
  const issueUrl = goalUrl(goalNumber);
  let prUrls = ctx.prUrls;
  if (!prUrls.length) {
    try {
      prUrls = findOpenPrsForGoalTask(goalNumber, task.id, task.repo, token).map((p) => p.url);
    } catch {
      /* ignore */
    }
  }
  const prLines = formatPrLinkLines(prUrls, goalNumber);
  const baseState = {
    taskId: task.id,
    agentId: ctx.agentId,
    runId: ctx.runId,
    prUrls,
    headRef: ctx.headRef,
  };

  if (!prUrls.length) {
    commentGoalDispatch(
      goalNumber,
      { phase: "review", ...baseState, reviewVerdict: "blocked", at: new Date().toISOString() },
      [
        `\`${task.id}\` · ${task.repo}`,
        ctx.source,
        "",
        `**Нужна приёмка.** PR нет — реши сам. ${ACCEPT_HINT}`,
        prLines,
      ],
      token,
    );
    return `${task.id} — review blocked — нет PR`;
  }

  commentGoalDispatch(
    goalNumber,
    { phase: "reviewing", ...baseState, at: new Date().toISOString() },
    [],
    token,
  );
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  const humanGates = extractStoredPlan(comments, goalNumber)?.human_gates ?? [];
  const previousChanges = countReviewChangesForTask(comments, task.id);
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
      goalNumber,
      prUrls,
      token,
      `${roundCap}${iconGate}\n\nСдача воркера:\n${ctx.source}`,
      humanGates,
      ctx.headRef,
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
    commentGoalDispatch(
      goalNumber,
      {
        phase: "review",
        ...baseState,
        reviewVerdict: "changes",
        reviewRound: previousChanges + 1,
        at,
      },
      [
        `\`${task.id}\` · ${task.repo}`,
        ctx.source,
        "",
        `**Ревьюер: правки** (раунд ${previousChanges + 1}/${REVIEW_MAX_CHANGES}). Goal In Progress — воркер MODE B на следующем тике.`,
        prLines,
        "",
        review.summary,
        ...findingLines,
      ],
      token,
    );
    await notifyTelegram(`Ревьюер: правки ${task.id}\n${issueUrl}\n${review.summary}`);
    return `${task.id} — review changes — ${prUrls.join(" ")}`;
  }

  commentGoalDispatch(
    goalNumber,
    { phase: "review", ...baseState, reviewVerdict: review.verdict, reviewRound: previousChanges, at },
    [
      `\`${task.id}\` · ${task.repo}`,
      ctx.source,
      "",
      review.verdict === "pass"
        ? `**Кусок готов к приёмке.** ${ACCEPT_HINT}`
        : `**Ревьюер заблокировал** (нужен человек). ${ACCEPT_HINT}`,
      prLines,
      "",
      review.summary,
      ...findingLines,
    ],
    token,
  );
  await notifyTelegram(
    `Ревьюер: ${review.verdict} ${task.id}\n${issueUrl}\n${review.summary}\n${prUrls.join("\n")}`,
  );
  await maybePromoteGoal(goalNumber, token);
  return `${task.id} — review ${review.verdict} — ${prUrls.join(" ")}`;
}

async function finishNewIconWithoutMachine(
  task: Task,
  goalNumber: number,
  token: string,
  prUrls: string[],
): Promise<string> {
  const prLines = formatPrLinkLines(prUrls, goalNumber);
  commentGoalDispatch(
    goalNumber,
    {
      phase: "review",
      taskId: task.id,
      prUrls,
      reviewVerdict: "blocked",
      at: new Date().toISOString(),
    },
    [
      `\`${task.id}\` · ${task.repo}`,
      "Slash `/new-icon` уже открыл PR с вариантами. Это не слот My Machines (`win-predict-vps`).",
      "",
      `**Нужна приёмка.** Выбери вариант A–D комментарием в PR. ${ACCEPT_HINT}`,
      prLines,
    ],
    token,
  );
  await notifyTelegram(`Иконки: выбор в PR, не VPS\n${goalUrl(goalNumber)}\n${prUrls.join("\n")}`);
  await maybePromoteGoal(goalNumber, token);
  return `${task.id} — review blocked — ${prUrls.join(" ")}`;
}

async function runMachineWorker(
  task: Task,
  goalNumber: number,
  token: string,
  notes = "",
): Promise<{ runId: string; prUrls: string[]; agentId: string; headRef: string; summary: string }> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");
  const issueUrl = goalUrl(goalNumber);
  addToProject(issueUrl, "In Progress", token);
  const workerModel = "composer-2.5";
  const occupancy: InventoryRun = {
    taskId: task.id,
    title: task.title,
    surface: task.surface,
    repo: task.repo,
    issueUrl,
    status: "starting",
    attempt: 1,
    startedAt: new Date().toISOString(),
    model: workerModel,
  };
  await publishActiveRun(occupancy, "старт");
  const worker = readFileSync(join(ROOT, "orchestrator/prompts/worker.md"), "utf8");
  const design = isVisualTask(task, notes)
    ? readFileSync(join(ROOT, "orchestrator/prompts/design.md"), "utf8")
    : "";
  const openPrs = findOpenPrsForGoalTask(goalNumber, task.id, task.repo, token);
  const mode = openPrs.length ? "B" : "A";
  const headRef = mode === "B" ? openPrs[0].headRefName || "main" : "main";
  const parent = parentLine(GOAL_REPO, goalNumber);
  const prompt = [
    worker,
    design ? `\n${design}\n` : "",
    "",
    `Репозиторий: ${task.repo}`,
    `Goal: ${issueUrl}`,
    `task id: ${task.id}`,
    `Parent line (вставь в тело PR): ${parent}`,
    `Маркер задачи (вставь в тело PR): ${taskMarker(task.id)}`,
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
      ? `Комментарии после последней сдачи (ревьюер и человек на Goal):\n${notes}`
      : "Новых комментариев после сдачи нет — перечитай Goal и открытый PR, исправь недочёты.",
    "",
    mode === "B"
      ? "Это правка существующего PR. Новый PR не открывай. В конце — URL того же PR."
      : "Сделай задачу в этом репо. В конце — URL PR или причина, почему PR нет. Не пиши Closes на Goal.",
  ].join("\n");

  const attempts = 4;
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      occupancy.attempt = attempt;
      try {
        await using agent = await Agent.create({
          apiKey,
          model: { id: workerModel },
          cloud: {
            env: { type: "machine", name: MACHINE_NAME },
            repos: [{ url: `https://github.com/${task.repo}`, startingRef: headRef }],
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
        for (const url of prUrls) {
          try {
            linkPrToGoal(url, goalNumber, task.id, token);
          } catch (err) {
            console.warn(`link PR ${url}: ${err instanceof Error ? err.message : err}`);
          }
        }
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

function consumerPrBody(task: Task, goalNumber: number, packageName: string, version: string): string {
  return [
    bumpMarker(task.id),
    parentLine(GOAL_REPO, goalNumber),
    "",
    `Тестовая версия \`${packageName}@${version}\` из библиотеки Goal #${goalNumber}.`,
    "Оркестратор подтянул prerelease для интеграции до merge библиотеки.",
  ].join("\n");
}

async function bumpPrereleaseIntoGoalConsumers(
  goalNumber: number,
  packageName: string,
  version: string,
  token: string,
): Promise<ConsumerBump[]> {
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  const plan = extractStoredPlan(comments, goalNumber);
  if (!plan || plan.status !== "ready") return [];

  const results: ConsumerBump[] = [];
  const consumers = plan.tasks.filter((t) => t.surface === "app" || t.surface === "admin");
  const goalIssue = goalUrl(goalNumber);
  for (const task of consumers) {
    const open = findOpenConsumerPrsForGoalTask(goalNumber, task.id, task.repo, token);
    const commitMessage = `chore: bump ${packageName} to ${version}`;
    try {
      if (open.length) {
        const branch = open[0].headRefName;
        const bumped = bumpPackageOnBranch({
          repo: task.repo,
          branch,
          packageName,
          version,
          token,
          commitMessage,
        });
        results.push({
          repo: task.repo,
          issueUrl: goalIssue,
          prUrl: open[0].url,
          note: bumped.changed
            ? `обновил ${packageName}@${version} в ${open[0].url}`
            : `уже ${packageName}@${version} в ${open[0].url}`,
        });
        continue;
      }

      const branch = branchNameForPrerelease(packageName, version);
      const bumped = bumpPackageOnBranch({
        repo: task.repo,
        branch,
        packageName,
        version,
        token,
        createBranchFromMain: true,
        commitMessage,
      });
      const title = `chore: bump ${packageName} to ${version}`;
      const body = consumerPrBody(task, goalNumber, packageName, version);
      const prUrl = openOrFindBumpPr({
        repo: task.repo,
        branch,
        title,
        body,
        token,
        gh,
      });
      results.push({
        repo: task.repo,
        issueUrl: goalIssue,
        prUrl,
        note: bumped.changed
          ? `создал bump PR ${prUrl}`
          : `уже ${packageName}@${version} — ${prUrl || branch}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        repo: task.repo,
        issueUrl: goalIssue,
        prUrl: "",
        note: `ошибка bump ${task.repo}: ${message.slice(0, 240)}`,
      });
    }
  }
  return results;
}

async function runPublisherLoopForTask(
  task: Task,
  goalNumber: number,
  prUrl: string,
  token: string,
  prSha?: string,
): Promise<string> {
  const publishing: PublisherState = {
    taskId: task.id,
    phase: "publishing",
    prUrl,
    prSha,
    at: new Date().toISOString(),
  };
  commentOnGoal(
    goalNumber,
    formatPublisherComment(publishing, [
      `**Publisher.** \`${task.id}\` — publish + bump app/admin…`,
      `- PR: ${prUrl}`,
    ]),
  );

  try {
    const published = publishLibraryPrerelease(prUrl, token, gh);
    const bumps = await bumpPrereleaseIntoGoalConsumers(
      goalNumber,
      published.packageName,
      published.version,
      token,
    );
    const bumpLines = bumps.length
      ? bumps.map((b) => `- ${b.note}`)
      : ["- consumer app/admin в плане Goal нет или PR ещё нет"];
    const done: PublisherState = {
      taskId: task.id,
      phase: "bump_done",
      prUrl,
      prSha: published.sha,
      packageName: published.packageName,
      version: published.version,
      at: new Date().toISOString(),
    };
    commentOnGoal(
      goalNumber,
      formatPublisherComment(done, [
        `**Publisher.** \`${task.id}\` — prerelease готов.`,
        `- пакет: \`${published.packageName}@${published.version}\``,
        `- dist-tag: \`${published.tag}\``,
        `- PR: ${published.prUrl}`,
        published.skippedPublish ? "- publish: уже был в registry" : "- publish: ok",
        "",
        "Подтянул в app/admin:",
        ...bumpLines,
      ]),
    );
    await notifyTelegram(
      `Publisher ${published.packageName}@${published.version}\n${goalUrl(goalNumber)}\n${bumps.map((b) => b.note).join("\n")}`,
    );
    return `publisher ${task.id} — ${published.packageName}@${published.version}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`publisher ${task.id}: ${message}`);
    const failed: PublisherState = {
      taskId: task.id,
      phase: "publish_error",
      prUrl,
      prSha,
      at: new Date().toISOString(),
    };
    commentOnGoal(
      goalNumber,
      formatPublisherComment(failed, [
        `**Publisher не вышел** (\`${task.id}\`). ${message.slice(0, 500)}`,
        "Повтор — на следующем тике catch-up или после пуша в PR библиотеки.",
      ]),
    );
    await notifyTelegram(`Publisher ошибка\n${goalUrl(goalNumber)}\n${message.slice(0, 400)}`);
    return `publisher ${task.id} — ошибка`;
  }
}

async function afterLibraryPr(
  task: Task,
  goalNumber: number,
  prUrls: string[],
  token: string,
): Promise<string> {
  if (!isLibraryPackageRepo(task.repo) || !prUrls.length) return "";
  const prUrl = prUrls[0];
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  const state = latestPublisherState(comments, task.id);
  let prSha: string | undefined;
  try {
    prSha = prHeadSha(prUrl, token);
  } catch {
    /* optional for gate */
  }
  if (
    !needsPublisherRun({
      repo: task.repo,
      openPrUrl: prUrl,
      openPrSha: prSha,
      state,
      publishingActive: isActivePublisher(state),
    })
  ) {
    return state?.packageName && state.version ? `${state.packageName}@${state.version}` : "";
  }
  return runPublisherLoopForTask(task, goalNumber, prUrl, token, prSha);
}

async function maybeRunPublisherLoop(plan: Plan, token: string): Promise<string[]> {
  const comments = listIssueComments(GOAL_REPO, plan.goal_number, token);
  const notes: string[] = [];
  for (const task of plan.tasks) {
    if (!isLibraryPackageRepo(task.repo)) continue;
    const open = findOpenPrsForGoalTask(plan.goal_number, task.id, task.repo, token);
    if (!open.length) continue;
    const prUrl = open[0].url;
    const state = latestPublisherState(comments, task.id);
    if (isActivePublisher(state)) {
      notes.push(`\`${task.id}\` — publisher…`);
      continue;
    }
    let prSha: string | undefined;
    try {
      prSha = prHeadSha(prUrl, token);
    } catch {
      /* optional */
    }
    if (
      !needsPublisherRun({
        repo: task.repo,
        openPrUrl: prUrl,
        openPrSha: prSha,
        state,
      })
    ) {
      continue;
    }
    notes.push(await runPublisherLoopForTask(task, plan.goal_number, prUrl, token, prSha));
  }
  return notes;
}

function prereleaseReadyForDependency(
  plan: Plan,
  depId: string,
  comments: IssueComment[],
  token: string,
): boolean {
  const depTask = plan.tasks.find((t) => t.id === depId);
  if (!depTask || !isLibraryPackageRepo(depTask.repo)) return true;
  const progress = taskProgress(depTask, plan.goal_number, token);
  if (!progress?.url || progress.closed) return true;
  const open = findOpenPrsForGoalTask(plan.goal_number, depId, depTask.repo, token);
  if (!open.length) return false;
  const state = latestPublisherState(comments, depId);
  return isPrereleaseReady(state, open[0].url);
}

async function promoteStableIntoGoalConsumers(
  goalNumber: number,
  libraryRepo: string,
  stableVersion: string,
  token: string,
): Promise<string[]> {
  const packageName = packageNameForLibraryRepo(libraryRepo);
  if (!packageName) return [];
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  const plan = extractStoredPlan(comments, goalNumber);
  if (!plan || plan.status !== "ready") return [];

  const notes: string[] = [];
  const consumers = plan.tasks.filter((t) => t.surface === "app" || t.surface === "admin");
  for (const task of consumers) {
    const open = findOpenConsumerPrsForGoalTask(goalNumber, task.id, task.repo, token);
    if (!open.length) {
      notes.push(`${task.repo}: открытого PR нет — skip`);
      continue;
    }
    try {
      const bumped = bumpPackageOnBranch({
        repo: task.repo,
        branch: open[0].headRefName,
        packageName,
        version: stableVersion,
        token,
        exact: false,
        commitMessage: `chore: bump ${packageName} to ${stableVersion}`,
      });
      notes.push(
        bumped.changed
          ? `${open[0].url}: ${packageName}@${stableVersion}`
          : `${open[0].url}: уже ${stableVersion}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`${task.repo}: ошибка promote — ${message.slice(0, 200)}`);
    }
  }
  return notes;
}

function findPrsClosingIssue(issueUrl: string, token: string): OpenPr[] {
  const { repo, number } = parseIssueUrl(issueUrl);
  const items = listRepoPrs(repo, "open", token);
  const closeRe = new RegExp(`(?:closes|fixes|resolves)\\s+#${number}\\b`, "i");
  const issueRe = new RegExp(`github\\.com/${repo}/issues/${number}\\b`, "i");
  return items
    .filter((pr) => closeRe.test(pr.body || "") || closeRe.test(pr.title || "") || issueRe.test(pr.body || ""))
    .map((pr) => ({ url: pr.url, headRefName: pr.headRefName }));
}

function createSlashTriggerIssue(task: Task, goalNumber: number, token: string): string {
  ensureLabel(task.repo, task.surface, token);
  const body = [
    taskMarker(task.id),
    parentLine(GOAL_REPO, goalNumber),
    "",
    task.body.trim(),
    "",
    `Goal: ${goalUrl(goalNumber)}`,
    `Критерий куска: ${task.done_when}`,
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const file = join(dir, "issue.md");
  writeFileSync(file, body);
  return gh(
    ["issue", "create", "-R", task.repo, "--title", task.title, "--body-file", file, "--label", task.surface],
    token,
  );
}

async function dispatchTask(
  task: Task,
  goalNumber: number,
  token: string,
  opts: { skipIfOpenPr?: boolean; notes?: string } = {},
): Promise<string> {
  const skipIfOpenPr = opts.skipIfOpenPr !== false;
  const open = findOpenPrsForGoalTask(goalNumber, task.id, task.repo, token);
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  const taskState = lastDispatchStateForTask(comments, task.id);
  const needsModeB = taskState?.reviewVerdict === "changes" || Boolean(opts.notes);
  if (skipIfOpenPr && open.length && !needsModeB) {
    return `${task.id} — уже запускали — ${open.map((p) => p.url).join(" ")}`;
  }
  if (task.trigger.type === "issue_only") {
    return `${task.id} — issue_only, воркера нет`;
  }
  if (isNewIconTask(task)) {
    if (open.length) {
      await afterLibraryPr(task, goalNumber, open.map((p) => p.url), token);
      return finishNewIconWithoutMachine(task, goalNumber, token, open.map((p) => p.url));
    }
    const triggerUrl = createSlashTriggerIssue(task, goalNumber, token);
    const { repo, number } = parseIssueUrl(triggerUrl);
    commentOnIssue(repo, number, task.trigger.command, token);
    await notifyTelegram(`Slash ${task.trigger.command}: ждём PR\n${triggerUrl}`);
    const started = Date.now();
    let prUrls: string[] = [];
    for (;;) {
      prUrls = findPrsClosingIssue(triggerUrl, token).map((p) => p.url);
      if (prUrls.length) break;
      if (Date.now() - started >= SLASH_WAIT_MS) {
        throw new Error(
          `slash-воркер не открыл PR за ${Math.round(SLASH_WAIT_MS / 60000)} мин. Повтор: Goal снова In Progress.`,
        );
      }
      await sleep(SLASH_POLL_MS);
    }
    for (const url of prUrls) linkPrToGoal(url, goalNumber, task.id, token);
    await notifyTelegram(`Slash ${task.trigger.command}: PR\n${prUrls.join("\n")}`);
    await afterLibraryPr(task, goalNumber, prUrls, token);
    return settleWithReviewer(task, goalNumber, token, {
      prUrls,
      source: `Slash \`${task.trigger.command}\` открыл PR.`,
    });
  }
  const { runId, prUrls, agentId, headRef, summary } = await runMachineWorker(
    task,
    goalNumber,
    token,
    opts.notes ?? "",
  );
  await afterLibraryPr(task, goalNumber, prUrls, token);
  return settleWithReviewer(task, goalNumber, token, {
    prUrls,
    agentId,
    runId,
    headRef,
    source: `My Machines воркер завершился (\`${runId}\`, agent \`${agentId}\`, \`${MACHINE_NAME}\`).\n\n${summary}`,
  });
}

async function dispatchPlan(
  plan: Plan,
  token: string,
  opts: { skipIfOpenPr?: boolean; notes?: string } = {},
): Promise<string[]> {
  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );
  const notes: string[] = [];
  const comments = listIssueComments(GOAL_REPO, plan.goal_number, token);
  const depCtx = {
    prereleaseReady: (depId: string) => prereleaseReadyForDependency(plan, depId, comments, token),
  };
  for (const task of ordered) {
    const progress = taskProgress(task, plan.goal_number, token);
    if (progress?.closed) {
      notes.push(`\`${task.id}\` — PR смержен ${progress.url}`);
      continue;
    }
    const reviewing = lastDispatchStateForTask(comments, task.id);
    if (reviewing?.phase === "reviewing" && isActiveReviewing(reviewing)) {
      notes.push(`\`${task.id}\` — ревьюер смотрит`);
      continue;
    }
    try {
      if (task.depends_on.length) {
        const unmet = unmetDependencyIds(
          task,
          plan.tasks,
          (id) => {
            const depTask = plan.tasks.find((t) => t.id === id);
            return depTask ? taskProgress(depTask, plan.goal_number, token) : undefined;
          },
          (depUrl) => /\/pull\/\d+/.test(depUrl),
          depCtx,
        );
        if (unmet.length) {
          const publishWait = task.depends_on.filter(
            (id) => unmet.includes(id) && !depCtx.prereleaseReady(id),
          );
          if (publishWait.length) {
            notes.push(`\`${task.id}\` — жду publish ${publishWait.join(", ")}`);
          } else {
            notes.push(`\`${task.id}\` — жду ${unmet.join(", ")}`);
          }
          continue;
        }
      }
      notes.push(await dispatchTask(task, plan.goal_number, token, opts));
    } catch (err) {
      const prs = findOpenPrsForGoalTask(plan.goal_number, task.id, task.repo, token).map((p) => p.url);
      if (prs.length && isRetryableWorkerStart(err)) {
        notes.push(`\`${task.id}\` — квота Cursor, PR на месте ${prs.join(" ")}`);
        await notifyTelegram(`Квота Cursor, PR уже есть: ${task.id}\n${prs.join("\n")}`);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`\`${task.id}\` — ошибка: ${message}`);
      await reportTaskFailure(plan.goal_number, task.id, err, token);
    }
  }
  return notes;
}

async function reportTaskFailure(
  goalNumber: number,
  taskId: string,
  err: unknown,
  token: string,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  await notifyTelegram(`Ошибка воркера: ${taskId}\n${goalUrl(goalNumber)}\n${message.slice(0, 500)}`);
  try {
    commentGoalDispatch(
      goalNumber,
      { phase: "error", taskId, at: new Date().toISOString() },
      [
        `Не удалось запустить воркера \`${taskId}\`: ${message}`,
        "",
        "Повтор: комментарий в Goal и карточку верни в In Progress.",
      ],
      token,
    );
  } catch {
    /* ignore */
  }
}

function postNonReadyPlan(issue: IssueCommentEvent["issue"], plan: Plan, token: string): void {
  commentOnGoal(
    issue.number,
    [
      PLAN_MARKER,
      `**Статус:** \`${plan.status}\``,
      "",
      plan.summary,
      "",
      formatPlanJsonDetails(plan),
    ].join("\n"),
  );
  addToProject(issue.html_url, "Review", token);
  syncGoalPhaseLabels(issue.number, undefined, token);
}

async function decompose(
  issue: IssueCommentEvent["issue"],
  extra = "",
  opts?: { gameRepo?: string },
): Promise<Plan> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");

  const productId = resolveProductId(issue.labels.map((l) => l.name));
  const product = getProduct(productId);
  if (product.status === "stub") {
    return stubNeedsHumanPlan(issue.number, productId) as Plan;
  }

  const manager = readFileSync(join(ROOT, "orchestrator/prompts/manager.md"), "utf8");
  const schema = readFileSync(join(ROOT, "orchestrator/schema/plan.schema.json"), "utf8");
  const labels = issue.labels.map((l) => l.name).join(", ") || "(нет)";
  const prompt = [
    manager,
    "",
    formatProductContext(productId, undefined, opts?.gameRepo ? { gameRepo: opts.gameRepo } : undefined),
    "",
    "Схема плана (соблюдай строго):",
    schema,
    "",
    "Goal Issue:",
    `номер: ${issue.number}`,
    `заголовок: ${issue.title}`,
    `лейблы: ${labels}`,
    `продукт: ${productId}`,
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
  return validatePlan(extractJson(result.result ?? ""), issue.number, productId, opts?.gameRepo);
}

function prepareIosGamesScaffold(
  issue: IssueCommentEvent["issue"],
  productId: string,
  token: string,
): string | undefined {
  if (productId !== "ios-games") return undefined;
  const product = getProduct(productId);
  if (!product.templateRepo) throw new Error("ios-games: нет templateRepo в registry");
  const comments = listIssueComments(GOAL_REPO, issue.number, token);
  return ensureGameScaffold(GOAL_REPO, issue.number, product.templateRepo, comments, token).repo;
}

function loadEvent(): IssueCommentEvent {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("нет GITHUB_EVENT_PATH — запускай из GitHub Action");
  return JSON.parse(readFileSync(path, "utf8")) as IssueCommentEvent;
}

function isIdleDispatchNote(note: string): boolean {
  return (
    note.includes("уже запускали") ||
    note.includes("уже закрыт") ||
    note.includes("смержен") ||
    note.includes(" — жду ") ||
    note.includes("жду publish") ||
    note.includes("жду PR") ||
    note.includes("ревьюер смотрит") ||
    note.includes("publisher…")
  );
}

/**
 * After a child advances (Review or Done), start plan tasks whose depends_on are now met.
 * Same-repo chains wait for merge; cross-repo can start on open PR (prerelease).
 */
async function catchUpGoalByNumber(goalNumber: number, token: string): Promise<void> {
  const comments = listIssueComments(GOAL_REPO, goalNumber, token);
  const plan = extractStoredPlan(comments, goalNumber);
  if (!plan || plan.status !== "ready" || plan.tasks.length === 0) return;

  console.log(`catch-up Goal #${goalNumber}`);
  const publisherNotes = await maybeRunPublisherLoop(plan, token);
  const notes = [...publisherNotes, ...(await dispatchPlan(plan, token, { skipIfOpenPr: true }))];
  const shouldReport = notes.some((n) => !isIdleDispatchNote(n));
  if (!shouldReport) {
    if (await finishIdleGoalDispatch(goalNumber, comments, token)) return;
    console.log(`catch-up Goal #${goalNumber}: nothing to start`);
    return;
  }
  if (!(await commentDispatch(goalNumber, goalUrl(goalNumber), notes, token))) process.exitCode = 2;
  await notifyTelegram(`Goal #${goalNumber}: догонка воркеров\n${goalUrl(goalNumber)}`);
}

async function commentDispatch(
  goalNumber: number,
  goalIssueUrl: string,
  notes: string[],
  token: string,
): Promise<boolean> {
  const failed = notes.some((n) => n.includes("ошибка"));
  const allSkipped = notes.length > 0 && notes.every(isIdleDispatchNote);
  const bounced = notes.some((n) => n.includes("review changes"));
  const waiting = notes.some((n) => n.includes("жду PR") || n.includes(" — жду "));
  let promotedToReview = false;
  if (!failed && !allSkipped && !bounced && !waiting) {
    promotedToReview = await maybePromoteGoal(goalNumber, token);
  }
  if (promotedToReview) {
    const fresh = listIssueComments(GOAL_REPO, goalNumber, token);
    syncGoalPhaseLabels(goalNumber, goalDispatchStateForLabels(fresh), token);
    return !failed && !allSkipped;
  }
  const state: DispatchState = failed
    ? { phase: "error", at: new Date().toISOString() }
    : { phase: "working", at: new Date().toISOString() };
  const lines: string[] = failed
    ? ["**Воркеры (есть ошибки).** Верни карточку в In Progress или `/orchestrate`."]
    : [];
  const bodyLines = [...lines];
  if (notes.length) {
    if (bodyLines.length) bodyLines.push("");
    bodyLines.push(...notes.map((n) => `- ${n}`));
  }
  commentGoalDispatch(goalNumber, state, bodyLines, token);
  const digest = notes.map((n) => `- ${n}`).join("\n");
  if (failed) await notifyTelegram(`Goal #${goalNumber}: ошибки\n${goalIssueUrl}\n${digest}`);
  else if (!allSkipped) await notifyTelegram(`Goal #${goalNumber}: воркеры\n${goalIssueUrl}\n${digest}`);
  return !failed && !allSkipped;
}

function formatPlanJsonDetails(plan: Plan): string {
  return [
    "<details>",
    "<summary>План (JSON для оркестратора)</summary>",
    "",
    "```json",
    JSON.stringify(plan, null, 2),
    "```",
    "",
    "</details>",
  ].join("\n");
}

function postPlanComment(issue: IssueCommentEvent["issue"], plan: Plan): void {
  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );
  const rows = ordered
    .map((task) => {
      const trigger = task.trigger.type === "slash" ? task.trigger.command : task.trigger.type;
      return `| \`${task.id}\` | ${task.repo} | ${trigger} |`;
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
      "Одна Goal — несколько PR (без child issues). PR: `Parent` + маркер задачи, без Closes на Goal.",
      "",
      "| id | repo | trigger |",
      "|---|---|---|",
      rows,
      gates,
      "",
      formatPlanJsonDetails(plan),
    ].join("\n"),
  );
}

function publishPlan(plan: Plan, issue: IssueCommentEvent["issue"], token: string): void {
  addToProject(issue.html_url, "In Progress", token);
  postPlanComment(issue, plan);
}

const REPLAN_DECIDE_EXTRA = [
  "Предыдущий план был needs_human / out_of_scope. Человек вернул карточку в In Progress — это просьба продолжить.",
  "Не возвращай needs_human из‑за IA, размещения или варианта UX. Выбери сам один связный вариант, status ready, tasks не пустой.",
].join("\n");

async function runGoalFirst(
  issue: IssueCommentEvent["issue"],
  token: string,
  redo: boolean,
  extra = "",
): Promise<void> {
  const productId = resolveProductId(issue.labels.map((l) => l.name));
  ensureGoalProductLabel(issue.number, productId, token);
  const gameRepo = prepareIosGamesScaffold(issue, productId, token);
  const plan = await decompose(issue, extra, gameRepo ? { gameRepo } : undefined);
  if (plan.status !== "ready") {
    postNonReadyPlan(issue, plan, token);
    await notifyTelegram(`Goal #${issue.number}: ${plan.status}\n${plan.summary}\n${issue.html_url}`);
    return;
  }
  publishPlan(plan, issue, token);
  await notifyTelegram(`Goal #${issue.number}: план готов, запускаю воркеров\n${plan.summary}\n${issue.html_url}`);
  const notes = await dispatchPlan(plan, token, { skipIfOpenPr: !redo });
  if (!(await commentDispatch(issue.number, issue.html_url, notes, token))) process.exitCode = 2;
}

async function runGoalRevision(
  issue: IssueCommentEvent["issue"],
  stored: Plan,
  humanNotes: string,
  token: string,
): Promise<void> {
  let plan = stored;
  const productId = resolveProductId(issue.labels.map((l) => l.name));
  const gameRepo = prepareIosGamesScaffold(issue, productId, token);
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
      gameRepo ? { gameRepo } : undefined,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`revise plan fallback to stored: ${message}`);
    plan = stored;
  }
  if (plan.status !== "ready") {
    postNonReadyPlan(issue, plan, token);
    return;
  }
  publishPlan(plan, issue, token);
  const notes = await dispatchPlan(plan, token, {
    skipIfOpenPr: false,
    notes: humanNotes,
  });
  if (!(await commentDispatch(issue.number, issue.html_url, notes, token))) process.exitCode = 2;
}

function childWakeReason(state: DispatchState | undefined, comments: IssueComment[]): string {
  if (state?.phase === "error") {
    if (lastReleaseConflictNote(comments)) return "после конфликта релиза";
    return "после ошибки";
  }
  if (state?.phase === "review" && state.reviewVerdict === "changes") return "после ревьюера";
  if (state?.phase === "review") return "после Review";
  if (state?.phase === "reviewing") return "повтор: ревьюер завис";
  if (state?.phase === "working" && notesAfterLastPhase(comments, "working")) {
    return "повтор: комментарий пока working";
  }
  if (state?.phase === "working") return "повтор: working завис";
  if (state?.phase === "releasing") return "после застрявшего релиза";
  return state?.phase ?? "старт";
}

async function handleGoalFromBoard(item: BoardIssue, token: string): Promise<void> {
  if (item.closed) {
    console.log(`skip goal #${item.number}: closed`);
    return;
  }
  const comments = listIssueComments(item.repo, item.number, token);
  const state = lastGoalDispatchState(comments);
  if (shouldReleaseFromBoard(state, comments)) {
    if (state?.phase === "releasing" && isActivePhase(state, "releasing")) {
      console.log(`skip goal #${item.number}: already releasing`);
      return;
    }
    console.log(`goal #${item.number}: release intent → releaser`);
    await handleGoalRelease(item, token);
    return;
  }
  if (state?.phase === "error" && !notesAfterLastPhase(comments, "error")) {
    console.log(`skip goal #${item.number}: error, try catch-up`);
    const plan = extractStoredPlan(comments, item.number);
    if (plan && (await maybeReviewOpenPrsWithoutVerdict(plan, token))) {
      await maybePromoteGoal(item.number, token);
      return;
    }
    await catchUpGoalByNumber(item.number, token);
    return;
  }
  if (isResourceBackoff(state, comments)) {
    console.log(`skip goal #${item.number}: resource_exhausted backoff`);
    return;
  }
  const stored = extractStoredPlan(comments, item.number);
  const issue = fetchIssue(item.repo, item.number, token);
  const productId = resolveProductId(issue.labels.map((l) => l.name));
  if (stored && stored.status !== "ready") {
    if (item.status !== "In Progress") {
      console.log(`skip goal #${item.number}: plan status ${stored.status}`);
      return;
    }
    console.log(`goal #${item.number}: ${stored.status} → пересобираю план`);
    await notifyTelegram(`Доска: Goal #${item.number} — пересбор плана (${stored.status})\n${item.url}`);
    claimWorking(item.repo, item.number, token);
    await sleep(CLAIM_WAIT_MS);
    await runGoalFirst(issue, token, true, REPLAN_DECIDE_EXTRA);
    return;
  }
  if (getProduct(productId).status === "stub" && !stored) {
    ensureGoalProductLabel(issue.number, productId, token);
    const plan = stubNeedsHumanPlan(issue.number, productId) as Plan;
    postNonReadyPlan(issue, plan, token);
    await notifyTelegram(`Goal #${issue.number}: ${plan.status}\n${plan.summary}\n${issue.html_url}`);
    return;
  }
  const humanNotesBeforeClaim = notesAfterLastReview(comments);
  const revisionPending = Boolean(stored && goalRevisionPending(comments, humanNotesBeforeClaim));
  const why = revisionPending
    ? "правка после Review"
    : state?.phase === "review"
      ? "правка после Review"
      : stored
        ? "догоняю воркеров"
        : "первый прогон";
  await notifyTelegram(`Доска: Goal #${item.number} — ${why}\n${item.url}`);
  claimWorking(item.repo, item.number, token);
  await sleep(CLAIM_WAIT_MS);
  const fresh = listIssueComments(item.repo, item.number, token);
  const humanNotes = notesAfterLastReview(fresh);
  if (
    stored &&
    shouldSyncMainFromBoard({
      phase: state?.phase,
      reviewVerdict: state?.reviewVerdict,
      humanNotes,
    })
  ) {
    console.log(`goal #${item.number}: Review→IP без комментария → sync main`);
    await handleGoalSyncMain(item, stored, token);
    return;
  }
  if (stored && goalRevisionPending(fresh, humanNotes)) {
    console.log(`goal #${item.number}: revision after Review feedback`);
    await runGoalRevision(issue, stored, humanNotes, token);
    return;
  }
  if (stored && goalRevisionFollowUpPending(fresh, stored.tasks.map((task) => task.id))) {
    console.log(`goal #${item.number}: revision follow-up → worker`);
    const notes = await dispatchPlan(stored, token, { skipIfOpenPr: false, notes: humanNotes });
    if (!(await commentDispatch(issue.number, issue.html_url, notes, token))) process.exitCode = 2;
    return;
  }
  if (stored) {
    await commentDispatchFromStored(issue, stored, token);
    return;
  }
  await runGoalFirst(issue, token, false);
}

async function handleGoalSyncMain(item: BoardIssue, plan: Plan, token: string): Promise<void> {
  const prUrls: string[] = [];
  for (const task of plan.tasks) {
    prUrls.push(...findOpenPrsForGoalTask(plan.goal_number, task.id, task.repo, token).map((p) => p.url));
  }
  if (!prUrls.length) {
    addToProject(item.url, "Review", token);
    commentGoalDispatch(
      item.number,
      { phase: "review", at: new Date().toISOString() },
      [
        "**Sync main.** Открытого PR нет — вернул в Review. Правки: комментарий + In Progress. Релиз: «релизь» + In Progress.",
      ],
      token,
    );
    await notifyTelegram(`Sync main: нет PR → Review\n${item.url}`);
    return;
  }

  const notes: string[] = [];
  let conflict = false;
  for (const prUrl of prUrls) {
    try {
      const prepared = preparePrForMerge(prUrl, token);
      if (prepared.notes.length) notes.push(...prepared.notes.map((n) => `${prUrl}: ${n}`));
      else notes.push(`${prUrl}: ветка актуальна`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`${prUrl}: ${message.slice(0, 300)}`);
      if (isReleaseConflict(err)) {
        conflict = true;
        continue;
      }
      throw err;
    }
  }

  if (conflict) {
    console.log(`goal #${item.number}: sync main → конфликт, MODE B`);
    const dispatchNotes = await dispatchPlan(plan, token, {
      skipIfOpenPr: false,
      notes: syncMainWorkerNotes(notes),
    });
    if (!(await commentDispatch(item.number, item.url, dispatchNotes, token))) process.exitCode = 2;
    return;
  }

  addToProject(item.url, "Review", token);
  commentGoalDispatch(
    item.number,
    { phase: "review", prUrls, at: new Date().toISOString() },
    [
      "**Sync main.** Ветки PR актуальны относительно base (или подтянул без конфликта). Карточка снова в Review.",
      ...notes.map((n) => `- ${n}`),
      ACCEPT_HINT,
    ],
    token,
  );
  await notifyTelegram(`Sync main: ок → Review\n${item.url}`);
}

function cardFromIssue(item: BoardIssue): InventoryCard {
  const kind: InventoryCard["kind"] =
    item.repo === GOAL_REPO ? "goal" : "child";
  return {
    kind,
    repo: item.repo,
    number: item.number,
    title: item.title,
    url: item.url,
  };
}

function ensureReleaseGitIdentity(cwd: string): void {
  spawnSync("git", ["config", "user.name", "Dmitriy S"], { cwd, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "onlyzoran@gmail.com"], { cwd, encoding: "utf8" });
}

/** Перед merge: bump package.json (+ lock) и CHANGELOG с версией. */
function prepareReleaseForPr(
  prUrl: string,
  issueUrl: string,
  token: string,
): { version?: string; note: string } {
  const { repo, number } = parsePrUrl(prUrl);
  const raw = gh(
    ["pr", "view", String(number), "-R", repo, "--json", "title,headRefName,url"],
    token,
  );
  const pr = JSON.parse(raw) as { title: string; headRefName: string; url: string };
  const branch = pr.headRefName;
  if (!branch) return { note: "нет head ветки PR" };

  const filesRaw = gh(
    ["api", `repos/${repo}/pulls/${number}/files`, "--jq", "[.[]|{path:.filename,status:.status}]"],
    token,
  );
  const files = JSON.parse(filesRaw || "[]") as Array<{ path: string; status?: string }>;
  const bumpType = resolveBumpTypeFromFiles(repo, files, pr.title);

  const dir = mkdtempSync(join(tmpdir(), "orch-release-"));
  try {
    const cloneUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
    const clone = spawnSync("git", ["clone", "--depth", "50", "--branch", branch, cloneUrl, dir], {
      encoding: "utf8",
    });
    if (clone.status !== 0) {
      throw new Error((clone.stderr || clone.stdout || "git clone failed").trim());
    }
    spawnSync("git", ["remote", "set-url", "origin", `https://github.com/${repo}.git`], {
      cwd: dir,
      encoding: "utf8",
    });
    ensureReleaseGitIdentity(dir);

    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) {
      return { note: "package.json нет — пропуск bump" };
    }
    const pkgRaw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    if (!pkg.version) {
      return { note: "в package.json нет version — пропуск bump" };
    }

    const changelogPath = join(dir, "CHANGELOG.md");
    const changelogExists = existsSync(changelogPath);
    const changelogText = changelogExists ? readFileSync(changelogPath, "utf8") : "";

    const mainVersionResult = spawnSync(
      "git",
      ["show", "origin/main:package.json"],
      { cwd: dir, encoding: "utf8" },
    );
    let mainVersion: string | null = null;
    if (mainVersionResult.status === 0 && mainVersionResult.stdout) {
      try {
        mainVersion = stripPrerelease(
          (JSON.parse(mainVersionResult.stdout) as { version?: string }).version || "",
        );
      } catch {
        mainVersion = null;
      }
    }
    // shallow clone may lack origin/main — fetch tip
    if (!mainVersion) {
      spawnSync("git", ["fetch", "origin", "main", "--depth", "1"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
      });
      const again = spawnSync("git", ["show", "origin/main:package.json"], {
        cwd: dir,
        encoding: "utf8",
      });
      if (again.status === 0 && again.stdout) {
        try {
          mainVersion = stripPrerelease(
            (JSON.parse(again.stdout) as { version?: string }).version || "",
          );
        } catch {
          mainVersion = null;
        }
      }
    }

    const currentBase = stripPrerelease(pkg.version);
    const alreadyBumped =
      Boolean(mainVersion) &&
      currentBase !== mainVersion &&
      (changelogText.includes(pr.url) || changelogText.includes(prUrl)) &&
      !/^## Unreleased\b/m.test(changelogText);
    if (alreadyBumped) {
      return {
        version: currentBase,
        note: `релиз уже подготовлен (${currentBase})`,
      };
    }

    const nextVersion = bumpSemver(pkg.version, bumpType);
    writeFileSync(pkgPath, setPackageJsonVersion(pkgRaw, nextVersion));

    const lockPath = join(dir, "package-lock.json");
    if (existsSync(lockPath)) {
      writeFileSync(lockPath, setPackageLockRootVersion(readFileSync(lockPath, "utf8"), nextVersion));
    }

    const entry = buildVersionedChangelogEntry(nextVersion, pr.title, pr.url, issueUrl);
    writeFileSync(
      changelogPath,
      changelogExists
        ? insertVersionedChangelogEntry(changelogText, entry)
        : createChangelogFile(nextVersion, entry),
    );

    const status = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    if (!(status.stdout || "").trim()) {
      return { version: nextVersion, note: "релиз без изменений на диске" };
    }

    spawnSync("git", ["add", "package.json", "CHANGELOG.md", "package-lock.json"], {
      cwd: dir,
      encoding: "utf8",
    });
    const commit = spawnSync("git", ["commit", "-m", `chore(release): ${nextVersion}`], {
      cwd: dir,
      encoding: "utf8",
    });
    if (commit.status !== 0) {
      throw new Error((commit.stderr || commit.stdout || "git commit failed").trim());
    }
    const push = spawnSync(
      "git",
      ["push", `https://x-access-token:${token}@github.com/${repo}.git`, `HEAD:${branch}`],
      { cwd: dir, encoding: "utf8" },
    );
    if (push.status !== 0) {
      throw new Error((push.stderr || push.stdout || "git push failed").trim());
    }

    return {
      version: nextVersion,
      note: `bump ${bumpType} → ${nextVersion}, CHANGELOG обновлён`,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

class ReleaseConflictError extends Error {
  readonly kind = "conflict" as const;
  constructor(
    message: string,
    readonly prUrl: string,
  ) {
    super(message);
    this.name = "ReleaseConflictError";
  }
}

function isConflictMessage(message: string): boolean {
  return /not mergeable|cannot be cleanly created|cannot update pr branch|due to conflicts?|merge conflicts?|\bconflicts?\b|CONFLICTING|\bDIRTY\b|pull request is not mergeable/i.test(
    message,
  );
}

function isReleaseConflict(err: unknown): boolean {
  return (
    err instanceof ReleaseConflictError ||
    (err instanceof Error && isConflictMessage(err.message))
  );
}

type PrMergeView = {
  state: string;
  mergeable: string;
  mergeStateStatus: string;
  title: string;
  url: string;
};

function viewPrMerge(repo: string, number: number, token: string): PrMergeView {
  const raw = gh(
    [
      "pr",
      "view",
      String(number),
      "-R",
      repo,
      "--json",
      "state,mergeable,mergeStateStatus,title,url",
    ],
    token,
  );
  return JSON.parse(raw) as PrMergeView;
}

function updatePrFromBase(repo: string, number: number, token: string): string {
  try {
    gh(["pr", "update-branch", String(number), "-R", repo], token);
    return "подтянул base в ветку PR";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already up.to.date|not out of date|is not behind/i.test(message)) {
      return "ветка уже актуальна относительно base";
    }
    if (isConflictMessage(message)) {
      throw new ReleaseConflictError(
        `${repo}#${number}: конфликт при update-branch — ${message.slice(0, 240)}`,
        `https://github.com/${repo}/pull/${number}`,
      );
    }
    throw err;
  }
}

function preparePrForMerge(prUrl: string, token: string): { pr: PrMergeView; notes: string[] } {
  const { repo, number } = parsePrUrl(prUrl);
  const notes: string[] = [];
  let pr = viewPrMerge(repo, number, token);
  if (pr.state === "MERGED") return { pr, notes: ["уже смержен"] };
  if (pr.state !== "OPEN") throw new Error(`PR ${pr.url} в состоянии ${pr.state}`);

  const behindOrUnknown =
    pr.mergeStateStatus === "BEHIND" ||
    pr.mergeStateStatus === "UNKNOWN" ||
    pr.mergeable === "UNKNOWN";
  const dirty =
    pr.mergeable === "CONFLICTING" ||
    pr.mergeStateStatus === "DIRTY";

  if (behindOrUnknown || dirty) {
    notes.push(updatePrFromBase(repo, number, token));
    for (let attempt = 0; attempt < PR_MERGEABLE_POLLS; attempt++) {
      sleepSync(PR_MERGEABLE_POLL_MS);
      pr = viewPrMerge(repo, number, token);
      if (pr.state === "MERGED") return { pr, notes: [...notes, "уже смержен"] };
      if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
        throw new ReleaseConflictError(
          `${pr.url}: конфликт с ${pr.mergeStateStatus || pr.mergeable}`,
          pr.url,
        );
      }
      if (pr.mergeable === "MERGEABLE" && pr.mergeStateStatus !== "BEHIND") break;
      if (attempt === Math.floor(PR_MERGEABLE_POLLS / 2)) {
        notes.push(updatePrFromBase(repo, number, token));
      }
    }
  }

  pr = viewPrMerge(repo, number, token);
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
    throw new ReleaseConflictError(
      `${pr.url}: всё ещё конфликт (${pr.mergeStateStatus || pr.mergeable})`,
      pr.url,
    );
  }
  return { pr, notes };
}

function mergePullRequest(prUrl: string, token: string): string {
  const { repo, number } = parsePrUrl(prUrl);
  const prepared = preparePrForMerge(prUrl, token);
  const prepNote = prepared.notes.length ? `${prepared.notes.join("; ")}; ` : "";
  if (prepared.pr.state === "MERGED") return `${prepared.pr.url} уже смержен`;

  try {
    gh(
      [
        "pr",
        "merge",
        String(number),
        "-R",
        repo,
        "--squash",
        "--delete-branch",
        "--subject",
        prepared.pr.title,
      ],
      token,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isConflictMessage(message)) {
      // Ещё одна попытка: base мог уехать между poll и merge.
      try {
        updatePrFromBase(repo, number, token);
        sleepSync(PR_MERGEABLE_POLL_MS);
        const again = viewPrMerge(repo, number, token);
        if (again.mergeable === "CONFLICTING" || again.mergeStateStatus === "DIRTY") {
          throw new ReleaseConflictError(`${again.url}: ${message.slice(0, 240)}`, again.url);
        }
        gh(
          [
            "pr",
            "merge",
            String(number),
            "-R",
            repo,
            "--squash",
            "--delete-branch",
            "--subject",
            again.title,
          ],
          token,
        );
        return `${prepNote}${again.url} смержен (squash, после update-branch)`;
      } catch (retryErr) {
        if (isReleaseConflict(retryErr)) throw retryErr;
        throw new ReleaseConflictError(
          `${prUrl}: ${message.slice(0, 240)}`,
          prUrl,
        );
      }
    }
    throw err;
  }
  return `${prepNote}${prepared.pr.url} смержен (squash)`;
}

async function handleGoalRelease(item: BoardIssue, token: string): Promise<void> {
  const comments = listIssueComments(item.repo, item.number, token);
  const state = lastGoalDispatchState(comments);
  if (state?.phase === "releasing" && isActivePhase(state, "releasing")) {
    console.log(`skip goal release #${item.number}: already releasing`);
    return;
  }
  const plan = extractStoredPlan(comments, item.number);
  await notifyTelegram(`Доска: релиз Goal #${item.number}\n${item.url}`);
  claimReleasing(item.repo, item.number, token);
  await sleep(CLAIM_WAIT_MS);

  if (!plan || plan.status !== "ready" || plan.tasks.length === 0) {
    addToProject(item.url, "Done", token);
    commentGoalDispatch(
      item.number,
      { phase: "review", at: new Date().toISOString() },
      ["**Готово.** Плана нет — Goal в Done."],
      token,
    );
    return;
  }

  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );
  const notes: string[] = [];
  let failed = 0;
  for (const task of ordered) {
    const open = findOpenPrsForGoalTask(plan.goal_number, task.id, task.repo, token);
    const merged = findMergedPrsForGoalTask(plan.goal_number, task.id, task.repo, token);
    if (!open.length && merged.length) {
      notes.push(`${task.id}: уже смержен ${merged[0].url}`);
      continue;
    }
    if (!open.length) {
      notes.push(`${task.id}: нет PR`);
      failed += 1;
      continue;
    }
    try {
      let mergeSha: string | undefined;
      let releasedVersion: string | undefined;
      for (const pr of open) {
        const prepared = prepareReleaseForPr(pr.url, item.url, token);
        notes.push(`${task.id}: ${prepared.note}`);
        if (prepared.version) releasedVersion = prepared.version;
        notes.push(mergePullRequest(pr.url, token));
        try {
          const { repo: prRepo, number: prNumber } = parsePrUrl(pr.url);
          const sha = gh(
            ["pr", "view", String(prNumber), "-R", prRepo, "--json", "mergeCommit", "--jq", ".mergeCommit.oid // empty"],
            token,
          );
          if (sha) mergeSha = sha;
        } catch {
          /* optional */
        }
      }
      if (isLibraryPackageRepo(task.repo)) {
        const packageName = packageNameForLibraryRepo(task.repo);
        if (packageName) {
          const stable = waitForStablePackageVersion(
            task.repo,
            packageName,
            token,
            gh,
            mergeSha,
            releasedVersion,
          );
          notes.push(`${task.id}: стабильная ${packageName}@${stable}`);
          notes.push(
            ...(await promoteStableIntoGoalConsumers(plan.goal_number, task.repo, stable, token)),
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`${task.id}: ошибка — ${message.slice(0, 300)}`);
      failed += 1;
      if (isReleaseConflict(err)) {
        addToProject(item.url, "In Progress", token);
        commentGoalDispatch(
          item.number,
          { phase: "error", at: new Date().toISOString() },
          [
            "**Релиз: конфликт с main.** Goal → In Progress. Воркер MODE B подтянет main.",
            ...notes.map((n) => `- ${n}`),
          ],
          token,
        );
        return;
      }
    }
  }

  if (failed === 0) {
    addToProject(item.url, "Done", token);
    commentGoalDispatch(
      item.number,
      { phase: "review", at: new Date().toISOString() },
      ["**Готово.** PR смержены — Goal в Done.", ...notes.map((n) => `- ${n}`)],
      token,
    );
    await notifyTelegram(`Goal #${item.number}: Done\n${item.url}`);
  } else {
    commentGoalDispatch(
      item.number,
      { phase: "error", at: new Date().toISOString() },
      [
        "**Релиз Goal неполный.** Поправь и снова In Progress + «релизь».",
        ...notes.map((n) => `- ${n}`),
      ],
      token,
    );
    await notifyTelegram(`Goal #${item.number}: релиз неполный\n${item.url}\n${notes.join("\n")}`);
  }
}

async function handleReadyToRelease(item: BoardIssue, token: string): Promise<void> {
  if (isHqIssue(item.repo)) {
    await handleGoalRelease(item, token);
    return;
  }
  console.log(`skip release ${item.url}: не штаб-репо`);
}

function backfillVpsPreviews(reviewItems: BoardIssue[], token: string): void {
  for (const item of reviewItems) {
    const comments = listIssueComments(item.repo, item.number, token);
    const plan = extractStoredPlan(comments, item.number);
    if (!plan) continue;
    const state = lastGoalDispatchState(comments);
    for (const task of plan.tasks) {
      ensureVpsPreview(task, item.number, state?.headRef, { ifMissing: true });
    }
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
    if (!token) throw new Error("нет секрета GITHUB_PAT");
    const boards = listBoardProjects();
    if (process.env.ORCHESTRATOR_PROJECT_ID?.trim()) {
      console.warn(`unset ORCHESTRATOR_PROJECT_ID=${process.env.ORCHESTRATOR_PROJECT_ID} (registry is source of truth)`);
      delete process.env.ORCHESTRATOR_PROJECT_ID;
    }
    console.log(`project boards: ${boards.map((board) => board.id).join(", ")}`);
    ensureAllBoardStatusOptions(token);
    const all = listProjectIssues(token);
    inventory.board = {
      inProgress: all.filter((item) => item.status === "In Progress" && !item.closed).map(cardFromIssue),
      review: all.filter((item) => item.status === "Review" && !item.closed).map(cardFromIssue),
      readyToRelease: all
        .filter((item) => item.status === LEGACY_READY_TO_RELEASE && !item.closed)
        .map(cardFromIssue),
    };
    writeInventory(inventory);

    const reviewGoals = all.filter((item) => item.status === "Review" && !item.closed && isHqIssue(item.repo));
    backfillVpsPreviews(reviewGoals, token);

    const ready = all.filter((item) => item.status === LEGACY_READY_TO_RELEASE && !item.closed);
    const readyGoals = ready.filter((item) => isHqIssue(item.repo));
    if (readyGoals.length) {
      console.log(`watch: legacy release ${readyGoals.length} goal in ${LEGACY_READY_TO_RELEASE}`);
      for (const item of readyGoals) {
        await handleReadyToRelease(item, token);
      }
    }

    const items = all.filter((item) => item.status === "In Progress" && !item.closed);
    const goals = items.filter((item) => isHqIssue(item.repo));
    const queueInventory = readInventory();
    const head = pickGoalQueueHead(goals, queueInventory);
    const waiting = goalQueueWaiting(goals, head);
    console.log(
      `watch: ${goals.length} goal in In Progress, head #${head?.number ?? "none"}, waiting ${waiting.map((g) => g.number).join(", ") || "none"}`,
    );

    for (const goal of goals) {
      const comments = listIssueComments(goal.repo, goal.number, token);
      syncGoalPhaseLabels(goal.number, goalDispatchStateForLabels(comments), token);
    }

    for (const goal of waiting) {
      const comments = listIssueComments(goal.repo, goal.number, token);
      const state = lastGoalDispatchState(comments);
      if (!shouldReleaseFromBoard(state, comments)) continue;
      if (state?.phase === "releasing" && isActivePhase(state, "releasing")) {
        console.log(`queue release: skip goal #${goal.number}, already releasing`);
        continue;
      }
      console.log(`queue release: goal #${goal.number} → releaser`);
      await handleGoalRelease(goal, token);
    }

    if (head) {
      await handleGoalFromBoard(head, token);
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
  const notes = await dispatchPlan(stored, token, { skipIfOpenPr: true });
  const allSkipped = notes.length > 0 && notes.every(isIdleDispatchNote);
  if (allSkipped) {
    await finishIdleGoalDispatch(issue.number, listIssueComments(GOAL_REPO, issue.number, token), token);
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

  const repo = process.env.GITHUB_REPOSITORY?.trim() || GOAL_REPO;
  if (!isHqIssue(repo)) {
    console.log("skip: /orchestrate только в штаб-репо");
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
      commentOnGoal(issue.number, "Нет `GITHUB_PAT` — воркеров не запускаю.");
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
      "План готов, но нет секрета `GITHUB_PAT` (PAT с `repo` + `project` на все шесть репо). Child issues не созданы.",
    );
    return;
  }

  try {
    claimWorking(GOAL_REPO, issue.number, token);
    await runGoalFirst(
      issue,
      token,
      redo,
      stored && stored.status !== "ready" ? REPLAN_DECIDE_EXTRA : "",
    );
  } catch (err) {
    console.error(err);
    const extra =
      err instanceof CursorAgentError
        ? ` (${[err.code, err.isRetryable ? "retryable" : "not-retryable", err.requestId]
            .filter(Boolean)
            .join(", ")})`
        : "";
    const message = err instanceof Error ? err.message : String(err);
    commentGoalDispatch(
      issue.number,
      { phase: "error", at: new Date().toISOString() },
      [`Оркестратор не смог собрать план: ${message}${extra}`],
      token,
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
