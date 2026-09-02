/** GitHub labels on Goal while orchestrator phases are active (not just In Progress column). */

export const WORKING_LABEL = "working";
export const REVIEWING_LABEL = "reviewing";

export type PhaseLabelState = {
  phase?: string;
  at?: string;
};

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
