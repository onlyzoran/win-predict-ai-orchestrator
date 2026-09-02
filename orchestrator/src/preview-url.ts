/** Публичные preview URL по репо семьи (ключ — номер Goal issue). Без preview — undefined. */
export function previewUrlForPr(prUrl: string, goalNumber: number): string | undefined {
  const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return undefined;
  const repo = match[1];
  const slug = `issue-${goalNumber}`;
  if (repo === "onlyzoran/win-predict-ai-ui") {
    return `https://onlyzoran.github.io/win-predict-ai-ui/ui-preview/${slug}/`;
  }
  if (repo === "onlyzoran/win-predict-ai-icons") {
    return `https://onlyzoran.github.io/win-predict-ai-icons/icons-preview/${slug}/`;
  }
  if (repo === "onlyzoran/win-predict-ai") {
    return `https://win-predict-ai.com/app-preview/${slug}/`;
  }
  if (repo === "onlyzoran/win-predict-ai-admin") {
    return `https://win-predict-ai.com/admin-preview/${slug}/`;
  }
  if (repo === "onlyzoran/gift-sales") {
    // HTTP: TLS на IP нет своего имени. https://<ip>/ ловит первый 443-vhost (HQ SPA).
    return `http://202.71.15.138/gift-sales/preview/${slug}/`;
  }
  return undefined;
}

/** Строки для комментария ревьюера: PR + Demo (если есть). */
export function formatPrLinkLines(prUrls: string[], goalNumber: number): string {
  if (!prUrls.length) return "- (URL PR не найден)";
  const lines: string[] = [];
  const seenDemo = new Set<string>();
  for (const url of prUrls) {
    lines.push(`- ${url}`);
    const demo = previewUrlForPr(url, goalNumber);
    if (demo && !seenDemo.has(demo)) {
      seenDemo.add(demo);
      lines.push(`- Demo: ${demo}`);
    }
  }
  return lines.join("\n");
}
