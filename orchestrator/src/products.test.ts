import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearProductRegistryCache,
  formatProductContext,
  loadProductRegistry,
  resolveProductId,
  stubNeedsHumanPlan,
} from "./products.js";

const sample = {
  "win-predict-ai": {
    status: "active",
    label: "win-predict-ai",
    surfaces: {
      ui: { repo: "onlyzoran/win-predict-ai-ui", trigger: "sdk" },
    },
  },
  "telegram-bots": {
    status: "stub",
    label: "telegram-bots",
    surfaces: {},
  },
};

test("resolveProductId: явный лейбл", () => {
  const dir = mkdtempSync(join(tmpdir(), "products-"));
  const path = join(dir, "registry.json");
  writeFileSync(path, JSON.stringify(sample));
  const registry = loadProductRegistry(path);
  assert.equal(resolveProductId(["goal", "telegram-bots"], registry), "telegram-bots");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveProductId: legacy product: prefix", () => {
  const dir = mkdtempSync(join(tmpdir(), "products-"));
  const path = join(dir, "registry.json");
  writeFileSync(path, JSON.stringify(sample));
  const registry = loadProductRegistry(path);
  assert.equal(resolveProductId(["product:telegram-bots"], registry), "telegram-bots");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveProductId: без лейбла → win-predict-ai", () => {
  const dir = mkdtempSync(join(tmpdir(), "products-"));
  const path = join(dir, "registry.json");
  writeFileSync(path, JSON.stringify(sample));
  const registry = loadProductRegistry(path);
  assert.equal(resolveProductId(["goal", "ui"], registry), "win-predict-ai");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveProductId: legacy games → ios-games", () => {
  clearProductRegistryCache();
  const registry = loadProductRegistry();
  assert.equal(resolveProductId(["games"], registry), "ios-games");
});

test("stubNeedsHumanPlan", () => {
  const plan = stubNeedsHumanPlan(42, "ios-games");
  assert.equal(plan.status, "needs_human");
  assert.equal(plan.goal_number, 42);
  assert.equal(plan.tasks.length, 0);
  assert.match(plan.summary, /ios-games/);
});

test("formatProductContext: active", () => {
  clearProductRegistryCache();
  const dir = mkdtempSync(join(tmpdir(), "products-"));
  const path = join(dir, "registry.json");
  writeFileSync(path, JSON.stringify(sample));
  const registry = loadProductRegistry(path);
  const text = formatProductContext("win-predict-ai", registry);
  assert.match(text, /win-predict-ai-ui/);
  assert.match(text, /`ui`/);
  rmSync(dir, { recursive: true, force: true });
});

test("loadProductRegistry: shipped file", () => {
  clearProductRegistryCache();
  const registry = loadProductRegistry();
  assert.equal(registry["win-predict-ai"]?.status, "active");
  assert.equal(registry["win-predict-ai"]?.label, "win-predict-ai");
  assert.equal(registry["telegram-bots"]?.status, "stub");
  assert.equal(registry["ios-games"]?.status, "stub");
});
