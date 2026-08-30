export function taskMarker(taskId: string): string {
  return `<!-- orchestrator-task:${taskId} -->`;
}

export function parentLine(goalRepo: string, goalNumber: number): string {
  return `Parent: ${goalRepo}#${goalNumber}`;
}

export function parseTaskId(body: string): string | undefined {
  return body.match(/<!-- orchestrator-task:([a-z0-9-]+) -->/)?.[1];
}

export function parseParentGoalNumber(
  body: string,
  goalRepo = "onlyzoran/win-predict-ai-orchestrator",
): number | undefined {
  const escaped = goalRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagged = body.match(
    new RegExp(`Parent:\\s*(?:https://github\\.com/)?${escaped}(?:/issues/|#)(\\d+)`, "i"),
  );
  if (!tagged) return undefined;
  const n = Number(tagged[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** PR принадлежит задаче плана Goal: Parent + task marker в body/title. Без Closes на Goal. */
export function prMatchesGoalTask(
  pr: { body?: string; title?: string },
  parent: string,
  taskId: string,
): boolean {
  const text = `${pr.body ?? ""}\n${pr.title ?? ""}`;
  return text.includes(parent) && text.includes(taskMarker(taskId));
}

export type PrLike = { url: string; body?: string; title?: string; headRefName?: string; state?: string };

export function matchGoalTaskPrs<T extends PrLike>(items: T[], parent: string, taskId: string): T[] {
  return items.filter((item) => prMatchesGoalTask(item, parent, taskId));
}
