import { useState } from 'react';
import { QUESTIONS, baseQuestionId } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult, ReviewItem } from '@zumen/ai';
import { useT, useTx } from '../i18n/useT.ts';
import { translateReviewText } from '../session/serverMessages.ts';
import { TrendHint } from '../TrendHint.tsx';
import { useTrends } from '../trends.ts';

/**
 * AIの読み取り結果を、人が確認して、採用するものだけを反映する画面。
 * 手書きメモの読み取り（スケッチ）と、音声入力から作成で、共通に使う。
 *
 * 読み取った内容はそのまま図面には入らない。必ずこの画面で、人が選んでから反映する
 * （電気設備図面は保安上の重要書類のため、最終責任は人に残す）。
 */

const levelKey = { error: 'revui.level.error', confirm: 'revui.level.confirm', ask: 'revui.level.ask' } as const;

type T = ReturnType<typeof useT>;
type Tx = ReturnType<typeof useTx>;

const labelOf = (id: string, t: T, tx: Tx) => {
  // 繰り返し（__2）やエリア（a2:）の書き方は、基本の項目名に、書き方の説明を添えて出す
  const m = /^(?:a(\d+):)?(.*?)(?:__(\d+))?$/.exec(id);
  const base = QUESTIONS.find((q) => q.id === (m?.[2] ?? id));
  if (!base) return id;
  const extra = [m?.[1] ? t('revui.extraArea', { n: m[1] }) : '', m?.[3] ? t('revui.extraUnit', { n: m[3] }) : ''].filter(Boolean).join('・');
  return extra ? `${tx(base.label)}（${extra}）` : tx(base.label);
};

const displayValue = (id: string, v: unknown, tx: Tx): string => {
  const baseId = id.replace(/^a\d+:/, '').replace(/__\d+$/, '');
  const q = QUESTIONS.find((x) => x.id === baseId);
  const o = q?.options?.find((opt) => opt.value === String(v));
  return o ? tx(o.label) : String(v);
};

export function AnalysisReview({
  result,
  review,
  evidenceLabel,
  notesLabel,
  onApply,
}: {
  result: AnalysisResult;
  review: ReviewItem[];
  /** 根拠の見出し（「メモの記載」「話された言葉」など） */
  evidenceLabel: string;
  /** 特記事項の見出し */
  notesLabel?: string;
  /** 選んだ項目だけを、答えとして渡す */
  onApply: (patch: Answers) => void;
}) {
  const t = useT();
  const tx = useTx();
  const notesTitle = notesLabel ?? t('revui.notes');
  // 過去の傾向：自信がない項目に、参考として添える（読み取った値が最優先。傾向で、値は変えない）
  const trends = useTrends(typeof result.answers.sourceType === 'string' ? result.answers.sourceType : undefined);
  // 自信がある項目は、最初からチェックを入れておく
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => {
    const uncertain = new Set(result.uncertain);
    return Object.fromEntries(Object.keys(result.answers).map((k) => [k, !uncertain.has(k)]));
  });

  const apply = () => {
    const patch: Answers = {};
    for (const [k, v] of Object.entries(result.answers)) {
      if (chosen[k]) patch[k] = v as Value;
    }
    onApply(patch);
  };
  const chosenCount = Object.values(chosen).filter(Boolean).length;

  return (
        <>
          <section className="panel">
            <h2>{t('revui.title', { n: review.length })}</h2>
            {review.length === 0 ? (
              <p className="hint">{t('revui.none')}</p>
            ) : (
              <ul className="review">
                {review.map((r, i) => (
                  <li key={i} className={r.level}>
                    <span className="tag">{t(levelKey[r.level])}</span>
                    <div>
                      <b>{translateReviewText(r.label)}</b>
                      {r.value && <span className="val">{t('revui.read', { value: translateReviewText(r.value) })}</span>}
                      <p>{translateReviewText(r.message)}</p>
                      {r.evidence && <p className="ev">{evidenceLabel}: {r.evidence}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>{t('revui.picked', { n: Object.keys(result.answers).length })}</h2>
            <p className="hint">{t('revui.pickedHint')}</p>
            <table className="picked">
              <thead>
                <tr>
                  <th>{t('revui.col.apply')}</th>
                  <th>{t('revui.col.item')}</th>
                  <th>{t('revui.col.value')}</th>
                  <th>{evidenceLabel}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.answers).map(([id, v]) => (
                  <tr key={id} className={result.uncertain.includes(id) ? 'uncertain' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(chosen[id])}
                        onChange={(e) => setChosen((p) => ({ ...p, [id]: e.target.checked }))}
                        aria-label={t('revui.applyLabel', { label: labelOf(id, t, tx) })}
                      />
                    </td>
                    <td>
                      {labelOf(id, t, tx)}
                      {result.uncertain.includes(id) && <span className="warn-tag">{t('revui.unsureTag')}</span>}
                    </td>
                    <td>
                      {displayValue(id, v, tx)}
                      {result.uncertain.includes(id) && trends[baseQuestionId(id)] && <TrendHint questionId={baseQuestionId(id)} entry={trends[baseQuestionId(id)]!} />}
                    </td>
                    <td className="ev">{result.evidence[id] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" disabled={chosenCount === 0} onClick={apply}>
              {t('revui.applyBtn', { n: chosenCount })}
            </button>
          </section>

          {result.notes.length > 0 && (
            <section className="panel">
              <h2>{notesTitle}</h2>
              <ul className="notes">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </section>
          )}
        </>
  );
}
