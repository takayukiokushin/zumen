import { useLayoutEffect, useRef, useState } from 'react';
import { FONT_FAMILY, getSymbol, shapesToSvg } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE } from '@zumen/layout';
import type { Doc, DocItem, PointAssist } from './doc.ts';
import { snap } from '@zumen/layout';
import { assistMove, assistPoint, assistWireEnd, assistWireNew, docBounds, groupOf, groupRootOf, itemBounds, moveItem, moveWireEnd } from './doc.ts';
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
  onAddWire: (x1: number, y1: number, x2: number, y2: number, opts?: { assist?: boolean; range?: number }) => void;
  /** 'wire' のときは2点をクリックして線を引く */
  mode: 'select' | 'wire';
  zoom: number;
  /** 2本指で拡大縮小したとき（指で操作する端末用） */
  onZoom?: (zoom: number) => void;
  /** 「結線を整える」で直しきれなかったところ。赤い印で知らせる */
  issues?: Issue[];
}

/** 吸い付く範囲の、画面上の大きさ（ピクセル）。拡大・縮小しても、同じ感覚になるよう、図面の長さには直して使う */
const SNAP_PX = 9;

/** 拡大縮小の範囲（Editor の「拡大」「縮小」ボタンと同じ） */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;

/** 指で操作するときの、つまんだ・なぞった状態 */
interface Pinch {
  startDist: number;
  startZoom: number;
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
export function DrawingCanvas({ doc, selectedId, onSelect, onMoveEnd, onWireEnd, onAddWire, mode, zoom, onZoom, issues = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 線を引いている途中の始点と、いまのカーソル位置 */
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** 線を引くモードで、いま吸い付いている先（つなぐ先の目印を出すため）。Alt キーを押している間は無し */
  const [hint, setHint] = useState<PointAssist | null>(null);

  /* ---- 指での操作：2本指で拡大縮小・動かす／何も無いところを1本指でなぞって動かす ---- */
  /** いま画面に触れている指（touch のみ） */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  /** 2本指の操作のあと、残った指は、離すまで何もしない */
  const ignored = useRef(new Set<number>());
  /** 何も無いところを1本指でなぞっている状態。動かしていなければ、離したときに「選択を外す」 */
  const pan = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  /** 拡大縮小の前後で、指の位置がずれないよう、動かす前の位置を覚えておく */
  const anchor = useRef<{ fx: number; fy: number; sl: number; st: number; sw: number; sh: number } | null>(null);

  const scroller = () => svgRef.current?.parentElement ?? null;

  useLayoutEffect(() => {
    const a = anchor.current;
    const sc = scroller();
    if (!a || !sc) return;
    sc.scrollLeft = (a.sl + a.fx) * (sc.scrollWidth / a.sw) - a.fx;
    sc.scrollTop = (a.st + a.fy) * (sc.scrollHeight / a.sh) - a.fy;
    anchor.current = null;
  }, [zoom]);

  const centerOf = () => {
    const pts = [...touches.current.values()];
    return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  };
  const distOf = () => {
    const pts = [...touches.current.values()];
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  };

  /**
   * 指の操作は、図面の外側の枠（動かせる領域）全体で受ける。
   * 図面の外に指が置かれても、2本指の操作ができるように。また、記号などの処理より先に受ける（捕まえて止めることがある）
   */
  const latest = useRef({ zoom, mode, onSelect, onZoom });
  latest.current = { zoom, mode, onSelect, onZoom };

  useLayoutEffect(() => {
    const sc = svgRef.current?.parentElement;
    if (!sc) return;
    const stop = (e: Event) => e.stopPropagation();

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const n = touches.current.size;
      if (n === 2) {
        // 2本目の指：動かしかけていた記号は、そのまま元に戻す（確定しない）
        setDrag(null);
        start.current = null;
        pan.current = null;
        setWireStart(null);
        setCursor(null);
        pinch.current = { startDist: Math.max(1, distOf()), startZoom: latest.current.zoom };
        stop(e);
      } else if (n > 2 || ignored.current.has(e.pointerId)) {
        stop(e);
      } else if (latest.current.mode === 'select' && !(e.target as Element).closest?.('g.item')) {
        // 1本指で、記号でないところ：なぞれば画面が動く。ちょんと触れただけなら、離したときに選択を外す
        pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      }
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const prev = touches.current.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      touches.current.set(e.pointerId, cur);
      if (pinch.current && touches.current.size === 2) {
        stop(e);
        // 2本指：指の間隔で拡大縮小し、指の中心が動いた分だけ、画面を動かす
        const c = centerOf();
        const r = sc.getBoundingClientRect();
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.current.startZoom * (distOf() / pinch.current.startDist)));
        sc.scrollLeft -= (cur.x - prev.x) / 2;
        sc.scrollTop -= (cur.y - prev.y) / 2;
        const z = latest.current.zoom;
        if (latest.current.onZoom && Math.abs(next - z) > 0.01) {
          anchor.current = { fx: c.x - r.left, fy: c.y - r.top, sl: sc.scrollLeft, st: sc.scrollTop, sw: sc.scrollWidth, sh: sc.scrollHeight };
          latest.current.onZoom(next);
        }
        return;
      }
      if (ignored.current.has(e.pointerId) || touches.current.size > 1) {
        stop(e);
        return;
      }
      const p = pan.current;
      if (p && p.id === e.pointerId) {
        if (!p.moved && Math.hypot(cur.x - p.x, cur.y - p.y) > 6) p.moved = true;
        if (p.moved) {
          sc.scrollLeft -= cur.x - prev.x;
          sc.scrollTop -= cur.y - prev.y;
        }
      }
    };

    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const wasPinching = pinch.current !== null;
      touches.current.delete(e.pointerId);
      const p = pan.current;
      if (p && p.id === e.pointerId) {
        pan.current = null;
        if (!p.moved && latest.current.mode === 'select') latest.current.onSelect(null);
      }
      if (ignored.current.delete(e.pointerId)) stop(e);
      if (wasPinching) {
        stop(e);
        if (touches.current.size < 2) {
          pinch.current = null;
          for (const id of touches.current.keys()) ignored.current.add(id);
        }
      }
    };

    sc.addEventListener('pointerdown', down, true);
    sc.addEventListener('pointermove', move, true);
    sc.addEventListener('pointerup', up, true);
    sc.addEventListener('pointercancel', up, true);
    return () => {
      sc.removeEventListener('pointerdown', down, true);
      sc.removeEventListener('pointermove', move, true);
      sc.removeEventListener('pointerup', up, true);
      sc.removeEventListener('pointercancel', up, true);
    };
  }, []);

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

  /** 吸い付く範囲（図面の長さ）。画面で SNAP_PX ピクセルになるよう、拡大率に合わせる */
  const snapRange = () => {
    const m = svgRef.current?.getScreenCTM();
    const scale = m && m.a > 0 ? m.a : 1;
    return Math.max(3, Math.min(40, SNAP_PX / scale));
  };

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
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = toDrawing(e);
    setDrag({ id: pick, dx: 0, dy: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode === 'wire') {
      const p = toDrawing(e);
      if (wireStart) setCursor(p);
      // Alt（Mac は option）キーを押している間は、吸い付けない（わざとずらしたり、突き抜けたりしたいとき）
      setHint(e.altKey ? null : wireStart ? assistWireNew(doc, wireStart.x, wireStart.y, p.x, p.y, undefined, snapRange()) : assistPoint(doc, p.x, p.y, undefined, snapRange()));
    }
    if (!drag || !start.current) return;
    const p = toDrawing(e);
    const rawDx = p.x - start.current.x;
    const rawDy = p.y - start.current.y;
    const a = drag.end
      ? assistWireEnd(doc, drag.id, drag.end, rawDx, rawDy, snapRange())
      : assistMove(doc, drag.id, rawDx, rawDy, snapRange());
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
      // 指のときは、なぞれば画面が動くので、「選択を外す」のは、離したときに上の処理で行う
      if (e.pointerType !== 'touch') onSelect(null);
      return;
    }
    const p = toDrawing(e);
    const free = e.altKey;
    if (!wireStart) {
      // 始点も吸い付ける（接続点・線の端・線の上）
      const a = free ? { x: snap(p.x), y: snap(p.y) } : assistPoint(doc, p.x, p.y, undefined, snapRange());
      setWireStart({ x: a.x, y: a.y });
      setCursor(p);
      setHint(null);
    } else {
      onAddWire(wireStart.x, wireStart.y, p.x, p.y, { assist: !free, range: snapRange() });
      setWireStart(null);
      setCursor(null);
      setHint(null);
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
                {/* 細い線でもつかめるように、見えない太い線を重ねる */}
                <path
                  d={`M ${it.x} ${it.y} L ${it.x + it.w} ${it.y} M ${it.x} ${it.y} L ${it.x} ${it.y + 26} M ${it.x + it.w} ${it.y} L ${it.x + it.w} ${it.y + 26}`}
                  strokeWidth={18}
                  stroke="transparent"
                />
                {it.label && (
                  <text x={it.x} y={it.y - 6} fontSize={LABEL_FONT} fontFamily={FONT_FAMILY} fill="currentColor" stroke="none">
                    {it.label}
                  </text>
                )}
              </g>
            );
          }

          if (it.kind === 'text') {
            return (
              <g {...common}>
                <text x={it.x} y={it.y} fontSize={LABEL_FONT} textAnchor={it.anchor} fontFamily={FONT_FAMILY} fill="currentColor" stroke="none">
                  {it.lines.map((l, i) => (
                    <tspan key={i} x={it.x} dy={i === 0 ? 0 : LABEL_LINE}>
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
                  fontSize={LABEL_FONT}
                  textAnchor={it.labelAnchor}
                  fontFamily={FONT_FAMILY}
                  fill="currentColor"
                  stroke="none"
                >
                  {it.label.map((l, i) => (
                    <tspan key={i} x={it.x + it.labelDx} dy={i === 0 ? 0 : LABEL_LINE}>
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
            x2={hint ? hint.x : Math.abs(cursor.x - wireStart.x) <= Math.abs(cursor.y - wireStart.y) ? wireStart.x : cursor.x}
            y2={hint ? hint.y : Math.abs(cursor.x - wireStart.x) <= Math.abs(cursor.y - wireStart.y) ? cursor.y : wireStart.y}
            strokeWidth={1}
          />
        )}
        {/* 吸い付く先の目印（丸）。揃う位置のときは、目安の線 */}
        {mode === 'wire' && hint && (hint.kind === 'port' || hint.kind === 'end' || hint.kind === 'wire') && (
          <circle className="snap-mark" cx={hint.x} cy={hint.y} r={snapRange() * 0.6} pointerEvents="none" />
        )}
        {mode === 'wire' && hint?.guideX !== undefined && (
          <line className="guide" x1={hint.guideX} y1={vb.y} x2={hint.guideX} y2={vb.y + vb.h} pointerEvents="none" />
        )}
        {mode === 'wire' && hint?.guideY !== undefined && (
          <line className="guide" x1={vb.x} y1={hint.guideY} x2={vb.x + vb.w} y2={hint.guideY} pointerEvents="none" />
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
