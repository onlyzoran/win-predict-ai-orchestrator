import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPrConflicting,
  prNeedsBaseSync,
  shouldSyncMainFromBoard,
  syncMainWorkerNotes,
} from "./sync-main.js";

describe("shouldSyncMainFromBoard", () => {
  it("да: Review pass без комментария", () => {
    assert.equal(
      shouldSyncMainFromBoard({ phase: "review", reviewVerdict: "pass", humanNotes: "" }),
      true,
    );
  });

  it("да: Review blocked без комментария", () => {
    assert.equal(
      shouldSyncMainFromBoard({ phase: "review", reviewVerdict: "blocked", humanNotes: "" }),
      true,
    );
  });

  it("нет: есть комментарий человека", () => {
    assert.equal(
      shouldSyncMainFromBoard({
        phase: "review",
        reviewVerdict: "pass",
        humanNotes: "поправь отступы",
      }),
      false,
    );
  });

  it("нет: changes — воркер по замечаниям ревьюера", () => {
    assert.equal(
      shouldSyncMainFromBoard({ phase: "review", reviewVerdict: "changes", humanNotes: "" }),
      false,
    );
  });

  it("нет: не фаза review", () => {
    assert.equal(
      shouldSyncMainFromBoard({ phase: "working", reviewVerdict: "pass", humanNotes: "" }),
      false,
    );
  });
});

describe("prNeedsBaseSync / isPrConflicting", () => {
  it("behind и dirty", () => {
    assert.equal(prNeedsBaseSync({ mergeable: "MERGEABLE", mergeStateStatus: "BEHIND" }), true);
    assert.equal(prNeedsBaseSync({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), true);
    assert.equal(prNeedsBaseSync({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }), false);
    assert.equal(isPrConflicting({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), true);
    assert.equal(isPrConflicting({ mergeable: "MERGEABLE", mergeStateStatus: "BEHIND" }), false);
  });
});

describe("syncMainWorkerNotes", () => {
  it("просит влить main", () => {
    const text = syncMainWorkerNotes(["pr: конфликт"]);
    assert.match(text, /Подтяни `main`/);
    assert.match(text, /pr: конфликт/);
  });
});
