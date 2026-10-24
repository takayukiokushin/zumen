import { useMemo, useState } from 'react';
import { evaluate, indexedKey, QUESTION_GROUPS, QUESTIONS, viewAt, visibleQuestions } from '@zumen/knowledge';
import type { Answers, Question, Value } from '@zumen/knowledge';
import { Field } from './Field.tsx';

/**
 * 事前ヒアリングのフォーム。
 * 質問はすべてナレッジベースの定義から描いているので、質問を足し引きしても
 * この画面を書き換えなくてよい。
 */

interface Props {
  /** 利用者が実際に入力した回答 */
  answers: Answers;
  /** 既定値を下敷きにした、実際に効いている回答 */
  effective: Answers;
  onChange: (next: (prev: Answers) => Answers) => void;
  /** 左の目次を出すか（㉖） */
  showNav?: boolean;
}

/**
 * 既定値のままでよい質問（必須でなく、まだ触っていないもの）は最初は畳んでおく。
 * ただし図面の中身を左右する質問（分岐・件数を決めるもの）は必ず表示する。
 */
interface Row {
  key: string;
  question: Question;
}

interface Block {
  index: number;
  /** 「1台目」。繰り返しでないときは null */
  heading: string | null;
  rows: Row[];
  answered: number;
  need: boolean;
}

export function HearingForm({ answers, effective, onChange, showNav = true }: Props) {
  /** スケッチから読み取れた前提で、質問がどれだけ減るかを確かめる切り替え */
  const [aiAssist, setAiAssist] = useState(false);

  const resolvedByAi = useMemo(
    () => (aiAssist ? new Set(QUESTIONS.filter((q) => q.ask === 'ai-uncertain').map((q) => q.id)) : new Set<string>()),
    [aiAssist],
  );
  const visible = useMemo(() => visibleQuestions(effective, { resolvedByAi }), [effective, resolvedByAi]);

  const set = (key: string, value: Value) =>
    onChange((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const sections = QUESTION_GROUPS.map((group) => {
    const groupQuestions = visible.filter((q) => q.group === group.id);
    if (groupQuestions.length === 0) return null;

    const countKey = group.repeatCountKey;
    const count = countKey ? Math.max(1, Number(effective[countKey] ?? 1)) : 1;
    // 件数そのものと、件数に関わらず1回だけ聞く質問は、繰り返しの外に出す
    const leading = groupQuestions.filter((q) => q.id === countKey || q.shared);
    const repeated = groupQuestions.filter((q) => q.id !== countKey && !q.shared);

    // 質問は畳まず、対象になったものは全部出す。
    // 隠れている項目に気づかないまま入力漏れになるほうが困るため
    const lead: Row[] = leading.map((q) => ({ key: q.id, question: q }));

    /** 1台目・2台目…のまとまり。count が1なら見出しの無い1つだけ */
    const blocks: Block[] = [];
    for (let i = 0; i < count; i++) {
      const rows: Row[] = [];
      for (const q of repeated) {
        // 表示条件も件ごとに見る（他の件の答えは引き継がない）
        if (i > 0 && !evaluate(q.showIf, viewAt(effective, i))) continue;
        rows.push({ key: indexedKey(q.id, i), question: q });
      }
      if (rows.length === 0) continue;
      blocks.push({
        index: i,
        heading: count > 1 ? `${i + 1}${group.repeatUnit ?? '件'}目` : null,
        rows,
        answered: rows.filter((r) => effective[r.key] !== undefined).length,
        need: rows.some((r) => r.question.required && effective[r.key] === undefined),
      });
    }

    const all = [...lead, ...blocks.flatMap((b) => b.rows)];
    return {
      group,
      lead,
      blocks,
      answered: all.filter((r) => effective[r.key] !== undefined).length,
      total: all.length,
      need: all.some((r) => r.question.required && effective[r.key] === undefined),
    };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <>
      {showNav && (
      <nav className="nav">
        <h1>事前ヒアリング</h1>
        <p className="sub">
          全{QUESTIONS.length}問のうち、いまの回答で{visible.length}問が対象
        </p>
        {sections.map((s) => (
          <a
            key={s.group.id}
            href={`#g-${s.group.id}`}
            className={s.need ? 'need' : s.answered === s.total ? 'done' : ''}
          >
            <span>{s.group.label}</span>
            <span className="count">
              {s.answered}/{s.total}
            </span>
          </a>
        ))}
      </nav>
      )}

      <main className="form">
        <div className="form-head">
          <h2>ヒアリング項目</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="toggle">
              <input type="checkbox" checked={aiAssist} onChange={(e) => setAiAssist(e.target.checked)} />
              スケッチから判定できた質問を隠す
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
            {s.lead.length > 0 && (
              <div className="fields">
                {s.lead.map((r) => (
                  <Field key={r.key} question={r.question} fieldKey={r.key} value={answers[r.key]} onChange={set} />
                ))}
              </div>
            )}

            {s.blocks.map((b) =>
              b.heading === null ? (
                <div className="fields" key={b.index}>
                  {b.rows.map((r) => (
                    <Field key={r.key} question={r.question} fieldKey={r.key} value={answers[r.key]} onChange={set} />
                  ))}
                </div>
              ) : (
                // 何台目を入力しているのかが一目で分かるよう、1件ずつ枠で囲んで交互に色を変える
                <div className={`repeat-block ${b.index % 2 ? 'alt' : ''}`} key={b.index}>
                  <div className="repeat-head">
                    <b>{b.heading}</b>
                    <span className={b.need ? 'need' : b.answered === b.rows.length ? 'done' : ''}>
                      {b.need ? '未入力あり' : `${b.answered}/${b.rows.length}`}
                    </span>
                  </div>
                  <div className="fields">
                    {b.rows.map((r) => (
                      <Field key={r.key} question={r.question} fieldKey={r.key} value={answers[r.key]} onChange={set} />
                    ))}
                  </div>
                </div>
              ),
            )}
          </section>
        ))}
      </main>
    </>
  );
}
