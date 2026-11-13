/**
 * 図面の文字の大きさと、文字の幅の見積もり。
 * 印刷（svg.ts）・自動配置（layout.ts）・編集画面で、同じ値を使う。
 */

/** 記号の横などに書く文字の大きさ（作図単位）。A4縦で縮めずに印刷すると、紙の上で約2.8mm */
export const LABEL_FONT = 10;

/**
 * 太字にするとき、文字の輪郭に足す線の太さ（文字の大きさに比例）。
 * 文字の字体（フォント）に太字が無いと、「太字」を指定しても見た目が変わらないことがあるため、字体に頼らず、輪郭を足して太く見せる
 * （字体に太字があるときは、その太字に、さらに少し足す）
 */
export const boldStrokeWidth = (fontSize: number): number => Math.round(fontSize * 0.06 * 100) / 100;
/** 文字を複数行にしたときの、行から行までの間隔 */
export const LABEL_LINE = 12.5;

/**
 * 手で足す文字（メモ）の大きさの範囲。記号の横の文字（LABEL_FONT）を1倍とする。
 * 縦横の比は変えず、全体の大きさだけを変える。1倍より小さくはできない。
 */
export const TEXT_SIZE_MIN = 1;
export const TEXT_SIZE_MAX = 5;
/** ボタンで大きさを変えるときの、1回ぶん */
export const TEXT_SIZE_STEP = 0.25;

/** 文字の大きさの倍率として読む（範囲外・数でないものは、範囲の中に収める。無ければ1倍） */
export function clampTextSize(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : TEXT_SIZE_MIN;
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, n));
}

/** レイヤー（停電範囲図など）に重ねる、赤い印・文字の色。カラー印刷の前提で、はっきりした赤にする */
export const OVERLAY_RED = '#d40000';

/**
 * 文字列の幅の見積もり（作図単位）。
 * 全角の文字は1文字ぶん、半角の英数字は0.5〜0.7文字ぶん。実際のフォントで測った値より
 * わずかに大きめに見積もる（枠からはみ出さないように）。
 */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0x20) w += 0.35;
    else if (c < 0x80) w += /[A-Z0-9]/.test(ch) ? 0.68 : /[.,:;!|'`()]/.test(ch) ? 0.4 : 0.58;
    else if (c >= 0xff61 && c <= 0xff9f) w += 0.55; // 半角カナ
    else w += 1;
  }
  return w * size;
}

/** 複数行の文字のうち、いちばん長い行の幅 */
export const labelWidth = (lines: string[], size = LABEL_FONT): number =>
  Math.max(0, ...lines.map((l) => textWidth(l, size)));
