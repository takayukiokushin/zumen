import { getSymbol, sizedSymbol } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, clampTextSize, labelRect, labelWidth, renderSvg } from '@zumen/layout';
import { areaLabelAt, groundBounds, groundLabelAt } from '@zumen/layout';
import type { DrawingArea, DrawingCross, DrawingGround, DrawingLayout, Orientation, PaperSize, TitleBlock } from '@zumen/layout';
import type { Doc } from './doc.ts';

/** 編集中の図面を、図枠・表題欄つきの1枚のSVGにする */
export function buildSheetSvg(
  doc: Doc,
  title: TitleBlock,
  paper: PaperSize = 'A4',
  orientation: Orientation = 'portrait',
  /** 重ねる赤い×印（レイヤーを選んでいるとき） */
  crosses: DrawingCross[] = [],
  /** 重ねる赤い接地のマーク */
  grounds: DrawingGround[] = [],
  /** 重ねる赤い枠（範囲を囲む四角） */
  areas: DrawingArea[] = [],
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
      drawing.texts!.push({
        x: it.x,
        y: it.y,
        lines: it.lines,
        anchor: it.anchor,
        ...(it.size !== undefined ? { size: it.size } : {}),
        ...(it.bold ? { bold: true } : {}),
        ...(it.red ? { red: true } : {}),
      });
    } else {
      drawing.symbols.push({
        id: it.id,
        role: it.id,
        symbolId: it.symbolId,
        x: it.x,
        y: it.y,
        rotate: it.rotate,
        ...(it.w !== undefined ? { w: it.w } : {}),
        ...(it.h !== undefined ? { h: it.h } : {}),
        label: it.label,
        labelAt: { x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor },
      });
    }
  }

  // 接地のマークの横に付けた文字は、図面の文字として、一緒に出す（大きさ・太字・色も、そのまま）
  for (const g of grounds) {
    if (!g.label || g.label.lines.every((l) => l === '')) continue;
    const at = groundLabelAt(g.x, g.y, g.lead, g.drop);
    drawing.texts!.push({
      x: at.x,
      y: at.y,
      lines: g.label.lines,
      anchor: at.anchor,
      ...(g.label.size !== undefined ? { size: g.label.size } : {}),
      ...(g.label.bold ? { bold: true } : {}),
      ...(g.label.red ? { red: true } : {}),
    });
  }

  // 赤い枠の近くに付けた文字も、図面の文字として、一緒に出す
  for (const a of areas) {
    if (!a.label || a.label.lines.every((l) => l === '')) continue;
    const at = areaLabelAt(a, a.label);
    drawing.texts!.push({
      x: at.x,
      y: at.y,
      lines: a.label.lines,
      anchor: at.anchor,
      red: true,
      ...(a.label.size !== undefined ? { size: a.label.size } : {}),
      ...(a.label.bold ? { bold: true } : {}),
    });
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
    const def = sizedSymbol(getSymbol(s.symbolId), s);
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
    const k = clampTextSize(t.size);
    const w = labelWidth(t.lines, LABEL_FONT * k);
    ext(t.x, t.y - LABEL_FONT * k, t.x + w, t.y + t.lines.length * LABEL_LINE * k);
  }
  for (const c of crosses) ext(c.x - c.size / 2, c.y - c.size / 2, c.x + c.size / 2, c.y + c.size / 2);
  if (crosses.length > 0) drawing.crosses = crosses;
  for (const g of grounds) {
    const gb = groundBounds(g.x, g.y, g.lead, g.drop);
    ext(gb.x0, gb.y0, gb.x1, gb.y1);
  }
  if (grounds.length > 0) drawing.grounds = grounds;
  for (const a of areas) ext(a.x - 1, a.y - 1, a.x + a.w + 1, a.y + a.h + 1);
  if (areas.length > 0) drawing.areas = areas;
  if (!Number.isFinite(b.x0)) Object.assign(b, { x0: 0, y0: 0, x1: 100, y1: 100 });

  return renderSvg(drawing, title, { paper, orientation });
}
