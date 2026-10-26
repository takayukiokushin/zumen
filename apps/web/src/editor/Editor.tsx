import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORY_LABEL, SYMBOLS, getSymbol, symbolToSvg } from '@zumen/symbols';
import type { SymbolCategory } from '@zumen/symbols';
import { COMPANY_NAME, layout, sheetSize } from '@zumen/layout';
import type { Orientation, PaperSize } from '@zumen/layout';
import { buildComposition } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { DrawingCanvas } from './DrawingCanvas.tsx';
import { useT } from '../i18n/useT.ts';
import { buildSheetSvg, downloadPng, downloadSvg } from './exportSheet.ts';
import { ISSUE_LABEL, tidyDrawing } from './inspect.ts';
import type { Issue } from './inspect.ts';
import type { Doc, DocSymbol } from './doc.ts';
import { addSymbol, addText, addWire, digest, docBounds, fromLayout, moveItem, moveWireEnd, removeItem, replaceSymbol, rotateSymbol, setLabel, snapWireToPorts, tidyDoc } from './doc.ts';

/** 操作を戻す／進めるための履歴 */
interface History {
  past: Doc[];
  present: Doc;
  future: Doc[];
}

const commit = (h: History, next: Doc): History => ({ past: [...h.past, h.present], present: next, future: [] });
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
  const generated = useMemo(() => fromLayout(layout(composition, answers), basis), [composition, answers, basis]);

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
  /** 「結線を整える」で直しきれなかったところ */
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [tidyNote, setTidyNote] = useState<string | null>(null);

  const doc = history.present;
  const sheetTitle = {
    title: `${String(answers.customerNameForTitleBlock ?? answers.siteName ?? '')}　${String(
      answers.drawingName ?? 'キュービクル式高圧受電設備単線結線図',
    )}`.trim(),
    // 右下は常に社名（作成者や図面番号は図面に入れない方針）
    footer: COMPANY_NAME,
  };
  const fileBase = String(answers.siteName ?? '単線結線図');
  const selected = doc.items.find((i) => i.id === selectedId) ?? null;
  /** 印刷・保存用の1枚のSVG（図枠と表題欄つき） */
  const paper: PaperSize = doc.paper ?? 'A4';
  const orientation: Orientation = doc.orientation ?? 'portrait';
  const sheetSvg = useMemo(
    () => buildSheetSvg(doc, sheetTitle, paper, orientation),
    [doc, sheetTitle.title, sheetTitle.footer, paper, orientation],
  );
  /** 印刷のときの用紙の実寸。@page と図面の大きさを合わせるのに使う */
  const sheetMm = sheetSize(paper, orientation);

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
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selectedId, apply]);

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
      <div className="editor-bar">
        <div className="tools">
          <button
            type="button"
            className="btn"
            title={t('editor.undo.help')}
            onClick={() => setHistory((h) => { const n = undo(h); onDocChange?.(n.present); return n; })}
            disabled={history.past.length === 0}
          >
            {t('editor.undo')}
          </button>
          <button
            type="button"
            className="btn"
            title={t('editor.redo.help')}
            onClick={() => setHistory((h) => { const n = redo(h); onDocChange?.(n.present); return n; })}
            disabled={history.future.length === 0}
          >
            {t('editor.redo')}
          </button>
          <span className="sep" />
          <button type="button" className="btn" disabled={!selected} onClick={() => selected && (apply(removeItem(doc, selected.id)), setSelectedId(null))}>
            {t('editor.delete')}
          </button>
          <button type="button" className="btn" disabled={!selectedSymbol} onClick={() => selectedSymbol && apply(rotateSymbol(doc, selectedSymbol.id, 90))}>
            {t('editor.rotate')}
          </button>
          <button
            type="button"
            onClick={() => {
              const b = docBounds(doc);
              const { doc: next, id } = addText(doc, (b.x0 + b.x1) / 2, b.y1 + 40, '注記');
              apply(next);
              setSelectedId(id);
            }}
          >
            {t('editor.addNote')}
          </button>
          <span className="sep" />
          <button
            type="button"
            aria-pressed={mode === 'wire'}
            className={mode === 'wire' ? 'on' : ''}
            onClick={() => {
              setMode((m) => (m === 'wire' ? 'select' : 'wire'));
              setSelectedId(null);
            }}
          >
            {t('editor.drawWire')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={selected?.kind !== 'wire'}
            title={t('editor.snapToPort.help')}
            onClick={() => selected && apply(snapWireToPorts(doc, selected.id))}
          >
            {t('editor.snapToPort')}
          </button>
          <button
            type="button"
            className="btn"
            title={t('editor.tidy.help')}
            onClick={() => {
              const r = tidyDrawing(doc, paper, orientation);
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
          <span className="sep" />
          <button type="button" onClick={regenerate}>
            {t('editor.regenerate')}
          </button>
          <span className="sep" />
          <span className="paper-pick">
            {(['A4', 'A3'] as const).map((p2) => (
              <button
                key={p2}
                type="button"
                className="btn"
                aria-pressed={paper === p2}
                title={`${p2}（${sheetSize(p2, orientation).mmW}×${sheetSize(p2, orientation).mmH}mm）で印刷します`}
                onClick={() => setPaper({ paper: p2 })}
              >
                {p2}
              </button>
            ))}
            {([
              ['portrait', '縦'],
              ['landscape', '横'],
            ] as const).map(([o, label]) => (
              <button
                key={o}
                type="button"
                className="btn"
                aria-pressed={orientation === o}
                onClick={() => setPaper({ orientation: o })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="btn"
              aria-pressed={sheetView}
              title="図枠つきの、印刷したときの見た目で確かめます"
              onClick={() => setSheetView((v) => !v)}
            >
              用紙で見る
            </button>
          </span>
          <span className="sep" />
          <button type="button" onClick={() => window.print()}>
            {t('editor.print')}
          </button>
          <button type="button" onClick={() => void downloadPng(sheetSvg, `${fileBase}.png`)}>
            {t('editor.png')}
          </button>
          <button type="button" onClick={() => downloadSvg(sheetSvg, `${fileBase}.svg`)}>
            {t('editor.svg')}
          </button>
        </div>
        <div className="tools">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
            {t('editor.zoomOut')}
          </button>
          <span className="zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
            {t('editor.zoomIn')}
          </button>
        </div>
      </div>

      {stale && (
        <p className="stale-note">
          <b>ヒアリングの回答が、この図面を作ったときから変わっています。</b>
          いまの図面は手で直したものなので、そのままにしてあります。
          <button type="button" className="btn" onClick={regenerate}>
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
            onAddWire={(x1, y1, x2, y2) => {
              const { doc: next, id } = addWire(doc, x1, y1, x2, y2);
              apply(next);
              setSelectedId(id);
              setMode('select');
            }}
            mode={mode}
            zoom={zoom}
            issues={issues ?? []}
          />
          )}
        </div>

        <aside className="side">
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
