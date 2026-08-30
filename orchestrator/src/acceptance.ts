import { formatPrLinkLines } from "./preview-url.js";

export type AcceptanceTask = {
  id: string;
  surface: string;
  repo: string;
  title: string;
  done_when: string;
  parallel_group: number;
};

export type AcceptancePlan = {
  summary: string;
  human_gates?: string[];
  tasks: AcceptanceTask[];
};

/** Open PR urls per task id (feature + bump, deduped within task). */
export type GoalTaskPrs = Map<string, string[]>;

export function flattenPrUrls(prsByTaskId: GoalTaskPrs): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const urls of prsByTaskId.values()) {
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** Комментарий при переводе Goal в Review: PR, demo, что тестировать. */
export function formatGoalAcceptanceComment(
  plan: AcceptancePlan,
  prsByTaskId: GoalTaskPrs,
  acceptHint: string,
  intro = "**Приёмка.** Карточка в Review — проверь PR и критерии ниже.",
): string[] {
  const ordered = [...plan.tasks].sort(
    (a, b) => a.parallel_group - b.parallel_group || a.id.localeCompare(b.id),
  );

  const lines: string[] = [intro, "", plan.summary.trim(), "", "## PR и demo", ""];

  let hasPr = false;
  for (const task of ordered) {
    const prUrls = prsByTaskId.get(task.id);
    if (!prUrls?.length) continue;
    hasPr = true;
    lines.push(`### \`${task.id}\` · ${task.repo}`, formatPrLinkLines(prUrls), "");
  }
  if (!hasPr) lines.push("- (открытых PR не найдено)", "");

  lines.push("## Что проверить", "");
  for (const task of ordered) {
    lines.push(`**${task.surface}** · \`${task.id}\` — ${task.title}`, `- ${task.done_when}`, "");
  }

  if (plan.human_gates?.length) {
    lines.push("**Отдельно от воркеров:**", ...plan.human_gates.map((gate) => `- ${gate}`), "");
  }

  lines.push(acceptHint);
  return lines;
}
