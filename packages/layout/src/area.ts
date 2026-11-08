import { LABEL_FONT, LABEL_LINE, OVERLAY_RED, clampTextSize } from './text.ts';

/**
 * 停電範囲図などの、赤い枠（範囲を囲む四角）。
 *
 * - 線は赤で、少し太め（2）。
 * - 「充電範囲」の枠には、枠の中に、赤い斜線（右上がり）を、均等に入れる。線は細く（中の図記号や線が見えるように）、間隔は、
 *   枠の大きさによらず一定にする（大きい枠でも、まばらにならない）。「停電範囲」「印加範囲」の枠には、入れない。
 * - 枠の近くに、文字（「停電範囲」「充電範囲」など。任意）を、四隅のどこかの外側に書く。文字の色は、枠と同じ赤。
 */

/** 枠の線の太さ（ふつうの線は1、母線は3。「少し太め」） */
export const AREA_STROKE = 2;
/** 斜線の太さ（細く） */
export const HATCH_STROKE = 0.8;
/** 斜線どうしの間隔（線に直角に測った長さ）。枠の大きさによらず一定 */
export const HATCH_GAP = 6;
/** 枠のいちばん小さい大きさ（ドラッグで描いたとき、これより小さければ、置かない） */
export const AREA_MIN = 12;

/** 文字を書く位置：枠の、左上・右上・左下・右下の外側 */
export type AreaLabelPos = 'tl' | 'tr' | 'bl' | 'br';
export const AREA_LABEL_POSITIONS: readonly AreaLabelPos[] = ['tl', 'tr', 'bl', 'br'];

export interface AreaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 枠に付ける文字 */
export interface AreaLabel {
  lines: string[];
  size?: number;
  bold?: boolean;
  pos: AreaLabelPos;
}

/** 図面に出す赤い枠 */
export interface DrawingArea extends AreaRect {
  hatch: boolean;
  label?: AreaLabel;
}

/**
 * 斜線（右上がり）の線分。枠の中にだけ、gap の間隔で、均等に並ぶ。
 * 向きが右上がりの直線 x + y = c を、c を一定の刻みで動かして、枠との交わりを線分にしている（切り抜きの機能は使わない）。
 */
export function hatchSegments(r: AreaRect, gap = HATCH_GAP): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  // 隣の線との間隔（線に直角に測る）が gap になるよう、x + y = c の c の刻みは gap×√2
  const step = gap * Math.SQRT2;
  const x0 = r.x;
  const x1 = r.x + r.w;
  const y0 = r.y;
  const y1 = r.y + r.h;
  const first = Math.ceil((x0 + y0) / step) * step;
  for (let c = first; c < x1 + y1; c += step) {
    // 直線 y = c - x と、枠の交わり：x の範囲は、枠の左右と、y が枠の上下に収まる範囲の、重なり
    const xa = Math.max(x0, c - y1);
    const xb = Math.min(x1, c - y0);
    if (xb - xa < 0.5) continue;
    out.push({ x1: xa, y1: c - xa, x2: xb, y2: c - xb });
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** SVG の部品（枠と、斜線）。色は赤 */
export function areaSvg(a: DrawingArea, opts: { indent?: string; opacity?: number; color?: string } = {}): string {
  const indent = opts.indent ?? '    ';
  const color = opts.color ?? OVERLAY_RED;
  const op = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  const parts = [`${indent}<rect x="${r2(a.x)}" y="${r2(a.y)}" width="${r2(a.w)}" height="${r2(a.h)}" fill="none" stroke="${color}" stroke-width="${AREA_STROKE}" stroke-linejoin="miter"${op} />`];
  if (a.hatch) {
    const d = hatchSegments(a)
      .map((s) => `M ${r2(s.x1)} ${r2(s.y1)} L ${r2(s.x2)} ${r2(s.y2)}`)
      .join(' ');
    if (d) parts.push(`${indent}<path d="${d}" fill="none" stroke="${color}" stroke-width="${HATCH_STROKE}" stroke-linecap="butt"${op} />`);
  }
  return parts.join('\n');
}

/**
 * 枠に付ける文字を書く位置。枠の、四隅のどこかの外側（左なら枠の左端から、右なら右端まで）。
 * 上側は、文字のかたまりが枠の上に収まるように、下側は、枠の下から書き始める。
 */
export function areaLabelAt(a: AreaRect, label: AreaLabel): { x: number; y: number; anchor: 'start' | 'end' } {
  const k = clampTextSize(label.size);
  const lh = LABEL_LINE * k;
  const top = label.pos === 'tl' || label.pos === 'tr';
  const right = label.pos === 'tr' || label.pos === 'br';
  const y = top ? a.y - 6 - (label.lines.length - 1) * lh : a.y + a.h + LABEL_FONT * k + 4;
  return { x: right ? a.x + a.w : a.x, y, anchor: right ? 'end' : 'start' };
}
