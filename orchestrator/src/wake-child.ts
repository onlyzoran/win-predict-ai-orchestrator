export type WakePhase = "working" | "reviewing" | "review" | "releasing" | "error";

export function shouldWakeOnPhase(input: {
  phase: WakePhase | undefined;
  resourceBackoff?: boolean;
  reviewingActive?: boolean;
  reviewChangesDebounce?: boolean;
  notesAfterWorking?: boolean;
  slotFailed?: boolean;
  workingActive?: boolean;
  releasingActive?: boolean;
}): boolean {
  const { phase } = input;
  if (phase === "error") return !input.resourceBackoff;
  if (phase === "reviewing") return !input.reviewingActive;
  if (phase === "review") return !input.reviewChangesDebounce;
  if (phase === "working") {
    if (input.notesAfterWorking || input.slotFailed) return true;
    return !input.workingActive;
  }
  // releasing на карточке In Progress — либо обрезка комментариев, либо релиз упал без error.
  if (phase === "releasing") return !input.releasingActive;
  return !phase;
}
