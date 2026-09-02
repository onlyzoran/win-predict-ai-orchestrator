import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectPreviewUrls,
  formatBrowserReviewBlock,
  isVisualTask,
  needsBrowserReview,
  waitForPreviewUrls,
} from "./visual-review.js";

const UI_PR = "https://github.com/onlyzoran/win-predict-ai-ui/pull/39";
const APP_PR = "https://github.com/onlyzoran/win-predict-ai/pull/7";
const GOAL = 31;

describe("isVisualTask", () => {
  it("ui/app/admin win-predict", () => {
    assert.equal(isVisualTask({ surface: "ui", repo: "onlyzoran/win-predict-ai-ui", title: "x", body: "", done_when: "" }), true);
    assert.equal(isVisualTask({ surface: "data", repo: "onlyzoran/win-predict-ai-data", title: "x", body: "", done_when: "" }), false);
  });

  it("gift-sales sales surface", () => {
    assert.equal(isVisualTask({ surface: "sales", repo: "onlyzoran/gift-sales", title: "x", body: "", done_when: "" }), true);
  });

  it("theme keywords in title", () => {
    assert.equal(
      isVisualTask({ surface: "feed", repo: "onlyzoran/shoppable-feed", title: "Палитра ленты", body: "", done_when: "" }),
      true,
    );
  });
});

describe("collectPreviewUrls", () => {
  it("dedupes demo per goal", () => {
    const urls = collectPreviewUrls([UI_PR, UI_PR.replace("39", "40")], GOAL);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /ui-preview\/issue-31/);
  });

  it("multiple repos → multiple demos", () => {
    const urls = collectPreviewUrls([UI_PR, APP_PR], GOAL);
    assert.equal(urls.length, 2);
  });
});

describe("needsBrowserReview", () => {
  it("false without preview url", () => {
    assert.equal(
      needsBrowserReview(
        { surface: "feed", repo: "onlyzoran/shoppable-feed", title: "Палитра", body: "", done_when: "" },
        ["https://github.com/onlyzoran/shoppable-feed/pull/1"],
        GOAL,
      ),
      false,
    );
    assert.equal(
      needsBrowserReview(
        { surface: "data", repo: "onlyzoran/win-predict-ai-data", title: "schema", body: "", done_when: "" },
        ["https://github.com/onlyzoran/win-predict-ai-data/pull/1"],
        GOAL,
      ),
      false,
    );
  });

  it("respects ORCHESTRATOR_BROWSER_REVIEW=0", () => {
    const prev = process.env.ORCHESTRATOR_BROWSER_REVIEW;
    process.env.ORCHESTRATOR_BROWSER_REVIEW = "0";
    try {
      assert.equal(
        needsBrowserReview(
          { surface: "ui", repo: "onlyzoran/win-predict-ai-ui", title: "x", body: "", done_when: "" },
          [UI_PR],
          GOAL,
        ),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.ORCHESTRATOR_BROWSER_REVIEW;
      else process.env.ORCHESTRATOR_BROWSER_REVIEW = prev;
    }
  });
});

describe("waitForPreviewUrls", () => {
  it("returns ready when fetch ok", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200 };
    };
    const results = await waitForPreviewUrls(["https://example.com/demo/"], {
      pollMs: 1,
      waitMs: 50,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      now: () => Date.now(),
    });
    assert.equal(results[0]?.ready, true);
    assert.equal(calls, 1);
  });

  it("polls until ready", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: calls >= 2, status: calls >= 2 ? 200 : 503 };
    };
    const results = await waitForPreviewUrls(["https://example.com/demo/"], {
      pollMs: 1,
      waitMs: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    assert.equal(results[0]?.ready, true);
    assert.ok(calls >= 2);
  });
});

describe("formatBrowserReviewBlock", () => {
  it("mentions demo not ready", () => {
    const text = formatBrowserReviewBlock(
      [{ url: "https://example.com/x/", ready: false, status: 404 }],
      { surface: "ui", repo: "onlyzoran/win-predict-ai-ui", title: "t", body: "", done_when: "видно в demo" },
    );
    assert.match(text, /Demo не готов/);
    assert.match(text, /Playwright MCP/);
  });
});
