import { useMemo, useState } from 'react';
import { areaCountOf, areaKey, areaView, dropHiddenChoices, evaluate, indexedKey, QUESTION_GROUPS, QUESTIONS, viewAt, visibleQuestions } from '@zumen/knowledge';
import type { Answers, Question, QuestionGroup, Value } from '@zumen/knowledge';
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
  /** この案件で、スケッチの読み取りを行ったか。行っていないときは、「スケッチから判定できた質問を隠す」を出さない */
  sketchRead?: boolean;
}

/**
 * 既定値のままでよい質問（必須でなく、まだ触っていないもの）は最初は畳んでおく。
 * ただし図面の中身を左右する質問（分岐・件数を決めるもの）は必ず表示する。
 */
interface Row {
  key: string;
  question: Question;
  /** 繰り返しの何件目か（0始まり）。選択肢を絞る条件を、その件の答えで見るのに使う */
  unit: number;
  /** どのエリアの答えか（0始まり。1か所目と、エリア全体で1つの質問は0） */
  area: number;
}

interface Block {
  index: number;
  /** 「1台目」。繰り返しでないときは null */
  heading: string | null;
  rows: Row[];
  answered: number;
  need: boolean;
}

export function HearingForm({ answers, effective, onChange, showNav = true, sketchRead = false }: Props) {
  /** スケッチから読み取れた前提で、質問がどれだけ減るかを確かめる切り替え */
  const [aiAssist, setAiAssist] = useState(false);

  // スケッチを読み取っていないときは、切り替えそのものを出さないので、隠す質問も無い
  const resolvedByAi = useMemo(
    () => (aiAssist && sketchRead ? new Set(QUESTIONS.filter((q) => q.ask === 'ai-uncertain').map((q) => q.id)) : new Set<string>()),
    [aiAssist, sketchRead],
  );
  /** 受電設備エリアの数。2か所以上のときは、「受電設備の構成」以降を、エリアごとのブロックにする */
  const areas = areaCountOf(effective);
  const splitByArea = areas >= 2;
  /** エリアごとの答え（1か所目はそのまま。2か所目以降は、そのエリアの答えだけ） */
  const views = useMemo(() => Array.from({ length: areas }, (_, n) => areaView(effective, n)), [effective, areas]);
  const visibleByArea = useMemo(
    () => views.map((v) => visibleQuestions(v, { resolvedByAi })),
    [views, resolvedByAi],
  );
  const visible = visibleByArea[0]!;

  const set = (key: string, value: Value) =>
    onChange((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      // 答えを変えたせいで、選んでいた選択肢が一覧に出なくなったら、空に戻す
      // （例：結線方式に三相を選んであるのに、用途を「電灯」に変えた）
      return dropHiddenChoices(next);
    });

  /**
   * グループ1つぶんの入力欄を組み立てる。
   * area：どのエリアの答えか（0＝1か所目）。2か所目以降は、保存のキーに「a2:」などが付く。
   */
  const buildSection = (group: QuestionGroup, area: number, leadOnly = false) => {
    const view = views[area]!;
    const groupQuestions = visibleByArea[area]!.filter((q) => q.group === group.id);
    if (groupQuestions.length === 0) return null;
    const keyOf = (id: string, unit: number) => (group.perArea ? areaKey(indexedKey(id, unit), area) : indexedKey(id, unit));

    const countKey = group.repeatCountKey;
    const count = countKey ? Math.max(1, Number(view[countKey] ?? 1)) : 1;
    // 件数そのものと、件数に関わらず1回だけ聞く質問は、繰り返しの外に出す
    const leading = groupQuestions.filter((q) => q.id === countKey || q.shared);
    const repeated = leadOnly ? [] : groupQuestions.filter((q) => q.id !== countKey && !q.shared);

    // 質問は畳まず、対象になったものは全部出す。
    // 隠れている項目に気づかないまま入力漏れになるほうが困るため
    const lead: Row[] = leading.map((q) => ({ key: keyOf(q.id, 0), question: q, unit: 0, area }));

    /** 1台目・2台目…のまとまり。count が1なら見出しの無い1つだけ */
    const blocks: Block[] = [];
    for (let i = 0; i < count && !leadOnly; i++) {
      const rows: Row[] = [];
      for (const q of repeated) {
        // 表示条件も件ごとに見る（他の件の答えは引き継がない）
        if (i > 0 && !evaluate(q.showIf, viewAt(view, i))) continue;
        rows.push({ key: keyOf(q.id, i), question: q, unit: i, area });
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
  };
  type Section = NonNullable<ReturnType<typeof buildSection>>;

  // 通常のグループ。エリアが2か所以上のときは、エリアごとのグループは、下のエリアのブロックの中で出す。
  // 受電設備エリアのグループも、件数の質問だけここに残し、「か所目」ごとの入力はブロックの中に移す
  const sections = QUESTION_GROUPS.filter((g) => !(splitByArea && g.perArea))
    .map((g) => buildSection(g, 0, splitByArea && g.id === 'area'))
    .filter((x): x is Section => x !== null);

  /** エリアごとのブロック（2か所以上のとき）。エリア自体の質問（形態・設置場所など）と、エリアごとのグループ */
  const areaBlocks = splitByArea
    ? Array.from({ length: areas }, (_, n) => {
        const view = views[n]!;
        // 受電設備エリアの質問（形態・設置場所…）は、「か所目」ごとの答え
        const areaGroup = QUESTION_GROUPS.find((g) => g.id === 'area')!;
        // （2か所目以降だけに出す質問があるので、2か所目以降は、1か所目で出ている質問からではなく、全部の質問から選ぶ）
        const areaRows: Row[] = (n === 0 ? visibleByArea[0]! : QUESTIONS)
          .filter((q) => q.group === 'area' && q.id !== areaGroup.repeatCountKey)
          .filter((q) => n === 0 || evaluate(q.showIf, viewAt(effective, n)))
          .map((q) => ({ key: indexedKey(q.id, n), question: q, unit: n, area: 0 }));
        const groups = QUESTION_GROUPS.filter((g) => g.perArea)
          .map((g) => buildSection(g, n))
          .filter((x): x is Section => x !== null);
        void view;
        const all = [...areaRows, ...groups.flatMap((g) => [...g.lead, ...g.blocks.flatMap((b) => b.rows)])];
        return {
          index: n,
          areaRows,
          groups,
          answered: all.filter((r) => effective[r.key] !== undefined).length,
          total: all.length,
          need: all.some((r) => r.question.required && effective[r.key] === undefined),
        };
      })
    : [];
  const totalQuestions = visible.length + areaBlocks.slice(1).reduce((a, b) => a + b.total, 0);

  /** 入力欄1つ。選択肢を絞る条件は、そのエリア・その件の答えで見る */
  const field = (r: Row) => (
    <Field key={r.key} question={r.question} fieldKey={r.key} value={answers[r.key]} onChange={set} context={viewAt(views[r.area]!, r.unit)} />
  );

  /**
   * 質問の並びを描く。質問に section（小見出し）が付いているものは、同じ名前が続くところを1つの「行」にまとめて、
   * 見出しを付ける（例：受電設備の構成の、VT・CT・LBSなど）。見出しの無いものは、これまでどおり並べる。
   */
  const renderRows = (rows: Row[]) => {
    const chunks: { section?: string; rows: Row[] }[] = [];
    for (const r of rows) {
      const last = chunks.at(-1);
      if (last && last.section === r.question.section) last.rows.push(r);
      else chunks.push({ section: r.question.section, rows: [r] });
    }
    const fields = (list: Row[]) => <div className="fields">{list.map(field)}</div>;
    return chunks.map((c, i) =>
      c.section ? (
        <div className="subgroup" key={`${c.section}-${i}`}>
          <h4 className="subhead">{c.section}</h4>
          {fields(c.rows)}
        </div>
      ) : (
        <div key={`plain-${i}`}>{fields(c.rows)}</div>
      ),
    );
  };

  /** グループ1つぶん（見出し・件数の質問・件ごとのまとまり）を描く。inner：エリアのブロックの中か */
  const renderSection = (sec: Section, id: string, inner = false) => (
    <section className={`group${inner ? ' inner' : ''}`} id={id} key={id}>
      <header>
        {inner ? <h4 className="grouphead">{sec.group.label}</h4> : <h3>{sec.group.label}</h3>}
        {sec.group.description && <span className="desc">{sec.group.description}</span>}
        <span className="badge">
          {sec.answered}/{sec.total}
        </span>
      </header>
      {sec.lead.length > 0 && <div className="fields">{sec.lead.map(field)}</div>}

      {sec.blocks.map((b) =>
        b.heading === null ? (
          <div key={b.index}>{renderRows(b.rows)}</div>
        ) : (
          // 何台目を入力しているのかが一目で分かるよう、1件ずつ枠で囲んで交互に色を変える
          <div className={`repeat-block ${b.index % 2 ? 'alt' : ''}`} key={b.index}>
            <div className="repeat-head">
              <b>{b.heading}</b>
              <span className={b.need ? 'need' : b.answered === b.rows.length ? 'done' : ''}>
                {b.need ? '未入力あり' : `${b.answered}/${b.rows.length}`}
              </span>
            </div>
            {renderRows(b.rows)}
          </div>
        ),
      )}
    </section>
  );

  /** エリアのブロック（2か所以上のとき）を、受電設備エリアのグループの直後に出す */
  const renderAreaBlocks = () =>
    areaBlocks.map((ab) => (
      <section className="area-block" id={`area-${ab.index + 1}`} key={`area-${ab.index}`}>
        <header className="area-head">
          <h3>{ab.index + 1}か所目のエリア</h3>
          <span className={ab.need ? 'need' : ab.answered === ab.total ? 'done' : ''}>
            {ab.need ? '未入力あり' : `${ab.answered}/${ab.total}`}
          </span>
        </header>
        {ab.areaRows.length > 0 && <div className="fields">{ab.areaRows.map(field)}</div>}
        {ab.groups.map((g) => renderSection(g, `g-${g.group.id}-a${ab.index + 1}`, true))}
      </section>
    ));

  return (
    <>
      {showNav && (
      <nav className="nav">
        <h1>事前ヒアリング</h1>
        <p className="sub">
          全{QUESTIONS.length}問のうち、いまの回答で{totalQuestions}問が対象
        </p>
        {sections.flatMap((s) => [
          <a
            key={s.group.id}
            href={`#g-${s.group.id}`}
            className={s.need ? 'need' : s.answered === s.total ? 'done' : ''}
          >
            <span>{s.group.label}</span>
            <span className="count">
              {s.answered}/{s.total}
            </span>
          </a>,
          ...(s.group.id === 'area'
            ? areaBlocks.map((ab) => (
                <a
                  key={`area-${ab.index}`}
                  href={`#area-${ab.index + 1}`}
                  className={`sub-link ${ab.need ? 'need' : ab.answered === ab.total ? 'done' : ''}`}
                >
                  <span>{ab.index + 1}か所目のエリア</span>
                  <span className="count">
                    {ab.answered}/{ab.total}
                  </span>
                </a>
              ))
            : []),
        ])}
      </nav>
      )}

      <main className="form">
        <div className="form-head">
          <h2>ヒアリング項目</h2>
          {sketchRead && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="toggle">
                <input type="checkbox" checked={aiAssist} onChange={(e) => setAiAssist(e.target.checked)} />
                スケッチから判定できた質問を隠す
              </label>
            </div>
          )}
        </div>

        {sections.flatMap((s) => [
          renderSection(s, `g-${s.group.id}`),
          ...(s.group.id === 'area' ? renderAreaBlocks() : []),
        ])}
      </main>
    </>
  );
}
