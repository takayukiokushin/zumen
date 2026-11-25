import { useRef, useState } from 'react';
import { QUESTIONS, baseQuestionId } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult } from '@zumen/ai';
import { Field } from '../Field.tsx';
import { useT, useTx } from '../i18n/useT.ts';
import { labelOf } from './AnalysisReview.tsx';
import { keyTitle } from '../missingLabel.ts';

/**
 * スケッチを読み取ったあとの、AIからの質問と、自信がない読み取りの確認（第18弾 E-②）。
 *
 * ・AIからの質問：1つ1つ枠に分けて、「どの部分／分からないこと／なぜ聞くか」を出し、
 *   対応する項目があれば、入力画面と同じ入力欄（選ぶだけ）で、その場で答えられる。上から順に答える。件数の制限はない。
 * ・自信がない読み取り：すでに反映してある値を、根拠といっしょに出す。違っていたら、その場で直せる。
 */

const isAnswered = (v: unknown) => v !== undefined && v !== null && v !== '';

export function SketchQuestions({
  result,
  current,
  onSetAnswer,
  onGoToHearing,
}: {
  result: AnalysisResult;
  current: Answers;
  onSetAnswer: (key: string, value: Value) => void;
  onGoToHearing: () => void;
}) {
  const t = useT();
  const tx = useTx();
  // 開いたときの答え（答えたかどうかは、これと比べて決める）
  const first = useRef<Answers>({ ...current });
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);

  const questionOf = (key: string) => QUESTIONS.find((q) => q.id === baseQuestionId(key));
  const qs = result.questions.map((q, i) => ({ ...q, no: i + 1, key: `q${i}`, item: q.questionId ? questionOf(q.questionId) : undefined }));
  const answeredQ = (x: (typeof qs)[number]) => !!acked[x.key] || (!!x.item && isAnswered(current[x.questionId]) && current[x.questionId] !== first.current[x.questionId]);
  const doneQ = qs.filter(answeredQ).length;

  const sure = result.uncertain.filter((k) => k in result.answers);
  const doneC = sure.filter((k) => acked[`c:${k}`]).length;

  /** 次の、まだ答えていない質問へ（画面を動かして、入力欄に印を付ける） */
  const next = () => {
    const x = qs.find((y) => !answeredQ(y));
    if (!x) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-q="${x.key}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('input, select, button, textarea')?.focus({ preventScroll: true });
  };

  if (qs.length === 0 && sure.length === 0) return null;
  return (
    <div ref={root}>
      {qs.length > 0 && (
        <section className="panel sketch-ai">
          <h2>{t('sketch.ai.title')}</h2>
          <p className="hint">{t('sketch.ai.hint')}</p>
          <p className="sketch-count" role="status">
            {t('sketch.count', { total: qs.length, done: doneQ })}
            {doneQ < qs.length && (
              <button type="button" className="btn" onClick={next}>
                {t('sketch.ai.next')}
              </button>
            )}
          </p>
          <ol className="ai-qs">
            {qs.map((x) => {
              const done = answeredQ(x);
              return (
                <li key={x.key} data-q={x.key} className={`ai-q${done ? ' done' : ''}`}>
                  <header>
                    <span className="no">{t('sketch.ai.cardNo', { n: x.no, total: qs.length })}</span>
                    <b>{x.questionId ? (keyTitle(x.questionId, t, tx) ?? labelOf(x.questionId, t, tx)) : t('sketch.ai.untitled')}</b>
                    {done && <span className="ok">{t('sketch.ai.answered')}</span>}
                  </header>
                  <dl>
                    {x.where && (
                      <>
                        <dt>{t('sketch.ai.where')}</dt>
                        <dd>{x.where}</dd>
                      </>
                    )}
                    <dt>{t('sketch.ai.what')}</dt>
                    <dd>{x.ask}</dd>
                    {x.why && (
                      <>
                        <dt>{t('sketch.ai.why')}</dt>
                        <dd>{x.why}</dd>
                      </>
                    )}
                  </dl>
                  {x.item ? (
                    <div className="fields">
                      <Field question={{ ...x.item, label: t('sketch.ai.answer') }} fieldKey={x.questionId} value={current[x.questionId]} onChange={onSetAnswer} context={current} />
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
                    <input type="checkbox" checked={!!acked[x.key]} onChange={(e) => setAcked((p) => ({ ...p, [x.key]: e.target.checked }))} />
                    {x.item ? t('sketch.ai.ackKeep') : t('sketch.ai.ack')}
                  </label>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {sure.length > 0 && (
        <section className="panel sketch-ai">
          <h2>{t('sketch.confirm.title')}</h2>
          <p className="hint">{t('sketch.confirm.hint')}</p>
          <p className="sketch-count" role="status">
            {t('sketch.confirm.count', { total: sure.length, done: doneC })}
          </p>
          <ol className="ai-qs">
            {sure.map((k, i) => {
              const q = questionOf(k);
              const done = !!acked[`c:${k}`];
              return (
                <li key={k} className={`ai-q${done ? ' done' : ''}`}>
                  <header>
                    <span className="no">{t('sketch.ai.cardNo', { n: i + 1, total: sure.length })}</span>
                    <b>{keyTitle(k, t, tx) ?? labelOf(k, t, tx)}</b>
                    {done && <span className="ok">{t('sketch.confirm.checked')}</span>}
                  </header>
                  {result.evidence[k] && (
                    <dl>
                      <dt>{t('sketch.confirm.evidence')}</dt>
                      <dd>{result.evidence[k]}</dd>
                    </dl>
                  )}
                  {q && (
                    <div className="fields">
                      <Field question={{ ...q, label: t('sketch.ai.answer') }} fieldKey={k} value={current[k]} onChange={onSetAnswer} context={current} />
                    </div>
                  )}
                  <label className="ai-q-ack">
                    <input type="checkbox" checked={done} onChange={(e) => setAcked((p) => ({ ...p, [`c:${k}`]: e.target.checked }))} />
                    {t('sketch.confirm.ack')}
                  </label>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
