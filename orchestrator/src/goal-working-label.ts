/** GitHub labels on Goal while orchestrator phases are active (not just In Progress column). */

export const WORKING_LABEL = "working";
export const REVIEWING_LABEL = "reviewing";

const STATE_RE = /<!-- orchestrator-state:(.*?) -->/;

export type PhaseLabelState = {
  phase?: string;
  at?: string;
};

type ParsedDispatchState = PhaseLabelState & { taskId?: string };

export type DispatchComment = { body: string };

function parseDispatchStateBody(body: string): ParsedDispatchState | undefined {
  const match = body.match(STATE_RE);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as ParsedDispatchState;
  } catch {
    return undefined;
  }
}

function isActivePhaseLabel(
  state: PhaseLabelState | undefined,
  phase: string,
  now: number,
  staleMs: number,
): boolean {
  if (state?.phase !== phase) return false;
  if (!state.at) return true;
  const started = Date.parse(state.at);
  return !Number.isNaN(started) && now - started < staleMs;
}

export function shouldHaveWorkingLabel(
  state: PhaseLabelState | undefined,
  now = Date.now(),
  staleMs = 3 * 60 * 60 * 1000,
): boolean {
  return isActivePhaseLabel(state, "working", now, staleMs);
}

export function shouldHaveReviewingLabel(
  state: PhaseLabelState | undefined,
  now = Date.now(),
  staleMs = 3 * 60 * 60 * 1000,
): boolean {
  return isActivePhaseLabel(state, "reviewing", now, staleMs);
}

/** Latest active reviewing dispatch (goal- or task-level). */
export function reviewingStateForLabels(comments: DispatchComment[]): PhaseLabelState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchStateBody(comment.body);
    if (state?.phase === "reviewing") return state;
  }
  return undefined;
}

/** Latest goal-level working; skips post-promote echo and stops at later goal phases. */
export function goalLevelWorkingStateForLabels(comments: DispatchComment[]): PhaseLabelState | undefined {
  for (const comment of [...comments].reverse()) {
    const state = parseDispatchStateBody(comment.body);
    if (!state || state.taskId) continue;
    if (state.phase === "working" && isPostPromoteWorkingEcho(comment.body)) continue;
    if (state.phase === "working") return state;
    if (state.phase === "review" || state.phase === "reviewing" || state.phase === "releasing") {
      return undefined;
    }
  }
  return undefined;
}

/** Board sync: working only on queue head; reviewing from any dispatch level. */
export function resolveGoalPhaseLabels(
  comments: DispatchComment[],
  isQueueHead: boolean,
  now = Date.now(),
  staleMs = 3 * 60 * 60 * 1000,
): { working: boolean; reviewing: boolean } {
  const reviewing = shouldHaveReviewingLabel(reviewingStateForLabels(comments), now, staleMs);
  const working =
    isQueueHead &&
    !reviewing &&
    shouldHaveWorkingLabel(goalLevelWorkingStateForLabels(comments), now, staleMs);
  return { working, reviewing };
}

/** Immediate sync right after posting a dispatch comment. */
export function phaseLabelsAfterDispatch(
  state: PhaseLabelState | undefined,
  now = Date.now(),
  staleMs = 3 * 60 * 60 * 1000,
): { working: boolean; reviewing: boolean } {
  const reviewing = state?.phase === "reviewing" && shouldHaveReviewingLabel(state, now, staleMs);
  const working =
    state?.phase === "working" &&
    !reviewing &&
    shouldHaveWorkingLabel(state, now, staleMs);
  return { working, reviewing };
}

function extractDispatchNotes(body: string): string[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function isTerminalDispatchNote(note: string): boolean {
  return (
    /review (pass|blocked|changes)/i.test(note) ||
    /уже (закрыт|смержен|запускали)/i.test(note)
  );
}

/** Spurious working after promote (legacy «Воркеры.» or slim JSON+notes). */
export function isPostPromoteWorkingEcho(body: string): boolean {
  if (!/"phase"\s*:\s*"working"/.test(body)) return false;
  if (/\*\*В работе\.\*\*/.test(body)) return false;
  const notes = extractDispatchNotes(body);
  if (!notes.length || !notes.every(isTerminalDispatchNote)) return false;
  if (/\*\*Воркеры\.\*\*/.test(body)) return true;
  return notes.every((note) => /review (pass|blocked|changes)/i.test(note));
}
