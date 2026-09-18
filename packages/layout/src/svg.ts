import { FONT_FAMILY, getSymbol, shapesToSvg } from '@zumen/symbols';
import type { DrawingLayout } from './layout.ts';

/** 表題欄の内容 */
export interface TitleBlock {
  title: string;
  footer?: string;
  /** 作図支援ツールによる下書きである旨の注記 */
  draftNotice?: string;
}

export interface SheetOptions {
  width?: number;
  height?: number;
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
  const W = opts.width ?? 760;
  const H = opts.height ?? 1080;
  const M = opts.margin ?? 24;
  const TITLE_H = opts.titleHeight ?? 44;
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
  const ty = areaY - y0 * scale;

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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" />
  <g stroke="#000" fill="none">
    <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" stroke-width="1" />
    <rect x="${M + 60}" y="${M + 6}" width="${W - M * 2 - 120}" height="${TITLE_H - 12}" stroke-width="1" />
  </g>
  <text x="${W / 2}" y="${M + 6 + (TITLE_H - 12) / 2 + 5}" font-size="14" font-weight="700" text-anchor="middle" font-family="${FONT_FAMILY}" fill="#000">${esc(title.title)}</text>
  ${title.footer ? `<text x="${W - M - 14}" y="${H - M - 12}" font-size="9" text-anchor="end" font-family="${FONT_FAMILY}" fill="#000">${esc(title.footer)}</text>` : ''}
  ${title.draftNotice ? `<text x="${M + 14}" y="${H - M - 12}" font-size="8" font-family="${FONT_FAMILY}" fill="#666">${esc(title.draftNotice)}</text>` : ''}
  <g transform="translate(${round(tx)} ${round(ty)}) scale(${scale.toFixed(4)})">
    <g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round" color="#000">
${body.join('\n')}
    </g>
  </g>
</svg>
`;
}

const round = (v: number) => Math.round(v * 100) / 100;
