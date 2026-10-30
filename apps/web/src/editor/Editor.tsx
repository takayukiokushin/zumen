import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABEL, SYMBOLS, getSymbol, labelFields, symbolToSvg } from '@zumen/symbols';
import type { SymbolCategory } from '@zumen/symbols';
import { COMPANY_NAME, SHEET_MARGIN, layout, layoutTitle, sheetSize } from '@zumen/layout';
import type { Orientation, PaperSize } from '@zumen/layout';
import { buildComposition, resolveDrawingName } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { DrawingCanvas } from './DrawingCanvas.tsx';
import { useT } from '../i18n/useT.ts';
import { buildSheetSvg } from './exportSheet.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { UndoIcon, ZoomIcon } from '../icons.tsx';
import { ISSUE_LABEL, tidyDrawing } from './inspect.ts';
import type { Issue } from './inspect.ts';
import type { Doc, DocSymbol } from './doc.ts';
import { addSymbol, addText, addWire, digest, docBounds, fromLayout, moveItem, moveWireEnd, removeItem, replaceSymbol, resetLabelFromFields, setLabel, setLabelValue, tidyDoc } from './doc.ts';

/** 操作を戻す／進めるための履歴 */
interface History {
  past: Doc[];
  present: Doc;
  future: Doc[];
}

const commit = (h: History, next: Doc): History => ({ past: [...h.past, h.present], present: next, future: [] });
/** 矢印キーで1回に動かす距離（図面の座標。格子の間隔 2 の倍数） */
const ARROW_STEP = 4;
/** Shift キーを押しながら矢印キーを押したときは、この倍数だけ大きく動かす */
const ARROW_SHIFT_TIMES = 5;
/** 矢印キーを、この時間（ミリ秒）以内に続けて押したら、1回の操作にまとめる */
const ARROW_MERGE_MS = 800;
const ARROW_MOVE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const undo = (h: History): History =>
  h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
const redo = (h: History): History =>
  h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };

interface EditorProps {
  answers: Answers;
  /** 保存してあった図面（無ければ回答から自動生成する） */
  initialDoc?: Doc | null;
  /** 図面が変わったときに知らせる（保存のため） */
  onDocChange?: (doc: Doc) => void;
}

export function Editor({ answers, initialDoc, onDocChange }: EditorProps) {
  const t = useT();
  const composition = useMemo(() => buildComposition(answers), [answers]);
  /** いまのヒアリング回答の印。これが変わったら、図面の中身も変わるはず */
  const basis = useMemo(
    () => digest(JSON.stringify(composition.map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0]))),
    [composition],
  );
  const generated = useMemo(() => {
    const doc = fromLayout(layout(composition, answers), basis);
    // 受電設備エリアが2か所以上のときは、横に並ぶので、用紙は横向きにする（3か所以上は、A3）
    const areas = Math.max(...composition.map((i) => (i.area ?? 0) + 1));
    return areas >= 2 ? { ...doc, orientation: 'landscape' as const, ...(areas >= 3 ? { paper: 'A3' as const } : {}) } : doc;
  }, [composition, answers, basis]);

  /** 作り直しても、用紙の大きさと向きだけは選んだままにする */
  const keepPaper = (fresh: Doc, from: Doc | null | undefined): Doc =>
    from?.paper === undefined && from?.orientation === undefined
      ? fresh
      : { ...fresh, paper: from.paper ?? fresh.paper, orientation: from.orientation ?? fresh.orientation };

  const [history, setHistory] = useState<History>(() => {
    // 手で直していない図面は、いつでも回答から作り直してよい。
    // 手で直したものは、勝手に作り直さずそのまま開く（案内だけ出す）
    if (!initialDoc || initialDoc.edited !== true) {
      return { past: [], present: keepPaper(generated, initialDoc), future: [] };
    }
    // 保存してあった図面も一度「整える」を通して、結線を接続点に結び直しておく
    return { past: [], present: tidyDoc(initialDoc), future: [] };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [paletteCategory, setPaletteCategory] = useState<SymbolCategory>('switchgear');
  const [mode, setMode] = useState<'select' | 'wire'>('select');
  /** 用紙のまま（図枠つき）で見るか。印刷の見た目をそのまま確かめられる */
  const [sheetView, setSheetView] = useState(false);
  /** スマホ（幅の狭い画面）で、ほかの操作のボタン列・記号パレットを開いているか */
  const [moreOpen, setMoreOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  /** 「結線を整える」で直しきれなかったところ */
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [tidyNote, setTidyNote] = useState<string | null>(null);
  /** 「入力した内容を反映させる」の確認の窓を出しているか */
  const [askRegenerate, setAskRegenerate] = useState(false);
  /** 直前に矢印キーで動かした要素と時刻（続けて押したときに、操作を1つにまとめる） */
  const lastArrow = useRef<{ id: string; at: number } | null>(null);

  const doc = history.present;
  const sheetTitle = {
    site: String(answers.customerNameForTitleBlock ?? answers.siteName ?? ''),
    name: resolveDrawingName(answers),
    // 右下は常に社名（作成者や図面番号は図面に入れない方針）
    footer: COMPANY_NAME,
  };
  const selected = doc.items.find((i) => i.id === selectedId) ?? null;
  /** 印刷・保存用の1枚のSVG（図枠と表題欄つき） */
  const paper: PaperSize = doc.paper ?? 'A4';
  const orientation: Orientation = doc.orientation ?? 'portrait';
  const sheetSvg = useMemo(
    () => buildSheetSvg(doc, sheetTitle, paper, orientation),
    [doc, sheetTitle.site, sheetTitle.name, sheetTitle.footer, paper, orientation],
  );
  /** 印刷のときの用紙の実寸。@page と図面の大きさを合わせるのに使う */
  const sheetMm = sheetSize(paper, orientation);
  /** 表題まわりの高さ。事業場名称が長くて2行になると高くなり、そのぶん図面を少し縮めて収める */
  const titleH = layoutTitle(sheetTitle, sheetMm.w, SHEET_MARGIN).titleH;

  const selectedSymbol = selected?.kind === 'symbol' ? (selected as DocSymbol) : null;

  const apply = useCallback(
    (next: Doc) => {
      // 手で直した印を付ける。どの回答から作った図面かは、そのまま持ち越す
      const stamped: Doc = { ...next, edited: true, basis: doc.basis };
      setHistory((h) => commit(h, stamped));
      onDocChange?.(stamped);
    },
    [onDocChange, doc.basis],
  );

  /**
   * アプリが自分で整えた結果を入れる（「結線を整える」・用紙の設定）。
   *
   * これは利用者が手で描き変えたわけではないので、**「手で直した」印は付けない**。
   * 付けてしまうと、そのあとヒアリングの回答を変えても図面が作り直されなくなり、
   * 「ケーブルの長さに『約』を付けたのに図面が変わらない」といったことが起きる。
   */
  const applyAuto = useCallback(
    (next: Doc) => {
      const stamped: Doc = { ...next, edited: doc.edited, basis: doc.basis };
      setHistory((h) => commit(h, stamped));
      onDocChange?.(stamped);
    },
    [onDocChange, doc.edited, doc.basis],
  );

  /** ヒアリングの回答から作り直す（編集内容は履歴に残るので元に戻せる） */
  const regenerate = () => {
    const fresh = keepPaper(generated, doc);
    setHistory((h) => commit(h, fresh));
    onDocChange?.(fresh);
    setSelectedId(null);
  };

  /** 用紙の設定を変える（図面の一部として保存する） */
  const setPaper = (next: Partial<Pick<Doc, 'paper' | 'orientation'>>) => applyAuto({ ...doc, ...next });

  /** 手で直したあとに回答が変わっている。勝手に作り直さず、案内だけ出す */
  const stale = doc.edited === true && doc.basis !== undefined && doc.basis !== basis;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 印刷プレビュー中は編集できない（Delete や 元に戻す のキーも効かせない）
      if (sheetView) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      // 線を引くモードは、Esc キーで解除する（引きかけの線も、取りやめ）
      if (e.key === 'Escape' && mode === 'wire' && !e.isComposing) {
        e.preventDefault();
        setMode('select');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setHistory((h) => {
          const n = e.shiftKey ? redo(h) : undo(h);
          onDocChange?.(n.present);
          return n;
        });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        apply(removeItem(doc, selectedId));
        setSelectedId(null);
      } else if (selectedId && mode === 'select' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key in ARROW_MOVE) {
        // 選んでいる要素を、矢印キーの向きに動かす（マウスでドラッグするのと同じ動かし方）
        e.preventDefault();
        const [ux, uy] = ARROW_MOVE[e.key]!;
        const step = e.shiftKey ? ARROW_STEP * ARROW_SHIFT_TIMES : ARROW_STEP;
        const next: Doc = { ...moveItem(doc, selectedId, ux * step, uy * step), edited: true, basis: doc.basis };
        const now = Date.now();
        const last = lastArrow.current;
        lastArrow.current = { id: selectedId, at: now };
        if (last && last.id === selectedId && now - last.at < ARROW_MERGE_MS) {
          // 続けて押している間は、1回の操作として扱う（「操作を戻す」を1回押せば、押す前に戻る）
          setHistory((h) => ({ ...h, present: next }));
          onDocChange?.(next);
        } else {
          setHistory((h) => commit(h, next));
          onDocChange?.(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selectedId, apply, sheetView, mode]);

  // 自動作図のためだけに用意した差し替え版（PASの枠を広げたものなど）は、
  // 手で選ぶものではないので一覧に出さない
  const palette = SYMBOLS.filter((s) => s.category === paletteCategory && !(s.altOf && s.optional));
  const categories = [...new Set(SYMBOLS.map((s) => s.category))];

  const onPaletteClick = (symbolId: string) => {
    if (selectedSymbol) {
      apply(replaceSymbol(doc, selectedSymbol.id, symbolId));
    } else {
      const b = docBounds(doc);
      const { doc: next, id } = addSymbol(doc, symbolId, (b.x0 + b.x1) / 2, b.y1 + 60);
      apply(next);
      setSelectedId(id);
    }
  };

  return (
    <div className="editor">
      <div className={`editor-bar${moreOpen ? ' more-open' : ''}`}>
        <div className="tools">
          {/* ボタンは、用途ごとに、見出し付きのグループにまとめる。スマホでは、見出しを消し、「sec」の付いたものを「ほかの操作」の中にしまう */}
          <div className="tool-group">
            <span className="cap">{t('editor.group.history')}</span>
            <div className="tool-row">
              <button
                type="button"
                className="btn with-icon"
                title={t('editor.undo.help')}
                onClick={() => setHistory((h) => { const n = undo(h); onDocChange?.(n.present); return n; })}
                disabled={sheetView || history.past.length === 0}
              >
                <UndoIcon />
                {t('editor.undo')}
              </button>
              <button
                type="button"
                className="btn with-icon"
                title={t('editor.redo.help')}
                onClick={() => setHistory((h) => { const n = redo(h); onDocChange?.(n.present); return n; })}
                disabled={sheetView || history.future.length === 0}
              >
                <UndoIcon redo />
                {t('editor.redo')}
              </button>
            </div>
          </div>

          <div className="tool-group">
            <span className="cap">{t('editor.group.edit')}</span>
            <div className="tool-row">
              <button type="button" className="btn danger" disabled={sheetView || !selected} onClick={() => selected && (apply(removeItem(doc, selected.id)), setSelectedId(null))}>
                {t('editor.delete')}
              </button>
              <button
                type="button"
                className="sec"
                disabled={sheetView}
                onClick={() => {
                  const b = docBounds(doc);
                  const { doc: next, id } = addText(doc, (b.x0 + b.x1) / 2, b.y1 + 40, '注記');
                  apply(next);
                  setSelectedId(id);
                }}
              >
                {t('editor.addNote')}
              </button>
              <button
                type="button"
                className={`sec${mode === 'wire' ? ' on' : ''}`}
                aria-pressed={mode === 'wire'}
                disabled={sheetView}
                onClick={() => {
                  setMode((m) => (m === 'wire' ? 'select' : 'wire'));
                  setSelectedId(null);
                }}
              >
                {t('editor.drawWire')}
              </button>
            </div>
          </div>

          {/* スマホ専用のボタン */}
          <button type="button" className="tools-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            {moreOpen ? t('editor.moreClose') : t('editor.more')}
          </button>
          <button type="button" className="tools-toggle" aria-expanded={sideOpen} onClick={() => setSideOpen((v) => !v)}>
            {t('editor.sideOpen')}
          </button>

          <div className="tool-group sec">
            <span className="cap">{t('editor.group.tidy')}</span>
            <div className="tool-row">
              <button
                type="button"
                className="btn sec"
                title={t('editor.tidy.help')}
                disabled={sheetView}
                onClick={() => {
                  const r = tidyDrawing(doc, paper, orientation, titleH);
                  applyAuto(r.doc);
                  const done = Object.entries(r.fixed)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${ISSUE_LABEL[k as keyof typeof ISSUE_LABEL]} ${n}件`);
                  setIssues(r.issues);
                  setTidyNote(
                    done.length > 0
                      ? `直しました：${done.join(' / ')}`
                      : '直すところはありませんでした',
                  );
                }}
              >
                {t('editor.tidy')}
              </button>
            </div>
          </div>

          <div className="tool-group sec">
            <span className="cap">{t('editor.group.rebuild')}</span>
            <div className="tool-row">
              <button type="button" disabled={sheetView} onClick={() => setAskRegenerate(true)}>
                {t('editor.regenerate')}
              </button>
            </div>
          </div>

          <div className="tool-group sec">
            <span className="cap">{t('editor.group.print')}</span>
            <div className="tool-row">
              <label className="tool-select">
                <span>{t('editor.paper')}</span>
                <select
                  value={paper}
                  aria-label={t('editor.paper')}
                  onChange={(e) => setPaper({ paper: e.target.value as 'A4' | 'A3' })}
                >
                  {(['A4', 'A3'] as const).map((p2) => (
                    <option key={p2} value={p2}>
                      {p2}（{sheetSize(p2, orientation).mmW}×{sheetSize(p2, orientation).mmH}mm）
                    </option>
                  ))}
                </select>
              </label>
              <label className="tool-select">
                <span>{t('editor.orientation')}</span>
                <select
                  value={orientation}
                  aria-label={t('editor.orientation')}
                  onChange={(e) => setPaper({ orientation: e.target.value as 'portrait' | 'landscape' })}
                >
                  <option value="portrait">{t('editor.portrait')}</option>
                  <option value="landscape">{t('editor.landscape')}</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                aria-pressed={sheetView}
                title="図枠つきの、印刷したときの見た目で確かめます"
                onClick={() => {
                  setSheetView((v) => !v);
                  setMode('select');
                }}
              >
                印刷プレビュー
              </button>
              <button type="button" onClick={() => window.print()}>
                {t('editor.print')}
              </button>
            </div>
          </div>

          <div className="tool-group zoom-group">
            <span className="cap">{t('editor.group.view')}</span>
            <div className="tool-row">
              <button type="button" className="with-icon" disabled={sheetView} onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
                <ZoomIcon kind="out" />
                {t('editor.zoomOut')}
              </button>
              <span className="zoom">{Math.round(zoom * 100)}%</span>
              <button type="button" className="with-icon" disabled={sheetView} onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
                <ZoomIcon kind="in" />
                {t('editor.zoomIn')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {stale && (
        <p className="stale-note">
          <b>ヒアリングの回答が、この図面を作ったときから変わっています。</b>
          いまの図面は手で直したものなので、そのままにしてあります。
          <button type="button" className="btn" disabled={sheetView} onClick={() => setAskRegenerate(true)}>
            {t('editor.regenerate')}
          </button>
          <span className="hint">（押しても「操作を戻す」で元に戻せます）</span>
        </p>
      )}

      {tidyNote && (
        <p className={`tidy-note${issues && issues.length > 0 ? ' has-left' : ''}`}>
          <b>{tidyNote}</b>
          {issues && issues.length > 0 ? (
            <>
              <span>直しきれなかったところが {issues.length}件 あります（図面に赤い印を出しています）</span>
              <ul className="issue-list">
                {issues.slice(0, 8).map((is, i) => (
                  <li key={i}>
                    <span className="tag">{ISSUE_LABEL[is.kind]}</span>
                    {is.message}
                  </li>
                ))}
                {issues.length > 8 && <li>ほか {issues.length - 8}件</li>}
              </ul>
            </>
          ) : (
            <span>直しきれなかったところはありません</span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTidyNote(null);
              setIssues(null);
            }}
          >
            {t('common.close')}
          </button>
        </p>
      )}

      {mode === 'wire' && (
        <p className="mode-hint">{t('editor.wireHint')}</p>
      )}

      {sheetView && (
        <p className="preview-note" role="status">
          <span>印刷プレビュー中は編集できません。編集するときは、印刷プレビューを閉じてください</span>
          <button type="button" className="btn" onClick={() => setSheetView(false)}>
            印刷プレビューを閉じる
          </button>
        </p>
      )}

      {askRegenerate && (
        <ConfirmDialog
          title={t('editor.regenerate')}
          message={[
            '入力済みの内容で上書きされます。入力した内容に基づいて、図面が再作成されます。',
            ...(doc.edited
              ? ['この図面は手で直してあります。記号の移動・追加・削除、線やメモの変更など、手で直した内容は、この図面から失われます。']
              : []),
            '実行したあとでも、「操作を戻す」で、元の図面に戻せます。',
            'よろしいですか？',
          ]}
          confirmLabel="実行"
          cancelLabel="キャンセル"
          onConfirm={() => {
            setAskRegenerate(false);
            regenerate();
          }}
          onCancel={() => setAskRegenerate(false)}
        />
      )}

      {/* 印刷の用紙を、選んだ大きさ・向きに合わせる */}
      <style>{`@page { size: ${sheetMm.mmW}mm ${sheetMm.mmH}mm; margin: 0; }
        .print-root svg { width: ${sheetMm.mmW}mm; height: ${sheetMm.mmH}mm; }`}</style>
      <div className="print-root" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sheetSvg }} />

      <div className="editor-body">
        <div className="canvas-wrap">
          {sheetView ? (
            <div
              className="sheet-view"
              style={{ aspectRatio: `${sheetMm.mmW} / ${sheetMm.mmH}` }}
              dangerouslySetInnerHTML={{ __html: sheetSvg }}
            />
          ) : (
          <DrawingCanvas
            doc={doc}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMoveEnd={(id, dx, dy) => apply(moveItem(doc, id, dx, dy))}
            onWireEnd={(id, end, dx, dy) => apply(moveWireEnd(doc, id, end, dx, dy))}
            onAddWire={(x1, y1, x2, y2, opts) => {
              const { doc: next, id } = addWire(doc, x1, y1, x2, y2, opts);
              apply(next);
              // 線を引くモードは続ける（次の線を、続けて引ける）。やめるときは、Esc キーか「線を引く」をもう一度押す
              setSelectedId(id);
            }}
            mode={mode}
            zoom={zoom}
            onZoom={setZoom}
            issues={issues ?? []}
          />
          )}
        </div>

        <aside className={`side${sideOpen ? ' open' : ''}`} inert={sheetView}>
          <button type="button" className="btn side-close" onClick={() => setSideOpen(false)}>
            {t('common.close')}
          </button>
          <section>
            <h3>{t('editor.palette')}</h3>
            <p className="hint">
              {selectedSymbol
                ? t('editor.palette.replace')
                : t('editor.palette.add')}
            </p>
            <select value={paletteCategory} onChange={(e) => setPaletteCategory(e.target.value as SymbolCategory)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <div className="palette">
              {palette.map((s) => (
                <button key={s.id} type="button" title={s.nameJa} onClick={() => onPaletteClick(s.id)}>
                  <span
                    className="thumb"
                    dangerouslySetInnerHTML={{ __html: symbolToSvg(s, { padding: 4, scale: 0.62 }) }}
                  />
                  <span className="cap">{s.abbr}</span>
                </button>
              ))}
            </div>
          </section>

          {selected && (
            <section>
              <h3>{t('editor.selected')}</h3>
              {selectedSymbol ? (
                <>
                  <p className="hint">
                    {getSymbol(selectedSymbol.symbolId).nameJa}
                  </p>
                  {(() => {
                    const def = getSymbol(selectedSymbol.symbolId);
                    const fields = labelFields(def);
                    if (fields.length === 0) return null;
                    const values = selectedSymbol.values;
                    return (
                      <div className="ratings">
                        <label className="lbl">{t('editor.ratings')}</label>
                        {values ? (
                          <>
                            <p className="hint">{t('editor.ratings.help')}</p>
                            {fields.map((f) => {
                              const listId = `rating-${selectedSymbol.id}-${f.key}`;
                              const free = f.type !== 'select' || f.allowFreeInput;
                              return (
                                <label className="rating" key={f.key}>
                                  <span>{f.label}</span>
                                  {f.type === 'select' && !f.allowFreeInput ? (
                                    <select value={values[f.key] ?? ''} onChange={(e) => apply(setLabelValue(doc, selectedSymbol.id, f.key, e.target.value))}>
                                      <option value="">{t('editor.ratings.blank')}</option>
                                      {f.options?.map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                                      list={f.type === 'select' ? listId : undefined}
                                      value={values[f.key] ?? ''}
                                      onChange={(e) => apply(setLabelValue(doc, selectedSymbol.id, f.key, e.target.value))}
                                    />
                                  )}
                                  {f.unit && <span className="unit">{f.unit}</span>}
                                  {free && f.type === 'select' && (
                                    <datalist id={listId}>
                                      {f.options?.map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                      ))}
                                    </datalist>
                                  )}
                                </label>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            <p className="hint">{t('editor.ratings.manual')}</p>
                            <button type="button" className="btn" onClick={() => apply(resetLabelFromFields(doc, selectedSymbol.id))}>
                              {t('editor.ratings.reset')}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <label className="lbl">{t('editor.labelText')}</label>
                  <textarea
                    rows={4}
                    value={selectedSymbol.label.join('\n')}
                    onChange={(e) => apply(setLabel(doc, selectedSymbol.id, e.target.value.split('\n')))}
                  />
                </>
              ) : selected.kind === 'text' ? (
                <>
                  <label className="lbl">{t('editor.note')}</label>
                  <textarea
                    rows={3}
                    value={selected.lines.join('\n')}
                    onChange={(e) => apply(setLabel(doc, selected.id, e.target.value.split('\n')))}
                  />
                </>
              ) : (
                <p className="hint">
                  {selected.kind === 'wire'
                    ? t('editor.wireSelected')
                    : t('editor.frameSelected')}
                </p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
