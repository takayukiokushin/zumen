import { AI_HINTS } from './ai-hints.ts';
import type { Value } from './condition.ts';
import type { Question } from './questions/types.ts';
import { SITE_QUESTIONS } from './questions/site.ts';
import { RECEIVING_QUESTIONS } from './questions/receiving.ts';
import { COMPOSITION_QUESTIONS } from './questions/composition.ts';
import { TRANSFORMER_QUESTIONS } from './questions/transformer.ts';
import { EQUIPMENT_QUESTIONS } from './questions/equipment.ts';
import { AREAS_QUESTIONS } from './questions/areas.ts';
import { BREAKER_QUESTIONS } from './questions/breakers.ts';

/**
 * ヒアリングの質問定義。
 *
 * 仕様書10-1（共通項目）と10-2（機器別・ナレッジベースの分岐点から生成）の両方を
 * ここに1本化している。質問はデータなので、機器や分岐が増えても1件追加するだけでよい。
 */

export type { QuestionType, Choice, AskWhen, Question, QuestionGroup } from './questions/types.ts';
export { QUESTION_GROUPS } from './questions/groups.ts';

/** すべての質問（この順番が、入力画面の並び順になる）。種類ごとの定義は、`questions/` の中にある */
export const QUESTIONS: Question[] = [
  ...SITE_QUESTIONS,
  ...RECEIVING_QUESTIONS,
  ...COMPOSITION_QUESTIONS,
  ...TRANSFORMER_QUESTIONS,
  ...EQUIPMENT_QUESTIONS,
  ...AREAS_QUESTIONS,
  ...BREAKER_QUESTIONS,
];

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

/** 質問定義の既定値（エリアごとの入力でも、まだ触っていない質問に使う） */
export const QUESTION_DEFAULTS: Record<string, Value> = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

/**
 * 新しい案件を作ったときに、最初から入れておく答え（初期設定）。
 * 質問の既定値と違うものだけを書く（同じものは、質問の既定値のまま）。
 * 質問の既定値そのものは変えない：すでに保存してある案件は、答えていない質問を既定値で見るので、
 * ここに書いたことで、保存済みの案件の内容が変わることはない。
 * 2件目以降の答えは、「__2」のように書く（変圧器の2台目など）。
 */
export const NEW_PROJECT_ANSWERS: Record<string, Value> = {
  // 区分開閉器
  pasRatedVoltage: '7200',
  pasRatedCurrent: '200',
  // VCT
  vctLocation: 'indoor',
  // 引込ケーブル
  cableInstallation: 'buried',
  cableCrossSection: '38',
  // 受電設備エリア
  areaForm: 'cubicle',
  areaPlacement: 'outdoor',
  // 受電設備の構成
  mainBreakerForm: 'pfs',
  lbsRatedVoltage: '7200',
  hasSiteVt: 'no',
  hasSiteCt: 'no',
  // 変圧器：2台（1台目は電灯、2台目は動力）。結線方式と電圧は、用途から自動で入る
  transformerCount: '2',
  trUsage: '電灯',
  trUsage__2: '動力',
  // 進相設備：高圧コンデンサ1台（リアクトルは、質問の既定値の「なし」）
  hasCapacitor: 'yes',
};
