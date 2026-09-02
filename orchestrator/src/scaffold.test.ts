import test from "node:test";
import assert from "node:assert/strict";
import {
  extractScaffoldedRepo,
  gameRepoForGoal,
  isGameRepo,
  GAME_REPO_MARKER,
} from "./scaffold.js";

test("gameRepoForGoal", () => {
  assert.equal(gameRepoForGoal(42), "onlyzoran/game-issue-42");
});

test("isGameRepo", () => {
  assert.equal(isGameRepo("onlyzoran/game-issue-1"), true);
  assert.equal(isGameRepo("onlyzoran/game-gravity"), false);
  assert.equal(isGameRepo("onlyzoran/win-predict-ai-ios"), false);
});

test("extractScaffoldedRepo", () => {
  const repo = gameRepoForGoal(7);
  const comments = [
    { body: "hello" },
    { body: `${GAME_REPO_MARKER}${repo} -->\nscaffold ok` },
  ];
  assert.equal(extractScaffoldedRepo(comments), repo);
  assert.equal(extractScaffoldedRepo([{ body: "no marker" }]), undefined);
});
