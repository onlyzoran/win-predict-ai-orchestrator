import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReleaseablePhase, isReleaseIntent } from "./release-intent.js";

describe("isReleaseIntent", () => {
  it("ловат типичные фразы приёмки", () => {
    for (const phrase of [
      "релизь",
      "Релизь!",
      "можно релизить",
      "отправляем на релиз",
      "ок, можно релизить",
      "давай релиз",
      "в релиз",
      "ship it",
      "release please",
    ]) {
      assert.equal(isReleaseIntent(phrase), true, phrase);
    }
  });

  it("не путает с правками и отрицанием", () => {
    for (const phrase of [
      "",
      "поправь отступы",
      "после релиза проверь админку",
      "не релизить пока",
      "не надо релизить",
      "ревью ок, но ещё правки",
    ]) {
      assert.equal(isReleaseIntent(phrase), false, phrase);
    }
  });
});

describe("isReleaseablePhase", () => {
  it("review / releasing / reviewing — да", () => {
    assert.equal(isReleaseablePhase("review"), true);
    assert.equal(isReleaseablePhase("releasing"), true);
    assert.equal(isReleaseablePhase("reviewing"), true);
  });

  it("working / error / пусто — нет (error отдельно в board)", () => {
    assert.equal(isReleaseablePhase("working"), false);
    assert.equal(isReleaseablePhase("error"), false);
    assert.equal(isReleaseablePhase(undefined), false);
  });
});
