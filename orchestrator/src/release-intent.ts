/**
 * Человек принимает работу: Review → In Progress + фраза про релиз.
 * Без фразы тот же переход = правки (воркер / goal revision).
 *
 * `\b` в JS только для ASCII — для кириллицы свой «край слова».
 */
const EDGE = String.raw`(?:^|[\s,.:;!?…—–\-«"(])`;
const END = String.raw`(?=$|[\s,.:;!?…—–\-»")\]])`;

const RELEASE_INTENT_RE = new RegExp(
  `${EDGE}(?:ок[,.]?\\s*)?(?:релизь|зарелизь|релизните|можно\\s+релизить|давай\\s+релиз(?:ить)?|отправляем\\s+на\\s+релиз|можно\\s+(?:отправлять\\s+)?(?:на\\s+)?релиз|в\\s+релиз|ship\\s*it|release\\s*(?:it|please)?)${END}`,
  "i",
);

const RELEASE_NEGATION_RE =
  /(?:^|[\s,.:;!?])не\s+(?:надо\s+|нужно\s+)?(?:релиз|релизить|отправля|мерж)|не\s+релизь/i;

export function isReleaseIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/ё/g, "е");
  if (!normalized) return false;
  if (RELEASE_NEGATION_RE.test(normalized)) return false;
  return RELEASE_INTENT_RE.test(` ${normalized} `);
}
