import { QUESTIONS } from '@zumen/knowledge';
import type { useT, useTx } from '../i18n/useT.ts';

/**
 * AIの読み取り結果の、項目名・値の、表示用の道具（手書きメモの読み取り＝スケッチと、音声入力から作成で、共通に使う）。
 *
 * 読み取った内容を、人が確認して直す画面は、スケッチ：SketchResult・SketchQuestions、音声入力：voice/VoiceReview。
 * （電気設備図面は保安上の重要書類のため、最終責任は人に残す。読み取った内容は、必ず、人が確認・修正できる画面を通す）
 */

type T = ReturnType<typeof useT>;
type Tx = ReturnType<typeof useTx>;

export const labelOf = (id: string, t: T, tx: Tx) => {
  // 繰り返し（__2）やエリア（a2:）の書き方は、基本の項目名に、書き方の説明を添えて出す
  const m = /^(?:a(\d+):)?(.*?)(?:__(\d+))?$/.exec(id);
  const base = QUESTIONS.find((q) => q.id === (m?.[2] ?? id));
  if (!base) return id;
  const extra = [m?.[1] ? t('revui.extraArea', { n: m[1] }) : '', m?.[3] ? t('revui.extraUnit', { n: m[3] }) : ''].filter(Boolean).join('・');
  return extra ? `${tx(base.label)}（${extra}）` : tx(base.label);
};

export const displayValue = (id: string, v: unknown, tx: Tx): string => {
  const baseId = id.replace(/^a\d+:/, '').replace(/__\d+$/, '');
  const q = QUESTIONS.find((x) => x.id === baseId);
  const o = q?.options?.find((opt) => opt.value === String(v));
  return o ? tx(o.label, o.i18nContext) : String(v);
};
