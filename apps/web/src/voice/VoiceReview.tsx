import { useMemo, useState } from 'react';
import { baseQuestionId, missingRequiredFields, QUESTIONS } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult, ReviewItem } from '@zumen/ai';
import { Field } from '../Field.tsx';
import { useT, useTx } from '../i18n/useT.ts';
import { keyTitle } from '../missingLabel.ts';
import { translateReviewText } from '../session/serverMessages.ts';
import { TrendHint } from '../TrendHint.tsx';
import { useTrends } from '../trends.ts';
import { useSettings } from '../settings/settings.tsx';
import { displayValue, labelOf } from '../analyze/AnalysisReview.tsx';
import type { AiApplied } from '../analyze/applied.ts';
import { RequiredList } from '../analyze/RequiredList.tsx';

/**
 * 音声入力から作成：読み取ったあとの画面（第21弾 項目3）。この画面の中で、最後まで済ませられる。
 *
 * 上から：
 *   1. 先に答えてほしいこと（図面を作るために必要。重大な欠点があるときだけ）。その場で答えられる
 *   2. 「読み取った内容を、設備入力に反映する」のボタン（反映したあとは、案内と「設備を入力して作成を開く」など）
 *   3. 確認してほしいこと（読み取りに自信がないもの・図面の決まりに合わないもの）。その場で直せる
 *   4. 話された特記事項
 *   5. 読み取った内容（開け閉めできる。どこから読み取ったかを、確かめたいときだけ）
 *
 * 反映の前に答えたものは、反映するときに、いっしょに入る（まだ案件には入っていない）。反映のあとに直したものは、すぐ、案件に入る。
 * 読み取った内容は、すべて反映する（自信がないものは、「確認してほしいこと」に出して、直せるようにする）。
 */

const isAnswered = (v: unknown) => v !== undefined && v !== null && v !== '';

export function VoiceReview({
  result,
  review,
  answers,
  onApply,
  onUndo,
  onSetAnswer,
  onGoToHearing,
  onGoToDrawing,
}: {
  result: AnalysisResult;
  review: ReviewItem[];
  /** いまの答え（案件に入っているもの） */
  answers: Answers;
  onApply: (patch: Answers) => AiApplied;
  onUndo: (applied: AiApplied) => void;
  onSetAnswer: (key: string, value: Value) => void;
  onGoToHearing: () => void;
  onGoToDrawing: () => void;
}) {
  const t = useT();
  const tx = useTx();
  const { settings } = useSettings();
  const trends = useTrends(typeof result.answers.sourceType === 'string' ? result.answers.sourceType : undefined);
  const [applied, setApplied] = useState<AiApplied | null>(null);
  const [undone, setUndone] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  /** 反映する前に答えたもの（反映するときに、いっしょに入れる） */
  const [draft, setDraft] = useState<Answers>({});
  /** 手を付けた（答えを変えた・確認した）確認事項 */
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // 反映の前は、「いまの答え＋読み取った内容＋反映前に答えたもの」で見る。反映のあとは、案件の答えそのもの
  const working: Answers = applied ? answers : { ...answers, ...(result.answers as Answers), ...draft };
  const set = (key: string, value: Value) => {
    if (applied) onSetAnswer(key, value);
    else setDraft((d) => ({ ...d, [key]: value }));
    setTouched((p) => ({ ...p, [`k:${key}`]: true }));
  };

  // 最初に、先に答えてほしいと分かった必須項目（確認事項の、同じ内容の質問は、重ねて出さない）
  const initial = useMemo(() => working, []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialMissingKeys = useMemo(() => new Set(missingRequiredFields(initial).map((m) => m.key)), [initial]);
  const nowMissing = missingRequiredFields(working);

  const errors = review.filter((r) => r.level === 'error');
  const cards = review.filter(
    (r) => r.level !== 'error' && r.source !== 'missing' && !(r.questionId && initialMissingKeys.has(r.questionId)),
  );
  const need = nowMissing.length + errors.length;
  const readCount = Object.keys(result.answers).length;
  const confirmed = cards.filter((c, i) => touched[`c:${i}`] || (c.questionId && touched[`k:${c.questionId}`])).length;

  const apply = () => {
    setApplied(onApply({ ...(result.answers as Answers), ...draft }));
    setUndone(false);
  };
  const undo = () => {
    if (!applied) return;
    onUndo(applied);
    setApplied(null);
    setUndone(true);
  };

  const card = (r: ReviewItem, i: number, tag: string | null) => {
    const key = r.questionId;
    const question = key ? QUESTIONS.find((q) => q.id === baseQuestionId(key)) : undefined;
    const done = !!touched[`c:${i}`] || (!!key && !!touched[`k:${key}`]);
    const title = key ? (keyTitle(key, t, tx) ?? translateReviewText(r.label)) : translateReviewText(r.label);
    return (
      <li key={`${tag ?? 'c'}${i}`} className={`ai-q${done ? ' done' : ''}${r.level === 'error' ? ' error' : ''}`}>
        <header>
          <b>{title}</b>
          {tag && <span className="no">{tag}</span>}
          {done && <span className="ok">{t('sketch.confirm.checked')}</span>}
        </header>
        <dl>
          <dt>{t('voice.r.what')}</dt>
          <dd>{translateReviewText(r.message)}</dd>
          {r.evidence && (
            <>
              <dt>{t('voice.evidence')}</dt>
              <dd>{r.evidence}</dd>
            </>
          )}
        </dl>
        {key && question ? (
          <div className="fields">
            <Field question={{ ...question, label: t('sketch.ai.answer') }} fieldKey={key} value={working[key]} onChange={set} context={working} />
          </div>
        ) : (
          <p className="ai-q-noitem">
            {t('sketch.ai.noItem')}{' '}
            <button type="button" className="btn" onClick={onGoToHearing}>
              {t('sketch.ai.goHearing')}
            </button>
          </p>
        )}
        <label className="ai-q-ack">
          <input type="checkbox" checked={!!touched[`c:${i}`]} onChange={(e) => setTouched((p) => ({ ...p, [`c:${i}`]: e.target.checked }))} />
          {key && question ? t('sketch.ai.ackKeep') : t('sketch.ai.ack')}
        </label>
      </li>
    );
  };

  return (
    <>
      <section className="panel">
        {applied ? (
          <p className="ok-note" role="status">
            {need > 0 ? t('voice.r.appliedNeed', { m: need }) : cards.length > 0 ? t('voice.r.appliedCheck', { k: cards.length }) : t('voice.r.applied')}
          </p>
        ) : need > 0 ? (
          <p className="warn-note" role="status">
            {t('voice.r.readNeed', { n: readCount, m: need })}
          </p>
        ) : (
          <p className="ok-note" role="status">
            {t('voice.r.readOk', { n: readCount })}
          </p>
        )}
        {undone && !applied && <p className="ok-note-inline">{t('sketch.undone')}</p>}
        {applied && applied.overwritten.length > 0 && (
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
        {applied ? (
          <div className="sketch-actions">
            <button type="button" className="primary" onClick={onGoToHearing}>
              {t('sketch.openHearing')}
            </button>
            <button type="button" className="btn" onClick={onGoToDrawing}>
              {t('sketch.openDrawing')}
            </button>
            <button type="button" className="btn" title={t('sketch.undoNote')} onClick={undo}>
              {t('sketch.undo')}
            </button>
          </div>
        ) : null}
      </section>

      {/* 1. 先に答えてほしいこと（必須で、まだ答えていないもの・図面の決まりに合わないもの）。その場で答えられる */}
      <RequiredList
        title={t('voice.r.needTitle')}
        current={working}
        initial={initial}
        onSetAnswer={set}
        onGoToHearing={onGoToHearing}
      />
      {errors.length > 0 && (
        <section className="panel sketch-ai">
          <h2>{t('voice.r.errorTitle')}</h2>
          <ol className="ai-qs">{errors.map((r, i) => card(r, 1000 + i, null))}</ol>
        </section>
      )}

      {/* 2. 反映のボタン（反映する前だけ） */}
      {!applied && (
        <section className="panel">
          <div className="sketch-actions">
            <button type="button" className="primary" onClick={apply}>
              {t('voice.r.apply')}
            </button>
          </div>
          <p className="hint">
            {t('voice.r.applyHint')}
            {need > 0 && ` ${t('voice.r.applyHintNeed', { m: need })}`}
            {cards.length > 0 && ` ${t('voice.r.applyHintCheck', { k: cards.length })}`}
          </p>
        </section>
      )}

      {/* 3. 確認してほしいこと */}
      {cards.length > 0 && (
        <section className="panel sketch-ai">
          <h2>{t('voice.r.confirmTitle')}</h2>
          <p className="hint">{t('voice.r.confirmHint')}</p>
          <p className="sketch-count" role="status">
            {t('voice.r.confirmCount', { total: cards.length, done: confirmed })}
          </p>
          <ol className="ai-qs">{cards.map((r, i) => card(r, i, t('voice.r.cardNo', { n: i + 1, total: cards.length })))}</ol>
        </section>
      )}

      {/* 4. 話された特記事項 */}
      {result.notes.length > 0 && (
        <section className="panel">
          <h2>{t('voice.notes')}</h2>
          <ul className="notes">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 5. 読み取った内容（開け閉めできる） */}
      <section className="panel">
        <details>
          <summary>
            <b>{t('voice.r.readTitle', { n: readCount })}</b>
            <span className="hint">{t('voice.r.readHint')}</span>
          </summary>
          <table className="picked">
            <thead>
              <tr>
                <th>{t('revui.col.item')}</th>
                <th>{t('revui.col.value')}</th>
                <th>{t('voice.evidence')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.answers).map(([id, v]) => (
                <tr key={id} className={result.uncertain.includes(id) ? 'uncertain' : ''}>
                  <td>
                    {keyTitle(id, t, tx) ?? labelOf(id, t, tx)}
                    {result.uncertain.includes(id) && <span className="warn-tag">{t('revui.unsureTag')}</span>}
                  </td>
                  <td>
                    {displayValue(id, v, tx)}
                    {!settings.hideHelp && result.uncertain.includes(id) && trends[baseQuestionId(id)] && <TrendHint questionId={baseQuestionId(id)} entry={trends[baseQuestionId(id)]!} />}
                  </td>
                  <td className="ev">{result.evidence[id] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}
