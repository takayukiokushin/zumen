import { QUESTIONS, QUESTION_GROUPS } from '@zumen/knowledge';
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

/** グループ名の、かっこの中（（OCR・UVR・OVRなど）など）を除いたもの */
const plain = (label: string) => label.replace(/[（(].*?[）)]/g, '').trim();
/** 「2か所目：」の、最後の「：」を除く */
const noColon = (text: string) => text.replace(/[：:]\s*$/, '').trim();

/**
 * 質問の、「何についての質問か」を添えた名前（例：「変圧器 2台目：用途」「受電設備エリア 2か所目：形態は？」）。
 * 「形態は？」「用途」のように、これだけでは何のことか分からない名前を、初めて使う人にも分かるようにする。
 * 質問の名前に、グループ名がすでに入っているとき（「変圧器の台数」「VCTの位置は？」など）は、重ねて付けない。
 */
export function missingTitle(f: MissingField, t: ReturnType<typeof useT>, tx: ReturnType<typeof useTx>): string {
  const area = f.areaNo ? noColon(t('hearing.areaPrefix', { n: f.areaNo })) : '';
  const unit = f.unitNo ? noColon(t('hearing.unitPrefix', { nth: t('hearing.nth', { n: f.unitNo, unit: tx(f.unitName ?? '件', 'nth') }) })) : '';
  const where = [area, unit].filter(Boolean).join(' ');
  const label = tx(f.question.label);
  const group = QUESTION_GROUPS.find((g) => g.id === f.question.group);
  const g = group ? tx(group.label) : '';
  const gp = plain(g);
  const addGroup = gp !== '' && !label.includes(gp) && !gp.includes(label);
  const head = addGroup ? `${gp}${where ? ` ${where}` : ''}` : where;
  return head ? `${head}：${label}` : label;
}

/** 項目の鍵（「trUsage__2」「a2:areaForm」など）から、「何についての質問か」を添えた名前を作る（AI の質問の見出し用） */
export function keyTitle(id: string, t: ReturnType<typeof useT>, tx: ReturnType<typeof useTx>): string | null {
  const m = /^(?:a(\d+):)?(.*?)(?:__(\d+))?$/.exec(id);
  const question = QUESTIONS.find((q) => q.id === (m?.[2] ?? id));
  if (!question) return null;
  const group = QUESTION_GROUPS.find((g) => g.id === question.group);
  const areaNo = m?.[1] ? Number(m[1]) : undefined;
  const unitNo = m?.[3] ? Number(m[3]) : undefined;
  return missingTitle({ key: id, question, label: question.label, ...(areaNo ? { areaNo } : {}), ...(unitNo ? { unitNo, unitName: group?.repeatUnit ?? '件' } : {}), context: {} } as MissingField, t, tx);
}
