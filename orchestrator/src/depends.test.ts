import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDependencyMet, unmetDependencyIds } from "./depends.js";

describe("isDependencyMet", () => {
  const ui = { id: "ui-1", repo: "onlyzoran/win-predict-ai-ui" };
  const app = { id: "app-1", repo: "onlyzoran/win-predict-ai", depends_on: ["ui-1"] };
  const iosA = { id: "ios-a", repo: "onlyzoran/win-predict-ai-ios" };
  const iosB = { id: "ios-b", repo: "onlyzoran/win-predict-ai-ios", depends_on: ["ios-a"] };

  it("closed dep always met", () => {
    assert.equal(
      isDependencyMet({ url: "https://github.com/o/r/issues/1", closed: true }, ui, app, false),
      true,
    );
  });

  it("cross-repo open PR met", () => {
    assert.equal(
      isDependencyMet({ url: "https://github.com/o/r/issues/1", closed: false }, ui, app, true),
      true,
    );
  });

  it("cross-repo without PR unmet", () => {
    assert.equal(
      isDependencyMet({ url: "https://github.com/o/r/issues/1", closed: false }, ui, app, false),
      false,
    );
  });

  it("same-repo open PR still unmet", () => {
    assert.equal(
      isDependencyMet({ url: "https://github.com/o/r/issues/1", closed: false }, iosA, iosB, true),
      false,
    );
  });

  it("missing dep unmet", () => {
    assert.equal(isDependencyMet(undefined, ui, app, true), false);
  });
});

describe("unmetDependencyIds", () => {
  it("same-repo waits for closed", () => {
    const iosA = { id: "ios-a", repo: "onlyzoran/win-predict-ai-ios" };
    const iosB = {
      id: "ios-b",
      repo: "onlyzoran/win-predict-ai-ios",
      depends_on: ["ios-a"],
    };
    const unmet = unmetDependencyIds(
      iosB,
      [iosA, iosB],
      (id) =>
        id === "ios-a"
          ? { url: "https://github.com/onlyzoran/win-predict-ai-ios/issues/1", closed: false }
          : undefined,
      () => true,
    );
    assert.deepEqual(unmet, ["ios-a"]);
  });

  it("same-repo clear when closed", () => {
    const iosA = { id: "ios-a", repo: "onlyzoran/win-predict-ai-ios" };
    const iosB = {
      id: "ios-b",
      repo: "onlyzoran/win-predict-ai-ios",
      depends_on: ["ios-a"],
    };
    const unmet = unmetDependencyIds(
      iosB,
      [iosA, iosB],
      (id) =>
        id === "ios-a"
          ? { url: "https://github.com/onlyzoran/win-predict-ai-ios/issues/1", closed: true }
          : undefined,
      () => false,
    );
    assert.deepEqual(unmet, []);
  });
});
