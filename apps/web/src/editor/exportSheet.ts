import { getSymbol } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, labelRect, labelWidth, renderSvg } from '@zumen/layout';
import type { DrawingLayout, Orientation, PaperSize, TitleBlock } from '@zumen/layout';
import type { Doc } from './doc.ts';

/** 編集中の図面を、図枠・表題欄つきの1枚のSVGにする */
export function buildSheetSvg(
  doc: Doc,
  title: TitleBlock,
  paper: PaperSize = 'A4',
  orientation: Orientation = 'portrait',
): string {
  const drawing: DrawingLayout = {
    symbols: [],
    wires: [],
    frames: [],
    texts: [],
    bounds: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  };

  for (const it of doc.items) {
    if (it.kind === 'wire') {
      drawing.wires.push({ x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, dashed: it.dashed });
    } else if (it.kind === 'frame') {
      drawing.frames.push({ x: it.x, y: it.y, w: it.w, label: it.label });
    } else if (it.kind === 'text') {
      drawing.texts!.push({ x: it.x, y: it.y, lines: it.lines, anchor: it.anchor });
    } else {
      drawing.symbols.push({
        id: it.id,
        role: it.id,
        symbolId: it.symbolId,
        x: it.x,
        y: it.y,
        rotate: it.rotate,
        label: it.label,
        labelAt: { x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor },
      });
    }
  }

  // 外形を求める（図枠に収めるために使う）
  const b = drawing.bounds;
  const ext = (x0: number, y0: number, x1: number, y1: number) => {
    b.x0 = Math.min(b.x0, x0);
    b.y0 = Math.min(b.y0, y0);
    b.x1 = Math.max(b.x1, x1);
    b.y1 = Math.max(b.y1, y1);
  };
  for (const s of drawing.symbols) {
    const def = getSymbol(s.symbolId);
    ext(s.x, s.y, s.x + def.box.w, s.y + def.box.h);
    if (s.label.length) {
      const r = labelRect(s.labelAt, s.label);
      ext(r.x0, r.y0, r.x1, r.y1);
    }
  }
  for (const w of drawing.wires) {
    ext(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2));
  }
  for (const f of drawing.frames) ext(f.x, f.y - 14, f.x + f.w, f.y + 26);
  for (const t of drawing.texts!) {
    const w = labelWidth(t.lines);
    ext(t.x, t.y - LABEL_FONT, t.x + w, t.y + t.lines.length * LABEL_LINE);
  }
  if (!Number.isFinite(b.x0)) Object.assign(b, { x0: 0, y0: 0, x1: 100, y1: 100 });

  return renderSvg(drawing, title, { paper, orientation });
}
