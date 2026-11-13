import { hline, shapesToSvg, vline } from '@zumen/symbols';
import type { Shape } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, OVERLAY_RED, clampTextSize } from './text.ts';

/**
 * 停電範囲図などに置く、短絡接地器具の赤い接地のマーク。
 *
 * マークの向きは、いつも下向き（横線が地面と平行で、下に行くほど短くなる）。形は、記号マスタの「接地」と同じ比率の3本の横線を
 * 1.5倍にし、線の太さを2（ふつうの線の2倍）にして、赤くしたもの。
 *
 * つなぎ方は2つ。どちらも、つなぐ場所（母線の途中・記号の接続点）から出る：
 *   A．横棒あり：つなぐ場所から、左か右へ横棒（lead の長さ）を出し、その先から下へ縦の線（drop の長さ）を引いて、マークを付ける
 *   B．横棒なし：lead が 0。つなぐ場所から、まっすぐ下へ縦の線（drop の長さ）を引いて、マークを付ける
 * lead は左右の向きつき（右が正、左が負）。左右を反転するには、符号を変える。
 */

/** 接地の記号に対する倍率 */
const SCALE = 1.5;

/**
 * マークの大きさ（第13弾 項目32）。中＝これまでの大きさ、大＝中の1.5倍（横線の長さ・間隔を1.5倍。線の太さは変えない）。
 * 無指定は中
 */
export type GroundSize = 'M' | 'L';
export const GROUND_SIZE_IDS: readonly GroundSize[] = ['M', 'L'];
export const GROUND_SCALES: Readonly<Record<GroundSize, number>> = { M: 1, L: 1.5 };
/** 線の太さ（ふつうの線は1、母線は3。「少し太め」） */
export const GROUND_STROKE = 2;
/** 縦の線の、いちばん短い長さ（つなぐ場所から、いちばん上の横線まで） */
export const GROUND_DROP_MIN = 8;
/** 横棒の、いちばん短い長さ。これより短いときは、横棒なし（B）にする */
export const GROUND_LEAD_MIN = 8;
/** 縦の長さ・横棒の長さを、ボタンや矢印キーで変えるときの、1回ぶん */
export const GROUND_STEP = 4;
/** 最初に出すときの、横棒・縦の長さ（ボタンで「横棒を付ける」にしたとき） */
export const GROUND_LEAD_DEFAULT = 30;

/** 横線の、半分の長さ（上から順に） */
const HALF_WIDTHS = [9 * SCALE, 5.5 * SCALE, 2.5 * SCALE];
/** 横線どうしの間隔 */
const BAR_GAP = 4 * SCALE;
/** マーク（3本の横線）のいちばん広い半幅と、いちばん上の線から、いちばん下の線までの高さ */
export const GROUND_HALF_WIDTH = HALF_WIDTHS[0]!;
const BARS_HEIGHT = BAR_GAP * 2;

/** 縦の長さ・横棒の長さとして読む（範囲に収める。横棒は、短すぎれば 0＝横棒なし） */
export const clampDrop = (v: number): number => (Number.isFinite(v) ? Math.max(GROUND_DROP_MIN, v) : GROUND_DROP_MIN);
export const clampLead = (v: number): number => (Number.isFinite(v) && Math.abs(v) >= GROUND_LEAD_MIN ? v : 0);

/**
 * つなぐ場所 (px,py) と、マークを置く場所（縦の線の先＝いちばん上の横線の中央）(tx,ty) から、横棒と縦の長さを決める。
 * 真下に近ければ横棒なし、横にずれていれば、ずれた向きに横棒を出す。長さは、格子（2）に合わせる。
 */
export function groundFromTip(px: number, py: number, tx: number, ty: number): { lead: number; drop: number } {
  const snap2 = (v: number) => Math.round(v / 2) * 2;
  return { lead: clampLead(snap2(tx - px)), drop: clampDrop(snap2(ty - py)) };
}

/** 接地のマークの形（つなぐ場所が原点） */
export function groundShapes(lead: number, drop: number, k = 1): Shape[] {
  const o = { sw: GROUND_STROKE };
  const shapes: Shape[] = [];
  if (lead !== 0) shapes.push(hline(0, 0, lead, o));
  shapes.push(vline(lead, 0, drop, o));
  HALF_WIDTHS.forEach((hw, i) => shapes.push(hline(drop + BAR_GAP * k * i, lead - hw * k, lead + hw * k, o)));
  return shapes;
}

/** 外形（図面の座標）。線の太さまで含める */
export function groundBounds(px: number, py: number, lead: number, drop: number, k = 1): { x0: number; y0: number; x1: number; y1: number } {
  const cx = px + lead;
  return {
    x0: Math.min(px, cx - GROUND_HALF_WIDTH * k),
    y0: py,
    x1: Math.max(px, cx + GROUND_HALF_WIDTH * k),
    y1: py + drop + BARS_HEIGHT * k + GROUND_STROKE / 2,
  };
}

/** マークの先（縦の線の先＝いちばん上の横線の中央）の位置 */
export const groundTip = (px: number, py: number, lead: number, drop: number): { x: number; y: number } => ({ x: px + lead, y: py + drop });

/** SVG の部品。ghost が true のときは、置く前の見本として、薄く（透かして）描く */
export function groundSvg(px: number, py: number, lead: number, drop: number, opts: { indent?: string; color?: string; opacity?: number; scale?: number } = {}): string {
  const indent = opts.indent ?? '    ';
  const r = (v: number) => Math.round(v * 100) / 100;
  const op = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  return `${indent}<g transform="translate(${r(px)} ${r(py)})" stroke="${opts.color ?? OVERLAY_RED}" fill="none" stroke-linecap="butt"${op}>\n${shapesToSvg(groundShapes(lead, drop, opts.scale ?? 1), `${indent}  `)}\n${indent}</g>`;
}

/** マークの横に付ける文字（番号・回路名など）。マークごとに任意で付けられる。大きさ・太字・色は、テキストボックスと同じ */
export interface GroundLabel {
  lines: string[];
  size?: number;
  bold?: boolean;
  red?: boolean;
}

/**
 * 文字を書く位置。マークの、母線から遠い側（右へ出していれば右、左へ出していれば左、横棒なしは右）の横に、
 * いちばん上の横線の高さから書き始める。
 */
export function groundLabelAt(px: number, py: number, lead: number, drop: number, k = 1): { x: number; y: number; anchor: 'start' | 'end' } {
  const left = lead < 0;
  const cx = px + lead;
  return { x: left ? cx - GROUND_HALF_WIDTH * k - 6 : cx + GROUND_HALF_WIDTH * k + 6, y: py + drop + 4, anchor: left ? 'end' : 'start' };
}

/** 文字の外形（図面の座標。画面で、選ぶ枠や、重なりの確認に使う）。文字が無ければ null */
export function groundLabelBounds(px: number, py: number, lead: number, drop: number, label: GroundLabel | undefined, widthOf: (lines: string[], size: number) => number, scale = 1): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!label || label.lines.every((l) => l === '')) return null;
  const k = clampTextSize(label.size);
  const at = groundLabelAt(px, py, lead, drop, scale);
  const w = widthOf(label.lines, LABEL_FONT * k);
  const x0 = at.anchor === 'end' ? at.x - w : at.x;
  return { x0, y0: at.y - LABEL_FONT * k, x1: x0 + w, y1: at.y + label.lines.length * LABEL_LINE * k };
}

/** 図面に出す接地のマーク（つなぐ場所の位置・横棒・縦の長さ・文字） */
export interface DrawingGround {
  x: number;
  y: number;
  lead: number;
  drop: number;
  /** マークの大きさの倍率（無ければ1＝中。大は1.5） */
  scale?: number;
  label?: GroundLabel;
}
