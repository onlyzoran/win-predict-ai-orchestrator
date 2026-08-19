import assert from "node:assert/strict";
import { test } from "node:test";
import { matchExistingChild, parentLine, taskMarker } from "./child-issue.js";

const parent = parentLine("onlyzoran/win-predict-ai-orchestrator", 15);

function issue(
  number: number,
  taskId: string,
  title: string,
  state = "OPEN",
): Parameters<typeof matchExistingChild>[0][number] {
  return {
    url: `https://github.com/onlyzoran/win-predict-ai-ui/issues/${number}`,
    title,
    state,
    body: `${taskMarker(taskId)}\n${parent}\n`,
  };
}

test("матчит по маркеру задачи, а не по единственному open issue родителя", () => {
  const items = [
    issue(27, "ui-shadcn-card", "Shadcn-примитивы: семейство Card"),
    issue(31, "ui-shadcn-chart", "Shadcn-примитивы: Chart"),
  ];
  const chart = matchExistingChild(items, { id: "ui-shadcn-chart", title: "другое" }, parent);
  assert.equal(chart?.url, items[1].url);
  assert.equal(chart?.closed, false);

  const missing = matchExistingChild(
    items,
    { id: "ui-shadcn-controls", title: "Shadcn-примитивы: Button" },
    parent,
  );
  assert.equal(missing, undefined);
});

test("не переиспользует единственный child другого id", () => {
  const items = [issue(31, "ui-shadcn-chart", "Shadcn-примитивы: Chart")];
  const found = matchExistingChild(
    items,
    { id: "ui-app-pattern-stories", title: "Pattern-сторис" },
    parent,
  );
  assert.equal(found, undefined);
});

test("если маркера нет — матчит по заголовку и parent", () => {
  const items = [
    {
      url: "https://github.com/onlyzoran/win-predict-ai-ui/issues/10",
      title: "Палитра Claude+",
      state: "OPEN",
      body: `${parent}\nбез маркера`,
    },
  ];
  const found = matchExistingChild(items, { id: "ui-palette", title: "Палитра Claude+" }, parent);
  assert.equal(found?.url, items[0].url);
});

test("закрытый child с тем же маркером считается найденным", () => {
  const items = [issue(27, "ui-shadcn-card", "Card", "CLOSED")];
  const found = matchExistingChild(items, { id: "ui-shadcn-card", title: "Card" }, parent);
  assert.equal(found?.url, items[0].url);
  assert.equal(found?.closed, true);
});

test("открытый child того же id предпочтительнее закрытого", () => {
  const items = [
    issue(27, "ui-shadcn-card", "Card", "CLOSED"),
    issue(40, "ui-shadcn-card", "Card again"),
  ];
  const found = matchExistingChild(items, { id: "ui-shadcn-card", title: "Card" }, parent);
  assert.equal(found?.url, items[1].url);
  assert.equal(found?.closed, false);
});
