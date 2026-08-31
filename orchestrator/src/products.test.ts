import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearProductRegistryCache,
  formatProductContext,
  getBoardProject,
  listBoardProjects,
  loadProductRegistry,
  resolveBoardProject,
  resolveProductId,
  stubNeedsHumanPlan,
  taskMatchesProduct,
} from "./products.js";

const sampleBoard = {
  id: "PVT_test_board",
  statusFieldId: "PVTSSF_test",
  statusOptions: { Inbox: "opt-inbox" },
};

const sample = {
  "win-predict-ai": {
    status: "active",
    label: "win-predict-ai",
    board: sampleBoard,
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
  assert.equal(registry["win-predict-ai"]?.board?.id, "PVT_kwHOAom_KM4BgVLq");
  assert.equal(registry["telegram-bots"]?.status, "stub");
  assert.equal(registry["ios-games"]?.status, "stub");
  assert.equal(registry["shoppable-feed"]?.status, "active");
  assert.equal(registry["shoppable-feed"]?.surfaces.feed?.repo, "onlyzoran/shoppable-feed");
});

test("getBoardProject: stub inherits win-predict-ai board", () => {
  clearProductRegistryCache();
  const registry = loadProductRegistry();
  assert.equal(getBoardProject("telegram-bots", registry).id, registry["win-predict-ai"]?.board?.id);
  assert.equal(getBoardProject("shoppable-feed", registry).id, registry["win-predict-ai"]?.board?.id);
});

test("taskMatchesProduct", () => {
  clearProductRegistryCache();
  assert.equal(taskMatchesProduct("shoppable-feed", "feed", "onlyzoran/shoppable-feed"), true);
  assert.equal(taskMatchesProduct("shoppable-feed", "app", "onlyzoran/win-predict-ai"), false);
  assert.equal(taskMatchesProduct("win-predict-ai", "app", "onlyzoran/win-predict-ai"), true);
});

test("listBoardProjects: unique boards", () => {
  clearProductRegistryCache();
  const boards = listBoardProjects();
  assert.equal(boards.length, 1);
  assert.equal(boards[0]?.id, "PVT_kwHOAom_KM4BgVLq");
});

test("resolveBoardProject: uses registry board", () => {
  clearProductRegistryCache();
  const prev = process.env.ORCHESTRATOR_PROJECT_ID;
  process.env.ORCHESTRATOR_PROJECT_ID = "PVT_kwHOAom_KM4Bg7oB";
  try {
    const board = resolveBoardProject("win-predict-ai");
    assert.equal(board.id, "PVT_kwHOAom_KM4BgVLq");
  } finally {
    if (prev === undefined) delete process.env.ORCHESTRATOR_PROJECT_ID;
    else process.env.ORCHESTRATOR_PROJECT_ID = prev;
  }
});
