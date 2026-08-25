import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPrLinkLines, previewUrlForPr } from "./preview-url.js";

describe("previewUrlForPr", () => {
  it("ui Storybook Pages", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-ui/pull/39"),
      "https://onlyzoran.github.io/win-predict-ai-ui/pr-preview/pr-39/",
    );
  });

  it("icons playground Pages", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-icons/pull/12"),
      "https://onlyzoran.github.io/win-predict-ai-icons/pr-preview/pr-12/",
    );
  });

  it("app VPS preview", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai/pull/7"),
      "http://202.71.15.138/win-predict-ai-preview/pr-7/",
    );
  });

  it("admin/data — без preview", () => {
    assert.equal(previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-admin/pull/3"), undefined);
    assert.equal(previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-data/pull/1"), undefined);
  });
});

describe("formatPrLinkLines", () => {
  it("пустой список", () => {
    assert.equal(formatPrLinkLines([]), "- (URL PR не найден)");
  });

  it("PR + Demo для ui", () => {
    assert.equal(
      formatPrLinkLines(["https://github.com/onlyzoran/win-predict-ai-ui/pull/39"]),
      [
        "- https://github.com/onlyzoran/win-predict-ai-ui/pull/39",
        "- Demo: https://onlyzoran.github.io/win-predict-ai-ui/pr-preview/pr-39/",
      ].join("\n"),
    );
  });

  it("только PR для admin", () => {
    assert.equal(
      formatPrLinkLines(["https://github.com/onlyzoran/win-predict-ai-admin/pull/3"]),
      "- https://github.com/onlyzoran/win-predict-ai-admin/pull/3",
    );
  });
});
