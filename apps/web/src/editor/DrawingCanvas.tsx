import { useRef, useState } from 'react';
import { FONT_FAMILY, getSymbol, shapesToSvg } from '@zumen/symbols';
import type { Doc, DocItem } from './doc.ts';
import { assistMove, assistWireEnd, docBounds, groupOf, groupRootOf, itemBounds, moveItem, moveWireEnd } from './doc.ts';
import type { Issue } from './inspect.ts';

interface Props {
  doc: Doc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ドラッグが終わったときに一度だけ呼ぶ（元に戻すの単位をドラッグ1回にするため） */
  onMoveEnd: (id: string, dx: number, dy: number) => void;
  /** 線の端を動かして伸縮したとき */
  onWireEnd: (id: string, end: 1 | 2, dx: number, dy: number) => void;
  /** 線を引き終えたとき */
  onAddWire: (x1: number, y1: number, x2: number, y2: number) => void;
  /** 'wire' のときは2点をクリックして線を引く */
  mode: 'select' | 'wire';
  zoom: number;
  /** 「結線を整える」で直しきれなかったところ。赤い印で知らせる */
  issues?: Issue[];
}

/** 動かしている最中の状態。dx・dy は吸い寄せたあとの値 */
interface Drag {
  id: string;
  end?: 1 | 2;
  dx: number;
  dy: number;
  /** 揃った位置に引く目安の線 */
  guideX?: number;
  guideY?: number;
}

/** 図面のキャンバス。記号をクリックで選び、ドラッグで動かせる */
export function DrawingCanvas({ doc, selectedId, onSelect, onMoveEnd, onWireEnd, onAddWire, mode, zoom, issues = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 線を引いている途中の始点と、いまのカーソル位置 */
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // 表示用の図面。動かしている最中も、結線をつないだまま見せる
  const view = !drag
    ? doc
    : drag.end
      ? moveWireEnd(doc, drag.id, drag.end, drag.dx, drag.dy)
      : moveItem(doc, drag.id, drag.dx, drag.dy);

  // 見える範囲は動かす前の図面から決める。動かすたびに画面が揺れないように
  const b = docBounds(doc);
  const pad = 40;
  const vb = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };

  /** 画面の座標を図面の座標に直す */
  const toDrawing = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return {
      x: vb.x + ((e.clientX - r.left) / r.width) * vb.w,
      y: vb.y + ((e.clientY - r.top) / r.height) * vb.h,
    };
  };

  const onPointerDown = (e: React.PointerEvent, it: DocItem) => {
    if (mode === 'wire') return;
    e.stopPropagation();

    // PASのように中に部品を抱えている記号は、かたまりごと選ぶ。
    // すでにそのかたまりを選んでいるときだけ、もう一度押すと中の部品を選べる
    const root = groupRootOf(doc, it.id);
    const insideSelected = selectedId !== null && groupOf(doc, root).includes(selectedId);
    const pick = insideSelected ? it.id : root;

    onSelect(pick);
    if (it.kind === 'frame') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = toDrawing(e);
    setDrag({ id: pick, dx: 0, dy: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode === 'wire' && wireStart) setCursor(toDrawing(e));
    if (!drag || !start.current) return;
    const p = toDrawing(e);
    const rawDx = p.x - start.current.x;
    const rawDy = p.y - start.current.y;
    const a = drag.end
      ? assistWireEnd(doc, drag.id, drag.end, rawDx, rawDy)
      : assistMove(doc, drag.id, rawDx, rawDy);
    setDrag({ id: drag.id, end: drag.end, dx: a.dx, dy: a.dy, guideX: a.guideX, guideY: a.guideY });
  };

  const onPointerUp = () => {
    if (drag && (Math.abs(drag.dx) > 0.01 || Math.abs(drag.dy) > 0.01)) {
      if (drag.end) onWireEnd(drag.id, drag.end, drag.dx, drag.dy);
      else onMoveEnd(drag.id, drag.dx, drag.dy);
    }
    setDrag(null);
    start.current = null;
  };

  /** 線を引くモードのとき、1回目のクリックで始点、2回目で線を確定する */
  const onCanvasDown = (e: React.PointerEvent) => {
    if (mode !== 'wire') {
      onSelect(null);
      return;
    }
    const p = toDrawing(e);
    if (!wireStart) {
      setWireStart(p);
      setCursor(p);
    } else {
      onAddWire(wireStart.x, wireStart.y, p.x, p.y);
      setWireStart(null);
      setCursor(null);
    }
  };

  const selectedWire = view.items.find((i) => i.id === selectedId && i.kind === 'wire');

  return (
    <svg
      ref={svgRef}
      className="canvas"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{ height: `${zoom * 100}%` }}
      onPointerDown={onCanvasDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="図面"
    >
      <g stroke="#000" fill="none" strokeLinecap="round" strokeLinejoin="round" color="#000">
        {view.items.map((it) => {
          const selected = it.id === selectedId;
          const common = {
            key: it.id,
            onPointerDown: (e: React.PointerEvent) => onPointerDown(e, it),
            className: `item${selected ? ' selected' : ''}`,
          };

          if (it.kind === 'wire') {
            return (
              <g {...common}>
                <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} strokeWidth={1} strokeDasharray={it.dashed ? '5 4' : undefined} />
                <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} strokeWidth={8} stroke="transparent" />
              </g>
            );
          }

          if (it.kind === 'frame') {
            return (
              <g {...common}>
                <path
                  d={`M ${it.x} ${it.y} L ${it.x + it.w} ${it.y} M ${it.x} ${it.y} L ${it.x} ${it.y + 26} M ${it.x + it.w} ${it.y} L ${it.x + it.w} ${it.y + 26}`}
                  strokeWidth={1}
                />
                {it.label && (
                  <text x={it.x} y={it.y - 6} fontSize={8} fontFamily={FONT_FAMILY} fill="currentColor" stroke="none">
                    {it.label}
                  </text>
                )}
              </g>
            );
          }

          if (it.kind === 'text') {
            return (
              <g {...common}>
                <text x={it.x} y={it.y} fontSize={8} textAnchor={it.anchor} fontFamily={FONT_FAMILY} fill="currentColor" stroke="none">
                  {it.lines.map((l, i) => (
                    <tspan key={i} x={it.x} dy={i === 0 ? 0 : 10}>
                      {l}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          }

          const def = getSymbol(it.symbolId);
          const cx = def.box.w / 2;
          const cy = def.box.h / 2;
          return (
            <g {...common}>
              <g
                transform={`translate(${it.x} ${it.y})${it.rotate ? ` rotate(${it.rotate} ${cx} ${cy})` : ''}`}
                dangerouslySetInnerHTML={{ __html: shapesToSvg(def.shapes, '') }}
              />
              {it.label.length > 0 && (
                <text
                  x={it.x + it.labelDx}
                  y={it.y + it.labelDy}
                  fontSize={8}
                  textAnchor={it.labelAnchor}
                  fontFamily={FONT_FAMILY}
                  fill="currentColor"
                  stroke="none"
                >
                  {it.label.map((l, i) => (
                    <tspan key={i} x={it.x + it.labelDx} dy={i === 0 ? 0 : 10}>
                      {l}
                    </tspan>
                  ))}
                </text>
              )}
              <rect x={it.x} y={it.y} width={def.box.w} height={def.box.h} fill="transparent" stroke="none" />
            </g>
          );
        })}

        {/* 動かしている最中、まっすぐ揃った位置に目安の線を出す */}
        {drag?.guideX !== undefined && (
          <line className="guide" x1={drag.guideX} y1={vb.y} x2={drag.guideX} y2={vb.y + vb.h} pointerEvents="none" />
        )}
        {drag?.guideY !== undefined && (
          <line className="guide" x1={vb.x} y1={drag.guideY} x2={vb.x + vb.w} y2={drag.guideY} pointerEvents="none" />
        )}

        {selectedWire && selectedWire.kind === 'wire' && mode === 'select' && (
          <>
            {([1, 2] as const).map((end) => (
              <circle
                key={end}
                className="handle"
                cx={end === 1 ? selectedWire.x1 : selectedWire.x2}
                cy={end === 1 ? selectedWire.y1 : selectedWire.y2}
                r={4}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  start.current = toDrawing(e);
                  setDrag({ id: selectedWire.id, end, dx: 0, dy: 0 });
                }}
              />
            ))}
          </>
        )}

        {mode === 'wire' && wireStart && cursor && (
          <line
            className="preview"
            x1={wireStart.x}
            y1={wireStart.y}
            x2={Math.abs(cursor.x - wireStart.x) <= Math.abs(cursor.y - wireStart.y) ? wireStart.x : cursor.x}
            y2={Math.abs(cursor.x - wireStart.x) <= Math.abs(cursor.y - wireStart.y) ? cursor.y : wireStart.y}
            strokeWidth={1}
          />
        )}

        {/* 直しきれなかったところに、赤い印を出す */}
        {issues.map((is, i) => (
          <g key={`issue-${i}`} className="issue-mark" pointerEvents="none">
            <circle cx={is.x} cy={is.y} r={11} />
            <line x1={is.x} y1={is.y - 5} x2={is.x} y2={is.y + 1} />
            <circle cx={is.x} cy={is.y + 4.5} r={0.9} className="dot" />
          </g>
        ))}

        {selectedId &&
          (() => {
            // かたまりを選んでいるときは、中の部品まで含めて囲う
            const ids = groupOf(view, selectedId);
            const boxes = view.items.filter((i) => ids.includes(i.id)).map(itemBounds);
            if (boxes.length === 0) return null;
            const bb = {
              x0: Math.min(...boxes.map((b) => b.x0)),
              y0: Math.min(...boxes.map((b) => b.y0)),
              x1: Math.max(...boxes.map((b) => b.x1)),
              y1: Math.max(...boxes.map((b) => b.y1)),
            };
            return (
              <rect
                className="selection"
                x={bb.x0 - 4}
                y={bb.y0 - 4}
                width={bb.x1 - bb.x0 + 8}
                height={bb.y1 - bb.y0 + 8}
                fill="none"
                pointerEvents="none"
              />
            );
          })()}
      </g>
    </svg>
  );
}
