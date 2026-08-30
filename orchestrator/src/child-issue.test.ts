import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchGoalTaskPrs,
  parentLine,
  parseParentGoalNumber,
  parseTaskId,
  prMatchesGoalTask,
  taskMarker,
} from "./child-issue.js";

const parent = parentLine("onlyzoran/win-predict-ai-orchestrator", 29);

test("prMatchesGoalTask: Parent + marker", () => {
  const body = `${taskMarker("ui-header")}\n${parent}\nакцент AI`;
  assert.equal(prMatchesGoalTask({ body, title: "feat: AI" }, parent, "ui-header"), true);
  assert.equal(prMatchesGoalTask({ body, title: "feat: AI" }, parent, "app-header"), false);
  assert.equal(
    prMatchesGoalTask({ body: "Closes #29", title: "feat" }, parent, "ui-header"),
    false,
  );
});

test("matchGoalTaskPrs не схлопывает задачи одного Goal", () => {
  const items = [
    {
      url: "https://github.com/onlyzoran/win-predict-ai-ui/pull/46",
      body: `${taskMarker("ui-header")}\n${parent}`,
      title: "ui",
    },
    {
      url: "https://github.com/onlyzoran/win-predict-ai/pull/60",
      body: `${taskMarker("app-header")}\n${parent}`,
      title: "app",
    },
  ];
  const ui = matchGoalTaskPrs(items, parent, "ui-header");
  assert.equal(ui.length, 1);
  assert.equal(ui[0].url, items[0].url);
  const missing = matchGoalTaskPrs(items, parent, "admin-header");
  assert.equal(missing.length, 0);
});

test("parseTaskId / parseParentGoalNumber", () => {
  const body = `${taskMarker("ui-action-button")}\n${parent}\n`;
  assert.equal(parseTaskId(body), "ui-action-button");
  assert.equal(parseParentGoalNumber(body), 29);
  assert.equal(
    parseParentGoalNumber("Parent: https://github.com/onlyzoran/win-predict-ai-orchestrator/issues/8"),
    8,
  );
});
