import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GhFn = (args: string[], token: string) => string;

export type PrereleasePublish = {
  packageName: string;
  version: string;
  tag: string;
  prUrl: string;
  repo: string;
  prNumber: number;
  sha: string;
  skippedPublish: boolean;
};

export type ConsumerBump = {
  repo: string;
  issueUrl?: string;
  prUrl: string;
  note: string;
};

const PRERELEASE_WAIT_MS = 12 * 60 * 1000;
const PRERELEASE_POLL_MS = 15_000;
const STABLE_WAIT_MS = 15 * 60 * 1000;
const STABLE_POLL_MS = 20_000;

const LIBRARY_PACKAGES: Record<string, string> = {
  "onlyzoran/win-predict-ai-ui": "@onlyzoran/win-predict-ai-ui",
  "onlyzoran/win-predict-ai-icons": "@onlyzoran/win-predict-ai-icons",
};

export function packageNameForLibraryRepo(repo: string): string | undefined {
  return LIBRARY_PACKAGES[repo];
}

export function isLibraryPackageRepo(repo: string): boolean {
  return Boolean(LIBRARY_PACKAGES[repo]);
}

export function computePrereleaseVersion(baseVersion: string, prNumber: number, sha: string): string {
  const base = baseVersion.split("-")[0] || baseVersion;
  const short = sha.slice(0, 7);
  return `${base}-pr.${prNumber}.${short}`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parsePrUrl(url: string): { repo: string; number: number } {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`не URL PR: ${url}`);
  return { repo: match[1], number: Number(match[2]) };
}

function runCmd(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; token?: string },
): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: opts.cwd,
    env: {
      ...process.env,
      ...opts.env,
      ...(opts.token
        ? { GH_TOKEN: opts.token, GITHUB_TOKEN: opts.token, NODE_AUTH_TOKEN: opts.token }
        : {}),
    },
  });
  if (result.status === 0) return (result.stdout || "").trim();
  const err = (result.stderr || result.stdout || `${command} failed`).trim();
  throw new Error(err);
}

function npmViewVersion(packageName: string, version: string, token: string): string | null {
  const result = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "--registry", "https://npm.pkg.github.com"], {
    encoding: "utf8",
    env: { ...process.env, NODE_AUTH_TOKEN: token },
  });
  if (result.status !== 0) return null;
  const out = (result.stdout || "").trim();
  return out || null;
}

function readPackageVersionAtRef(repo: string, ref: string, token: string, gh: GhFn): string {
  const raw = gh(
    ["api", `repos/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`, "--jq", ".content"],
    token,
  );
  const pkg = JSON.parse(Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf8")) as {
    version?: string;
    name?: string;
  };
  if (!pkg.version) throw new Error(`${repo}@${ref}: нет version в package.json`);
  return pkg.version;
}

function prHead(repo: string, prNumber: number, token: string, gh: GhFn): { sha: string; ref: string } {
  const raw = gh(
    ["api", `repos/${repo}/pulls/${prNumber}`, "--jq", "{sha:.head.sha,ref:.head.ref,state:.state}"],
    token,
  );
  const parsed = JSON.parse(raw) as { sha: string; ref: string; state: string };
  if (parsed.state !== "open") throw new Error(`PR ${repo}#${prNumber} не open (${parsed.state})`);
  return { sha: parsed.sha, ref: parsed.ref };
}

function triggerPrereleaseWorkflow(repo: string, prNumber: number, token: string, gh: GhFn): void {
  gh(
    ["workflow", "run", "prerelease.yml", "-R", repo, "-f", `pr_number=${prNumber}`],
    token,
  );
}

function latestWorkflowRunId(repo: string, token: string, gh: GhFn, afterIso: string): number | null {
  const raw = gh(
    [
      "run",
      "list",
      "-R",
      repo,
      "--workflow",
      "prerelease.yml",
      "--limit",
      "10",
      "--json",
      "databaseId,createdAt,status,conclusion,event",
    ],
    token,
  );
  const runs = JSON.parse(raw) as Array<{
    databaseId: number;
    createdAt: string;
    status: string;
    conclusion: string | null;
    event: string;
  }>;
  const after = Date.parse(afterIso);
  const match = runs.find((run) => Date.parse(run.createdAt) >= after - 5_000);
  return match?.databaseId ?? null;
}

function waitForWorkflow(repo: string, runId: number, token: string, gh: GhFn, timeoutMs: number): void {
  const started = Date.now();
  for (;;) {
    const raw = gh(
      ["run", "view", String(runId), "-R", repo, "--json", "status,conclusion,url"],
      token,
    );
    const view = JSON.parse(raw) as { status: string; conclusion: string | null; url: string };
    if (view.status === "completed") {
      if (view.conclusion === "success") return;
      throw new Error(`prerelease workflow ${view.url} → ${view.conclusion}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting prerelease workflow ${view.url}`);
    }
    sleepSync(PRERELEASE_POLL_MS);
  }
}

function waitForNpm(packageName: string, version: string, token: string, timeoutMs: number): boolean {
  const started = Date.now();
  for (;;) {
    if (npmViewVersion(packageName, version, token)) return true;
    if (Date.now() - started > timeoutMs) return false;
    sleepSync(PRERELEASE_POLL_MS);
  }
}

export function publishLibraryPrerelease(prUrl: string, token: string, gh: GhFn): PrereleasePublish {
  const { repo, number: prNumber } = parsePrUrl(prUrl);
  const packageName = packageNameForLibraryRepo(repo);
  if (!packageName) throw new Error(`${repo} не library package`);
  const head = prHead(repo, prNumber, token, gh);
  const baseVersion = readPackageVersionAtRef(repo, head.sha, token, gh);
  const version = computePrereleaseVersion(baseVersion, prNumber, head.sha);
  const tag = `pr-${prNumber}`;

  const already = Boolean(npmViewVersion(packageName, version, token));
  if (!already) {
    const triggeredAt = new Date().toISOString();
    triggerPrereleaseWorkflow(repo, prNumber, token, gh);
    sleepSync(8_000);
    let runId = latestWorkflowRunId(repo, token, gh, triggeredAt);
    const findDeadline = Date.now() + 60_000;
    while (runId == null && Date.now() < findDeadline) {
      sleepSync(5_000);
      runId = latestWorkflowRunId(repo, token, gh, triggeredAt);
    }
    if (runId == null) throw new Error(`не нашёл run prerelease.yml для ${repo}#${prNumber}`);
    waitForWorkflow(repo, runId, token, gh, PRERELEASE_WAIT_MS);
    if (!waitForNpm(packageName, version, token, 60_000)) {
      throw new Error(`${packageName}@${version} не появился в registry после workflow`);
    }
  }

  return {
    packageName,
    version,
    tag,
    prUrl,
    repo,
    prNumber,
    sha: head.sha,
    skippedPublish: already,
  };
}

function ensureGitIdentity(cwd: string): void {
  runCmd("git", ["config", "user.name", "Dmitriy S"], { cwd });
  runCmd("git", ["config", "user.email", "onlyzoran@gmail.com"], { cwd });
}

function cloneRepo(repo: string, token: string): string {
  const dir = mkdtempSync(join(tmpdir(), "orch-bump-"));
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  runCmd("git", ["clone", "--depth", "50", url, dir], {});
  // Drop token from remote URL after clone.
  runCmd("git", ["remote", "set-url", "origin", `https://github.com/${repo}.git`], { cwd: dir });
  ensureGitIdentity(dir);
  return dir;
}

function packageDependencyVersion(cwd: string, packageName: string): string | null {
  try {
    const raw = runCmd("node", ["-p", `require('./package.json').dependencies?.[${JSON.stringify(packageName)}] ?? ''`], {
      cwd,
    });
    return raw || null;
  } catch {
    return null;
  }
}

function writeNpmrc(cwd: string): void {
  writeFileSync(
    join(cwd, ".npmrc"),
    "@onlyzoran:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n",
  );
}

export function bumpPackageOnBranch(opts: {
  repo: string;
  branch: string;
  packageName: string;
  version: string;
  token: string;
  createBranchFromMain?: boolean;
  /** default true — prerelease pins must be exact */
  exact?: boolean;
  commitMessage: string;
}): { changed: boolean; headSha?: string } {
  const dir = cloneRepo(opts.repo, opts.token);
  try {
    if (opts.createBranchFromMain) {
      runCmd("git", ["fetch", "origin", "main"], { cwd: dir, token: opts.token });
      runCmd("git", ["checkout", "-B", opts.branch, "origin/main"], { cwd: dir });
    } else {
      const fetchBranch = spawnSync("git", ["fetch", "origin", "main", opts.branch], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GH_TOKEN: opts.token, GITHUB_TOKEN: opts.token },
      });
      if (fetchBranch.status !== 0) {
        runCmd("git", ["fetch", "origin", "main"], { cwd: dir, token: opts.token });
      }
      const hasRemote = spawnSync("git", ["rev-parse", "--verify", `origin/${opts.branch}`], {
        cwd: dir,
        encoding: "utf8",
      });
      if (hasRemote.status !== 0) {
        runCmd("git", ["checkout", "-B", opts.branch, "origin/main"], { cwd: dir });
      } else {
        runCmd("git", ["checkout", "-B", opts.branch, `origin/${opts.branch}`], { cwd: dir });
      }
    }

    const current = packageDependencyVersion(dir, opts.packageName);
    if (current === opts.version || current === `^${opts.version}`) {
      return { changed: false };
    }

    writeNpmrc(dir);
    runCmd("npm", ["install", `${opts.packageName}@${opts.version}`, ...(opts.exact === false ? [] : ["--save-exact"])], {
      cwd: dir,
      token: opts.token,
      env: { NODE_AUTH_TOKEN: opts.token },
    });

    const status = runCmd("git", ["status", "--porcelain"], { cwd: dir });
    if (!status.trim()) return { changed: false };

    runCmd("git", ["add", "package.json", "package-lock.json"], { cwd: dir });
    runCmd("git", ["commit", "-m", opts.commitMessage], { cwd: dir });
    runCmd("git", ["push", "-u", `https://x-access-token:${opts.token}@github.com/${opts.repo}.git`, `HEAD:${opts.branch}`], {
      cwd: dir,
    });
    const headSha = runCmd("git", ["rev-parse", "HEAD"], { cwd: dir });
    return { changed: true, headSha };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function openOrFindBumpPr(opts: {
  repo: string;
  branch: string;
  title: string;
  body: string;
  token: string;
  gh: GhFn;
}): string {
  const existing = opts.gh(
    [
      "pr",
      "list",
      "-R",
      opts.repo,
      "--state",
      "open",
      "--head",
      opts.branch,
      "--json",
      "url",
      "--jq",
      ".[0].url // empty",
    ],
    opts.token,
  );
  if (existing) return existing;
  const dir = mkdtempSync(join(tmpdir(), "orch-pr-"));
  const file = join(dir, "body.md");
  writeFileSync(file, opts.body);
  const url = opts.gh(
    [
      "pr",
      "create",
      "-R",
      opts.repo,
      "--base",
      "main",
      "--head",
      opts.branch,
      "--title",
      opts.title,
      "--body-file",
      file,
    ],
    opts.token,
  );
  try {
    opts.gh(["pr", "edit", url, "--add-assignee", "onlyzoran"], opts.token);
  } catch {
    /* assignee optional */
  }
  return url;
}

export function waitForStablePackageVersion(
  repo: string,
  packageName: string,
  token: string,
  gh: GhFn,
  afterMergeSha?: string,
): string {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < STABLE_WAIT_MS) {
    try {
      // Prefer newest v* tag on main after release.yml.
      const tag = gh(
        ["api", `repos/${repo}/tags?per_page=5`, "--jq", ".[0].name // empty"],
        token,
      );
      if (/^v\d+\.\d+\.\d+$/.test(tag)) {
        const version = tag.slice(1);
        if (npmViewVersion(packageName, version, token)) return version;
      }
      const releaseRun = gh(
        [
          "run",
          "list",
          "-R",
          repo,
          "--workflow",
          "release.yml",
          "--branch",
          "main",
          "--limit",
          "3",
          "--json",
          "status,conclusion,headSha,databaseId,createdAt",
        ],
        token,
      );
      const runs = JSON.parse(releaseRun) as Array<{
        status: string;
        conclusion: string | null;
        headSha: string;
        databaseId: number;
      }>;
      const ok = runs.find((r) => {
        if (r.status !== "completed" || r.conclusion !== "success") return false;
        if (afterMergeSha && r.headSha !== afterMergeSha) {
          // Accept any recent successful release on main once the tag is visible.
          return Boolean(tag);
        }
        return true;
      });
      if (ok && /^v\d+\.\d+\.\d+$/.test(tag) && npmViewVersion(packageName, tag.slice(1), token)) {
        return tag.slice(1);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    sleepSync(STABLE_POLL_MS);
  }
  throw new Error(
    `не дождался стабильной версии ${packageName} в ${repo}${lastError ? `: ${lastError.slice(0, 200)}` : ""}`,
  );
}

export function shortPackageSlug(packageName: string): string {
  return packageName.replace(/^@onlyzoran\//, "");
}

export function branchNameForPrerelease(packageName: string, version: string): string {
  const safe = version.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `chore/prerelease-${shortPackageSlug(packageName)}-${safe}`.slice(0, 100);
}
