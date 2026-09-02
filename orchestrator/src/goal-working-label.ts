/** GitHub label on Goal while orchestrator phase `working` is active (not just In Progress column). */

export const WORKING_LABEL = "working";

export type WorkingLabelState = {
  phase?: string;
  at?: string;
};

export function shouldHaveWorkingLabel(
  state: WorkingLabelState | undefined,
  now = Date.now(),
  staleMs = 3 * 60 * 60 * 1000,
): boolean {
  if (state?.phase !== "working") return false;
  if (!state.at) return true;
  const started = Date.parse(state.at);
  return !Number.isNaN(started) && now - started < staleMs;
}
