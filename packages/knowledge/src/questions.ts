import { AI_HINTS } from './ai-hints.ts';
import type { Value } from './condition.ts';
import type { Question } from './questions/types.ts';
import { SITE_QUESTIONS } from './questions/site.ts';
import { RECEIVING_QUESTIONS } from './questions/receiving.ts';
import { MIDSWITCH_QUESTIONS } from './questions/midswitch.ts';
import { COMPOSITION_QUESTIONS } from './questions/composition.ts';
import { TRANSFORMER_QUESTIONS } from './questions/transformer.ts';
import { EQUIPMENT_QUESTIONS } from './questions/equipment.ts';
import { AREAS_QUESTIONS } from './questions/areas.ts';
import { BREAKER_QUESTIONS } from './questions/breakers.ts';
import { withDeviceCableQuestions } from './questions/devcable.ts';

/**
 * ヒアリングの質問定義。
 *
 * 仕様書10-1（共通項目）と10-2（機器別・ナレッジベースの分岐点から生成）の両方を
 * ここに1本化している。質問はデータなので、機器や分岐が増えても1件追加するだけでよい。
 */

export type { QuestionType, Choice, AskWhen, Question, QuestionGroup } from './questions/types.ts';
export { QUESTION_GROUPS } from './questions/groups.ts';

/** すべての質問（この順番が、入力画面の並び順になる）。種類ごとの定義は、`questions/` の中にある */
export const QUESTIONS: Question[] = withDeviceCableQuestions([
  ...SITE_QUESTIONS,
  ...RECEIVING_QUESTIONS,
  ...MIDSWITCH_QUESTIONS,
  ...COMPOSITION_QUESTIONS,
  ...TRANSFORMER_QUESTIONS,
  ...EQUIPMENT_QUESTIONS,
  ...AREAS_QUESTIONS,
  ...BREAKER_QUESTIONS,
]);

/** AIに渡す説明（詳しい文章）を、各項目に付ける。内容は ai-hints.ts にある */
for (const q of QUESTIONS) {
  const hint = AI_HINTS[q.id];
  if (hint !== undefined) q.aiHint = hint;
}

/** 入力画面で、広めの欄にしたい質問（名前・場所・自由な書き込み）。ほかの欄は、中身の長さから、画面側で幅を決める（Field.tsx） */
const WIDE_FIELDS = [
  'siteName', 'customerNameForTitleBlock', 'poleName', 'cabinetName', 'ugsCabinetName', 'earthingNotes',
  'drawingName', 'linkName', 'areaName', 'generatorPlace', 'areaDetail',
];
for (const q of QUESTIONS) {
  if (WIDE_FIELDS.includes(q.id) && q.size === undefined) q.size = 'l';
}

/** 「あり／なし」「はい／いいえ」で答える質問か（選択肢が yes と no の2つだけ） */
export const isYesNoQuestion = (q: Question): boolean =>
  q.type === 'select' && q.options?.length === 2 && q.options.some((o) => o.value === 'yes') && q.options.some((o) => o.value === 'no');

/**
 * 最初は「あり」（はい）だけを出す質問か（第15弾 項目1）。必須でなく、最初から両方出す印（bothChoices）も無い、あり／なしの質問。
 * 何も選ばないときは「なし」として扱う。「あり」を押すと、「なし」も出る。
 */
export const startsWithYesOnly = (q: Question): boolean => isYesNoQuestion(q) && !q.required && !q.bothChoices;

/**
 * 白紙で始めた案件に、スケッチ・音声の読み取りを反映するとき、「ない」（no）の答えは、何も選ばない状態にする（第15弾 項目1）。
 * 最初は「あり」だけを出す質問の「なし」が対象（「何も選ばない＝なし」なので、同じ意味）。
 * 返す値は、反映のしかた：patch に入れるキーのうち、答えを入れずに外すもの
 */
export function keysToUnset(patch: Record<string, Value>): string[] {
  return Object.entries(patch)
    .filter(([key, v]) => {
      if (v !== 'no') return false;
      const id = key.replace(/^a\d+:/, '').replace(/__\d+$/, '');
      const q = QUESTIONS.find((x) => x.id === id);
      return q !== undefined && startsWithYesOnly(q);
    })
    .map(([key]) => key);
}

/** 白紙で始めた案件でも入れておく既定値（名前の頭の部分「中電柱：」など。blankDefault の付いた質問） */
export const BLANK_DEFAULTS: Record<string, Value> = Object.fromEntries(
  QUESTIONS.filter((q) => q.blankDefault && q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

/** 質問定義の既定値（エリアごとの入力でも、まだ触っていない質問に使う） */
export const QUESTION_DEFAULTS: Record<string, Value> = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);
