import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractJson, validatePlan } from "./plan.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "evals/plans");
const SCHEMA_EXAMPLE = join(ROOT, "schema/plan.example.json");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;
}

describe("validatePlan golden fixtures", () => {
  it("plan.example.json — win-predict-ai ui → app/admin", () => {
    const raw = JSON.parse(readFileSync(SCHEMA_EXAMPLE, "utf8")) as unknown;
    const plan = validatePlan(raw, 1, "win-predict-ai");
    assert.equal(plan.status, "ready");
    assert.equal(plan.tasks.length, 3);
    assert.deepEqual(
      plan.tasks.map((t) => t.id),
      ["ui-action-button", "app-use-button", "admin-use-button"],
    );
    assert.deepEqual(plan.tasks[1].depends_on, ["ui-action-button"]);
    assert.deepEqual(plan.tasks[2].depends_on, ["ui-action-button"]);
  });

  it("shoppable-feed — одна задача feed", () => {
    const plan = validatePlan(loadFixture("shoppable-feed-buy-buttons.json"), 54, "shoppable-feed");
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0]?.surface, "feed");
    assert.equal(plan.tasks[0]?.repo, "onlyzoran/shoppable-feed");
  });

  it("gift-sales — одна задача sales", () => {
    const plan = validatePlan(loadFixture("gift-sales-quotes-api.json"), 65, "gift-sales");
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0]?.surface, "sales");
    assert.equal(plan.tasks[0]?.repo, "onlyzoran/gift-sales");
  });

  it("telegram-bots stub — needs_human, пустой tasks", () => {
    const plan = validatePlan(loadFixture("telegram-bots-stub.json"), 10, "telegram-bots");
    assert.equal(plan.status, "needs_human");
    assert.equal(plan.tasks.length, 0);
    assert.equal(plan.surfaces.length, 0);
  });
});

describe("validatePlan rejects invalid plans", () => {
  it("задача чужого продукта в win-predict-ai", () => {
    assert.throws(
      () => validatePlan(loadFixture("negative-foreign-product.json"), 99, "win-predict-ai"),
      /не из продукта win-predict-ai/,
    );
  });

  it("needs_human с непустым tasks", () => {
    assert.throws(
      () => validatePlan(loadFixture("negative-needs-human-with-tasks.json"), 101, "win-predict-ai"),
      /needs_human\/out_of_scope tasks должен быть пустым/,
    );
  });

  it("ready с пустым tasks", () => {
    assert.throws(
      () => validatePlan(loadFixture("negative-ready-empty-tasks.json"), 100, "win-predict-ai"),
      /при ready tasks не должен быть пустым/,
    );
  });

  it("нет done_when", () => {
    assert.throws(
      () => validatePlan(loadFixture("negative-missing-done-when.json"), 102, "win-predict-ai"),
      /done_when/,
    );
  });

  it("план не объект", () => {
    assert.throws(() => validatePlan(null, 1), /план не объект/);
  });
});

describe("extractJson", () => {
  it("вырезает JSON из fenced block", () => {
    const raw = extractJson('текст\n```json\n{"a":1}\n```\nхвост');
    assert.deepEqual(raw, { a: 1 });
  });

  it("бросает без объекта", () => {
    assert.throws(() => extractJson("нет json здесь"), /менеджер не вернул JSON/);
  });

  it("бросает на битом JSON", () => {
    assert.throws(() => extractJson("{ broken"), /JSON|Unexpected token/);
  });
});
