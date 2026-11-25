import { useMemo, useRef } from 'react';
import { missingRequiredFields, requiredFields } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import { Field } from '../Field.tsx';
import { useT, useTx } from '../i18n/useT.ts';
import { missingTitle } from '../missingLabel.ts';

/**
 * 図面を作るのに必要で、まだ答えていない項目（必須）の一覧と、その場で答える欄。
 * スケッチ読み取り（SketchResult）と、音声入力（VoiceReview）で、共通に使う。
 *
 * ・最初に出た項目と、答えたあとに新しく出てきた項目は、答えても、一覧から消さない（答えた内容が見えるように）。
 *   ほかの答えを変えて、条件に合わなくなった項目だけが、外れる。並びは、入力画面と同じ。
 * ・エリアが2か所以上のときは、エリアごとの折りたたみにする。
 */
export function RequiredList({
  title,
  current,
  initial,
  exclude,
  onSetAnswer,
  onGoToHearing,
}: {
  title: string;
  /** いまの答え（ここに出す項目の値は、これで決まる） */
  current: Answers;
  /** 最初に出す項目を決める答え（開いたときの答え。あとで変えても、無視する） */
  initial: Answers;
  /** ここには出さない項目（別の場所で聞いているもの） */
  exclude?: Set<string>;
  onSetAnswer: (key: string, value: Value) => void;
  onGoToHearing: () => void;
}) {
  const t = useT();
  const tx = useTx();
  const firstMissing = useMemo(() => missingRequiredFields(initial), []); // eslint-disable-line react-hooks/exhaustive-deps
  const nowMissing = missingRequiredFields(current);
  const shown = useRef<Set<string>>(new Set(firstMissing.map((m) => m.key)));
  for (const m of nowMissing) shown.current.add(m.key);
  const rows = requiredFields(current).filter((f) => shown.current.has(f.key) && !exclude?.has(f.key));
  if (rows.length === 0) return null;

  const isAnswered = (v: unknown) => v !== undefined && v !== null && v !== '';
  // 入力画面と同じ、エリアごとのまとまりにする（1か所目と、全体の項目は、1つ目。2か所目以降は、それぞれ別）
  const groups = (() => {
    const m = new Map<number, typeof rows>();
    for (const r of rows) m.set(r.areaNo ?? 1, [...(m.get(r.areaNo ?? 1) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([no, list]) => ({ no, rows: list }));
  })();
  const doneCount = rows.filter((r) => isAnswered(current[r.key])).length;
  // 項目が少ないときは、ぜんぶ開いておく。多いとき（複数エリア）は、1か所目だけ開いて、残りは、見出しを押して開く
  const openAll = rows.length <= 12;

  return (
    <section className="panel">
      <h2>{title}</h2>
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
                question={{ ...r.question, label: missingTitle(r, t, tx) }}
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
  );
}
