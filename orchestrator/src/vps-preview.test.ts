import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  goalParentPattern,
  previewScriptRef,
  resolvePreviewGitRef,
  vpsPreviewUrl,
} from "./vps-preview.js";

describe("goalParentPattern", () => {
  it("matches PR Parent line", () => {
    assert.equal(goalParentPattern(69), "win-predict-ai-orchestrator#69");
  });
});

describe("previewScriptRef", () => {
  it("skips main/master", () => {
    assert.equal(previewScriptRef("main"), undefined);
    assert.equal(previewScriptRef("master"), undefined);
  });

  it("keeps feature branches", () => {
    assert.equal(previewScriptRef("feature/foo"), "feature/foo");
  });
});

describe("resolvePreviewGitRef", () => {
  it("prefers PR head SHA", () => {
    assert.equal(
      resolvePreviewGitRef("main", () => "abc123", ["https://github.com/onlyzoran/gift-sales/pull/11"]),
      "abc123",
    );
  });

  it("falls back to branch when SHA lookup fails", () => {
    assert.equal(
      resolvePreviewGitRef("feature/foo", () => {
        throw new Error("no access");
      }, ["https://github.com/onlyzoran/gift-sales/pull/11"]),
      "feature/foo",
    );
  });

  it("returns undefined for main without PR SHA", () => {
    assert.equal(resolvePreviewGitRef("main", undefined, undefined), undefined);
  });
});

describe("vpsPreviewUrl", () => {
  it("gift-sales preview on domain", () => {
    assert.equal(
      vpsPreviewUrl("onlyzoran/gift-sales", 69),
      "https://gift-sales.store/preview/issue-69/",
    );
  });
});
