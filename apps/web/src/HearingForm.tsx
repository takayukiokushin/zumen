import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { areaCountOf, areaRows, areaView, dropHiddenChoices, inputNotices, isUnanswered, linkFromOf, linkRows, QUESTION_GROUPS, QUESTIONS, sectionRows, viewAt, visibleQuestions } from '@zumen/knowledge';
import type { Answers, InputRow, QuestionGroup, Value } from '@zumen/knowledge';
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
  /**
   * 上から1つずつ開く表示にするか（第14弾 項目3）。白紙で始めた案件を、手で入力しているときだけ。
   * 1つの項目の必須項目をすべて入力すると、次の項目が開く。一度開いた項目は、この画面を開いているあいだは閉じない
   */
  stepwise?: boolean;
  /** 見出しの行に添えるもの（使える高さが小さい画面で、目次・いまの構成の切り替えを置く） */
  headExtra?: React.ReactNode;
  /** 「全部の項目を開く」を押したとき */
  onOpenAll?: () => void;
  /** 「図面を開く」を押したとき（すべての必須項目が終わったときの案内から） */
  onOpenDrawing?: () => void;
}

/**
 * 既定値のままでよい質問（必須でなく、まだ触っていないもの）は最初は畳んでおく。
 * ただし図面の中身を左右する質問（分岐・件数を決めるもの）は必ず表示する。
 */
type Row = InputRow;

interface Block {
  index: number;
  /** 「1台目」。繰り返しでないときは null */
  heading: string | null;
  rows: Row[];
  answered: number;
  need: boolean;
}

/** エリアの枠の色の番号（1か所目から順に5色。6か所目以降は、1か所目に戻って繰り返す）。色そのものは styles.css の --area1-line など */
export const AREA_COLOR_COUNT = 5;
const areaColorClass = (index: number) => `area-c${(index % AREA_COLOR_COUNT) + 1}`;

export function HearingForm({ answers, effective, onChange, showNav = true, sketchRead = false, stepwise = false, headExtra, onOpenAll, onOpenDrawing }: Props) {
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
  /** 行を決めるための、エリアごとの答えなど（rows.ts） */
  const rowsCtx = useMemo(() => ({ effective, areas, views, visibleByArea, resolvedByAi }), [effective, areas, views, visibleByArea, resolvedByAi]);

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
    // どの行を出すか（件数・エリア・2件目以降の出し分け）は、knowledge の rows.ts で決める。
    // 「必須が残っているか」の判断（スケッチ・音声の確認画面など）と、同じ行の並びを使うため
    const sec = sectionRows(rowsCtx, group, area, leadOnly);
    if (!sec) return null;
    const miss = (r: Row) => r.question.required && isUnanswered(effective[r.key]);

    const blocks: Block[] = sec.blocks.map((b) => ({
      index: b.index,
      heading: sec.count > 1 ? t('hearing.nth', { n: b.index + 1, unit: tx(group.repeatUnit ?? '件', 'nth') }) : null,
      rows: b.rows,
      answered: b.rows.filter((r) => effective[r.key] !== undefined).length,
      need: b.rows.some(miss),
    }));

    const all = [...sec.lead, ...blocks.flatMap((b) => b.rows)];
    return {
      group,
      lead: sec.lead,
      blocks,
      // 図面は、そのまま描く。直したほうがよいところを、入力画面で知らせる
      notices: inputNotices(view, effective).filter((n) => n.group === group.id).map((n) => n.text),
      answered: all.filter((r) => effective[r.key] !== undefined).length,
      total: all.length,
      need: all.some(miss),
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
        // 受電設備エリアの質問（形態・設置場所…）は、「か所目」ごとの答え
        const areaRowList = areaRows(rowsCtx, n);
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
          const rows = linkRows(rowsCtx, to);
          return { to, parent, owned: parent === n, rows, notices: sec?.notices ?? [] };
        });
        // 受ける側の欄に出す、読み取り専用の1行（どこから送られてくるか）
        const from = n >= 1 ? linkFromOf(views[n]!, n) : -1;
        const all = [...areaRowList, ...groups.flatMap((g) => [...g.lead, ...g.blocks.flatMap((b) => b.rows)]), ...dests.filter((d) => d.owned).flatMap((d) => d.rows)];
        const miss = (r: Row) => r.question.required && isUnanswered(effective[r.key]);
        return {
          index: n,
          areaRows: areaRowList,
          groups,
          dests,
          from,
          // 1つずつ開くときの、小さな段ごとの「入力が残っているか」
          areaNeed: areaRowList.some(miss),
          sendNeed: dests.filter((d) => d.owned).some((d) => d.rows.some(miss)),
          answered: all.filter((r) => effective[r.key] !== undefined).length,
          total: all.length,
          need: all.some(miss),
        };
      })
    : [];
  const totalQuestions = visible.length + areaBlocks.slice(1).reduce((a, b) => a + b.total, 0);

  /**
   * 上から1つずつ開く表示（第14弾 項目3）。画面に出る順に、「段」を並べる。
   * 段の中の必須項目（「必須」の印のもの）がすべて入ると、次の段が開く。必須が1つも無い段は、すぐ次へ進む。
   */
  const steps: { id: string; need: boolean; label: string }[] = [];
  /** ほかのグループの段と一緒に開くグループ（stepWith）の、グループの段の id → 先頭の段の id */
  const stepAlias = new Map<string, string>();
  /** グループの段を足す。stepWith のあるグループ（特殊設備の細かい入力の枠）は、先頭の段にまとめ、必須が残っているかも、先頭の段で見る */
  const pushGroupStep = (g: Section, suffix: string) => {
    const id = `g-${g.group.id}${suffix}`;
    const lead = g.group.stepWith ? steps.find((x) => x.id === `g-${g.group.stepWith}${suffix}`) : undefined;
    if (lead) {
      lead.need = lead.need || g.need;
      stepAlias.set(id, lead.id);
    } else steps.push({ id, need: g.need, label: g.group.label });
  };
  for (const sec of sections) {
    pushGroupStep(sec, '');
    if (sec.group.id === 'area') {
      for (const ab of areaBlocks) {
        steps.push({ id: `area-${ab.index + 1}`, need: ab.areaNeed, label: t('hearing.areaNth', { n: ab.index + 1 }) });
        for (const g of ab.groups) pushGroupStep(g, `-a${ab.index + 1}`);
        if (ab.dests.length > 0) steps.push({ id: `send-${ab.index + 1}`, need: ab.sendNeed, label: 'hearing.sendTitle' });
      }
    }
  }
  const firstNeed = steps.findIndex((x) => x.need);
  const lastOpen = firstNeed === -1 ? steps.length - 1 : firstNeed;
  const allDone = firstNeed === -1;
  /** 一度開いた段は、この画面を開いているあいだは、閉じない（前の段の答えを変えても、入力中のものが消えないように） */
  const opened = useRef(new Set<string>());
  if (stepwise) for (let i = 0; i <= lastOpen; i++) opened.current.add(steps[i]!.id);
  const isOpen = (id: string) => !stepwise || opened.current.has(stepAlias.get(id) ?? id);
  const stepName = (x: { label: string }) => (x.label === 'hearing.sendTitle' ? t('hearing.sendTitle') : tx(x.label));
  /** まだ開いていない段を押したときの知らせ */
  const [lockedHint, setLockedHint] = useState<string | null>(null);
  const currentId = steps[lastOpen]?.id;
  useEffect(() => setLockedHint(null), [currentId]);
  /**
   * 下の余白（第17弾 項目4）。次の段は、いま入力している段の下に開くので、画面の下の外に出てしまい、見えない。
   * そこで、入力の途中だけ、いちばん下に余白を足して、いま入力している段（内容のいちばん下）が、画面の真ん中あたりまで、
   * 上へスクロールできるようにする。画面は、自動では動かさない（余白を足すだけ）。
   * 余白の大きさは、スクロールする枠の高さの半分から、もとからある下の余白を引いたもの（画面の高さ・設定の大きさが変わると、そのたびに計算し直す）。
   * 最後まで入力し終わったとき（完了の案内が出たとき）と、全部の欄を開いているときは、足さない。
   */
  const formRef = useRef<HTMLElement>(null);
  const [padH, setPadH] = useState(0);
  const wantPad = stepwise && !allDone;
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form || !wantPad) {
      setPadH(0);
      return;
    }
    // スクロールするのは、ふつうは入力欄の枠。幅の狭い画面では、その外側（全体）
    const scroller = (): HTMLElement => (/(auto|scroll)/.test(getComputedStyle(form).overflowY) ? form : (form.closest<HTMLElement>('.app') ?? form));
    // 枠の高さの半分から、入力欄の枠の、もとからある下の余白を引く（内容のいちばん下が、ちょうど真ん中に来る）
    const measure = () => setPadH(Math.max(0, Math.round(scroller().clientHeight / 2 - (parseFloat(getComputedStyle(form).paddingBottom) || 0))));
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(scroller());
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wantPad]);
  const pressLocked = (label: string) => {
    setLockedHint(label);
    if (currentId) document.getElementById(currentId)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

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
  const renderSection = (sec: Section, id: string, inner = false) => !isOpen(id) ? null : (
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
    areaBlocks.filter((ab) => isOpen(`area-${ab.index + 1}`)).map((ab) => (
      <section className={`area-block ${areaColorClass(ab.index)}`} id={`area-${ab.index + 1}`} key={`area-${ab.index}`}>
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
        {ab.dests.length > 0 && isOpen(`send-${ab.index + 1}`) && (
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
          isOpen(`g-${s.group.id}`) ? (
            <a
              key={s.group.id}
              href={`#g-${s.group.id}`}
              className={s.need ? 'need' : s.answered === s.total ? 'done' : ''}
            >
              <span>{tx(s.group.label)}</span>
              <span className="count">
                {s.answered}/{s.total}
              </span>
            </a>
          ) : (
            // まだ開いていない段（1つずつ開く表示のとき）。押すと、いま入力する段へ移って、知らせを出す
            <a
              key={s.group.id}
              href="#"
              className="locked"
              aria-disabled="true"
              onClick={(e) => {
                e.preventDefault();
                pressLocked(tx(s.group.label));
              }}
            >
              <span>{tx(s.group.label)}</span>
              <span className="count">🔒</span>
            </a>
          ),
          ...(s.group.id === 'area'
            ? areaBlocks.map((ab) =>
                isOpen(`area-${ab.index + 1}`) ? (
                  <a
                    key={`area-${ab.index}`}
                    href={`#area-${ab.index + 1}`}
                    className={`sub-link ${areaColorClass(ab.index)} ${ab.need ? 'need' : ab.answered === ab.total ? 'done' : ''}`}
                  >
                    <span>{t('hearing.areaNth', { n: ab.index + 1 })}</span>
                    <span className="count">
                      {ab.answered}/{ab.total}
                    </span>
                  </a>
                ) : (
                  <a
                    key={`area-${ab.index}`}
                    href="#"
                    className="sub-link locked"
                    aria-disabled="true"
                    onClick={(e) => {
                      e.preventDefault();
                      pressLocked(t('hearing.areaNth', { n: ab.index + 1 }));
                    }}
                  >
                    <span>{t('hearing.areaNth', { n: ab.index + 1 })}</span>
                    <span className="count">🔒</span>
                  </a>
                ),
              )
            : []),
        ])}
      </nav>
      )}

      <main className="form" ref={formRef}>
        <div className="form-head">
          <h2>{t('hearing.items')}</h2>
          {headExtra && <div className="panel-toggles">{headExtra}</div>}
          {stepwise && onOpenAll && (
            <button type="button" className="btn" title={t('hearing.stepOpenAllNote')} onClick={onOpenAll}>
              {t('hearing.stepOpenAll')}
            </button>
          )}
          {sketchRead && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="toggle">
                <input type="checkbox" checked={aiAssist} onChange={(e) => setAiAssist(e.target.checked)} />
                {t('hearing.hideResolved')}
              </label>
            </div>
          )}
        </div>

        {stepwise && lockedHint && (
          <p className="step-hint" role="status">
            {t('hearing.stepLocked', { name: lockedHint })}
            <button type="button" className="link-btn" onClick={() => setLockedHint(null)} aria-label={t('common.close')}>
              ×
            </button>
          </p>
        )}
        {sections.flatMap((s) => [
          // すべての必須項目が終わったら、いちばん下の表題欄の上に、案内を出す
          ...(stepwise && allDone && s.group.id === 'title'
            ? [
                <p className="step-done" role="status" key="step-done">
                  {t('hearing.stepDone')}{' '}
                  {onOpenDrawing && (
                    <button type="button" className="btn" onClick={onOpenDrawing}>
                      {t('hearing.stepOpenDrawing')}
                    </button>
                  )}
                </p>,
              ]
            : []),
          renderSection(s, `g-${s.group.id}`),
          ...(s.group.id === 'area' ? renderAreaBlocks() : []),
        ])}
        {stepwise && !allDone && steps.some((x) => !isOpen(x.id)) && (
          <p className="step-later">{t('hearing.stepLater', { list: steps.filter((x) => !isOpen(x.id)).map(stepName).join(' → ') })}</p>
        )}
        {wantPad && <div className="step-pad" style={{ height: padH }} aria-hidden="true" />}
      </main>
    </>
  );
}
