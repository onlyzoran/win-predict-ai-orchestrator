import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPublisherComment,
  isPrereleaseReady,
  latestPublisherState,
  needsPublisherRun,
  parsePublisherState,
  publisherWaitNote,
} from "./publisher-loop.js";

const UI_PR = "https://github.com/onlyzoran/win-predict-ai-ui/pull/47";
const SHA = "abc1234";

describe("parsePublisherState", () => {
  it("reads tagged state", () => {
    const body = formatPublisherComment(
      { taskId: "ui-x", phase: "bump_done", prUrl: UI_PR, prSha: SHA, at: new Date().toISOString() },
      ["ok"],
    );
    const state = parsePublisherState(body);
    assert.equal(state?.phase, "bump_done");
    assert.equal(state?.taskId, "ui-x");
  });
});

describe("isPrereleaseReady", () => {
  it("true for bump_done on same PR", () => {
    assert.equal(
      isPrereleaseReady({ taskId: "ui-x", phase: "bump_done", prUrl: UI_PR, prSha: SHA }, UI_PR, SHA),
      true,
    );
  });

  it("false when sha moved", () => {
    assert.equal(
      isPrereleaseReady({ taskId: "ui-x", phase: "bump_done", prUrl: UI_PR, prSha: SHA }, UI_PR, "deadbeef"),
      false,
    );
  });
});

describe("needsPublisherRun", () => {
  it("false for non-library repo", () => {
    assert.equal(
      needsPublisherRun({ repo: "onlyzoran/win-predict-ai", openPrUrl: UI_PR }),
      false,
    );
  });

  it("true when library PR has no state", () => {
    assert.equal(
      needsPublisherRun({ repo: "onlyzoran/win-predict-ai-ui", openPrUrl: UI_PR, openPrSha: SHA }),
      true,
    );
  });

  it("false when bump_done for current head", () => {
    assert.equal(
      needsPublisherRun({
        repo: "onlyzoran/win-predict-ai-ui",
        openPrUrl: UI_PR,
        openPrSha: SHA,
        state: { taskId: "ui-x", phase: "bump_done", prUrl: UI_PR, prSha: SHA },
      }),
      false,
    );
  });

  it("true after publish_error", () => {
    assert.equal(
      needsPublisherRun({
        repo: "onlyzoran/win-predict-ai-ui",
        openPrUrl: UI_PR,
        state: { taskId: "ui-x", phase: "publish_error", prUrl: UI_PR },
      }),
      true,
    );
  });
});

describe("latestPublisherState", () => {
  it("returns newest for task", () => {
    const comments = [
      {
        body: formatPublisherComment(
          { taskId: "ui-x", phase: "published", prUrl: UI_PR },
          ["v1"],
        ),
      },
      {
        body: formatPublisherComment(
          { taskId: "ui-x", phase: "bump_done", prUrl: UI_PR },
          ["v2"],
        ),
      },
    ];
    assert.equal(latestPublisherState(comments, "ui-x")?.phase, "bump_done");
  });
});

describe("publisherWaitNote", () => {
  it("mentions dep task", () => {
    assert.match(publisherWaitNote("app-x", "ui-x"), /жду publish.*ui-x/);
  });
});
