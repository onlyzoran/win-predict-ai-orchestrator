import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bumpSemver,
  buildVersionedChangelogEntry,
  insertVersionedChangelogEntry,
  resolveBumpTypeFromFiles,
  resolveBumpTypeFromTitle,
  setPackageJsonVersion,
  setPackageLockRootVersion,
  stripPrerelease,
} from "./release.js";

describe("bumpSemver", () => {
  it("bumps patch/minor/major", () => {
    assert.equal(bumpSemver("1.2.3", "patch"), "1.2.4");
    assert.equal(bumpSemver("1.2.3", "minor"), "1.3.0");
    assert.equal(bumpSemver("1.2.3", "major"), "2.0.0");
  });

  it("strips prerelease before bump", () => {
    assert.equal(bumpSemver("1.2.3-pr.9.abc", "patch"), "1.2.4");
    assert.equal(stripPrerelease("1.2.3-pr.9.abc"), "1.2.3");
  });
});

describe("resolveBumpType", () => {
  it("reads markers from title", () => {
    assert.equal(resolveBumpTypeFromTitle("feat [minor]"), "minor");
    assert.equal(resolveBumpTypeFromTitle("fix stuff"), "patch");
  });

  it("uses file heuristics for ui/icons", () => {
    assert.equal(
      resolveBumpTypeFromFiles(
        "onlyzoran/win-predict-ai-ui",
        ["src/components/NewThing.vue"],
        "add component",
      ),
      "minor",
    );
    assert.equal(
      resolveBumpTypeFromFiles(
        "onlyzoran/win-predict-ai-ui",
        ["src/components/ui/dropdown-menu/Item.vue"],
        "internal",
      ),
      "patch",
    );
    assert.equal(
      resolveBumpTypeFromFiles(
        "onlyzoran/win-predict-ai-icons",
        ["src/icons/Foo.vue"],
        "new icon",
      ),
      "minor",
    );
    assert.equal(
      resolveBumpTypeFromFiles(
        "onlyzoran/win-predict-ai-icons",
        ["src/icons/Foo.vue"],
        "new icon [patch]",
      ),
      "patch",
    );
  });
});

describe("changelog", () => {
  it("builds versioned entry", () => {
    const entry = buildVersionedChangelogEntry(
      "1.2.4",
      "Add thing",
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/issues/2",
      "2026-08-25",
    );
    assert.match(entry, /^## 1\.2\.4 \(2026-08-25\)/);
    assert.match(entry, /\* Add thing/);
  });

  it("promotes Unreleased and inserts new section", () => {
    const existing = "# Changelog\n\n## Unreleased (2026-08-01)\n\n* old\n\n## 1.0.0 (2026-07-01)\n";
    const entry = buildVersionedChangelogEntry(
      "1.0.1",
      "New",
      "https://github.com/o/r/pull/3",
      "https://github.com/o/r/issues/4",
      "2026-08-25",
    );
    const next = insertVersionedChangelogEntry(existing, entry);
    assert.match(next, /## 1\.0\.1 \(2026-08-25\)/);
    assert.doesNotMatch(next, /Unreleased/);
    assert.match(next, /\* New/);
  });
});

describe("setPackageJsonVersion", () => {
  it("replaces version field", () => {
    const raw = '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n';
    assert.match(setPackageJsonVersion(raw, "0.1.1"), /"version": "0\.1\.1"/);
  });
});

describe("setPackageLockRootVersion", () => {
  it("updates root and packages[\"\"] version", () => {
    const raw = `{
  "name": "x",
  "version": "0.1.0",
  "packages": {
    "": {
      "name": "x",
      "version": "0.1.0"
    }
  }
}`;
    const next = setPackageLockRootVersion(raw, "0.1.1");
    assert.match(next, /"version": "0\.1\.1"/);
    assert.equal((next.match(/"version": "0\.1\.1"/g) || []).length, 2);
  });
});
