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
          <div className="fields">
            {rows.map((r) => (
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
        </section>
      )}
    </>
  );
}
