import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHumanGatesForReviewer } from "./human-gates.js";

describe("formatHumanGatesForReviewer", () => {
  it("empty when no gates", () => {
    assert.equal(formatHumanGatesForReviewer(undefined), "");
    assert.equal(formatHumanGatesForReviewer([]), "");
    assert.equal(formatHumanGatesForReviewer(["", "  "]), "");
  });

  it("lists gates and blocked rule", () => {
    const text = formatHumanGatesForReviewer([
      "выбор варианта иконки",
      "приёмка спорного UX",
    ]);
    assert.match(text, /Human gates/);
    assert.match(text, /выбор варианта иконки/);
    assert.match(text, /приёмка спорного UX/);
    assert.match(text, /`blocked`/);
    assert.match(text, /не.*`changes`/);
  });
});
