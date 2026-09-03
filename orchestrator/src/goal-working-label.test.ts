import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPostPromoteWorkingEcho,
  resolveGoalPhaseLabels,
  shouldHaveReviewingLabel,
  shouldHaveWorkingLabel,
} from "./goal-working-label.js";

describe("shouldHaveWorkingLabel", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z");
  const staleMs = 3 * 60 * 60 * 1000;

  it("true for fresh working phase", () => {
    assert.equal(
      shouldHaveWorkingLabel(
        { phase: "working", at: "2026-01-01T00:30:00.000Z" },
        now,
        staleMs,
      ),
      true,
    );
  });

  it("false for stale working phase", () => {
    assert.equal(
      shouldHaveWorkingLabel(
        { phase: "working", at: "2025-12-31T20:00:00.000Z" },
        now,
        staleMs,
      ),
      false,
    );
  });

  it("false for review phase", () => {
    assert.equal(
      shouldHaveWorkingLabel({ phase: "review", at: "2026-01-01T00:59:00.000Z" }, now, staleMs),
      false,
    );
  });

  it("true for working without timestamp", () => {
    assert.equal(shouldHaveWorkingLabel({ phase: "working" }, now, staleMs), true);
  });
});

describe("shouldHaveReviewingLabel", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z");
  const staleMs = 3 * 60 * 60 * 1000;

  it("true for fresh reviewing phase", () => {
    assert.equal(
      shouldHaveReviewingLabel(
        { phase: "reviewing", at: "2026-01-01T00:30:00.000Z" },
        now,
        staleMs,
      ),
      true,
    );
  });

  it("false for stale reviewing phase", () => {
    assert.equal(
      shouldHaveReviewingLabel(
        { phase: "reviewing", at: "2025-12-31T20:00:00.000Z" },
        now,
        staleMs,
      ),
      false,
    );
  });

  it("false for working phase", () => {
    assert.equal(
      shouldHaveReviewingLabel(
        { phase: "working", at: "2026-01-01T00:59:00.000Z" },
        now,
        staleMs,
      ),
      false,
    );
  });
});

describe("isPostPromoteWorkingEcho", () => {
  it("true for Воркеры + review pass only", () => {
    assert.equal(
      isPostPromoteWorkingEcho(
        [
          "<!-- orchestrator-dispatch -->",
          '<!-- orchestrator-state:{"phase":"working"} -->',
          "**Воркеры.**",
          "",
          "- sales-price-comparison-ui — review pass — https://github.com/x/pull/7",
        ].join("\n"),
      ),
      true,
    );
  });

  it("true for slim working + review pass only", () => {
    assert.equal(
      isPostPromoteWorkingEcho(
        [
          "<!-- orchestrator-dispatch -->",
          '<!-- orchestrator-state:{"phase":"working"} -->',
          "- sales-price-comparison-ui — review pass — https://github.com/x/pull/7",
        ].join("\n"),
      ),
      true,
    );
  });

  it("false for marker-only claim without notes", () => {
    assert.equal(
      isPostPromoteWorkingEcho(
        [
          "<!-- orchestrator-dispatch -->",
          '<!-- orchestrator-state:{"phase":"working","at":"2026-01-01T00:00:00.000Z"} -->',
        ].join("\n"),
      ),
      false,
    );
  });

  it("false when note implies active worker", () => {
    assert.equal(
      isPostPromoteWorkingEcho(
        [
          '<!-- orchestrator-state:{"phase":"working"} -->',
          "- ui-home — sdk воркер на машине",
        ].join("\n"),
      ),
      false,
    );
  });
});

describe("resolveGoalPhaseLabels", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z");
  const staleMs = 3 * 60 * 60 * 1000;

  const goalWorking = [
    "<!-- orchestrator-dispatch -->",
    '<!-- orchestrator-state:{"phase":"working","at":"2026-01-01T00:30:00.000Z"} -->',
    "working",
  ].join("\n");

  const taskReviewing = [
    "<!-- orchestrator-dispatch -->",
    '<!-- orchestrator-state:{"phase":"reviewing","taskId":"feed-x","at":"2026-01-01T00:35:00.000Z"} -->',
    "reviewing",
  ].join("\n");

  it("working only on queue head", () => {
    const comments = [{ body: goalWorking }];
    assert.deepEqual(resolveGoalPhaseLabels(comments, true, now, staleMs), {
      working: true,
      reviewing: false,
      releasing: false,
    });
    assert.deepEqual(resolveGoalPhaseLabels(comments, false, now, staleMs), {
      working: false,
      reviewing: false,
      releasing: false,
    });
  });

  it("reviewing from task-level dispatch suppresses working", () => {
    const comments = [{ body: goalWorking }, { body: taskReviewing }];
    assert.deepEqual(resolveGoalPhaseLabels(comments, true, now, staleMs), {
      working: false,
      reviewing: true,
      releasing: false,
    });
  });

  it("releasing suppresses working and reviewing", () => {
    const releasing = [
      "<!-- orchestrator-dispatch -->",
      '<!-- orchestrator-state:{"phase":"releasing","at":"2026-01-01T00:40:00.000Z"} -->',
      "releasing",
    ].join("\n");
    const comments = [{ body: goalWorking }, { body: taskReviewing }, { body: releasing }];
    assert.deepEqual(resolveGoalPhaseLabels(comments, true, now, staleMs), {
      working: false,
      reviewing: false,
      releasing: true,
    });
  });
});
