import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { previewUrlForPr } from "./preview-url.js";
import { probePreviewUrl } from "./visual-review.js";

export const VPS_PREVIEW_REPOS = new Set(["onlyzoran/gift-sales", "onlyzoran/shoppable-feed"]);

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

/** Goal parent marker used in PR bodies (matches child-issue parentLine). */
export function goalParentPattern(goalNumber: number): string {
  return `win-predict-ai-orchestrator#${goalNumber}`;
}

/** Branch names from MODE A — preview script resolves PR head itself. */
export function previewScriptRef(headRef?: string): string | undefined {
  const ref = headRef?.trim();
  if (!ref || ref === "main" || ref === "master") return undefined;
  return ref;
}

export function resolvePreviewGitRef(
  headRef: string | undefined,
  prHeadSha: ((prUrl: string) => string) | undefined,
  prUrls: string[] | undefined,
): string | undefined {
  const firstPr = prUrls?.[0]?.trim();
  if (firstPr && prHeadSha) {
    try {
      return prHeadSha(firstPr);
    } catch {
      /* fall through to branch ref */
    }
  }
  return previewScriptRef(headRef);
}

export function vpsPreviewUrl(repo: string, goalNumber: number): string | undefined {
  return previewUrlForPr(`https://github.com/${repo}/pull/1`, goalNumber);
}

export function taskUsesVpsPreview(repo: string): boolean {
  return VPS_PREVIEW_REPOS.has(repo);
}

export type EnsureVpsPreviewOpts = {
  root: string;
  ifMissing?: boolean;
  headRef?: string;
  prUrls?: string[];
  prHeadSha?: (prUrl: string) => string;
};

export function ensureVpsPreview(
  repo: string,
  goalNumber: number,
  opts: EnsureVpsPreviewOpts,
): { ok: boolean; message: string } {
  const config = VPS_PREVIEW_SCRIPTS[repo];
  if (!config) return { ok: true, message: "skip" };

  const scriptOverride =
    repo === "onlyzoran/gift-sales"
      ? process.env.ORCHESTRATOR_GIFT_SALES_PREVIEW_SCRIPT?.trim()
      : repo === "onlyzoran/shoppable-feed"
        ? process.env.ORCHESTRATOR_SHOPPABLE_FEED_PREVIEW_SCRIPT?.trim()
        : undefined;
  const script = scriptOverride || join(opts.root, "orchestrator/ops", config.script);
  if (!existsSync(script)) {
    const message = `preview ${repo}: нет ${script}`;
    console.warn(message);
    return { ok: false, message };
  }

  const args = [script, String(goalNumber)];
  const ref = resolvePreviewGitRef(opts.headRef, opts.prHeadSha, opts.prUrls);
  if (ref) args.push(ref);

  console.log(`preview ${repo}: bash ${args.join(" ")}`);
  const result = spawnSync("bash", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(opts.ifMissing ? { [config.ifMissingEnv]: "1" } : {}),
    },
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "failed").trim();
    console.warn(`preview ${repo}: ${message}`);
    return { ok: false, message };
  }
  return { ok: true, message: (result.stdout || "").trim() };
}

export async function isVpsPreviewReady(
  repo: string,
  goalNumber: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = vpsPreviewUrl(repo, goalNumber);
  if (!url) return true;
  const probe = await probePreviewUrl(url, fetchImpl);
  return probe.ready;
}
