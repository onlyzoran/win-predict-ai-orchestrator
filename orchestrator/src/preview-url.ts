/** Публичные PR preview URL по репо семьи. Без preview — undefined. */
export function previewUrlForPr(prUrl: string): string | undefined {
  const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return undefined;
  const repo = match[1];
  const n = match[2];
  if (repo === "onlyzoran/win-predict-ai-ui") {
    return `https://onlyzoran.github.io/win-predict-ai-ui/pr-preview/pr-${n}/`;
  }
  if (repo === "onlyzoran/win-predict-ai-icons") {
    return `https://onlyzoran.github.io/win-predict-ai-icons/pr-preview/pr-${n}/`;
  }
  if (repo === "onlyzoran/win-predict-ai") {
    return `http://202.71.15.138/win-predict-ai-preview/pr-${n}/`;
  }
  if (repo === "onlyzoran/win-predict-ai-admin") {
    return `https://win-predict-ai.com/admin-preview/pr-${n}/`;
  }
  return undefined;
}

/** Строки для комментария ревьюера: PR + Demo (если есть). */
export function formatPrLinkLines(prUrls: string[]): string {
  if (!prUrls.length) return "- (URL PR не найден)";
  const lines: string[] = [];
  for (const url of prUrls) {
    lines.push(`- ${url}`);
    const demo = previewUrlForPr(url);
    if (demo) lines.push(`- Demo: ${demo}`);
  }
  return lines.join("\n");
}
