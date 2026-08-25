export type BumpType = "major" | "minor" | "patch";

export function stripPrerelease(version: string): string {
  return version.split("-")[0] || version;
}

export function bumpSemver(version: string, type: BumpType): string {
  const base = stripPrerelease(version);
  const parts = base.split(".").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`не semver: ${version}`);
  }
  let [major, minor, patch] = parts;
  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/** Markers in PR title override; otherwise patch. */
export function resolveBumpTypeFromTitle(title: string): BumpType {
  if (/\[major\]/i.test(title)) return "major";
  if (/\[minor\]/i.test(title)) return "minor";
  if (/\[patch\]/i.test(title)) return "patch";
  return "patch";
}

export type PrFileChange = { path: string; status?: string };

/**
 * Heuristic for library PRs (same idea as former release.yml):
 * - ui: newly added public component .vue → minor
 * - icons: newly added src/icons/*.vue → minor
 */
export function resolveBumpTypeFromFiles(
  repo: string,
  files: Array<string | PrFileChange>,
  title: string,
): BumpType {
  const fromTitle = resolveBumpTypeFromTitle(title);
  if (/\[major\]|\[minor\]|\[patch\]/i.test(title)) return fromTitle;

  const normalized = files.map((f) =>
    typeof f === "string" ? { path: f, status: "added" } : f,
  );
  const isAdded = (f: PrFileChange) => !f.status || /^(added|a)$/i.test(f.status);

  if (repo.endsWith("/win-predict-ai-ui")) {
    const addedComponent = normalized.some((f) => {
      if (!isAdded(f)) return false;
      if (!f.path.startsWith("src/components/") || !f.path.endsWith(".vue")) return false;
      if (f.path.includes("/ui/dropdown-menu/")) return false;
      return true;
    });
    if (addedComponent) return "minor";
  }

  if (repo.endsWith("/win-predict-ai-icons")) {
    const addedIcon = normalized.some(
      (f) => isAdded(f) && /^src\/icons\/[^/]+\.vue$/.test(f.path),
    );
    if (addedIcon) return "minor";
  }

  return "patch";
}

export function buildVersionedChangelogEntry(
  version: string,
  prTitle: string,
  prUrl: string,
  issueUrl: string,
  today = new Date().toISOString().slice(0, 10),
): string {
  const title = prTitle.replace(/^\s+|\s+$/g, "") || "Release";
  return [
    `## ${version} (${today})`,
    "",
    `* ${title} ([PR](${prUrl}), [issue](${issueUrl}))`,
    "",
    "",
  ].join("\n");
}

export function insertVersionedChangelogEntry(existing: string, entry: string): string {
  const trimmed = existing.replace(/^\uFEFF/, "");
  const versionHeading = entry.match(/^## ([^\n]+)/)?.[1];
  const bullet = entry.split("\n").find((line) => line.startsWith("* "));
  if (!versionHeading || !bullet) return `${entry}${trimmed}`;

  // Promote ## Unreleased → version heading, then ensure bullet.
  if (/^## Unreleased\b/m.test(trimmed)) {
    let next = trimmed.replace(/^## Unreleased[^\n]*/m, `## ${versionHeading}`);
    if (!next.includes(bullet)) {
      next = next.replace(/^(## [^\n]+\n)/m, `$1\n${bullet}\n`);
    }
    return next;
  }

  const escaped = versionHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(`^## ${escaped}\\s*$`, "m");
  if (headingRe.test(trimmed)) {
    if (trimmed.includes(bullet)) return trimmed;
    return trimmed.replace(headingRe, `## ${versionHeading}\n\n${bullet}`);
  }

  const heading = trimmed.match(/^# [^\n]+\n+/);
  if (heading) {
    return `${heading[0]}${entry}${trimmed.slice(heading[0].length)}`;
  }
  return `${entry}${trimmed}`;
}

export function setPackageJsonVersion(raw: string, version: string): string {
  const updated = raw.replace(
    /("version"\s*:\s*")([^"]+)(")/,
    (_m, a: string, _old: string, c: string) => `${a}${version}${c}`,
  );
  if (updated === raw) {
    throw new Error("не нашёл \"version\" в package.json");
  }
  return updated;
}

export function setPackageLockRootVersion(raw: string, version: string): string {
  // Root package lock: "version" near the top / under packages[""]
  let next = raw.replace(
    /^(\{\s*"name"\s*:\s*"[^"]*"\s*,\s*"version"\s*:\s*")([^"]+)(")/m,
    `$1${version}$3`,
  );
  next = next.replace(
    /("packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?"version"\s*:\s*")([^"]+)(")/s,
    `$1${version}$3`,
  );
  return next;
}

export function createChangelogFile(version: string, entryBody: string): string {
  return `# Changelog\n\n${entryBody}`;
}
