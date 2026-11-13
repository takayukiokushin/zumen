import { useMemo, useState } from 'react';
import { areaCountOf, countOf, maxCountOf, areaKey, areaView, dropHiddenChoices, evaluate, indexedKey, inputNotices, linkFromOf, QUESTION_GROUPS, QUESTIONS, viewAt, visibleQuestions } from '@zumen/knowledge';
import type { Answers, Question, QuestionGroup, Value } from '@zumen/knowledge';
import { Field } from './Field.tsx';
import { useT, useTx } from './i18n/useT.ts';
import { useTrends } from './trends.ts';

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
  const t = useT();
  const tx = useTx();
  /** 過去の案件の傾向（参考表示）。同じ受電の形の案件で数える */
  const trends = useTrends(typeof effective.sourceType === 'string' ? effective.sourceType : undefined);
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
    // 件数の一覧に「0」がある項目（VT・CTの組数など）は、0件のとき、入力欄を1つも出さない
    const zeroOk = countKey ? (QUESTIONS.find((q) => q.id === countKey)?.options ?? []).some((o) => o.value === '0') : false;
    const count = countKey ? countOf(view[countKey], zeroOk ? 0 : 1, maxCountOf(countKey)) : 1;
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
      // 表示条件も件ごとに見る（他の件の答えは引き継がない）。
      // 1台目の答えで出ている質問の中から選ぶと、「1台目はPCなし・2台目だけPCあり」のとき、2台目のPCの定格が出なくなるので、
      // 2台目以降は、その件の答えで、出す質問を決め直す
      const unitQuestions =
        i === 0
          ? repeated
          : visibleQuestions(viewAt(view, i), { resolvedByAi }).filter((q) => q.group === group.id && q.id !== countKey && !q.shared);
      for (const q of unitQuestions) {
        rows.push({ key: keyOf(q.id, i), question: q, unit: i, area });
      }
      if (rows.length === 0) continue;
      blocks.push({
        index: i,
        heading: count > 1 ? t('hearing.nth', { n: i + 1, unit: tx(group.repeatUnit ?? '件', 'nth') }) : null,
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
      // 図面は、そのまま描く。直したほうがよいところを、入力画面で知らせる
      notices: inputNotices(view).filter((n) => n.group === group.id).map((n) => n.text),
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
        // 「エリア間の接続」（分岐する位置・ケーブル・送り出す側の開閉器）は、送り先のエリアの答えだが、
        // 入力画面では、送り出す側のエリアの欄に、送り先ごとの一塊として出す（第13弾 項目22）
        const groups = QUESTION_GROUPS.filter((g) => g.perArea && g.id !== 'link')
          .map((g) => buildSection(g, n))
          .filter((x): x is Section => x !== null);
        const linkGroup = QUESTION_GROUPS.find((g) => g.id === 'link')!;
        const dests = Array.from({ length: Math.max(0, areas - n - 1) }, (_, k) => {
          const to = n + 1 + k;
          const parent = linkFromOf(views[to]!, to);
          const sec = buildSection(linkGroup, to);
          const rows = (sec?.blocks.flatMap((b) => b.rows) ?? []).filter((r) => r.question.id !== 'linkFrom');
          return { to, parent, owned: parent === n, rows, notices: sec?.notices ?? [] };
        });
        // 受ける側の欄に出す、読み取り専用の1行（どこから送られてくるか）
        const from = n >= 1 ? linkFromOf(views[n]!, n) : -1;
        void view;
        const all = [...areaRows, ...groups.flatMap((g) => [...g.lead, ...g.blocks.flatMap((b) => b.rows)]), ...dests.filter((d) => d.owned).flatMap((d) => d.rows)];
        return {
          index: n,
          areaRows,
          groups,
          dests,
          from,
          answered: all.filter((r) => effective[r.key] !== undefined).length,
          total: all.length,
          need: all.some((r) => r.question.required && effective[r.key] === undefined),
        };
      })
    : [];
  const totalQuestions = visible.length + areaBlocks.slice(1).reduce((a, b) => a + b.total, 0);

  /**
   * 入力欄1つ。選択肢を絞る条件は、そのエリア・その件の答えで見る。
   * 「その件の答え」は、同じ件の入力欄どうしで同じなので、この描き直しの間は、1回だけ作って使い回す
   * （入力欄ごとに作ると、変圧器が100台のとき、1文字入れるたびに、何千回も作り直して、0.1秒近くかかっていた）
   */
  const unitViews = new Map<string, Answers>();
  const field = (r: Row) => {
    const cacheKey = `${r.area}:${r.unit}`;
    let context = unitViews.get(cacheKey);
    if (!context) {
      context = viewAt(views[r.area]!, r.unit);
      unitViews.set(cacheKey, context);
    }
    return <Field key={r.key} question={r.question} fieldKey={r.key} value={answers[r.key]} onChange={set} context={context} trend={trends[r.question.id]} />;
  };

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
          <h4 className="subhead">{tx(c.section)}</h4>
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
        {inner ? <h4 className="grouphead">{tx(sec.group.label)}</h4> : <h3>{tx(sec.group.label)}</h3>}
        {sec.group.description && <span className="desc">{tx(sec.group.description)}</span>}
        <span className="badge">
          {sec.answered}/{sec.total}
        </span>
      </header>
      {sec.lead.length > 0 && <div className="fields">{sec.lead.map(field)}</div>}
      {sec.notices.map((text) => (
        <p className="group-warn" role="status" key={text}>
          {tx(text)}
        </p>
      ))}

      {sec.blocks.map((b) =>
        b.heading === null ? (
          <div key={b.index}>{renderRows(b.rows)}</div>
        ) : (
          // 何台目を入力しているのかが一目で分かるよう、1件ずつ枠で囲んで交互に色を変える
          <div className={`repeat-block ${b.index % 2 ? 'alt' : ''}`} key={b.index}>
            <div className="repeat-head">
              <b>{b.heading}</b>
              <span className={b.need ? 'need' : b.answered === b.rows.length ? 'done' : ''}>
                {b.need ? t('hearing.needInput') : `${b.answered}/${b.rows.length}`}
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
          <h3>{t('hearing.areaNth', { n: ab.index + 1 })}</h3>
          <span className={ab.need ? 'need' : ab.answered === ab.total ? 'done' : ''}>
            {ab.need ? t('hearing.needInput') : `${ab.answered}/${ab.total}`}
          </span>
        </header>
        {ab.areaRows.length > 0 && <div className="fields">{ab.areaRows.map(field)}</div>}
        {ab.from >= 0 && (
          <p className="link-from">
            {t('hearing.recvFrom', { from: ab.from + 1 })}{' '}
            <a href={`#send-${ab.from + 1}-${ab.index + 1}`}>{t('hearing.recvJump', { from: ab.from + 1 })}</a>
          </p>
        )}
        {ab.groups.map((g) => renderSection(g, `g-${g.group.id}-a${ab.index + 1}`, true))}
        {ab.dests.length > 0 && (
          <section className="group inner send-group" id={`send-${ab.index + 1}`}>
            <header>
              <h4 className="grouphead">{t('hearing.sendTitle')}</h4>
              <span className="desc">{t('hearing.sendDesc')}</span>
            </header>
            {ab.dests.map((d) => (
              <div className={`repeat-block send-block${d.owned ? '' : ' off'}`} id={`send-${ab.index + 1}-${d.to + 1}`} key={d.to}>
                <div className="repeat-head">
                  <b>{t('hearing.sendNth', { n: d.to + 1 })}</b>
                  {d.to === 1 ? (
                    <span className="send-fixed">{t('hearing.sendOnly', { n: 2 })}</span>
                  ) : (
                    <label className="send-check">
                      <input
                        type="checkbox"
                        checked={d.owned}
                        // いまの送り元のチェックは外せない（ほかのエリアにチェックを入れると、そちらへ移る）
                        disabled={d.owned}
                        onChange={(e) => {
                          if (e.target.checked) set(`a${d.to + 1}:linkFrom`, String(ab.index + 1));
                        }}
                      />
                      {t('hearing.sendHere')}
                    </label>
                  )}
                </div>
                {d.owned && d.to !== 1 && <p className="send-note">{t('hearing.sendKeep')}</p>}
                {!d.owned && <p className="send-note">{t('hearing.sendOther', { from: d.parent + 1 })}</p>}
                {d.owned && d.notices.map((text) => <p className="group-warn" role="status" key={text}>{tx(text)}</p>)}
                {d.owned && renderRows(d.rows)}
              </div>
            ))}
          </section>
        )}
      </section>
    ));

  return (
    <>
      {showNav && (
      <nav className="nav">
        <h1>{t('hearing.title')}</h1>
        <p className="sub">
          {t('hearing.target', { total: QUESTIONS.length, n: totalQuestions })}
        </p>
        {sections.flatMap((s) => [
          <a
            key={s.group.id}
            href={`#g-${s.group.id}`}
            className={s.need ? 'need' : s.answered === s.total ? 'done' : ''}
          >
            <span>{tx(s.group.label)}</span>
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
                  <span>{t('hearing.areaNth', { n: ab.index + 1 })}</span>
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
          <h2>{t('hearing.items')}</h2>
          {sketchRead && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="toggle">
                <input type="checkbox" checked={aiAssist} onChange={(e) => setAiAssist(e.target.checked)} />
                {t('hearing.hideResolved')}
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
