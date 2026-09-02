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
