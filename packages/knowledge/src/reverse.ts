import type { Answers } from './condition.ts';
import { indexedKey } from './engine.ts';

/**
 * 図面の文字を、答えに読み替える（図面 → 入力。図面を作るときの文字の組み立て（engine.ts）の、逆向き）。
 * 図面に出る日本語の言い方（一次・二次・三次、kVA など）は、組み立てる側と同じ場所（このパッケージ）に置く。
 */

const THREE_WINDING = new Set(['tr-3w-yyd', 'tr-3w-ddy']);

const NUM = String.raw`\d+(?:\.\d+)?`;
const COMPACT = new RegExp(String.raw`^(?:[13]φ)?(${NUM})(?:/(${NUM}))?(?:/(${NUM}))?kVA$`);
const PART = new RegExp(String.raw`^(一次|二次|三次)(${NUM})kVA$`);

/** 変圧器の文字（用途・Tr・容量・電圧・構成）を、答えに読み替える。読み取れない書き方のときは、null */
export function parseTransformerLabel(lines: string[], conn: string, unit: number): Answers | null {
  if (conn === 'tr-vv' || conn === 'tr-1p-parallel') return null;
  const at = lines.indexOf('Tr');
  if (at < 0 || at > 1) return null;
  const k = (id: string) => indexedKey(id, unit);
  const out: Answers = { [k('trUsage')]: at === 1 ? lines[0] : undefined };
  const three = THREE_WINDING.has(conn);
  const caps: Record<string, string | undefined> = { trCapacityW1: undefined, trCapacityW2: undefined, trCapacityW3: undefined, trCapacity: undefined };
  let voltage = '';
  let composition = '';
  let stage = 0; // 0＝容量の前 1＝電圧の前 2＝構成の前
  for (const line of lines.slice(at + 1)) {
    if (stage === 0 && /kVA$/.test(line)) {
      stage = 1;
      if (three) {
        const c = COMPACT.exec(line);
        if (c) {
          const n = c.slice(1).filter((x) => x !== undefined);
          if (n.length === 1) caps.trCapacityW1 = n[0];
          else if (n.length === 3) [caps.trCapacityW1, caps.trCapacityW2, caps.trCapacityW3] = n;
          else return null;
          continue;
        }
        const parts = line.split(' / ').map((s) => PART.exec(s));
        if (parts.some((x) => !x)) return null;
        for (const x of parts) caps[x![1] === '一次' ? 'trCapacityW1' : x![1] === '二次' ? 'trCapacityW2' : 'trCapacityW3'] = x![2];
      } else {
        const c = COMPACT.exec(line);
        if (!c || c[2] !== undefined) return null;
        caps.trCapacity = c[1];
      }
    } else if (stage <= 1 && line.includes('/') && !/kVA/.test(line)) {
      stage = 2;
      voltage = line;
    } else if (stage <= 2 && conn === 'tr-3p-dd') {
      stage = 3;
      composition = line;
    } else return null;
  }
  // 容量は数の欄なので、数で入れる
  for (const [id, v] of Object.entries(caps)) out[k(id)] = v === undefined ? undefined : Number(v);
  out[k('trVoltage')] = voltage;
  if (conn === 'tr-3p-dd') out[k('trComposition')] = composition;
  return out;
}


/**
 * 定格の行（例：「7200V 200A」）。電圧と電流の2つの答えから作る行を、答えに読み替える（第20弾・書き戻しの残り ③）。
 * placeholder：構成ルールの文字の行（`{...}` だけの行）に書いてある名前。voltage・current：その行を作る答えの質問ID。
 * currentSuffix：電流の答えに、単位（A）を付けて出すもの（'A'）／答えそのままの文字を出すもの（''）。電圧には、いつも「V」を付ける。
 * 片方だけ入っているときは、その方だけが出る（もう片方の答えは空）。
 */
export interface RatingLine {
  placeholder: string;
  voltage: string;
  current: string;
  currentSuffix: 'A' | '';
}

export const RATING_LINES: readonly RatingLine[] = [
  { placeholder: 'lbsRatingLine', voltage: 'lbsRatedVoltage', current: 'lbsRatedCurrent', currentSuffix: 'A' },
  { placeholder: 'pasRatingText', voltage: 'pasRatedVoltage', current: 'pasRatedCurrent', currentSuffix: 'A' },
  { placeholder: 'midRatingText', voltage: 'midRatedVoltage', current: 'midRatedCurrent', currentSuffix: 'A' },
  { placeholder: 'areaPasRatingText', voltage: 'areaPasRatedVoltage', current: 'areaPasRatedCurrent', currentSuffix: 'A' },
  { placeholder: 'areaAsRatingText', voltage: 'areaAsRatedVoltage', current: 'areaAsRatedCurrent', currentSuffix: 'A' },
  { placeholder: 'trLbsRatingLine', voltage: 'trLbsVoltage', current: 'trLbsRating', currentSuffix: '' },
  { placeholder: 'capLbsRatingLine', voltage: 'capLbsVoltage', current: 'capLbsRating', currentSuffix: '' },
];

/** 定格の行を、電圧の答え・電流の答えに分ける（電圧は数、電流は「数」または単位なしの文字）。読み取れない書き方のときは、null */
export function parseRatingLine(line: string, spec: RatingLine): { voltage?: string; current?: string } | null {
  const text = line.trim();
  if (text === '') return null;
  const tokens = text.split(' ');
  const v = new RegExp(`^(${NUM})V$`).exec(tokens[0]!);
  const rest = (v ? tokens.slice(1) : tokens).join(' ');
  const out: { voltage?: string; current?: string } = {};
  if (v) out.voltage = v[1]!;
  if (rest !== '') {
    if (spec.currentSuffix === 'A') {
      const a = new RegExp(`^(${NUM})A$`).exec(rest);
      if (!a) return null;
      out.current = a[1]!;
    } else out.current = rest;
  }
  return out.voltage === undefined && out.current === undefined ? null : out;
}
