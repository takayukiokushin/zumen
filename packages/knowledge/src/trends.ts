import type { Answers } from './condition.ts';
import { QUESTIONS } from './questions.ts';
import type { Question } from './questions/types.ts';

/**
 * 過去の案件の「傾向」（第13弾 項目51）。
 *
 * スケッチの読み取り・音声入力・入力画面で、迷ったとき・まだ答えていないときの、参考にする。
 * 決まりは次のとおり。
 * - 参考にするのは、設備の構成の答え（選択肢から選ぶ質問）だけ。お客様の名前や、手で入力する文字・数字は、使わない。
 * - 集計した件数と割合だけを使う。ほかの案件の回答そのものは、画面にも、AIにも出さない。
 * - 同じ条件の案件が、TREND_MIN_COUNT 件に満たないあいだは、傾向を出さない。
 * - スケッチ・音声・人の入力は、いつも最優先。傾向は、あくまで補助（自動では入れない）。
 * - 集計はサーバーの中だけで行う。AI（Claude）には送らない。
 */

/** 傾向を出すのに必要な、最小の件数（その質問に答えている案件の数） */
export const TREND_MIN_COUNT = 10;
/** 「同じ条件」を決める質問（受電の形）。同じ答えの案件が足りないときは、全案件で数える */
export const TREND_CONTEXT_KEY = 'sourceType';
/** 1つの質問について、返す選択肢の数（多い順） */
export const TREND_TOP = 3;

export interface TrendEntry {
  /** どの案件を数えたか：context＝受電の形が同じ案件／all＝全案件 */
  scope: 'context' | 'all';
  /** 数えた案件の数（この質問に答えている案件） */
  total: number;
  /** 多い順の選択肢と、その件数 */
  top: { value: string; count: number }[];
}

/** 傾向の対象にする質問か（選択肢から選ぶ質問。手入力・AIに渡さない項目・「傾向に使わない」印のあるものは除く） */
export function isTrendQuestion(q: Question): boolean {
  return q.type === 'select' && !q.manualOnly && !q.noAi && !q.noTrend && !q.allowFreeInput && (q.options ?? []).length > 0;
}

const TREND_QUESTIONS = QUESTIONS.filter(isTrendQuestion);

/** 傾向の対象になる質問の id（繰り返しの2件目以降・2か所目以降の答えも、基本の質問の傾向を使う） */
export const TREND_QUESTION_IDS: ReadonlySet<string> = new Set(TREND_QUESTIONS.map((q) => q.id));

/** 保存した答えのキー（「key__2」「a2:key」）から、基本の質問の id を取り出す */
export const baseQuestionId = (key: string): string => key.replace(/^a\d+:/, '').replace(/__\d+$/, '');

/**
 * 案件の回答の一覧から、質問ごとの傾向を数える。
 * context：いま答えている案件の「受電の形」。あれば、同じ受電の形の案件だけで数え、足りなければ全案件で数える。
 * 件数が TREND_MIN_COUNT に満たない質問は、結果に入れない。
 */
export function tallyTrends(list: readonly Answers[], context?: string): Record<string, TrendEntry> {
  const out: Record<string, TrendEntry> = {};
  const count = (rows: readonly Answers[], q: Question): { total: number; counts: Map<string, number> } => {
    const valid = new Set((q.options ?? []).map((o) => o.value));
    const counts = new Map<string, number>();
    let total = 0;
    for (const a of rows) {
      const v = a[q.id];
      if (v === undefined || v === null || v === '') continue;
      const s = String(v);
      // 一覧にない値（昔の選択肢・手で書き換えた値）は、数えない
      if (!valid.has(s)) continue;
      total++;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return { total, counts };
  };
  const sameContext = context ? list.filter((a) => String(a[TREND_CONTEXT_KEY] ?? '') === context) : [];
  for (const q of TREND_QUESTIONS) {
    let scope: TrendEntry['scope'] = 'context';
    let r = context ? count(sameContext, q) : { total: 0, counts: new Map<string, number>() };
    if (r.total < TREND_MIN_COUNT) {
      scope = 'all';
      r = count(list, q);
    }
    if (r.total < TREND_MIN_COUNT) continue;
    const order = new Map((q.options ?? []).map((o, i) => [o.value, i]));
    const top = [...r.counts.entries()]
      .sort((a, b) => b[1] - a[1] || order.get(a[0])! - order.get(b[0])!)
      .slice(0, TREND_TOP)
      .map(([value, n]) => ({ value, count: n }));
    out[q.id] = { scope, total: r.total, top };
  }
  return out;
}
