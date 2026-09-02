import { isLibraryPackageRepo } from "./prerelease.js";

export const PUBLISHER_MARKER = "<!-- orchestrator-publisher -->";
export const PUBLISHER_STATE_RE = /<!-- orchestrator-publisher-state:(.*?) -->/;

export type PublisherPhase = "publishing" | "published" | "bump_done" | "publish_error";

export type PublisherState = {
  taskId: string;
  phase: PublisherPhase;
  prUrl: string;
  prSha?: string;
  packageName?: string;
  version?: string;
  at?: string;
};

export type PublisherCommentLike = { body: string };

/** Publisher can block board-watch while CI publish runs (matches prerelease wait). */
export const PUBLISHER_ACTIVE_MS = 15 * 60 * 1000;

export function parsePublisherState(body: string): PublisherState | undefined {
  const tagged = body.match(PUBLISHER_STATE_RE);
  if (!tagged) return undefined;
  try {
    const raw = JSON.parse(tagged[1]) as PublisherState;
    if (
      raw.phase === "publishing" ||
      raw.phase === "published" ||
      raw.phase === "bump_done" ||
      raw.phase === "publish_error"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function latestPublisherState(
  comments: PublisherCommentLike[],
  taskId: string,
): PublisherState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parsePublisherState(comment.body);
    if (state?.taskId === taskId) return state;
  }
  return undefined;
}

export function isActivePublisher(state: PublisherState | undefined): boolean {
  if (state?.phase !== "publishing") return false;
  if (!state.at) return true;
  const started = Date.parse(state.at);
  return !Number.isNaN(started) && Date.now() - started < PUBLISHER_ACTIVE_MS;
}

export function isPrereleaseReady(state: PublisherState | undefined, prUrl: string, prSha?: string): boolean {
  if (!state || state.prUrl !== prUrl) return false;
  if (state.phase !== "published" && state.phase !== "bump_done") return false;
  if (prSha && state.prSha && state.prSha !== prSha) return false;
  return true;
}

/** Library task with open PR needs publish+bump when head changed or last run failed. */
export function needsPublisherRun(input: {
  repo: string;
  openPrUrl?: string;
  openPrSha?: string;
  state?: PublisherState;
  publishingActive?: boolean;
}): boolean {
  if (!isLibraryPackageRepo(input.repo)) return false;
  if (!input.openPrUrl) return false;
  if (input.publishingActive) return false;
  if (!input.state) return true;
  if (input.state.prUrl !== input.openPrUrl) return true;
  if (input.openPrSha && input.state.prSha && input.state.prSha !== input.openPrSha) return true;
  if (input.state.phase === "publish_error") return true;
  return !isPrereleaseReady(input.state, input.openPrUrl, input.openPrSha);
}

export function formatPublisherComment(state: PublisherState, lines: string[]): string {
  return [PUBLISHER_MARKER, `<!-- orchestrator-publisher-state:${JSON.stringify(state)} -->`, ...lines].join(
    "\n",
  );
}

export function publisherWaitNote(taskId: string, depId: string): string {
  return `\`${taskId}\` — жду publish \`${depId}\``;
}
