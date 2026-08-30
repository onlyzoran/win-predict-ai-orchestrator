import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bumpMarker,
  isConsumerBumpOnlyPr,
  matchGoalBumpPrs,
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

test("prMatchesGoalTask: chore bump не считается воркерским PR", () => {
  const legacyBump = {
    title: "chore: bump @onlyzoran/win-predict-ai-ui to 0.4.0-pr.47.1c4e8b2",
    body: `${taskMarker("app-header-ai-accent")}\n${parent}\nОркестратор подтянул prerelease для интеграции до merge библиотеки.`,
  };
  assert.equal(isConsumerBumpOnlyPr(legacyBump), true);
  assert.equal(prMatchesGoalTask(legacyBump, parent, "app-header-ai-accent"), false);
  assert.equal(matchGoalBumpPrs([legacyBump], parent, "app-header-ai-accent").length, 1);
});

test("prMatchesGoalTask: bump marker отдельно от task marker", () => {
  const bump = {
    title: "chore: bump @onlyzoran/win-predict-ai-ui to 0.4.0-pr.47.1c4e8b2",
    body: `${bumpMarker("app-header-ai-accent")}\n${parent}\nОркестратор подтянул prerelease для интеграции до merge библиотеки.`,
  };
  assert.equal(prMatchesGoalTask(bump, parent, "app-header-ai-accent"), false);
  assert.equal(matchGoalBumpPrs([bump], parent, "app-header-ai-accent").length, 1);
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
