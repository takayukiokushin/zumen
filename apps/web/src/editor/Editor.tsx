import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORY_LABEL, SYMBOLS, getSymbol, symbolToSvg } from '@zumen/symbols';
import type { SymbolCategory } from '@zumen/symbols';
import { layout } from '@zumen/layout';
import { buildComposition } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { DrawingCanvas } from './DrawingCanvas.tsx';
import { buildSheetSvg, downloadPng, downloadSvg } from './exportSheet.ts';
import type { Doc, DocSymbol } from './doc.ts';
import { addSymbol, addText, addWire, docBounds, fromLayout, moveItem, moveWireEnd, removeItem, replaceSymbol, rotateSymbol, setLabel, snapWireToPorts } from './doc.ts';

/** 元に戻す／やり直すのための履歴 */
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
  const generated = useMemo(() => fromLayout(layout(buildComposition(answers), answers)), [answers]);
  const [history, setHistory] = useState<History>({ past: [], present: initialDoc ?? generated, future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [paletteCategory, setPaletteCategory] = useState<SymbolCategory>('switchgear');
  const [mode, setMode] = useState<'select' | 'wire'>('select');

  const doc = history.present;
  const sheetTitle = {
    title: `${String(answers.customerNameForTitleBlock ?? answers.siteName ?? answers.customerName ?? '')}　${String(
      answers.drawingName ?? 'キュービクル式高圧受電設備単線結線図',
    )}`.trim(),
    footer: String(answers.author ?? ''),
    draftNotice: '※ 作図支援ツールで作成したたたき台です。内容は有資格者の確認が必要です',
  };
  const fileBase = String(answers.siteName ?? answers.customerName ?? '単線結線図');
  const selected = doc.items.find((i) => i.id === selectedId) ?? null;
  /** 印刷・保存用の1枚のSVG（図枠と表題欄つき） */
  const sheetSvg = useMemo(() => buildSheetSvg(doc, sheetTitle), [doc, sheetTitle.title, sheetTitle.footer]);
  const selectedSymbol = selected?.kind === 'symbol' ? (selected as DocSymbol) : null;

  const apply = useCallback(
    (next: Doc) => {
      setHistory((h) => commit(h, next));
      onDocChange?.(next);
    },
    [onDocChange],
  );

  /** ヒアリングの回答から作り直す（編集内容は履歴に残るので元に戻せる） */
  const regenerate = () => {
    apply(fromLayout(layout(buildComposition(answers), answers)));
    setSelectedId(null);
  };

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

  const palette = SYMBOLS.filter((s) => s.category === paletteCategory);
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
            onClick={() => setHistory((h) => { const n = undo(h); onDocChange?.(n.present); return n; })}
            disabled={history.past.length === 0}
          >
            元に戻す
          </button>
          <button
            type="button"
            onClick={() => setHistory((h) => { const n = redo(h); onDocChange?.(n.present); return n; })}
            disabled={history.future.length === 0}
          >
            やり直す
          </button>
          <span className="sep" />
          <button type="button" disabled={!selected} onClick={() => selected && (apply(removeItem(doc, selected.id)), setSelectedId(null))}>
            削除
          </button>
          <button type="button" disabled={!selectedSymbol} onClick={() => selectedSymbol && apply(rotateSymbol(doc, selectedSymbol.id, 90))}>
            90°回す
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
            注記を追加
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
            線を引く
          </button>
          <button
            type="button"
            disabled={selected?.kind !== 'wire'}
            onClick={() => selected && apply(snapWireToPorts(doc, selected.id))}
          >
            接続点に合わせる
          </button>
          <span className="sep" />
          <button type="button" onClick={regenerate}>
            回答から作り直す
          </button>
          <span className="sep" />
          <button type="button" onClick={() => window.print()}>
            印刷 / PDF
          </button>
          <button type="button" onClick={() => void downloadPng(sheetSvg, `${fileBase}.png`)}>
            PNG保存
          </button>
          <button type="button" onClick={() => downloadSvg(sheetSvg, `${fileBase}.svg`)}>
            SVG保存
          </button>
        </div>
        <div className="tools">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
            縮小
          </button>
          <span className="zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
            拡大
          </button>
        </div>
      </div>

      {mode === 'wire' && (
        <p className="mode-hint">線を引く：始点をクリック→終点をクリック。縦か横に自動で揃います。</p>
      )}

      <div className="print-root" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sheetSvg }} />

      <div className="editor-body">
        <div className="canvas-wrap">
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
          />
        </div>

        <aside className="side">
          <section>
            <h3>記号を追加・差し替え</h3>
            <p className="hint">
              {selectedSymbol
                ? '記号を選んでいます。下から選ぶと差し替わります（結線はそのまま残ります）。'
                : '下から選ぶと図面の下に追加します。記号を選んでから押すと差し替えになります。'}
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
              <h3>選んでいるもの</h3>
              {selectedSymbol ? (
                <>
                  <p className="hint">
                    {getSymbol(selectedSymbol.symbolId).nameJa}
                  </p>
                  <label className="lbl">図面に書く文字</label>
                  <textarea
                    rows={4}
                    value={selectedSymbol.label.join('\n')}
                    onChange={(e) => apply(setLabel(doc, selectedSymbol.id, e.target.value.split('\n')))}
                  />
                </>
              ) : selected.kind === 'text' ? (
                <>
                  <label className="lbl">注記</label>
                  <textarea
                    rows={3}
                    value={selected.lines.join('\n')}
                    onChange={(e) => apply(setLabel(doc, selected.id, e.target.value.split('\n')))}
                  />
                </>
              ) : (
                <p className="hint">
                  {selected.kind === 'wire'
                    ? '結線を選んでいます。線をドラッグすると移動、両端の丸をドラッグすると伸縮します。線は縦か横に自動で揃います。'
                    : '枠を選んでいます。'}
                </p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
