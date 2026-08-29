import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReleaseIntent } from "./release-intent.js";

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
