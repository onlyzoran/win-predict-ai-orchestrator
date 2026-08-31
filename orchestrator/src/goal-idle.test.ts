import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recentlyIdleDispatchNotified, taskOpenPrNeedsReview } from "./goal-idle.js";

const MARKER = "<!-- orchestrator-dispatch -->";

describe("taskOpenPrNeedsReview", () => {
  it("true for error phase with open PR", () => {
    assert.equal(taskOpenPrNeedsReview({ phase: "error" }, true, false), true);
  });

  it("false when review pass recorded", () => {
    assert.equal(taskOpenPrNeedsReview({ phase: "review", reviewVerdict: "pass" }, true, false), false);
  });

  it("false when reviewer active", () => {
    assert.equal(
      taskOpenPrNeedsReview({ phase: "reviewing", reviewingActive: true }, true, false),
      false,
    );
  });
});

describe("recentlyIdleDispatchNotified", () => {
  it("true when idle hint already posted", () => {
    const comments = [{ body: "Воркеры по этому плану уже запускались." }];
    assert.equal(recentlyIdleDispatchNotified(comments, MARKER), true);
  });

  it("false when only dispatch comments without hint", () => {
    const comments = [{ body: `${MARKER}\n<!-- orchestrator-state:{"phase":"working"} -->` }];
    assert.equal(recentlyIdleDispatchNotified(comments, MARKER), false);
  });
});
