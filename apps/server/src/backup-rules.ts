/**
 * 控え（バックアップ）の決まり。時刻と、残す日数の計算だけを置く（データベースには触れない）。
 *
 * - 毎日、日付が変わった瞬間（午前0時）に、1つ作る。
 * - 残すのは、10日分（最長の連休＋1日。年末年始の9連休でも、休みの前の状態に戻せる）。
 * - 「午前0時」は、日本時間。クラウドのサーバーは、標準では世界標準時のことが多いので、
 *   サーバーの時計に頼らず、時間帯を決めて計算する（.env の BACKUP_TIMEZONE で変えられる）。
 */

/** 何日分残すか。これより古い日の控えは消す */
export const KEEP = 10;

export const DEFAULT_TIMEZONE = 'Asia/Tokyo';

/** 使える時間帯の名前か */
export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  y: string;
  mo: string;
  d: string;
  h: number;
  mi: number;
  s: number;
}

function parts(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of f.formatToParts(date)) m[p.type] = p.value;
  return { y: m.year!, mo: m.month!, d: m.day!, h: Number(m.hour), mi: Number(m.minute), s: Number(m.second) };
}

const two = (n: number) => String(n).padStart(2, '0');

/** 20260918-143205 のような、並べ替えれば時系列になる名前（時間帯の時刻） */
export function stamp(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.y}${p.mo}${p.d}-${two(p.h)}${two(p.mi)}${two(p.s)}`;
}

/** 20260918 のような、その時間帯での日付 */
export function dayOf(date: Date, tz: string): string {
  return stamp(date, tz).slice(0, 8);
}

/**
 * 次の午前0時まで、あと何ミリ秒か。
 * 0時ちょうどに動くと、前の日の名前になってしまうことがあるので、1秒だけ過ぎてから動かす。
 */
export function msUntilMidnight(now: Date, tz: string): number {
  const p = parts(now, tz);
  const sec = (24 - p.h) * 3600 - p.mi * 60 - p.s;
  return sec * 1000 - now.getMilliseconds() + 1000;
}

/**
 * 控えのフォルダの名前の一覧から、消すものを選ぶ。
 * 同じ日のものは、いちばん新しい1つだけ残し、新しい日から数えて KEEP 日分を残す。
 */
export function pickToDelete(names: string[], keep: number = KEEP): string[] {
  const own = names.filter((n) => /^\d{8}-\d{6}$/.test(n)).sort();
  const newestOfDay = new Map<string, string>();
  for (const n of own) newestOfDay.set(n.slice(0, 8), n); // 昇順なので、あとのものが勝つ
  const kept = new Set([...newestOfDay.keys()].sort().slice(-keep).map((d) => newestOfDay.get(d)!));
  return own.filter((n) => !kept.has(n));
}
