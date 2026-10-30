import { useState } from 'react';
import { QUESTIONS } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult, ReviewItem } from '@zumen/ai';

/**
 * AIの読み取り結果を、人が確認して、採用するものだけを反映する画面。
 * 手書きメモの読み取り（スケッチ）と、音声入力から作成で、共通に使う。
 *
 * 読み取った内容はそのまま図面には入らない。必ずこの画面で、人が選んでから反映する
 * （電気設備図面は保安上の重要書類のため、最終責任は人に残す）。
 */

const LEVEL_LABEL: Record<ReviewItem['level'], string> = {
  error: '矛盾',
  confirm: '確認',
  ask: '未記入',
};

const labelOf = (id: string) => {
  // 繰り返し（__2）やエリア（a2:）の書き方は、基本の項目名に、書き方の説明を添えて出す
  const m = /^(?:a(\d+):)?(.*?)(?:__(\d+))?$/.exec(id);
  const base = QUESTIONS.find((q) => q.id === (m?.[2] ?? id));
  if (!base) return id;
  const extra = [m?.[1] ? `${m[1]}か所目のエリア` : '', m?.[3] ? `${m[3]}件目` : ''].filter(Boolean).join('・');
  return extra ? `${base.label}（${extra}）` : base.label;
};

const displayValue = (id: string, v: unknown): string => {
  const baseId = id.replace(/^a\d+:/, '').replace(/__\d+$/, '');
  const q = QUESTIONS.find((x) => x.id === baseId);
  const o = q?.options?.find((opt) => opt.value === String(v));
  return o ? o.label : String(v);
};

export function AnalysisReview({
  result,
  review,
  evidenceLabel,
  notesLabel = 'メモに書かれていた特記事項',
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
            <h2>確認してほしいこと（{review.length}件）</h2>
            {review.length === 0 ? (
              <p className="hint">特にありません。</p>
            ) : (
              <ul className="review">
                {review.map((r, i) => (
                  <li key={i} className={r.level}>
                    <span className="tag">{LEVEL_LABEL[r.level]}</span>
                    <div>
                      <b>{r.label}</b>
                      {r.value && <span className="val">読み取り: {r.value}</span>}
                      <p>{r.message}</p>
                      {r.evidence && <p className="ev">{evidenceLabel}: {r.evidence}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>読み取った内容（{Object.keys(result.answers).length}件）</h2>
            <p className="hint">反映するものにチェックを入れてください。チェックを外したものは今までの回答のままです。</p>
            <table className="picked">
              <thead>
                <tr>
                  <th>反映</th>
                  <th>項目</th>
                  <th>読み取った値</th>
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
                        aria-label={`${labelOf(id)}を反映する`}
                      />
                    </td>
                    <td>
                      {labelOf(id)}
                      {result.uncertain.includes(id) && <span className="warn-tag">自信なし</span>}
                    </td>
                    <td>{displayValue(id, v)}</td>
                    <td className="ev">{result.evidence[id] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" disabled={chosenCount === 0} onClick={apply}>
              選んだ{chosenCount}件を反映してヒアリングへ
            </button>
          </section>

          {result.notes.length > 0 && (
            <section className="panel">
              <h2>{notesLabel}</h2>
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
