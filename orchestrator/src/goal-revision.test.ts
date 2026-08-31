import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISPATCH_MARKER, goalRevisionPending, PLAN_MARKER } from "./goal-revision.js";

const reviewAcceptance = `${DISPATCH_MARKER}
<!-- orchestrator-state:{"phase":"review","at":"2026-01-01T00:00:00.000Z"} -->
**Приёмка.** Карточка в Review`;

const workingDone = `${DISPATCH_MARKER}
<!-- orchestrator-state:{"phase":"working","at":"2026-01-01T00:01:00.000Z"} -->
**Воркеры.** review pass`;

const planComment = `${PLAN_MARKER}
\`\`\`json
{"goal_number":1,"status":"ready","tasks":[]}
\`\`\``;

describe("goalRevisionPending", () => {
  it("true when human commented after Review acceptance and workers already finished", () => {
    const comments = [
      { body: reviewAcceptance, user: { login: "onlyzoran" } },
      { body: workingDone, user: { login: "onlyzoran" } },
      { body: "добавь ios", user: { login: "onlyzoran" } },
    ];
    assert.equal(goalRevisionPending(comments, "добавь ios"), true);
  });

  it("false when plan was republished after the human note", () => {
    const comments = [
      { body: reviewAcceptance, user: { login: "onlyzoran" } },
      { body: "добавь ios", user: { login: "onlyzoran" } },
      { body: planComment, user: { login: "onlyzoran" } },
    ];
    assert.equal(goalRevisionPending(comments, "добавь ios"), false);
  });

  it("false without human notes", () => {
    const comments = [{ body: reviewAcceptance, user: { login: "onlyzoran" } }];
    assert.equal(goalRevisionPending(comments, ""), false);
  });

  it("false for bot comments only after review", () => {
    const comments = [
      { body: reviewAcceptance, user: { login: "onlyzoran" } },
      { body: workingDone, user: { login: "github-actions[bot]" } },
    ];
    assert.equal(goalRevisionPending(comments, ""), false);
  });
});
