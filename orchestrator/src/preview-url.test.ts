import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPrLinkLines, previewUrlForPr } from "./preview-url.js";

const GOAL = 31;

describe("previewUrlForPr", () => {
  it("ui Storybook Pages", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-ui/pull/39", GOAL),
      "https://onlyzoran.github.io/win-predict-ai-ui/ui-preview/issue-31/",
    );
  });

  it("icons playground Pages", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-icons/pull/12", GOAL),
      "https://onlyzoran.github.io/win-predict-ai-icons/icons-preview/issue-31/",
    );
  });

  it("app preview на домене", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai/pull/7", GOAL),
      "https://win-predict-ai.com/app-preview/issue-31/",
    );
  });

  it("admin preview", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-admin/pull/3", GOAL),
      "https://win-predict-ai.com/admin-preview/issue-31/",
    );
  });

  it("gift-sales preview на VPS", () => {
    assert.equal(
      previewUrlForPr("https://github.com/onlyzoran/gift-sales/pull/1", GOAL),
      "http://202.71.15.138/gift-sales/preview/issue-31/",
    );
  });

  it("data — без preview", () => {
    assert.equal(previewUrlForPr("https://github.com/onlyzoran/win-predict-ai-data/pull/1", GOAL), undefined);
  });
});

describe("formatPrLinkLines", () => {
  it("пустой список", () => {
    assert.equal(formatPrLinkLines([], GOAL), "- (URL PR не найден)");
  });

  it("PR + Demo для ui", () => {
    assert.equal(
      formatPrLinkLines(["https://github.com/onlyzoran/win-predict-ai-ui/pull/39"], GOAL),
      [
        "- https://github.com/onlyzoran/win-predict-ai-ui/pull/39",
        "- Demo: https://onlyzoran.github.io/win-predict-ai-ui/ui-preview/issue-31/",
      ].join("\n"),
    );
  });

  it("PR + Demo для admin", () => {
    assert.equal(
      formatPrLinkLines(["https://github.com/onlyzoran/win-predict-ai-admin/pull/3"], GOAL),
      [
        "- https://github.com/onlyzoran/win-predict-ai-admin/pull/3",
        "- Demo: https://win-predict-ai.com/admin-preview/issue-31/",
      ].join("\n"),
    );
  });

  it("не дублирует demo для feature + bump в одном repo", () => {
    const text = formatPrLinkLines(
      [
        "https://github.com/onlyzoran/win-predict-ai/pull/62",
        "https://github.com/onlyzoran/win-predict-ai/pull/61",
      ],
      GOAL,
    );
    assert.equal((text.match(/- Demo:/g) ?? []).length, 1);
    assert.match(text, /app-preview\/issue-31/);
  });
});
