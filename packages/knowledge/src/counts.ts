/**
 * 台数・組数・エリア数など、「件数」を読む共通の決まり。
 *
 * 入力欄には、一覧にない数を手入力できるものがある。そこに、とても大きな数
 * （「99999」「1e999」など）を打つと、その数だけ繰り返して組み立てるため、処理が終わらなくなる（画面が固まる）。
 * そこで、件数は、**0〜50 の整数**として読む（一覧の最大も 50）。数でないもの・空は、最小の値にする。
 */
export const MAX_COUNT = 50;

/** 件数として読む。小数は切り捨て、MAX_COUNT より大きいものは MAX_COUNT、数でないものは min にする */
export function countOf(v: unknown, min = 1): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (Number.isNaN(n)) return min;
  return Math.min(MAX_COUNT, Math.max(min, Math.floor(n)));
}

/**
 * 台数の入力欄（一覧にない数を手入力できるもの）に打たれた文字を、上限におさめる。
 * 数字だけのとき、大きすぎる数は上限にする（PCS の台数は、数百台になることがあるので、9999 まで）。
 * 数字でないもの（「abc」など）は、そのまま（組み立てるときに、最小の値として読まれる）。
 */
export function limitCountText(id: string, raw: string): string {
  const t = raw.normalize('NFKC').trim();
  if (!/^\d+$/.test(t)) return raw;
  const max = id === 'pcsCount' ? 9999 : MAX_COUNT;
  return Number(t) > max ? String(max) : raw;
}
