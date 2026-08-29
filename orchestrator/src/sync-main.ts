/**
 * Review → In Progress без комментария и без «релизь»:
 * не правки и не релиз, а проверка — не отстала ли ветка PR от main.
 */

export type PrSyncView = {
  mergeable: string;
  mergeStateStatus: string;
};

export function prNeedsBaseSync(pr: PrSyncView): boolean {
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") return true;
  if (pr.mergeStateStatus === "BEHIND" || pr.mergeStateStatus === "UNKNOWN") return true;
  if (pr.mergeable === "UNKNOWN") return true;
  return false;
}

export function isPrConflicting(pr: PrSyncView): boolean {
  return pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
}

/** После pass/blocked в Review, без человеческих заметок — sync main, не воркер правок. */
export function shouldSyncMainFromBoard(input: {
  phase: string | undefined;
  reviewVerdict?: string;
  humanNotes: string;
}): boolean {
  if (input.humanNotes.trim()) return false;
  if (input.phase !== "review") return false;
  if (input.reviewVerdict === "changes") return false;
  return true;
}

export function syncMainWorkerNotes(prNotes: string[]): string {
  return [
    "**Подтяни `main` в ветку PR и разреши конфликты.** Карточка ушла в In Progress без комментария — только синхронизация с main, не новые фичи.",
    ...prNotes.map((n) => `- ${n}`),
  ].join("\n");
}
