/** Idle dispatch: open PR without review verdict, debounce duplicate «already launched». */

export const IDLE_DISPATCH_HINT =
  "Воркеры по этому плану уже запускались. Правка: комментарий в issue и карточку Review → In Progress. С нуля: `/orchestrate redo`.";

export type IdleComment = { body: string };

export function recentlyIdleDispatchNotified(comments: IdleComment[], dispatchMarker: string): boolean {
  for (const comment of [...comments].reverse()) {
    if (comment.body.includes("уже запускались")) return true;
    if (comment.body.includes(dispatchMarker)) break;
  }
  return false;
}

export type TaskReviewState = {
  phase?: string;
  reviewVerdict?: string;
  reviewingActive?: boolean;
};

/** True when task has open PR but local reviewer has not recorded pass/blocked yet. */
export function taskOpenPrNeedsReview(
  state: TaskReviewState | undefined,
  hasOpenPr: boolean,
  merged: boolean,
): boolean {
  if (merged || !hasOpenPr) return false;
  if (state?.reviewVerdict === "pass" || state?.reviewVerdict === "blocked") return false;
  if (state?.phase === "reviewing" && state.reviewingActive) return false;
  return true;
}
