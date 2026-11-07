import { getSymbol } from '@zumen/symbols';
import type { CircleShape, LineShape, RectShape } from '@zumen/symbols';

/**
 * 停電範囲図などに付ける、開放の赤い×印の形。
 *
 * 正方形で、太さは均一。大きさは3種類で、記号の定義から決める（記号の大きさを変えたら、×印も一緒に変わる）。
 *   大：PASの外枠の横幅 ／ 小：変圧器の丸い記号の横幅 ／ 中：その中間
 * 太さは、母線の太さの、小3倍・中4倍・大5倍。
 */
export type CrossSize = 'S' | 'M' | 'L';
export const CROSS_SIZE_IDS: readonly CrossSize[] = ['S', 'M', 'L'];

const rectOf = (id: string): RectShape => getSymbol(id).shapes.find((s): s is RectShape => s.k === 'rect')!;
const circleOf = (id: string): CircleShape => getSymbol(id).shapes.find((s): s is CircleShape => s.k === 'circle')!;
const BUS_WIDTH = getSymbol('bus').shapes.find((s): s is LineShape => s.k === 'line')?.sw ?? 1;
/** PASの外枠の横幅（内蔵機器を入れる形。ふだんの図面の PAS） */
const PAS_FRAME = rectOf('pas-builtin').w;
/** 変圧器の丸い記号の横幅（直径） */
const TR_DIAMETER = circleOf('tr-3p-dy').r * 2;

export const CROSS_SPECS: Readonly<Record<CrossSize, { size: number; thickness: number }>> = {
  S: { size: TR_DIAMETER, thickness: BUS_WIDTH * 3 },
  M: { size: (PAS_FRAME + TR_DIAMETER) / 2, thickness: BUS_WIDTH * 4 },
  L: { size: PAS_FRAME, thickness: BUS_WIDTH * 5 },
};

/**
 * ×印の外形（中心 cx・cy、一辺 size、太さ thickness）。
 * 斜めの2本の帯が重なった形を、外形がちょうど size×size の正方形に収まるように、16個の点で表す
 * （線で描くと、太いとき、端が四角からはみ出して、横幅が size にならない）。
 */
export function crossPoints(cx: number, cy: number, size: number, thickness: number): [number, number][] {
  const a = thickness / Math.SQRT2;
  const s = size;
  const p: [number, number][] = [
    [0, 0], [a, 0], [s / 2, s / 2 - a], [s - a, 0], [s, 0], [s, a], [s / 2 + a, s / 2], [s, s - a],
    [s, s], [s - a, s], [s / 2, s / 2 + a], [a, s], [0, s], [0, s - a], [s / 2 - a, s / 2], [0, a],
  ];
  return p.map(([x, y]) => [cx - s / 2 + x, cy - s / 2 + y]);
}

/** SVG の polygon の points 属性 */
export const crossPointsAttr = (cx: number, cy: number, size: number, thickness: number): string =>
  crossPoints(cx, cy, size, thickness)
    .map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`)
    .join(' ');
