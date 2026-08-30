import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flattenPrUrls,
  formatGoalAcceptanceComment,
  type AcceptancePlan,
  type GoalTaskPrs,
} from "./acceptance.js";

const plan: AcceptancePlan = {
  goal_number: 31,
  summary: "В header Win Predict AI слово AI выделено градиентом.",
  tasks: [
    {
      id: "ui-header-ai-accent",
      surface: "ui",
      repo: "onlyzoran/win-predict-ai-ui",
      title: "BrandTitle с градиентом AI",
      done_when: "BrandTitle рендерит AI с CSS-градиентом из токенов.",
      parallel_group: 1,
    },
    {
      id: "app-header-ai-accent",
      surface: "app",
      repo: "onlyzoran/win-predict-ai",
      title: "AppHeader на BrandTitle",
      done_when: "AppHeader использует BrandTitle; Nexora-токены на месте.",
      parallel_group: 2,
    },
  ],
};

describe("formatGoalAcceptanceComment", () => {
  it("PR, demo и done_when по задачам", () => {
    const prs: GoalTaskPrs = new Map([
      ["ui-header-ai-accent", ["https://github.com/onlyzoran/win-predict-ai-ui/pull/47"]],
      ["app-header-ai-accent", ["https://github.com/onlyzoran/win-predict-ai/pull/62"]],
    ]);
    const text = formatGoalAcceptanceComment(plan, prs, "Ок — «релизь».").join("\n");
    assert.match(text, /## PR и demo/);
    assert.match(text, /pull\/47/);
    assert.match(text, /ui-preview\/issue-31/);
    assert.match(text, /pull\/62/);
    assert.match(text, /app-preview\/issue-31/);
    assert.match(text, /## Что проверить/);
    assert.match(text, /BrandTitle рендерит AI/);
    assert.match(text, /AppHeader использует BrandTitle/);
    assert.match(text, /Ок — «релизь»\./);
  });

  it("нет PR — явная заглушка", () => {
    const text = formatGoalAcceptanceComment(plan, new Map(), "hint").join("\n");
    assert.match(text, /открытых PR не найдено/);
    assert.match(text, /## Что проверить/);
  });
});

describe("flattenPrUrls", () => {
  it("dedupe между задачами", () => {
    const prs: GoalTaskPrs = new Map([
      ["a", ["https://github.com/x/y/pull/1"]],
      ["b", ["https://github.com/x/y/pull/1", "https://github.com/x/y/pull/2"]],
    ]);
    assert.deepEqual(flattenPrUrls(prs), [
      "https://github.com/x/y/pull/1",
      "https://github.com/x/y/pull/2",
    ]);
  });
});
