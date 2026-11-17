import type { Answers } from '@zumen/knowledge';

/**
 * スケッチ・音声で読み取った内容を、案件に反映したときの記録（第14弾 項目6）。
 *   before：反映した項目の、反映前の値（無かったものは undefined）。「反映前に戻す」で、その項目だけを元に戻すのに使う
 *   overwritten：すでに入力されていた項目を、読み取った内容で書き換えたもの（「項目：前 → 後」の一覧に使う）
 */
export interface AiApplied {
  before: Answers;
  overwritten: { key: string; before: string; after: string }[];
}
