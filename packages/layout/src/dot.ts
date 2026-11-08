import { LABEL_FONT, LABEL_LINE, OVERLAY_RED, clampTextSize } from './text.ts';

/**
 * 停電範囲図などに置く、赤い丸い点と、印加点の矢印。
 *
 * - 丸い点：赤で塗りつぶした小さな丸。渡り線（点と点をつなぐ弧の線）の両端や、印加点の目印に使う。
 * - 印加点の矢印：丸い点を指す赤い矢印。矢印の根もと（尾）の側に、文字（「印加点」など。任意で書き換えられる）を付ける。
 *   尾の向きは8方向（上・右上・右・右下・下・左下・左・左上）から選び、長さは自由に変えられる。
 */

/** 丸い点の半径（変圧器を表す二重丸の接点と同じくらいの、小さな丸） */
export const DOT_RADIUS = 5;

/** 矢印の線の太さ（ふつうの線は1。「少し太め」） */
export const ARROW_STROKE = 2;
/** 矢印の先から丸い点の縁までの、すき間 */
export const ARROW_GAP = 2;
/** 矢印の頭の、長さと、半分の幅 */
export const ARROW_HEAD = 10;
export const ARROW_HEAD_HALF = 4;
/** 矢印の長さ（丸い点の中心から、尾の端まで）の、いちばん短い長さ・いちばん長い長さ・最初の長さ・変えるときの1回ぶん */
export const ARROW_LEN_MIN = 20;
export const ARROW_LEN_MAX = 200;
export const ARROW_LEN_DEFAULT = 40;
export const ARROW_LEN_STEP = 4;

/** 尾の向き（丸い点から見て、矢印の根もとがある方向） */
export type ArrowDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const ARROW_DIRS: readonly ArrowDir[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
/** 最初の向き：左（左から、点に向かって右向きの矢印） */
export const ARROW_DIR_DEFAULT: ArrowDir = 'w';

const R2 = Math.SQRT1_2;
const UNIT: Record<ArrowDir, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  ne: { x: R2, y: -R2 },
  e: { x: 1, y: 0 },
  se: { x: R2, y: R2 },
  s: { x: 0, y: 1 },
  sw: { x: -R2, y: R2 },
  w: { x: -1, y: 0 },
  nw: { x: -R2, y: -R2 },
};

/** 矢印の長さとして読む（範囲に収める。数でないものは、最初の長さ） */
export const clampArrowLen = (v: number): number => (Number.isFinite(v) ? Math.min(ARROW_LEN_MAX, Math.max(ARROW_LEN_MIN, v)) : ARROW_LEN_DEFAULT);

/** 尾の位置から、いちばん近い向き（8方向）と長さにする。長さは、格子（2）に合わせる */
export function arrowFromTail(dx: number, dy: number): { dir: ArrowDir; len: number } {
  const len = clampArrowLen(Math.round(Math.hypot(dx, dy) / 2) * 2);
  let best: ArrowDir = ARROW_DIR_DEFAULT;
  let bestDot = -Infinity;
  const n = Math.hypot(dx, dy) || 1;
  for (const d of ARROW_DIRS) {
    const u = UNIT[d];
    const dot = (u.x * dx + u.y * dy) / n;
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return { dir: best, len };
}

/** 図面に出す丸い点（中心の位置） */
export interface DrawingDot {
  x: number;
  y: number;
}

/** 矢印に付ける文字 */
export interface ArrowLabel {
  lines: string[];
  size?: number;
  bold?: boolean;
}

/** 図面に出す印加点の矢印。x・y は、指している丸い点の中心 */
export interface DrawingArrow {
  x: number;
  y: number;
  dir: ArrowDir;
  len: number;
  label?: ArrowLabel;
}

/** 尾の端の位置（図面の座標） */
export function arrowTail(a: Pick<DrawingArrow, 'x' | 'y' | 'dir' | 'len'>): { x: number; y: number } {
  const u = UNIT[a.dir];
  return { x: a.x + u.x * a.len, y: a.y + u.y * a.len };
}

/** 矢印の先（丸い点の縁のすぐ外）の位置 */
export function arrowTip(a: Pick<DrawingArrow, 'x' | 'y' | 'dir'>): { x: number; y: number } {
  const u = UNIT[a.dir];
  const d = DOT_RADIUS + ARROW_GAP;
  return { x: a.x + u.x * d, y: a.y + u.y * d };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 丸い点の SVG の部品（赤で塗りつぶす） */
export function dotSvg(d: DrawingDot, opts: { indent?: string; opacity?: number; color?: string } = {}): string {
  const indent = opts.indent ?? '    ';
  const op = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  return `${indent}<circle cx="${r2(d.x)}" cy="${r2(d.y)}" r="${DOT_RADIUS}" fill="${opts.color ?? OVERLAY_RED}" stroke="none"${op} />`;
}

/** 矢印（線と頭）の SVG の部品 */
export function arrowSvg(a: DrawingArrow, opts: { indent?: string; opacity?: number; color?: string } = {}): string {
  const indent = opts.indent ?? '    ';
  const color = opts.color ?? OVERLAY_RED;
  const op = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  const u = UNIT[a.dir];
  const tip = arrowTip(a);
  const tail = arrowTail(a);
  // 頭の根もと（尾の側へ ARROW_HEAD 戻った所）。線は、頭の根もとまで引く
  const bx = tip.x + u.x * ARROW_HEAD;
  const by = tip.y + u.y * ARROW_HEAD;
  const px = -u.y;
  const py = u.x;
  const head = [
    [tip.x, tip.y],
    [bx + px * ARROW_HEAD_HALF, by + py * ARROW_HEAD_HALF],
    [bx - px * ARROW_HEAD_HALF, by - py * ARROW_HEAD_HALF],
  ]
    .map(([x, y]) => `${r2(x!)},${r2(y!)}`)
    .join(' ');
  return [
    `${indent}<line x1="${r2(tail.x)}" y1="${r2(tail.y)}" x2="${r2(bx)}" y2="${r2(by)}" stroke="${color}" stroke-width="${ARROW_STROKE}" stroke-linecap="butt"${op} />`,
    `${indent}<polygon points="${head}" fill="${color}" stroke="none"${op} />`,
  ].join('\n');
}

/**
 * 矢印の文字を書く位置。尾の端の外側（右側にあれば右、左側にあれば左。真上・真下は、尾の右に）。
 * 横向き（右・左）の矢印は、尾の高さに、文字のかたまりの中央をそろえる。
 */
export function arrowLabelAt(a: DrawingArrow, label: ArrowLabel): { x: number; y: number; anchor: 'start' | 'end' } {
  const k = clampTextSize(label.size);
  const lh = LABEL_LINE * k;
  const tail = arrowTail(a);
  const n = label.lines.length;
  const west = a.dir === 'w' || a.dir === 'nw' || a.dir === 'sw';
  const x = west ? tail.x - 4 : tail.x + 4;
  let y: number;
  if (a.dir === 'e' || a.dir === 'w') y = tail.y - ((n - 1) * lh) / 2 + LABEL_FONT * k * 0.35;
  else if (a.dir === 'n' || a.dir === 'ne' || a.dir === 'nw') y = tail.y - 6 - (n - 1) * lh;
  else y = tail.y + LABEL_FONT * k + 4;
  return { x, y, anchor: west ? 'end' : 'start' };
}
