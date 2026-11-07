import { hline, shapesToSvg, vline } from '@zumen/symbols';
import type { Shape } from '@zumen/symbols';
import { OVERLAY_RED } from './text.ts';

/**
 * 停電範囲図などに置く、短絡接地器具の赤い接地のマーク。
 *
 * 形は、接地の記号（記号マスタの「接地」＝3本の横線）と同じ比率で、少し大きくし（1.5倍）、線を太く（2）してある。
 * 取り付ける点（線のつなぎ先）は、縦の線の先（0,0）。そこから、接地の向きに、短い線と3本の横線が伸びる。
 * 向き（rotate）は、横線が向く方向：0＝下、90＝左、180＝上、270＝右（取り付ける点のまわりに回す）。
 */
export type GroundRotate = 0 | 90 | 180 | 270;
export const GROUND_ROTATES: readonly GroundRotate[] = [0, 90, 180, 270];

/** 接地の記号に対する倍率 */
const SCALE = 1.5;
/** 線の太さ（ふつうの線は1、母線は3。「少し太め」） */
export const GROUND_STROKE = 2;
/** 取り付ける点から、いちばん上の横線までの、縦の線の長さ */
const STEM = 10;

/** 接地のマークの形（取り付ける点が原点、向きは下） */
export function groundShapes(): Shape[] {
  const o = { sw: GROUND_STROKE };
  return [
    vline(0, 0, STEM, o),
    hline(STEM, -9 * SCALE, 9 * SCALE, o),
    hline(STEM + 4 * SCALE, -5.5 * SCALE, 5.5 * SCALE, o),
    hline(STEM + 8 * SCALE, -2.5 * SCALE, 2.5 * SCALE, o),
  ];
}

/** 外形（取り付ける点が原点、向きは下）。一番下の線の太さまで含める */
const EXTENT = { halfW: 9 * SCALE, bottom: STEM + 8 * SCALE + GROUND_STROKE / 2 };

/** 置いたときの外形（図面の座標。回したあとの、横縦の範囲）。図枠に収める計算と、選ぶ枠の大きさに使う */
export function groundBounds(x: number, y: number, rotate: number): { x0: number; y0: number; x1: number; y1: number } {
  const d = ((rotate % 360) + 360) % 360;
  const { halfW, bottom } = EXTENT;
  // 向き0（下）の外形：x は -halfW〜halfW、y は 0〜bottom。回したあとに入れ替える
  if (d === 90) return { x0: x - bottom, y0: y - halfW, x1: x, y1: y + halfW };
  if (d === 180) return { x0: x - halfW, y0: y - bottom, x1: x + halfW, y1: y };
  if (d === 270) return { x0: x, y0: y - halfW, x1: x + bottom, y1: y + halfW };
  return { x0: x - halfW, y0: y, x1: x + halfW, y1: y + bottom };
}

/** SVG の部品（赤・線の端は切り落とし）。x・y は取り付ける点 */
export function groundSvg(x: number, y: number, rotate: number, indent = '    '): string {
  const r = Math.round(x * 100) / 100;
  const s = Math.round(y * 100) / 100;
  return `${indent}<g transform="translate(${r} ${s})${rotate ? ` rotate(${rotate})` : ''}" stroke="${OVERLAY_RED}" fill="none" stroke-linecap="butt">\n${shapesToSvg(groundShapes(), `${indent}  `)}\n${indent}</g>`;
}
