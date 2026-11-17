import type { MissingField } from '@zumen/knowledge';
import type { useT, useTx } from './i18n/useT.ts';

/**
 * 未回答の必須項目の名前。選んでいる言葉に合わせて、「2か所目：」「2台目：」を前に付ける
 * （入力画面の見出し「2台目」「○か所目のエリア」と同じ言い方）。
 */
export function missingLabel(f: MissingField, t: ReturnType<typeof useT>, tx: ReturnType<typeof useTx>): string {
  const area = f.areaNo ? t('hearing.areaPrefix', { n: f.areaNo }) : '';
  const unit = f.unitNo ? t('hearing.unitPrefix', { nth: t('hearing.nth', { n: f.unitNo, unit: tx(f.unitName ?? '件', 'nth') }) }) : '';
  return `${area}${unit}${tx(f.question.label)}`;
}
