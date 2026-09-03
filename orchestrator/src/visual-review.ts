import { previewUrlForPr } from "./preview-url.js";

export const PREVIEW_POLL_MS = 15_000;
export const PREVIEW_WAIT_MS = 3 * 60_000;

export type PreviewWaitResult = {
  url: string;
  ready: boolean;
  status?: number;
  error?: string;
};

export type VisualTaskLike = {
  surface: string;
  repo: string;
  title: string;
  body: string;
  done_when: string;
};

export type PlaywrightMcpServer = {
  type: "stdio";
  command: string;
  args: string[];
  cwd?: string;
};

/** Задачи ui/app/admin/sales и явно про тему/цвет — кандидаты на browser review. */
export function isVisualTask(task: VisualTaskLike, notes = ""): boolean {
  const winPredictVisual =
    (task.surface === "ui" || task.surface === "app" || task.surface === "admin") &&
    task.repo.startsWith("onlyzoran/win-predict-ai");
  const giftSalesVisual = task.surface === "sales" && task.repo === "onlyzoran/gift-sales";
  const shoppableFeedVisual = task.surface === "feed" && task.repo === "onlyzoran/shoppable-feed";
  return (
    winPredictVisual ||
    giftSalesVisual ||
    shoppableFeedVisual ||
    /цвет|палитр|theme|токен|dark|light|контраст/i.test(`${task.title}\n${task.body}\n${notes}`)
  );
}

export function collectPreviewUrls(prUrls: string[], goalNumber: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const prUrl of prUrls) {
    const url = previewUrlForPr(prUrl, goalNumber);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function needsBrowserReview(
  task: VisualTaskLike,
  prUrls: string[],
  goalNumber: number,
  notes = "",
): boolean {
  if (process.env.ORCHESTRATOR_BROWSER_REVIEW?.trim() === "0") return false;
  if (!isVisualTask(task, notes)) return false;
  return collectPreviewUrls(prUrls, goalNumber).length > 0;
}

export async function probePreviewUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ready: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    let response = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    const ready = response.ok || (response.status >= 300 && response.status < 400);
    return { ready, status: response.status };
  } catch (err) {
    return {
      ready: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForPreviewUrls(
  urls: string[],
  opts: {
    pollMs?: number;
    waitMs?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<PreviewWaitResult[]> {
  if (!urls.length) return [];
  const pollMs = opts.pollMs ?? PREVIEW_POLL_MS;
  const waitMs = opts.waitMs ?? PREVIEW_WAIT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;

  const results = new Map<string, PreviewWaitResult>();
  for (const url of urls) results.set(url, { url, ready: false });

  const deadline = now() + waitMs;
  while (now() < deadline) {
    let pending = 0;
    for (const url of urls) {
      const current = results.get(url)!;
      if (current.ready) continue;
      const probe = await probePreviewUrl(url, fetchImpl);
      if (probe.ready) {
        results.set(url, { url, ready: true, status: probe.status });
        continue;
      }
      pending += 1;
      results.set(url, { url, ready: false, status: probe.status, error: probe.error });
    }
    if (pending === 0) break;
    if (now() + pollMs >= deadline) break;
    await sleep(pollMs);
  }
  return urls.map((url) => results.get(url)!);
}

export function playwrightMcpServers(cwd: string): Record<string, PlaywrightMcpServer> {
  return {
    playwright: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--headless", "--caps", "vision"],
      cwd,
    },
  };
}

export function formatBrowserReviewBlock(previewResults: PreviewWaitResult[], task: VisualTaskLike): string {
  const ready = previewResults.filter((item) => item.ready);
  const pending = previewResults.filter((item) => !item.ready);

  const lines = [
    "## Визуальная проверка (Playwright MCP)",
    "",
    "Подключён MCP `playwright`. Открой demo URL, сделай скриншоты, сверь с `done_when` и `design.md` (если есть).",
    "",
    "### Demo URL",
    ...previewResults.map((item) => {
      const flag = item.ready ? "готов" : "не ответил";
      const detail = item.status ? ` HTTP ${item.status}` : item.error ? ` (${item.error})` : "";
      return `- ${item.url} — ${flag}${detail}`;
    }),
    "",
    "### Чеклист",
    "- Открой каждый **готовый** URL. 404/пустая страница → не `pass`.",
    "- Скрин основного экрана из критерия; для ui/app/admin с темой — light и dark (переключатель или отдельные story/URL).",
    "- Проверь: layout не сломан, текст читаем, не «голый» zinc/shadcn если задача про палитру.",
    "- Admin с логином недоступен без credentials → не блокируй только из‑за логина; смотри diff + публичные экраны.",
    `- Поверхность \`${task.surface}\`, критерий: ${task.done_when}`,
    "",
  ];

  if (ready.length === 0) {
    lines.push(
      "**Demo не готов** (CI preview ещё не задеployил). Визуально проверить нельзя.",
      "- Если задача чисто визуальная и без diff-критерия → `blocked` («demo не поднялся»).",
      "- Если diff + CI достаточны → можно `pass`/`changes` по коду, упомяни в summary что demo ждали.",
      "",
    );
  } else if (pending.length > 0) {
    lines.push(
      "Часть URL ещё не готова — проверяй только готовые; в summary отметь, что не все demo ответили.",
      "",
    );
  }

  lines.push("После browser-check верни только JSON-вердикт как обычно.");
  return lines.join("\n");
}
