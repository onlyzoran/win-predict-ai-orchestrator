import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { branchNameForPrerelease, computePrereleaseVersion, packageNameForLibraryRepo } from "./prerelease.js";

describe("computePrereleaseVersion", () => {
  it("builds version from base, PR number and sha", () => {
    assert.equal(computePrereleaseVersion("0.1.1", 12, "abcdef012345"), "0.1.1-pr.12.abcdef0");
  });

  it("strips existing prerelease metadata from base", () => {
    assert.equal(computePrereleaseVersion("0.2.0-pr.9.deadbee", 9, "cafebabe"), "0.2.0-pr.9.cafebab");
  });
});

describe("packageNameForLibraryRepo", () => {
  it("maps ui and icons", () => {
    assert.equal(packageNameForLibraryRepo("onlyzoran/win-predict-ai-ui"), "@onlyzoran/win-predict-ai-ui");
    assert.equal(packageNameForLibraryRepo("onlyzoran/win-predict-ai-icons"), "@onlyzoran/win-predict-ai-icons");
    assert.equal(packageNameForLibraryRepo("onlyzoran/win-predict-ai"), undefined);
  });
});

describe("branchNameForPrerelease", () => {
  it("includes package slug and version", () => {
    const name = branchNameForPrerelease("@onlyzoran/win-predict-ai-ui", "0.1.1-pr.12.abc1234");
    assert.match(name, /^chore\/prerelease-win-predict-ai-ui-0\.1\.1-pr\.12\.abc1234$/);
  });
});
