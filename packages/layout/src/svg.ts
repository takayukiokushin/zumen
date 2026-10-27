import { FONT_FAMILY, getSymbol, shapesToSvg } from '@zumen/symbols';
import type { DrawingLayout } from './layout.ts';

/** 表題欄の内容 */
/** 図面の右下に入れる社名。全図面で共通 */
export const COMPANY_NAME = '株式会社フジエレックス';

export interface TitleBlock {
  /** 上の行（または1行にしたときの頭）。事業場名称、または表題欄への記載名 */
  site: string;
  /** 図面名称。「キュービクル式高圧受電設備単線結線図」など */
  name: string;
  footer?: string;
}

/* ---------------- 表題の枠（幅の自動調整と2行化） ---------------- */

/** 表題の文字の大きさ（作図単位） */
const TITLE_FONT = 14;
/** 枠の内側の左右の余白 */
const TITLE_PAD_X = 20;
/** 枠のいちばん狭い幅。短い名前でも、枠が小さくなりすぎないように */
const TITLE_MIN_W = 220;
/** 1行のときの枠の高さ／2行のときの枠の高さ */
const TITLE_BOX_H1 = 32;
const TITLE_BOX_H2 = 52;
/** 図枠の端から表題の枠までの、最低限の空き（左右） */
const TITLE_SIDE = 60;

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

export interface TitleLayout {
  /** 書く行（上から順）。size はその行の文字の大きさ */
  lines: { text: string; size: number }[];
  /** 枠の幅と高さ */
  boxW: number;
  boxH: number;
  /** 表題の枠まわりが使う高さ（図枠の上端から、作図範囲の手前まで） */
  titleH: number;
  twoLines: boolean;
}

/**
 * 表題の文字量から、枠の大きさと行の分け方を決める。
 *
 * - 枠の幅は文字量に合わせる（短ければ狭く、長ければ広く）。上限は図枠の幅から左右 60 ずつ引いた幅
 * - 「事業場名称＋図面名称」を1行に書いて上限に収まらないときだけ、2行にする
 *   （上の行は事業場名称、下の行は図面名称）
 * - どんな長さでも枠からはみ出さない。1行がそれでも収まらないときは、その行の文字を小さくして収める
 */
export function layoutTitle(title: TitleBlock, sheetW: number, margin: number): TitleLayout {
  const maxBoxW = sheetW - margin * 2 - TITLE_SIDE * 2;
  const room = maxBoxW - TITLE_PAD_X * 2;
  const site = title.site.trim();
  const name = title.name.trim();
  const one = site ? `${site}　${name}` : name;

  if (textWidth(one, TITLE_FONT) <= room) {
    const boxW = Math.min(maxBoxW, Math.max(TITLE_MIN_W, textWidth(one, TITLE_FONT) + TITLE_PAD_X * 2));
    return { lines: [{ text: one, size: TITLE_FONT }], boxW, boxH: TITLE_BOX_H1, titleH: TITLE_BOX_H1 + 12, twoLines: false };
  }

  // 2行。それでも収まらない行は、文字を小さくして枠の中に収める
  const fit = (text: string) => {
    const w = textWidth(text, TITLE_FONT);
    return { text, size: w <= room ? TITLE_FONT : (TITLE_FONT * room) / w };
  };
  const lines = [fit(site), fit(name)];
  const widest = Math.max(...lines.map((l) => textWidth(l.text, l.size)));
  const boxW = Math.min(maxBoxW, Math.max(TITLE_MIN_W, widest + TITLE_PAD_X * 2));
  return { lines, boxW, boxH: TITLE_BOX_H2, titleH: TITLE_BOX_H2 + 12, twoLines: true };
}

export type PaperSize = 'A4' | 'A3';
export type Orientation = 'portrait' | 'landscape';

/** 用紙の実寸（mm）。縦向きのときの値 */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
};

/**
 * 1mm あたりの作図単位。
 * これまでA4縦を 760×1075 で描いていたので、その比率をそのまま使う。
 * 用紙が大きくなるとそのぶん作図できる範囲が広がり、
 * 線の太さや文字は紙の上で同じ大きさのままになる。
 */
const UNITS_PER_MM = 760 / 210;

/** 用紙の大きさ（mmと作図単位の両方） */
export function sheetSize(paper: PaperSize, orientation: Orientation): {
  mmW: number;
  mmH: number;
  w: number;
  h: number;
} {
  const mm = PAPER_MM[paper];
  const mmW = orientation === 'portrait' ? mm.w : mm.h;
  const mmH = orientation === 'portrait' ? mm.h : mm.w;
  return { mmW, mmH, w: Math.round(mmW * UNITS_PER_MM), h: Math.round(mmH * UNITS_PER_MM) };
}

export interface SheetOptions {
  width?: number;
  height?: number;
  /** 用紙の大きさ。width/height を直接渡さないときに使う */
  paper?: PaperSize;
  orientation?: Orientation;
  /** 図枠の余白 */
  margin?: number;
  titleHeight?: number;
  /** 図枠と作図内容の間の余白 */
  pad?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * レイアウト結果をSVGにする。
 * 作図内容は必ず図枠の内側に収める（はみ出す場合は全体を縮小する）。
 */
export function renderSvg(drawing: DrawingLayout, title: TitleBlock, opts: SheetOptions = {}): string {
  const size = sheetSize(opts.paper ?? 'A4', opts.orientation ?? 'portrait');
  const W = opts.width ?? size.w;
  const H = opts.height ?? size.h;
  const M = opts.margin ?? 24;
  const tl = layoutTitle(title, W, M);
  const TITLE_H = opts.titleHeight ?? tl.titleH;
  const PAD = opts.pad ?? 12;

  const areaX = M + PAD;
  const areaY = M + TITLE_H + PAD;
  const areaW = W - M * 2 - PAD * 2;
  const areaH = H - M * 2 - TITLE_H - PAD * 2 - 18;

  const { x0, y0, x1, y1 } = drawing.bounds;
  const cw = Math.max(x1 - x0, 1);
  const ch = Math.max(y1 - y0, 1);
  const scale = Math.min(areaW / cw, areaH / ch, 1);
  const tx = areaX + (areaW - cw * scale) / 2 - x0 * scale;
  const ty = areaY + (areaH - ch * scale) / 2 - y0 * scale;

  const body: string[] = [];

  for (const f of drawing.frames) {
    body.push(
      `    <path d="M ${f.x} ${f.y} L ${f.x + f.w} ${f.y} M ${f.x} ${f.y} L ${f.x} ${f.y + 26} M ${f.x + f.w} ${f.y} L ${f.x + f.w} ${f.y + 26}" fill="none" stroke-width="1" />`,
    );
    if (f.label) {
      body.push(
        `    <text x="${f.x}" y="${f.y - 6}" font-size="8" font-family="${FONT_FAMILY}" fill="currentColor" stroke="none">${esc(f.label)}</text>`,
      );
    }
  }

  for (const w of drawing.wires) {
    body.push(
      `    <line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke-width="1"${
        w.dashed ? ' stroke-dasharray="5 4"' : ''
      } />`,
    );
  }

  for (const t2 of drawing.texts ?? []) {
    const tspans = t2.lines
      .map((l, i) => `<tspan x="${round(t2.x)}" dy="${i === 0 ? 0 : 10}">${esc(l)}</tspan>`)
      .join('');
    body.push(
      `    <text x="${round(t2.x)}" y="${round(t2.y)}" font-size="8" text-anchor="${t2.anchor}" font-family="${FONT_FAMILY}" fill="currentColor" stroke="none">${tspans}</text>`,
    );
  }

  for (const s of drawing.symbols) {
    const def = getSymbol(s.symbolId);
    const cx = def.box.w / 2;
    const cy = def.box.h / 2;
    body.push(
      `    <g transform="translate(${round(s.x)} ${round(s.y)})${s.rotate ? ` rotate(${s.rotate} ${cx} ${cy})` : ''}">`,
      shapesToSvg(def.shapes, '      '),
      `    </g>`,
    );
    if (s.label.length) {
      const tspans = s.label
        .map((l, i) => `<tspan x="${round(s.labelAt.x)}" dy="${i === 0 ? 0 : 10}">${esc(l)}</tspan>`)
        .join('');
      body.push(
        `    <text x="${round(s.labelAt.x)}" y="${round(s.labelAt.y)}" font-size="8" text-anchor="${s.labelAt.anchor}" font-family="${FONT_FAMILY}" fill="currentColor" stroke="none">${tspans}</text>`,
      );
    }
  }

  // 1行のときは枠の中央に、2行のときは上の行・下の行の順に、枠の中央にそろえて書く
  const boxTop = M + 6;
  const baselines = tl.twoLines ? [boxTop + 22, boxTop + 42] : [boxTop + tl.boxH / 2 + 5];
  const titleText = tl.lines
    .map(
      (l, i) =>
        `  <text x="${W / 2}" y="${baselines[i]}" font-size="${round(l.size)}" font-weight="700" text-anchor="middle" font-family="${FONT_FAMILY}" fill="#000">${esc(l.text)}</text>`,
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" />
  <g stroke="#000" fill="none">
    <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" stroke-width="1" />
    <rect x="${round((W - tl.boxW) / 2)}" y="${M + 6}" width="${round(tl.boxW)}" height="${tl.boxH}" stroke-width="1" />
  </g>
${titleText}
  <text x="${W - M - 14}" y="${H - M - 12}" font-size="9" text-anchor="end" font-family="${FONT_FAMILY}" fill="#000">${esc(title.footer ?? COMPANY_NAME)}</text>
  <g transform="translate(${round(tx)} ${round(ty)}) scale(${scale.toFixed(4)})">
    <g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round" color="#000">
${body.join('\n')}
    </g>
  </g>
</svg>
`;
}

const round = (v: number) => Math.round(v * 100) / 100;
