/**
 * Review → In Progress с комментарием человека: пересобрать план и догнать воркеров,
 * даже если последний dispatch-state уже `working` (воркеры успели завершиться).
 */

export const DISPATCH_MARKER = "<!-- orchestrator-dispatch -->";
export const PLAN_MARKER = "<!-- orchestrator-plan -->";

const STATE_RE = /<!-- orchestrator-state:(.*?) -->/;

export type GoalComment = {
  body: string;
  user?: { login?: string };
};

function parseDispatchPhase(body: string): string | undefined {
  const match = body.match(STATE_RE);
  if (!match) return undefined;
  try {
    const raw = JSON.parse(match[1]) as { phase?: string };
    return raw.phase;
  } catch {
    return undefined;
  }
}

function isHumanNote(comment: GoalComment): boolean {
  const login = comment.user?.login ?? "";
  if (!login || login.endsWith("[bot]")) return false;
  if (comment.body.includes(DISPATCH_MARKER) || comment.body.includes(PLAN_MARKER)) return false;
  const first = comment.body.trim().split(/\s+/)[0]?.toLowerCase();
  if (first === "/orchestrate" || first === "/new-icon" || first === "/ui-agent") return false;
  return comment.body.trim().length > 0;
}

function lastReviewCommentIndex(comments: GoalComment[]): number {
  let lastReview = -1;
  comments.forEach((comment, index) => {
    const phase = parseDispatchPhase(comment.body);
    if (phase === "review" || (comment.body.includes(DISPATCH_MARKER) && /Нужна приёмка/.test(comment.body))) {
      lastReview = index;
    }
  });
  return lastReview;
}

function lastHumanNoteIndexAfterReview(comments: GoalComment[]): number {
  const lastReview = lastReviewCommentIndex(comments);
  let lastHuman = -1;
  comments.forEach((comment, index) => {
    if (index <= lastReview) return;
    if (isHumanNote(comment)) lastHuman = index;
  });
  return lastHuman;
}

function hadGoalReviewAcceptance(comments: GoalComment[]): boolean {
  return comments.some((comment) => {
    const phase = parseDispatchPhase(comment.body);
    if (phase === "review" && !comment.body.includes('"taskId"')) return true;
    return comment.body.includes(DISPATCH_MARKER) && /Нужна приёмка/.test(comment.body);
  });
}

/** Есть необработанные комментарии человека после последней приёмки в Review. */
export function goalRevisionPending(comments: GoalComment[], humanNotes: string): boolean {
  if (!hadGoalReviewAcceptance(comments)) return false;
  if (!humanNotes.trim()) return false;
  const lastHuman = lastHumanNoteIndexAfterReview(comments);
  if (lastHuman < 0) return false;
  return !comments.slice(lastHuman + 1).some((comment) => comment.body.includes(PLAN_MARKER));
}
