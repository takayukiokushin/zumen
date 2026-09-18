import { useRef, useState } from 'react';
import { FONT_FAMILY, getSymbol, shapesToSvg } from '@zumen/symbols';
import type { Doc, DocItem } from './doc.ts';
import { docBounds, itemBounds } from './doc.ts';

interface Props {
  doc: Doc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ドラッグが終わったときに一度だけ呼ぶ（元に戻すの単位をドラッグ1回にするため） */
  onMoveEnd: (id: string, dx: number, dy: number) => void;
  zoom: number;
}

/** 図面のキャンバス。記号をクリックで選び、ドラッグで動かせる */
export function DrawingCanvas({ doc, selectedId, onSelect, onMoveEnd, zoom }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

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
    e.stopPropagation();
    onSelect(it.id);
    if (it.kind === 'frame') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = toDrawing(e);
    setDrag({ id: it.id, dx: 0, dy: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !start.current) return;
    const p = toDrawing(e);
    setDrag({ id: drag.id, dx: p.x - start.current.x, dy: p.y - start.current.y });
  };

  const onPointerUp = () => {
    if (drag && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5)) {
      onMoveEnd(drag.id, Math.round(drag.dx), Math.round(drag.dy));
    }
    setDrag(null);
    start.current = null;
  };

  const offset = (id: string) => (drag && drag.id === id ? { x: drag.dx, y: drag.dy } : { x: 0, y: 0 });

  return (
    <svg
      ref={svgRef}
      className="canvas"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{ height: `${zoom * 100}%` }}
      onPointerDown={() => onSelect(null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="図面"
    >
      <g stroke="#000" fill="none" strokeLinecap="round" strokeLinejoin="round" color="#000">
        {doc.items.map((it) => {
          const o = offset(it.id);
          const selected = it.id === selectedId;
          const common = {
            key: it.id,
            transform: `translate(${o.x} ${o.y})`,
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

        {selectedId &&
          (() => {
            const it = doc.items.find((i) => i.id === selectedId);
            if (!it) return null;
            const bb = itemBounds(it);
            const o = offset(it.id);
            return (
              <rect
                className="selection"
                x={bb.x0 - 4 + o.x}
                y={bb.y0 - 4 + o.y}
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
