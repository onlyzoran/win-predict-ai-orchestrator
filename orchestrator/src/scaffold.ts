import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GAME_REPO_MARKER = "<!-- orchestrator-game-repo:";
export const GAME_REPO_RE = /<!-- orchestrator-game-repo:([^>\s]+) -->/;

export function gameRepoForGoal(goalNumber: number): string {
  return `onlyzoran/game-issue-${goalNumber}`;
}

export function isGameRepo(repo: string): boolean {
  return /^onlyzoran\/game-issue-[0-9]+$/.test(repo);
}

export function extractScaffoldedRepo(comments: { body: string }[]): string | undefined {
  for (const comment of comments) {
    const match = comment.body.match(GAME_REPO_RE);
    if (match?.[1]) return match[1];
  }
  return undefined;
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

function repoExists(repo: string, token: string): boolean {
  try {
    gh(["repo", "view", repo, "--json", "name"], token);
    return true;
  } catch {
    return false;
  }
}

function commentOnGoal(goalRepo: string, issueNumber: number, body: string, token: string): void {
  const dir = mkdtempSync(join(tmpdir(), "orch-scaffold-"));
  const file = join(dir, "comment.md");
  writeFileSync(file, body);
  gh(["issue", "comment", String(issueNumber), "-R", goalRepo, "--body-file", file], token);
}

export type EnsureGameScaffoldResult = {
  repo: string;
  created: boolean;
  vpsNote?: string;
};

/** Create per-Goal game repo from GitHub template; idempotent via Goal comment marker. */
export function ensureGameScaffold(
  goalRepo: string,
  goalNumber: number,
  templateRepo: string,
  comments: { body: string }[],
  token: string,
): EnsureGameScaffoldResult {
  const existing = extractScaffoldedRepo(comments);
  if (existing) {
    if (!isGameRepo(existing)) {
      throw new Error(`некорректный маркер game-repo: ${existing}`);
    }
    return { repo: existing, created: false };
  }

  const repo = gameRepoForGoal(goalNumber);
  let created = false;
  if (!repoExists(repo, token)) {
    gh(["repo", "create", repo, "--template", templateRepo, "--private"], token);
    created = true;
  }

  const vpsNote = ensureGameWorkerOnVps(repo);

  commentOnGoal(
    goalRepo,
    goalNumber,
    [
      `${GAME_REPO_MARKER}${repo} -->`,
      created ? `**Scaffold:** создан репо [\`${repo}\`](https://github.com/${repo}) из template \`${templateRepo}\`.` : `**Scaffold:** репо [\`${repo}\`](https://github.com/${repo}) уже существует.`,
      vpsNote ? "" : undefined,
      vpsNote ?? undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
    token,
  );

  return { repo, created, vpsNote };
}

/** Optional: clone game repo on VPS and append --worker-dir (ORCHESTRATOR_VPS_SSH=root@host). */
export function ensureGameWorkerOnVps(repo: string): string | undefined {
  const ssh = process.env.ORCHESTRATOR_VPS_SSH?.trim();
  if (!ssh) return undefined;

  const script =
    process.env.ORCHESTRATOR_ENSURE_GAME_SCRIPT?.trim() ||
    "/opt/cursor-workers/win-predict-ai-orchestrator/orchestrator/ops/ensure-game-worker.sh";

  const result = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", ssh, script, repo], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "ssh failed").trim();
    return `VPS: не удалось добавить worker-dir для \`${repo}\`: ${err}. Запусти вручную: \`${script} ${repo}\` на VPS.`;
  }
  return `VPS: клон и \`--worker-dir\` для \`${repo}\` обновлены.`;
}
