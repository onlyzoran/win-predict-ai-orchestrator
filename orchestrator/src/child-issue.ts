export type ChildIssueCandidate = {
  url: string;
  title: string;
  body: string;
  state: string;
};

export type ChildIssueRef = { url: string; closed: boolean };

export function taskMarker(taskId: string): string {
  return `<!-- orchestrator-task:${taskId} -->`;
}

export function parentLine(goalRepo: string, goalNumber: number): string {
  return `Parent: ${goalRepo}#${goalNumber}`;
}

function pickPreferred(items: ChildIssueCandidate[]): ChildIssueCandidate | undefined {
  if (!items.length) return undefined;
  return items.find((item) => item.state !== "CLOSED") ?? items[0];
}

function toRef(item: ChildIssueCandidate): ChildIssueRef {
  return { url: item.url, closed: item.state === "CLOSED" };
}

/** Находит child по маркеру задачи, иначе по заголовку. Не схлопывает все задачи Goal в один issue. */
export function matchExistingChild(
  items: ChildIssueCandidate[],
  task: { id: string; title: string },
  parent: string,
): ChildIssueRef | undefined {
  const owned = items.filter((item) => item.body.includes(parent));
  const marked = pickPreferred(owned.filter((item) => item.body.includes(taskMarker(task.id))));
  if (marked) return toRef(marked);
  const titled = pickPreferred(owned.filter((item) => item.title === task.title));
  if (titled) return toRef(titled);
  return undefined;
}
