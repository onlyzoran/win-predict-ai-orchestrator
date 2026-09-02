/** Markdown block for reviewer prompt when plan lists human-only acceptance gates. */
export function formatHumanGatesForReviewer(humanGates: string[] | undefined): string {
  const gates = humanGates?.map((gate) => gate.trim()).filter(Boolean) ?? [];
  if (!gates.length) return "";

  const lines = [
    "## Human gates (только человек)",
    "",
    "Из плана Goal: эти пункты закрывает человек на приёмке, не воркер на VPS и не ты через `changes`.",
    "",
    ...gates.map((gate) => `- ${gate}`),
    "",
    "Если PR или критерий касается любого пункта:",
    "- verdict: **`blocked`** (или `pass` с finding «нужна приёмка: …»), **не** `changes`",
    "- не требуй от воркера решить human gate (выбор иконки, спорный UX, taste на устройстве и т.п.)",
    "",
  ];
  return lines.join("\n");
}
