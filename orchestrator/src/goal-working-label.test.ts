import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldHaveWorkingLabel } from "./goal-working-label.js";

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
