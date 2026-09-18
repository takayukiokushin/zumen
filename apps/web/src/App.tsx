import { useMemo, useState } from 'react';
import { DRIVER_QUESTION_IDS, evaluate, indexedKey, QUESTION_GROUPS, QUESTIONS, visibleQuestions } from '@zumen/knowledge';
import type { Answers, Question, Value } from '@zumen/knowledge';
import { Field } from './Field.tsx';
import { CompositionPreview } from './CompositionPreview.tsx';
import { Editor } from './editor/Editor.tsx';

/**
 * 事前ヒアリングのフォーム。
 * 質問はすべてナレッジベース（packages/knowledge）の定義から描いているので、
 * 質問を足し引きしてもこの画面は書き換えなくてよい。
 */

/** 質問定義の既定値。回答そのものとは分けて持ち、「まだ触っていない」が分かるようにする */
const DEFAULTS: Answers = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

/**
 * 既定値のままでよい質問（必須でなく、まだ触っていないもの）は最初は畳んでおく。
 * ただし図面の中身を左右する質問（分岐・件数を決めるもの）は必ず表示する。
 */
const isOptionalDetail = (q: Question, typed: Answers, key: string): boolean =>
  !q.required &&
  !DRIVER_QUESTION_IDS.has(q.id) &&
  q.defaultValue !== undefined &&
  typed[key] === undefined;

export function App() {
  const [tab, setTab] = useState<'hearing' | 'drawing'>('hearing');
  return <Shell tab={tab} setTab={setTab} />;
}

function Shell({ tab, setTab }: { tab: 'hearing' | 'drawing'; setTab: (t: 'hearing' | 'drawing') => void }) {
  /** 利用者が実際に入力した回答だけを持つ */
  const [answers, setAnswers] = useState<Answers>({});
  const [showAll, setShowAll] = useState(false);
  /** AIがスケッチ画像から判定できた質問（いまは手動で切り替えて挙動を確かめる） */
  const [aiAssist, setAiAssist] = useState(false);

  const resolvedByAi = useMemo(
    () => (aiAssist ? new Set(QUESTIONS.filter((q) => q.ask === 'ai-uncertain').map((q) => q.id)) : new Set<string>()),
    [aiAssist],
  );

  /** 既定値を下敷きにした、実際に効いている回答 */
  const effective = useMemo<Answers>(() => ({ ...DEFAULTS, ...answers }), [answers]);

  const visible = useMemo(() => visibleQuestions(effective, { resolvedByAi }), [effective, resolvedByAi]);

  const set = (key: string, value: Value) =>
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  /** グループごとに、繰り返し件数を考慮した実際の入力欄を組み立てる */
  const sections = QUESTION_GROUPS.map((group) => {
    const groupQuestions = visible.filter((q) => q.group === group.id);
    if (groupQuestions.length === 0) return null;

    const countKey = group.repeatCountKey;
    const count = countKey ? Math.max(1, Number(effective[countKey] ?? 1)) : 1;

    // 件数そのものを聞く質問は繰り返さない
    const countQuestion = countKey ? groupQuestions.find((q) => q.id === countKey) : undefined;
    const repeated = groupQuestions.filter((q) => q.id !== countKey);

    const rows: { key: string; question?: Question; heading?: string }[] = [];
    if (countQuestion) rows.push({ key: countQuestion.id, question: countQuestion });
    for (let i = 0; i < count; i++) {
      if (count > 1) rows.push({ key: `${group.id}-head-${i}`, heading: `${group.label} ${i + 1}件目` });
      for (const q of repeated) {
        const key = indexedKey(q.id, i);
        // 2件目以降も表示条件はその件の回答で判定する
        if (i > 0 && !evaluate(q.showIf, { ...effective, ...pick(effective, i) })) continue;
        rows.push({ key, question: q });
      }
    }

    const shown = rows.filter((r) => !r.question || showAll || !isOptionalDetail(r.question, answers, r.key));
    const hiddenCount = rows.length - shown.length;
    const answered = rows.filter((r) => r.question && effective[r.key] !== undefined).length;
    const total = rows.filter((r) => r.question).length;
    const need = rows.some((r) => r.question?.required && effective[r.key] === undefined);

    return { group, rows: shown, hiddenCount, answered, total, need };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <>
      <div className="tabbar">
        <strong>単線結線図作成</strong>
        <button type="button" aria-pressed={tab === 'hearing'} onClick={() => setTab('hearing')}>
          事前ヒアリング
        </button>
        <button type="button" aria-pressed={tab === 'drawing'} onClick={() => setTab('drawing')}>
          図面
        </button>
      </div>
      {tab === 'drawing' ? (
        <Editor answers={effective} />
      ) : (
    <div className="app">
      <nav className="nav">
        <h1>事前ヒアリング</h1>
        <p className="sub">
          全{QUESTIONS.length}問のうち、いまの回答で{visible.length}問が対象
        </p>
        {sections.map((s) => (
          <a key={s.group.id} href={`#g-${s.group.id}`} className={s.need ? 'need' : s.answered === s.total ? 'done' : ''}>
            <span>{s.group.label}</span>
            <span className="count">
              {s.answered}/{s.total}
            </span>
          </a>
        ))}
      </nav>

      <main className="form">
        <div className="form-head">
          <h2>新規プロジェクト</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="toggle">
              <input type="checkbox" checked={aiAssist} onChange={(e) => setAiAssist(e.target.checked)} />
              スケッチから判定できた質問を隠す
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              既定値のままでよい質問も表示
            </label>
          </div>
        </div>

        {sections.map((s) => (
          <section className="group" id={`g-${s.group.id}`} key={s.group.id}>
            <header>
              <h3>{s.group.label}</h3>
              {s.group.description && <span className="desc">{s.group.description}</span>}
              <span className="badge">
                {s.answered}/{s.total}
              </span>
            </header>
            <div className="fields">
              {s.rows.map((r) =>
                r.heading ? (
                  <p className="repeat-head" key={r.key}>
                    {r.heading}
                  </p>
                ) : (
                  <Field key={r.key} question={r.question!} fieldKey={r.key} value={answers[r.key]} onChange={set} />
                ),
              )}
            </div>
            {s.hiddenCount > 0 && (
              <p className="hidden-note">
                既定値のままでよい質問を{s.hiddenCount}件隠しています。変える場合は右上の「既定値のままでよい質問も表示」を入れてください。
              </p>
            )}
          </section>
        ))}
      </main>

      <CompositionPreview answers={effective} />
    </div>
      )}
    </>
  );
}

/** n件目の回答だけを取り出す（表示条件の判定に使う） */
function pick(answers: Answers, index: number): Answers {
  const suffix = `__${index + 1}`;
  const out: Answers = {};
  for (const [k, v] of Object.entries(answers)) {
    if (k.endsWith(suffix)) out[k.slice(0, -suffix.length)] = v;
  }
  return out;
}
