/** One In Progress Goal at a time; others wait on the board without starting workers. */

export type QueueGoal = { number: number; url: string };

export type QueueInventoryHint = {
  active: Array<{ issueUrl: string }>;
  last?: { issueUrl: string } | null;
};

export function sortGoalsInQueue<T extends QueueGoal>(goals: T[]): T[] {
  return [...goals].sort((a, b) => a.number - b.number);
}

/**
 * Head of the queue: machine busy → sticky last goal → lowest issue #.
 * Sticky keeps the current Goal until Review/Done even if lower # cards enter In Progress.
 */
export function pickGoalQueueHead<T extends QueueGoal>(
  goals: T[],
  inventory: QueueInventoryHint,
): T | undefined {
  const sorted = sortGoalsInQueue(goals);
  if (!sorted.length) return undefined;

  for (const run of inventory.active) {
    const match = sorted.find((g) => g.url === run.issueUrl);
    if (match) return match;
  }

  if (inventory.last?.issueUrl) {
    const sticky = sorted.find((g) => g.url === inventory.last!.issueUrl);
    if (sticky) return sticky;
  }

  return sorted[0];
}

export function goalQueueWaiting<T extends QueueGoal>(goals: T[], head: T | undefined): T[] {
  if (!head) return sortGoalsInQueue(goals);
  return sortGoalsInQueue(goals.filter((g) => g.number !== head.number));
}
