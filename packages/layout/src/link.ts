import { OVERLAY_RED } from './text.ts';

/**
 * 停電範囲図などの、渡り線（赤い丸い点と点を、弧の線でつなぐもの）。
 *
 * - 線は赤で、少し太め（2）。点と点の中心を結ぶ。丸い点は線の上に重なる（点のほうを上に描く）。
 * - 弧の形は4つ：直線／ゆるい弧／普通の弧／すごく丸い弧（半円）。点と点の距離（弦）に対する、ふくらみの高さの割合で決める。
 * - ふくらむ向きは、点から点へ向かう向きの左側が最初の向き。反転すると、右側になる。
 */

/** 線の太さ（ふつうの線は1、母線は3。「少し太め」） */
export const LINK_STROKE = 2;

export type LinkShape = 'straight' | 'gentle' | 'normal' | 'round';
export interface LinkShapeDef {
  id: LinkShape;
  /** 弦の長さに対する、ふくらみの高さの割合（半円で 0.5） */
  bulge: number;
}
export const LINK_SHAPES: readonly LinkShapeDef[] = [
  { id: 'straight', bulge: 0 },
  { id: 'gentle', bulge: 0.12 },
  { id: 'normal', bulge: 0.25 },
  { id: 'round', bulge: 0.5 },
];
export const LINK_SHAPE_DEFAULT: LinkShape = 'normal';

export const linkShapeDef = (id: LinkShape | undefined): LinkShapeDef => LINK_SHAPES.find((s) => s.id === id) ?? LINK_SHAPES.find((s) => s.id === LINK_SHAPE_DEFAULT)!;

/** 図面に出す渡り線（両端の点の中心と、形・ふくらむ向き） */
export interface DrawingLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  shape: LinkShape;
  flip: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** ふくらみの高さ（弦の長さ × 割合） */
function heightOf(l: DrawingLink): number {
  return Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * linkShapeDef(l.shape).bulge;
}

/** 弧のいちばんふくらんだ所（弦の中央から、ふくらむ向きへ、高さぶん） */
export function linkApex(l: DrawingLink): { x: number; y: number } {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const c = Math.hypot(dx, dy) || 1;
  // 点から点へ向かう向きの左側（画面では、東向きなら上）が、最初のふくらむ向き
  const nx = dy / c;
  const ny = -dx / c;
  const h = heightOf(l) * (l.flip ? -1 : 1);
  return { x: (l.x1 + l.x2) / 2 + nx * h, y: (l.y1 + l.y2) / 2 + ny * h };
}

/** 線の道すじ（SVG の path の d）。直線は M〜L、弧は円弧。両端が同じ場所なら、空 */
export function linkPath(l: DrawingLink): string {
  const c = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  if (c < 0.01) return '';
  const h = heightOf(l);
  const m = `M ${r2(l.x1)} ${r2(l.y1)}`;
  if (h < 0.01) return `${m} L ${r2(l.x2)} ${r2(l.y2)}`;
  // 半径：弦 c と高さ h の円弧は、r = (c²/4 + h²) / (2h)。高さは弦の半分以下なので、大きいほうの弧にはならない
  const r = (c * c) / 4 / h / 2 + h / 2;
  return `${m} A ${r2(r)} ${r2(r)} 0 0 ${l.flip ? 0 : 1} ${r2(l.x2)} ${r2(l.y2)}`;
}

/** SVG の部品 */
export function linkSvg(l: DrawingLink, opts: { indent?: string; opacity?: number; color?: string } = {}): string {
  const d = linkPath(l);
  if (!d) return '';
  const indent = opts.indent ?? '    ';
  const op = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  return `${indent}<path d="${d}" fill="none" stroke="${opts.color ?? OVERLAY_RED}" stroke-width="${LINK_STROKE}" stroke-linecap="round"${op} />`;
}
