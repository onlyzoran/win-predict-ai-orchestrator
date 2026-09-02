import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fingerprintFinding,
  fingerprintMarker,
  formatAuditBrowserBlock,
  formatGoalBody,
  formatGoalTitle,
  getAuditProductConfig,
  hasFingerprintInBody,
  loadAuditRoutes,
  normalizeTitleForFingerprint,
  parseMinSeverity,
  shouldCreateGoal,
  validateAudit,
} from "./product-audit.js";

describe("loadAuditRoutes", () => {
  it("loads win-predict-ai routes", () => {
    const routes = loadAuditRoutes();
    assert.ok(routes["win-predict-ai"]);
    assert.ok(routes["win-predict-ai"].routes.length >= 2);
  });
});

describe("getAuditProductConfig", () => {
  it("returns config for win-predict-ai", () => {
    const config = getAuditProductConfig("win-predict-ai");
    assert.equal(config.productLabel, "win-predict-ai");
    assert.match(config.routes[0].url, /^https?:\/\//);
  });

  it("throws for unknown product", () => {
    assert.throws(() => getAuditProductConfig("unknown-product"), /нет продукта/);
  });
});

describe("validateAudit", () => {
  it("accepts valid report", () => {
    const report = validateAudit({
      product_id: "win-predict-ai",
      summary: "Ок",
      findings: [
        {
          id: "app-contrast",
          severity: "medium",
          surface: "app",
          title: "Контраст muted",
          result: "Muted текст читаем на фоне карточек.",
          evidence: "https://win-predict-ai.com/ — серый текст на сером.",
        },
      ],
    });
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].severity, "medium");
  });

  it("rejects invalid severity", () => {
    assert.throws(
      () =>
        validateAudit({
          product_id: "win-predict-ai",
          summary: "x",
          findings: [{ id: "a", severity: "critical", surface: "app", title: "t", result: "r", evidence: "e" }],
        }),
      /severity/,
    );
  });
});

describe("fingerprintFinding", () => {
  it("stable for same input", () => {
    const a = fingerprintFinding("win-predict-ai", "app", "Контраст muted");
    const b = fingerprintFinding("win-predict-ai", "app", "  контраст   muted  ");
    assert.equal(a, b);
  });

  it("differs by surface", () => {
    const a = fingerprintFinding("win-predict-ai", "app", "Title");
    const b = fingerprintFinding("win-predict-ai", "ui", "Title");
    assert.notEqual(a, b);
  });
});

describe("normalizeTitleForFingerprint", () => {
  it("lowercases and collapses spaces", () => {
    assert.equal(normalizeTitleForFingerprint("  Hello   World "), "hello world");
  });
});

describe("shouldCreateGoal", () => {
  it("medium+ when min is medium", () => {
    assert.equal(shouldCreateGoal("high", "medium"), true);
    assert.equal(shouldCreateGoal("medium", "medium"), true);
    assert.equal(shouldCreateGoal("low", "medium"), false);
  });
});

describe("parseMinSeverity", () => {
  it("defaults to medium", () => {
    const prev = process.env.ORCHESTRATOR_AUDIT_MIN_SEVERITY;
    delete process.env.ORCHESTRATOR_AUDIT_MIN_SEVERITY;
    try {
      assert.equal(parseMinSeverity(), "medium");
    } finally {
      if (prev === undefined) delete process.env.ORCHESTRATOR_AUDIT_MIN_SEVERITY;
      else process.env.ORCHESTRATOR_AUDIT_MIN_SEVERITY = prev;
    }
  });
});

describe("formatGoalTitle", () => {
  it("adds audit prefix", () => {
    assert.equal(formatGoalTitle({ title: "Fix contrast", id: "x", severity: "high", surface: "app", result: "r", evidence: "e" }), "[audit] Fix contrast");
  });
});

describe("formatGoalBody", () => {
  it("includes fingerprint marker", () => {
    const body = formatGoalBody(
      {
        id: "x",
        severity: "high",
        surface: "app",
        title: "Fix contrast",
        result: "Контраст ок.",
        evidence: "url",
      },
      "win-predict-ai",
      "2026-01-01T00:00:00.000Z",
    );
    assert.match(body, /## Результат/);
    assert.match(body, /product-audit:fingerprint=/);
    assert.match(body, /Severity: high/);
  });
});

describe("hasFingerprintInBody", () => {
  it("matches marker", () => {
    const fp = fingerprintFinding("win-predict-ai", "app", "Title");
    const body = `text\n${fingerprintMarker(fp)}\n`;
    assert.equal(hasFingerprintInBody(body, fp), true);
    assert.equal(hasFingerprintInBody("other", fp), false);
  });
});

describe("formatAuditBrowserBlock", () => {
  it("lists routes and checklist", () => {
    const config = getAuditProductConfig("win-predict-ai");
    const text = formatAuditBrowserBlock(config.routes.slice(0, 1), [
      { url: config.routes[0].url, ready: true, status: 200 },
    ]);
    assert.match(text, /Playwright MCP/);
    assert.match(text, /https:\/\/win-predict-ai\.com\//);
    assert.match(text, /Чеклист/);
  });

  it("warns when no urls ready", () => {
    const config = getAuditProductConfig("win-predict-ai");
    const text = formatAuditBrowserBlock(config.routes.slice(0, 1), [
      { url: config.routes[0].url, ready: false, status: 503 },
    ]);
    assert.match(text, /Ни один URL не ответил/);
  });
});
