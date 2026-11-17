import { FONT_FAMILY, getSymbol, shapesToSvg, sizedSymbol } from '@zumen/symbols';
import type { DrawingLayout } from './layout.ts';
import { areaSvg } from './area.ts';
import { crossPointsAttr } from './cross.ts';
import { arrowSvg, dotSvg } from './dot.ts';
import { linkSvg } from './link.ts';
import { groundSvg } from './ground.ts';
import { LABEL_FONT, LABEL_LINE, OVERLAY_RED, boldStrokeWidth, clampTextSize, textWidth } from './text.ts';

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

/** 図枠の余白（用紙の端から図枠まで）。renderSvg の既定値 */
export const SHEET_MARGIN = 18;
/** 図枠と作図内容の間の余白。renderSvg の既定値 */
export const SHEET_PAD = 8;

/** 表題の文字の大きさ（作図単位） */
const TITLE_FONT = 14;
/** 枠の内側の左右の余白 */
const TITLE_PAD_X = 20;
/** 枠のいちばん狭い幅。短い名前でも、枠が小さくなりすぎないように */
const TITLE_MIN_W = 220;
/** 枠の高さ：1行のとき／2行のとき。3行のときは、2行のときに、1行ぶん（TITLE_LINE_GAP）を足す */
const TITLE_BOX_H1 = 32;
const TITLE_BOX_H2 = 52;
const TITLE_LINE_GAP = 20;
/** 図枠の端から表題の枠までの、最低限の空き（左右） */
const TITLE_SIDE = 60;
/** 表題の文字の、いちばん小さい大きさ（作図単位。A4で約2.8mm＝約8ポイント。これより小さくはしない） */
export const TITLE_MIN_FONT = 10;
/** 折り返した行の文字の大きさ */
const TITLE_WRAP_FONT = 12;
/** 事業場名称は、最大2行まで（図面名称は1行）。表題は、合わせて最大3行 */
const SITE_MAX_LINES = 2;

export interface TitleLayout {
  /** 書く行（上から順）。size はその行の文字の大きさ */
  lines: { text: string; size: number }[];
  /** 枠の幅と高さ */
  boxW: number;
  boxH: number;
  /** 表題の枠まわりが使う高さ（図枠の上端から、作図範囲の手前まで） */
  titleH: number;
  /** 2行以上か（3行のときも true） */
  twoLines: boolean;
  /** 行の数（1〜3） */
  lineCount: number;
  /** 長すぎて、文字を省略した（末尾が「…」）か */
  truncated: boolean;
}

/** 文字を、幅 room に収まる行に分ける。区切りの文字（空白・読点・かっこ・「・」）の直後で切れるときは、そこで切る */
function wrapText(text: string, size: number, room: number): string[] {
  const out: string[] = [];
  let rest = Array.from(text);
  while (rest.length > 0) {
    let n = 0;
    let w = 0;
    while (n < rest.length && w + textWidth(rest[n]!, size) <= room) {
      w += textWidth(rest[n]!, size);
      n++;
    }
    if (n >= rest.length) {
      out.push(rest.join(''));
      break;
    }
    n = Math.max(1, n);
    // 行の後ろ4割より後ろに、区切りがあれば、その直後で切る
    for (let k = n; k > n * 0.6; k--) {
      if (/[\s　、。，・）)」』】〕]/.test(rest[k - 1]!)) {
        n = k;
        break;
      }
    }
    out.push(rest.slice(0, n).join('').trimEnd());
    rest = rest.slice(n);
    while (rest.length > 0 && /\s/.test(rest[0]!)) rest.shift();
  }
  return out;
}

/** 最大 maxLines 行に収めて、文字を省略する（最後の行が収まらないときは、末尾を「…」にする） */
function clampLines(lines: string[], maxLines: number, size: number, room: number): { lines: string[]; truncated: boolean } {
  if (lines.length <= maxLines) return { lines, truncated: false };
  const keep = lines.slice(0, maxLines);
  let last = Array.from(keep[maxLines - 1]!);
  while (last.length > 0 && textWidth(`${last.join('')}…`, size) > room) last.pop();
  keep[maxLines - 1] = `${last.join('')}…`;
  return { lines: keep, truncated: true };
}

/**
 * 1つの文（事業場名称・図面名称）を、表題の行にする。
 * 1行に収まれば基準の大きさ。収まらないときは、最小の大きさまで小さくして1行に。それでも収まらなければ、
 * 折り返す（最大 maxLines 行。折り返した行は、基準より少し小さい大きさ。それでも収まらなければ、最小の大きさ）。
 * 最後まで収まらないときは、末尾を「…」にして省略する。
 */
function fitPart(text: string, room: number, maxLines: number): { lines: { text: string; size: number }[]; truncated: boolean } {
  const w = textWidth(text, TITLE_FONT);
  if (w <= room) return { lines: [{ text, size: TITLE_FONT }], truncated: false };
  if (textWidth(text, TITLE_MIN_FONT) <= room) return { lines: [{ text, size: (TITLE_FONT * room) / w }], truncated: false };
  if (maxLines >= 2) {
    for (const size of [TITLE_WRAP_FONT, TITLE_MIN_FONT]) {
      const wrapped = wrapText(text, size, room);
      if (wrapped.length <= maxLines) return { lines: wrapped.map((t) => ({ text: t, size })), truncated: false };
    }
  }
  // 収まらない。最小の大きさで、maxLines 行にして、末尾を省略する
  const c = clampLines(wrapText(text, TITLE_MIN_FONT, room), maxLines, TITLE_MIN_FONT, room);
  return { lines: c.lines.map((t) => ({ text: t, size: TITLE_MIN_FONT })), truncated: c.truncated };
}

/**
 * 表題の文字量から、枠の大きさと行の分け方を決める。
 *
 * - 枠の幅は文字量に合わせる（短ければ狭く、長ければ広く）。上限は図枠の幅から左右 60 ずつ引いた幅
 * - 「事業場名称＋図面名称」を1行に書いて上限に収まらないときだけ、2行にする
 *   （上の行は事業場名称、下の行は図面名称）。事業場名称が長いときは、文字を小さくして1行に収める（最小 TITLE_MIN_FONT）
 * - それでも収まらないほど長い事業場名称は、折り返して2行にする（合わせて3行）。さらに長いときは、末尾を「…」にする
 * - どんな長さでも枠からはみ出さない。文字が読めないほど小さくなることもない
 */
export function layoutTitle(title: TitleBlock, sheetW: number, margin: number): TitleLayout {
  const maxBoxW = sheetW - margin * 2 - TITLE_SIDE * 2;
  const room = maxBoxW - TITLE_PAD_X * 2;
  const site = title.site.trim();
  const name = title.name.trim();
  const one = site ? `${site}　${name}` : name;

  if (textWidth(one, TITLE_FONT) <= room) {
    const boxW = Math.min(maxBoxW, Math.max(TITLE_MIN_W, textWidth(one, TITLE_FONT) + TITLE_PAD_X * 2));
    return { lines: [{ text: one, size: TITLE_FONT }], boxW, boxH: TITLE_BOX_H1, titleH: TITLE_BOX_H1 + 12, twoLines: false, lineCount: 1, truncated: false };
  }

  // 2行以上（上が事業場名称、下が図面名称）
  const s = fitPart(site, room, SITE_MAX_LINES);
  const n = fitPart(name, room, 1);
  const lines = [...s.lines, ...n.lines].filter((l) => l.text !== '');
  const widest = Math.max(...lines.map((l) => textWidth(l.text, l.size)));
  const boxW = Math.min(maxBoxW, Math.max(TITLE_MIN_W, widest + TITLE_PAD_X * 2));
  const boxH = TITLE_BOX_H2 + TITLE_LINE_GAP * Math.max(0, lines.length - 2);
  return { lines, boxW, boxH, titleH: boxH + 12, twoLines: lines.length > 1, lineCount: lines.length, truncated: s.truncated || n.truncated };
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
  const M = opts.margin ?? SHEET_MARGIN;
  const tl = layoutTitle(title, W, M);
  const TITLE_H = opts.titleHeight ?? tl.titleH;
  const PAD = opts.pad ?? SHEET_PAD;

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
        `    <text x="${f.x}" y="${f.y - 6}" font-size="${LABEL_FONT}" font-family="${FONT_FAMILY}" fill="currentColor" stroke="none">${esc(f.label)}</text>`,
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
    // 大きさは、縦横の比を変えず、文字と行の間隔を同じ倍率で変える。倍率が無い（1倍）・太字でない・赤でないときは、これまでと同じ出力
    const size = clampTextSize(t2.size);
    const tspans = t2.lines
      .map((l, i) => `<tspan x="${round(t2.x)}" dy="${i === 0 ? 0 : round(LABEL_LINE * size)}">${esc(l)}</tspan>`)
      .join('');
    body.push(
      `    <text x="${round(t2.x)}" y="${round(t2.y)}" font-size="${round(LABEL_FONT * size)}" text-anchor="${t2.anchor}"${t2.bold ? ' font-weight="700"' : ''} font-family="${FONT_FAMILY}" fill="${t2.red ? OVERLAY_RED : 'currentColor'}" ${t2.bold ? `stroke="${t2.red ? OVERLAY_RED : 'currentColor'}" stroke-width="${boldStrokeWidth(LABEL_FONT * size)}" stroke-linejoin="round"` : 'stroke="none"'}>${tspans}</text>`,
    );
  }

  for (const s of drawing.symbols) {
    const def = sizedSymbol(getSymbol(s.symbolId), s);
    const cx = def.box.w / 2;
    const cy = def.box.h / 2;
    body.push(
      `    <g transform="translate(${round(s.x)} ${round(s.y)})${s.rotate ? ` rotate(${s.rotate} ${cx} ${cy})` : ''}"${def.color ? ` stroke="${def.color}" color="${def.color}"` : ''}>`,
      shapesToSvg(def.shapes, '      '),
      `    </g>`,
    );
    if (s.label.length) {
      const tspans = s.label
        .map((l, i) => `<tspan x="${round(s.labelAt.x)}" dy="${i === 0 ? 0 : LABEL_LINE}">${esc(l)}</tspan>`)
        .join('');
      body.push(
        `    <text x="${round(s.labelAt.x)}" y="${round(s.labelAt.y)}" font-size="${LABEL_FONT}" text-anchor="${s.labelAt.anchor}" font-family="${FONT_FAMILY}" fill="${def.color ?? 'currentColor'}" stroke="none">${tspans}</text>`,
      );
    }
  }

  // 赤い枠（充電範囲の斜線つき）
  for (const a of drawing.areas ?? []) body.push(areaSvg(a));

  // 開放の赤い×印は、図面のいちばん上に重ねる
  for (const c of drawing.crosses ?? []) {
    body.push(`    <polygon points="${crossPointsAttr(c.x, c.y, c.size, c.thickness)}" fill="${OVERLAY_RED}" stroke="none" />`);
  }

  // 赤い接地のマーク
  for (const g of drawing.grounds ?? []) body.push(groundSvg(g.x, g.y, g.lead, g.drop, g.scale !== undefined ? { scale: g.scale } : {}));

  // 赤い渡り線（点のほうを上にするため、点より先に描く）
  for (const k of drawing.links ?? []) body.push(linkSvg(k));

  // 赤い丸い点と、印加点の矢印
  for (const d of drawing.dots ?? []) body.push(dotSvg(d));
  for (const a of drawing.arrows ?? []) body.push(arrowSvg(a));

  // 1行のときは枠の中央に、2行のときは上の行・下の行の順に、枠の中央にそろえて書く
  const boxTop = M + 6;
  const baselines = tl.twoLines ? tl.lines.map((_, i) => boxTop + 22 + i * TITLE_LINE_GAP) : [boxTop + tl.boxH / 2 + 5];
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
