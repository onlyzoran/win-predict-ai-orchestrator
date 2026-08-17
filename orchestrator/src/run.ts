import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, CursorAgentError } from "@cursor/sdk";

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
const MACHINE_NAME = process.env.CURSOR_MACHINE_NAME?.trim() || "win-predict-vps";
const SLASH_WAIT_MS = 40 * 60 * 1000;
const SLASH_POLL_MS = 20_000;
const CLAIM_WAIT_MS = 15_000;
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
type DispatchPhase = "working" | "review" | "error";
type DispatchState = {
  phase: DispatchPhase;
  agentId?: string;
  runId?: string;
  prUrls?: string[];
  headRef?: string;
  at?: string;
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
};

type OpenPr = { url: string; headRefName: string };

function commentToken(): string {
  return process.env.GITHUB_TOKEN || process.env.ORCHESTRATOR_GITHUB_TOKEN || "";
}

function writeToken(): string {
  return process.env.ORCHESTRATOR_GITHUB_TOKEN || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function gh(args: string[], token: string): string {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `gh ${args.join(" ")}`).trim());
  }
  return (result.stdout || "").trim();
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
      if (raw.phase === "working" || raw.phase === "review" || raw.phase === "error") return raw;
    } catch {
      /* ignore */
    }
  }
  if (!body.includes(DISPATCH_MARKER)) return undefined;
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
  if (state?.phase !== "working") return false;
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

function shouldWakeChild(state: DispatchState | undefined, comments: IssueComment[]): boolean {
  if (state?.phase === "review" || state?.phase === "error") return true;
  if (state?.phase === "working") {
    if (notesAfterLastPhase(comments, "working")) return true;
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
  const query = `query($projectId:ID!){node(id:$projectId){...on ProjectV2{items(first:100){nodes{id fieldValues(first:20){nodes{...on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2SingleSelectField{id}}}}} content{__typename ...on Issue{number title body url repository{nameWithOwner} labels(first:20){nodes{name}}}}}}}}}`;
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

function findExistingChild(task: Task, goalNumber: number, token: string): string | undefined {
  const parent = `Parent: ${GOAL_REPO}#${goalNumber}`;
  const marker = `<!-- orchestrator-task:${task.id} -->`;
  const raw = gh(
    ["issue", "list", "-R", task.repo, "--state", "open", "--limit", "50", "--json", "url,title,body"],
    token,
  );
  const items = JSON.parse(raw) as Array<{ url: string; title: string; body: string }>;
  const marked = items.find((item) => item.body.includes(marker));
  if (marked) return marked.url;
  const titled = items.find((item) => item.body.includes(parent) && item.title === task.title);
  if (titled) return titled.url;
  const withParent = items.filter((item) => item.body.includes(parent));
  return withParent.length === 1 ? withParent[0].url : undefined;
}

function createChildIssue(task: Task, goalNumber: number, created: Map<string, string>, token: string): string {
  ensureLabel(task.repo, task.surface, token);
  const existing = findExistingChild(task, goalNumber, token);
  if (existing) return existing;
  const deps = task.depends_on
    .map((id) => created.get(id))
    .filter((url): url is string => Boolean(url));
  const triggerLine =
    task.trigger.type === "slash"
      ? `Воркер: комментарий \`${task.trigger.command}\` от диспетчера.`
      : `Воркер: My Machines (\`worker.md\`) на \`${MACHINE_NAME}\`.`;
  const body = [
    `<!-- orchestrator-task:${task.id} -->`,
    task.body.trim(),
    "",
    triggerLine,
    `Критерий куска: ${task.done_when}`,
    deps.length ? `Зависит от: ${deps.join(", ")}` : "",
    `Parent: ${GOAL_REPO}#${goalNumber}`,
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
    trigger: { type: "sdk" },
    done_when: doneWhen,
  };
}

async function runMachineWorker(
  task: Task,
  issueUrl: string,
  token: string,
  notes = "",
): Promise<{ runId: string; prUrls: string[]; agentId: string; headRef: string }> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");
  addToProject(issueUrl, "In Progress", token);
  await notifyTelegram(`My Machines старт: ${task.id}\n${issueUrl}`);
  const worker = readFileSync(join(ROOT, "orchestrator/prompts/worker.md"), "utf8");
  const visual =
    task.surface === "ui" ||
    task.surface === "app" ||
    task.surface === "admin" ||
    /цвет|палитр|theme|токен|dark|light|контраст/i.test(`${task.title}\n${task.body}\n${notes}`);
  const design = visual
    ? readFileSync(join(ROOT, "orchestrator/prompts/design.md"), "utf8")
    : "";
  const { repo, number } = parseIssueUrl(issueUrl);
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
      ? `Комментарии человека на issue после последней сдачи:\n${notes}`
      : "Новых комментариев после сдачи нет — перечитай issue и открытый PR, исправь недочёты.",
    "",
    mode === "B"
      ? "Это правка существующего PR. Новый PR не открывай. В конце — URL того же PR."
      : "Сделай задачу в этом репо. В конце — URL PR или причина, почему PR нет.",
  ].join("\n");

  const attempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
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
      console.log(
        `worker task=${task.id} mode=${mode} ref=${headRef} agent=${agent.agentId} run=${run.id} machine=${MACHINE_NAME} attempt=${attempt}`,
      );
      const result = await run.wait();
      if (result.status !== "finished") {
        throw new Error(result.error?.message || `run status ${result.status}`);
      }
      const summary = (result.result ?? "").trim().slice(0, 1500) || "(нет текста)";
      const prUrls = extractPrUrls(summary);
      if (mode === "B" && !prUrls.length) prUrls.push(openPrs[0].url);
      addToProject(issueUrl, "Review", token);
      const prLines = prUrls.length
        ? prUrls.map((url) => `- ${url}`).join("\n")
        : "- (URL PR в тексте воркера не найден)";
      commentOnIssue(
        repo,
        number,
        formatDispatchComment(
          {
            phase: "review",
            agentId: agent.agentId,
            runId: result.id,
            prUrls,
            headRef,
            at: new Date().toISOString(),
          },
          [
            `My Machines воркер завершился (\`${result.id}\`, agent \`${agent.agentId}\`, \`${MACHINE_NAME}\`, MODE ${mode}).`,
            "",
            "**Нужна приёмка.** Замечания — комментарий в этот issue, карточку верни в In Progress. Merge сам.",
            prLines,
            "",
            summary,
          ],
        ),
        token,
      );
      await notifyTelegram(
        `My Machines готов: ${task.id}\n${prUrls.length ? prUrls.join("\n") : issueUrl}`,
      );
      return { runId: result.id, prUrls, agentId: agent.agentId, headRef };
    } catch (err) {
      lastError = err;
      if (!isRetryableWorkerStart(err) || attempt === attempts) throw err;
      const waitMs = 30_000 * attempt;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`worker ${task.id} start failed, retry ${attempt}/${attempts} in ${waitMs}ms: ${message}`);
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  if (skipIfOpenPr && task.trigger.type === "slash" && task.trigger.command !== "/ui-agent") {
    addToProject(issueUrl, "In Progress", token);
    commentOnIssue(repo, number, task.trigger.command, token);
    await notifyTelegram(`Slash ${task.trigger.command}: ждём PR\n${issueUrl}`);
    const prUrls = await waitForOpenPr(issueUrl, token, SLASH_WAIT_MS);
    addToProject(issueUrl, "Review", token);
    commentOnIssue(
      repo,
      number,
      formatDispatchComment(
        { phase: "review", prUrls, at: new Date().toISOString() },
        [
          `Slash \`${task.trigger.command}\` открыл PR.`,
          "",
          "**Нужна приёмка.** Замечания — комментарий в этот issue, карточку верни в In Progress. Merge сам.",
          ...prUrls.map((url) => `- ${url}`),
        ],
      ),
      token,
    );
    await notifyTelegram(`Slash ${task.trigger.command}: PR\n${prUrls.join("\n")}`);
    return `${issueUrl} — \`${task.trigger.command}\` — ${prUrls.join(" ")}`;
  }
  const { runId, prUrls } = await runMachineWorker(task, issueUrl, token, opts.notes ?? "");
  const prNote = prUrls.length ? ` — ${prUrls.join(" ")}` : "";
  return `${issueUrl} — machine \`${runId}\`${prNote}`;
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
    const url = created.get(task.id) ?? findExistingChild(task, plan.goal_number, token);
    if (!url) {
      notes.push(`\`${task.id}\` — нет child issue`);
      continue;
    }
    try {
      if (task.depends_on.length && opts.skipIfOpenPr !== false) {
        const unmet = task.depends_on.filter((id) => {
          const depTask = plan.tasks.find((t) => t.id === id);
          const depUrl =
            created.get(id) ??
            (depTask ? findExistingChild(depTask, plan.goal_number, token) : undefined);
          return !depUrl || findOpenPrsForIssue(depUrl, token).length === 0;
        });
        if (unmet.length) {
          notes.push(`${url} — ошибка: нет PR у ${unmet.join(", ")}`);
          continue;
        }
      }
      notes.push(await dispatchTask(task, url, token, opts));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      notes.push(`${url} — ошибка: ${message}`);
      await notifyTelegram(`Ошибка воркера: ${task.id}\n${url}\n${message.slice(0, 500)}`);
      try {
        const { repo, number } = parseIssueUrl(url);
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
  }
  return notes;
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
    throw new Error(result.error?.message || `run status ${result.status}`);
  }
  return validatePlan(extractJson(result.result ?? ""), issue.number);
}

function loadEvent(): IssueCommentEvent {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("нет GITHUB_EVENT_PATH — запускай из GitHub Action");
  return JSON.parse(readFileSync(path, "utf8")) as IssueCommentEvent;
}

async function commentDispatch(
  goalNumber: number,
  goalUrl: string,
  notes: string[],
  token: string,
): Promise<boolean> {
  const failed = notes.some((n) => n.includes("ошибка") || n.includes("нет child"));
  const allSkipped = notes.length > 0 && notes.every((n) => n.includes("уже запускали"));
  const machineDone = notes.some((n) => /\/pull\/\d+/.test(n) || n.includes(" — machine "));
  const toReview = Boolean(token) && !failed && !allSkipped && machineDone;
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

async function handleGoalFromBoard(item: BoardIssue, token: string): Promise<void> {
  const comments = listIssueComments(item.repo, item.number, token);
  const state = lastDispatchState(comments);
  if (isActiveWorking(state) && !notesAfterLastPhase(comments, "working")) {
    console.log(`skip goal #${item.number}: already working`);
    return;
  }
  const stored = extractStoredPlan(comments, item.number);
  const issue = fetchIssue(item.repo, item.number, token);
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
  const comments = listIssueComments(item.repo, item.number, token);
  const state = lastDispatchState(comments);
  if (!shouldWakeChild(state, comments)) {
    console.log(`skip child ${item.url}: phase=${state?.phase ?? "none"}`);
    return;
  }
  claimWorking(item.repo, item.number, token);
  await sleep(CLAIM_WAIT_MS);
  const fresh = listIssueComments(item.repo, item.number, token);
  const humanNotes = notesAfterLastReview(fresh);
  const task = taskFromBoardIssue(item);
  await dispatchTask(task, item.url, token, { skipIfOpenPr: false, notes: humanNotes });
}

async function watchBoard(): Promise<void> {
  const token = writeToken();
  if (!token) throw new Error("нет секрета ORCHESTRATOR_GITHUB_TOKEN");
  const items = listProjectIssues(token).filter((item) => item.status === "In Progress");
  const goals = items.filter((item) => item.repo === GOAL_REPO && item.labels.includes("goal"));
  const children = items.filter((item) => isRepo(item.repo));
  console.log(`watch: ${goals.length} goal, ${children.length} child in In Progress`);
  for (const goal of goals) {
    await handleGoalFromBoard(goal, token);
  }
  const afterGoals = listProjectIssues(token).filter((item) => item.status === "In Progress");
  const remaining = afterGoals.filter((item) => isRepo(item.repo));
  const queue = remaining.length ? remaining : children;
  for (const child of queue) {
    await handleChildFromBoard(child, token);
  }
}

async function commentDispatchFromStored(
  issue: IssueCommentEvent["issue"],
  stored: Plan,
  token: string,
): Promise<void> {
  const notes = await dispatchPlan(stored, new Map(), token, { skipIfOpenPr: true });
  const allSkipped = notes.length > 0 && notes.every((n) => n.includes("уже запускали"));
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
