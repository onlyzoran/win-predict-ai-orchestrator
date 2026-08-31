import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goalQueueWaiting, pickGoalQueueHead, sortGoalsInQueue } from "./goal-queue.js";

const goals = [
  { number: 38, url: "https://github.com/o/hq/issues/38" },
  { number: 35, url: "https://github.com/o/hq/issues/35" },
  { number: 39, url: "https://github.com/o/hq/issues/39" },
];

describe("sortGoalsInQueue", () => {
  it("orders by issue number", () => {
    assert.deepEqual(sortGoalsInQueue(goals).map((g) => g.number), [35, 38, 39]);
  });
});

describe("pickGoalQueueHead", () => {
  it("prefers goal with active machine run", () => {
    const head = pickGoalQueueHead(goals, {
      active: [{ issueUrl: "https://github.com/o/hq/issues/39" }],
      last: null,
    });
    assert.equal(head?.number, 39);
  });

  it("sticks to last goal when still in queue", () => {
    const head = pickGoalQueueHead(goals, {
      active: [],
      last: { issueUrl: "https://github.com/o/hq/issues/38" },
    });
    assert.equal(head?.number, 38);
  });

  it("falls back to lowest issue number", () => {
    const head = pickGoalQueueHead(goals, { active: [], last: undefined });
    assert.equal(head?.number, 35);
  });
});

describe("goalQueueWaiting", () => {
  it("lists non-head goals sorted", () => {
    const head = goals.find((g) => g.number === 35);
    assert.deepEqual(goalQueueWaiting(goals, head).map((g) => g.number), [38, 39]);
  });
});
