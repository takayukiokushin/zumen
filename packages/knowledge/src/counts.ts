/**
 * 台数・組数・エリア数など、「件数」を読む共通の決まり。
 *
 * 入力欄には、一覧にない数を手入力できるものがある。そこに、とても大きな数
 * （「99999」「1e999」など）を打つと、その数だけ繰り返して組み立てるため、処理が終わらなくなる（画面が固まる）。
 * そこで、件数は、**0〜上限の整数**として読む（上限は、ふつう 50。COUNT_LIMITS にあるものだけ、それより大きい）。数でないもの・空は、最小の値にする。
 */
export const MAX_COUNT = 50;

/**
 * 項目ごとの上限（MAX_COUNT より大きくしたいものだけ書く）。
 *   受電設備のエリア：30か所 ／ 変圧器：100台 ／ 高圧コンデンサ：100台 ／ PCS：100台
 * ここを変えれば、組み立ても、入力欄の上限も、同じように変わる。
 */
export const COUNT_LIMITS: Readonly<Record<string, number>> = {
  areaCount: 30,
  transformerCount: 100,
  capacitorCount: 100,
  pcsCount: 100,
};

/** その項目の件数の上限 */
export function maxCountOf(id: string): number {
  return Object.hasOwn(COUNT_LIMITS, id) ? COUNT_LIMITS[id]! : MAX_COUNT;
}

/**
 * 文字や数字を入れる欄の、文字数の上限（案件名・事業場名称・各設備の定格値・メモなど、すべて同じ）。
 * 入力欄で、これ以上は打てないようにする。案件名は、サーバーも、これを超えるものは受け付けない。
 * （ログインのパスワードと、AI の答えを貼り付ける欄は、長くて当然なので対象外）
 */
export const MAX_TEXT_LENGTH = 100;

/** 件数として読む。小数は切り捨て、max（省略すると MAX_COUNT）より大きいものは max、数でないものは min にする */
export function countOf(v: unknown, min = 1, max: number = MAX_COUNT): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * 台数の入力欄（一覧にない数を手入力できるもの）に打たれた文字を、上限におさめる。
 * 数字だけのとき、大きすぎる数は、その項目の上限にする。
 * 数字でないもの（「abc」など）は、そのまま（組み立てるときに、最小の値として読まれる）。
 */
export function limitCountText(id: string, raw: string): string {
  const t = raw.normalize('NFKC').trim();
  if (!/^\d+$/.test(t)) return raw;
  const max = maxCountOf(id);
  return Number(t) > max ? String(max) : raw;
}
