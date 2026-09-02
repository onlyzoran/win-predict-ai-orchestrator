import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPostPromoteWorkingEcho,
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

  it("false when note implies active worker", () => {
    assert.equal(
      isPostPromoteWorkingEcho(
        ["**Воркеры.**", "", "- ui-home — sdk воркер на машине"].join("\n"),
      ),
      false,
    );
  });
});
