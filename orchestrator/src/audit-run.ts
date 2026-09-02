import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@cursor/sdk";

import { resolveBoardProject } from "./products.js";
import {
  AUDIT_LABEL,
  formatAuditBrowserBlock,
  formatGoalBody,
  formatGoalTitle,
  fingerprintFinding,
  getAuditProductConfig,
  hasFingerprintInBody,
  parseMinSeverity,
  probeAuditUrls,
  shouldCreateGoal,
  validateAudit,
} from "./product-audit.js";
import { playwrightMcpServers } from "./visual-review.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOAL_REPO = "onlyzoran/win-predict-ai-orchestrator";
const GH_RETRY = 5;
const GH_RETRY_MS = 8_000;

function githubPat(): string {
  const pat = process.env.GITHUB_PAT?.trim() || process.env.ORCHESTRATOR_GITHUB_TOKEN?.trim();
  if (!pat) throw new Error("нет секрета GITHUB_PAT");
  return pat;
}

function writeToken(): string {
  return githubPat();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransientGithub(text: string): boolean {
  return /HTTP 502|HTTP 503|HTTP 429|No server is currently available|secondary rate limit|Something went wrong while executing your query/i.test(
    text,
  );
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
    sleepSync(GH_RETRY_MS * attempt);
  }
  throw new Error(last);
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

function addToProject(url: string, token: string, productId: string): void {
  const board = resolveBoardProject(productId);
  const inboxId = board.statusOptions?.Inbox;
  if (!inboxId) throw new Error(`нет Inbox option для ${productId}`);
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
      optionId: inboxId,
    },
  );
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
    if (!res.ok) console.warn(`telegram: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`telegram: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("auditor не вернул JSON");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
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

type OpenAuditIssue = { number: number; title: string; body: string; url: string };

function listOpenAuditIssues(token: string): OpenAuditIssue[] {
  const raw = gh(
    [
      "issue",
      "list",
      "-R",
      GOAL_REPO,
      "--label",
      AUDIT_LABEL,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,body,url",
    ],
    token,
  );
  return JSON.parse(raw) as OpenAuditIssue[];
}

function createAuditGoal(title: string, body: string, productLabel: string, token: string): string {
  const dir = mkdtempSync(join(tmpdir(), "orch-audit-"));
  const file = join(dir, "body.md");
  writeFileSync(file, body);
  return gh(
    [
      "issue",
      "create",
      "-R",
      GOAL_REPO,
      "--title",
      title,
      "--body-file",
      file,
      "--label",
      productLabel,
      "--label",
      AUDIT_LABEL,
    ],
    token,
  );
}

export type AuditRunResult = {
  productId: string;
  findingsTotal: number;
  goalsCreated: number;
  goalsSkippedDedup: number;
  goalsSkippedLow: number;
  dryRun: boolean;
};

export async function runProductAudit(productId: string): Promise<AuditRunResult> {
  if (process.env.ORCHESTRATOR_AUDIT_ENABLED?.trim() === "0") {
    console.log("audit: ORCHESTRATOR_AUDIT_ENABLED=0 — skip");
    return {
      productId,
      findingsTotal: 0,
      goalsCreated: 0,
      goalsSkippedDedup: 0,
      goalsSkippedLow: 0,
      dryRun: false,
    };
  }

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("нет секрета CURSOR_API_KEY");

  const config = getAuditProductConfig(productId);
  const routes = config.routes;
  const urls = [...new Set(routes.map((route) => route.url))];

  console.log(`audit ${productId}: probe ${urls.length} URL`);
  const probeResults = await probeAuditUrls(urls);
  for (const item of probeResults) {
    console.log(`audit probe ${item.url}: ${item.ready ? "ready" : "pending"}${item.status ? ` ${item.status}` : ""}`);
  }

  const auditor = readFileSync(join(ROOT, "orchestrator/prompts/auditor.md"), "utf8");
  const schema = readFileSync(join(ROOT, "orchestrator/schema/audit.schema.json"), "utf8");
  const design = readFileSync(join(ROOT, "orchestrator/prompts/design.md"), "utf8");
  const browserBlock = formatAuditBrowserBlock(routes, probeResults);

  const prompt = [
    auditor,
    "",
    design,
    "",
    "Схема ответа (соблюдай строго):",
    schema,
    "",
    `Продукт: ${productId}`,
    `Product label: ${config.productLabel}`,
    "",
    browserBlock,
    "",
    "Верни только один блок ```json ... ``` с объектом audit. Никакого текста снаружи.",
  ].join("\n");

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    local: { cwd: ROOT },
    mcpServers: playwrightMcpServers(ROOT),
  });
  console.log(`audit run=${result.id} status=${result.status}`);
  if (result.status !== "finished") {
    throw new Error(runFailureMessage(result));
  }

  const report = validateAudit(extractJson(result.result ?? ""));
  if (report.product_id !== productId) {
    console.warn(`audit: product_id ${report.product_id} != ${productId}`);
  }

  const minSeverity = parseMinSeverity();
  const dryRun = process.env.ORCHESTRATOR_AUDIT_DRY_RUN?.trim() === "1";
  const runAt = new Date().toISOString();
  let goalsCreated = 0;
  let goalsSkippedDedup = 0;
  let goalsSkippedLow = 0;

  const token = dryRun ? "" : writeToken();
  const openIssues = dryRun ? [] : listOpenAuditIssues(token);

  for (const finding of report.findings) {
    if (!shouldCreateGoal(finding.severity, minSeverity)) {
      goalsSkippedLow += 1;
      console.log(`audit skip low: ${finding.id} (${finding.severity})`);
      continue;
    }

    const fingerprint = fingerprintFinding(productId, finding.surface, finding.title);
    const duplicate = openIssues.some((issue) => hasFingerprintInBody(issue.body, fingerprint));
    if (duplicate) {
      goalsSkippedDedup += 1;
      console.log(`audit skip dedup: ${finding.id}`);
      continue;
    }

    const title = formatGoalTitle(finding);
    const body = formatGoalBody(finding, productId, runAt);

    if (dryRun) {
      console.log(`audit dry-run goal: ${title}`);
      goalsCreated += 1;
      continue;
    }

    const issueUrl = createAuditGoal(title, body, config.productLabel, token);
    addToProject(issueUrl, token, productId);
    goalsCreated += 1;
    console.log(`audit goal created: ${issueUrl}`);
  }

  const summary = [
    `Product-audit: ${productId}`,
    report.summary,
    `Findings: ${report.findings.length} (created ${goalsCreated}, dedup ${goalsSkippedDedup}, below ${minSeverity} ${goalsSkippedLow})`,
    dryRun ? "DRY RUN — issues не создавались" : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(summary);
  await notifyTelegram(summary);

  return {
    productId,
    findingsTotal: report.findings.length,
    goalsCreated,
    goalsSkippedDedup,
    goalsSkippedLow,
    dryRun,
  };
}

async function main(): Promise<void> {
  const productId = process.argv[2]?.trim() || "win-predict-ai";
  await runProductAudit(productId);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(err instanceof Error && err.message.includes("CURSOR") ? 1 : 2);
});
