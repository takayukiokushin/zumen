import { useMemo, useState } from 'react';
import { missingRequiredFields } from '@zumen/knowledge';
import { missingLabel } from '../missingLabel.ts';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult } from '@zumen/ai';
import { Field } from '../Field.tsx';
import { useT, useTx } from '../i18n/useT.ts';
import { displayValue, labelOf } from './AnalysisReview.tsx';
import type { AiApplied } from './applied.ts';

/**
 * スケッチの読み取りが終わったあとの画面（読み取った内容は、終わったときに、自動で反映してある。第14弾 項目6）。
 *
 * 出すのは、次のもの。
 * 1. 完了の知らせ（足りない必須項目があるときは、そのことも）
 * 2. すでに入力されていた項目を書き換えたときは、その知らせと、「項目：前 → 後」の一覧
 * 3. 「反映前に戻す」（読み取りが書き換えた項目だけを、元に戻す）
 * 4. 注意書き（AIは間違えることがある）と、「設備を入力して作成を開く」「図面を開く」
 * 5. 図面を作るのに必要で、スケッチから読み取れなかった項目（必須で未回答のもの）。答えると、その場で反映される
 */
export function SketchResult({
  result,
  current,
  applied,
  onSetAnswer,
  onUndo,
  onGoToHearing,
  onGoToDrawing,
}: {
  result: AnalysisResult;
  /** いまの答え（反映のあとの、実際に効いている答え） */
  current: Answers;
  applied: AiApplied;
  onSetAnswer: (key: string, value: Value) => void;
  onUndo: () => void;
  onGoToHearing: () => void;
  onGoToDrawing: () => void;
}) {
  const t = useT();
  const tx = useTx();
  const [showChanges, setShowChanges] = useState(false);

  // 読み取った内容を足したうえで、必須なのに答えが無いものを、確認事項にする（最初に出たものは、答えたあとも出したままにする）
  const firstMissing = useMemo(() => missingRequiredFields({ ...current, ...(result.answers as Answers) }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const nowMissing = missingRequiredFields(current);
  const rows = [...firstMissing, ...nowMissing.filter((m) => !firstMissing.some((f) => f.key === m.key))];
  const stillMissing = nowMissing.length > 0;
  // 入力画面と同じ、エリアごとのまとまりにする（1か所目と、全体の項目は、1つ目。2か所目以降は、それぞれ別）
  const groups = (() => {
    const m = new Map<number, typeof rows>();
    for (const r of rows) m.set(r.areaNo ?? 1, [...(m.get(r.areaNo ?? 1) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([no, list]) => ({ no, rows: list }));
  })();
  const isAnswered = (v: unknown) => v !== undefined && v !== null && v !== '';
  const doneCount = rows.filter((r) => isAnswered(current[r.key])).length;
  // 項目が少ないときは、ぜんぶ開いておく。多いとき（複数エリア）は、1か所目だけ開いて、残りは、見出しを押して開く
  const openAll = rows.length <= 12;

  return (
    <>
      <section className="panel">
        <p className="ok-note" role="status">
          {stillMissing ? t('sketch.doneMissing') : t('sketch.done')}
        </p>
        {applied.overwritten.length > 0 && (
          <div className="overwrote">
            <p>
              {t('sketch.overwrote', { n: applied.overwritten.length })}{' '}
              <button type="button" className="btn" aria-expanded={showChanges} onClick={() => setShowChanges((v) => !v)}>
                {showChanges ? t('sketch.hideChanges') : t('sketch.showChanges')}
              </button>
            </p>
            {showChanges && (
              <ul>
                {applied.overwritten.map((c) => (
                  <li key={c.key}>
                    {t('sketch.change', { label: labelOf(c.key, t, tx), before: displayValue(c.key, c.before, tx), after: displayValue(c.key, c.after, tx) })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="ai-caution">{t('sketch.caution')}</p>
        <div className="sketch-actions">
          <button type="button" className="primary" onClick={onGoToHearing}>
            {t('sketch.openHearing')}
          </button>
          <button type="button" className="btn" onClick={onGoToDrawing}>
            {t('sketch.openDrawing')}
          </button>
          <button type="button" className="btn" title={t('sketch.undoNote')} onClick={onUndo}>
            {t('sketch.undo')}
          </button>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="panel">
          <h2>{t('sketch.answer')}</h2>
          <p className="sketch-count" role="status">
            {t('sketch.count', { total: rows.length, done: doneCount })}
            {groups.length > 1 && (
              <button type="button" className="btn" onClick={onGoToHearing}>
                {t('sketch.continueHearing')}
              </button>
            )}
          </p>
          {groups.map((g) => {
            const done = g.rows.filter((r) => isAnswered(current[r.key])).length;
            const fields = (
              <div className="fields">
                {g.rows.map((r) => (
                  <Field
                    key={r.key}
                    question={{ ...r.question, label: missingLabel(r, t, tx) }}
                    fieldKey={r.key}
                    value={current[r.key]}
                    onChange={onSetAnswer}
                    context={{ ...r.context, ...current }}
                  />
                ))}
              </div>
            );
            // エリアが1か所だけのときは、見出しも折りたたみも付けない
            if (groups.length === 1) return <div key={g.no}>{fields}</div>;
            return (
              <details key={g.no} className="sketch-group" open={openAll || g.no === 1}>
                <summary>
                  <b>{g.no === 1 ? t('sketch.groupFirst') : t('hearing.areaNth', { n: g.no })}</b>
                  <span className={done === g.rows.length ? 'done' : ''}>{done === g.rows.length ? t('sketch.groupDone') : t('sketch.groupCount', { done, total: g.rows.length })}</span>
                </summary>
                {fields}
              </details>
            );
          })}
        </section>
      )}
    </>
  );
}
