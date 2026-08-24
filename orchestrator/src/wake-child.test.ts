import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldWakeOnPhase } from "./wake-child.js";

describe("shouldWakeOnPhase", () => {
  it("будит после ошибки релиза (не квота)", () => {
    assert.equal(shouldWakeOnPhase({ phase: "error" }), true);
    assert.equal(shouldWakeOnPhase({ phase: "error", resourceBackoff: true }), false);
  });

  it("не будит по свежему claim releasing — иначе inf. loop релиза", () => {
    assert.equal(shouldWakeOnPhase({ phase: "releasing", releasingActive: true }), false);
  });

  it("будит In Progress, если last phase — протухший releasing", () => {
    assert.equal(shouldWakeOnPhase({ phase: "releasing", releasingActive: false }), true);
  });

  it("будит ручной child без фазы", () => {
    assert.equal(shouldWakeOnPhase({ phase: undefined }), true);
  });
});
