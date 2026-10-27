/**
 * 図面の文字の大きさと、文字の幅の見積もり。
 * 印刷（svg.ts）・自動配置（layout.ts）・編集画面で、同じ値を使う。
 */

/** 記号の横などに書く文字の大きさ（作図単位）。A4縦で縮めずに印刷すると、紙の上で約2.8mm */
export const LABEL_FONT = 10;
/** 文字を複数行にしたときの、行から行までの間隔 */
export const LABEL_LINE = 12.5;

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
