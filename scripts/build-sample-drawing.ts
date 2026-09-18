/**
 * 記号ライブラリの検証用に、実際の単線結線図（カニエ竹原太陽光発電所）を
 * 記号マスタだけで描き直す。読み取り内容が合っているかの確認用。
 *
 *   node --experimental-strip-types scripts/build-sample-drawing.ts
 *   → docs/sample-drawing.svg
 *
 * 作図した内容は必ず図枠の内側に収まるよう、最後に全体を自動で縮小する。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSymbol, shapesToSvg } from '../packages/symbols/src/index.ts';

/** 日本語は中国語フォントに落ちると字形が変わるため、明示的に日本語フォントを指定する */
const FONT = "IPAGothic, 'IPAゴシック', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif";

const parts: string[] = [];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 作図内容の外形。最後に図枠へ収めるために使う */
const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
function extend(x0: number, y0: number, x1: number, y1: number): void {
  bbox.x0 = Math.min(bbox.x0, x0);
  bbox.y0 = Math.min(bbox.y0, y0);
  bbox.x1 = Math.max(bbox.x1, x1);
  bbox.y1 = Math.max(bbox.y1, y1);
}

/** 記号を、指定したポートが (x, y) に来るように置く。戻り値は記号の左上座標 */
function put(id: string, portId: string, x: number, y: number, rotate = 0): [number, number] {
  const def = getSymbol(id);
  const port = def.ports.find((p) => p.id === portId);
  if (!port) throw new Error(`${id} にポート ${portId} がありません`);
  const cx = def.box.w / 2;
  const cy = def.box.h / 2;
  const rad = (rotate * Math.PI) / 180;
  const rx = cx + (port.x - cx) * Math.cos(rad) - (port.y - cy) * Math.sin(rad);
  const ry = cy + (port.x - cx) * Math.sin(rad) + (port.y - cy) * Math.cos(rad);
  const tx = x - rx;
  const ty = y - ry;
  extend(tx, ty, tx + def.box.w, ty + def.box.h);
  parts.push(
    `  <g transform="translate(${tx} ${ty})${rotate ? ` rotate(${rotate} ${cx} ${cy})` : ''}">\n` +
      shapesToSvg(def.shapes, '    ') +
      `\n  </g>`,
  );
  return [tx, ty];
}

/** 記号を左上座標で置いたときの、あるポートの絶対座標（回転も考慮する） */
function portOf(
  id: string,
  portId: string,
  originX: number,
  originY: number,
  rotate = 0,
): [number, number] {
  const def = getSymbol(id);
  const p = def.ports.find((q) => q.id === portId)!;
  const cx = def.box.w / 2;
  const cy = def.box.h / 2;
  const rad = (rotate * Math.PI) / 180;
  const rx = cx + (p.x - cx) * Math.cos(rad) - (p.y - cy) * Math.sin(rad);
  const ry = cy + (p.x - cx) * Math.sin(rad) + (p.y - cy) * Math.cos(rad);
  return [originX + rx, originY + ry];
}

function wire(x1: number, y1: number, x2: number, y2: number, dashed = false): void {
  extend(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2));
  parts.push(
    `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1"${
      dashed ? ' stroke-dasharray="5 4"' : ''
    } />`,
  );
}

function label(
  x: number,
  y: number,
  lines: string[],
  anchor: 'start' | 'middle' | 'end' = 'start',
  size = 8,
): void {
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.72;
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  extend(x0, y - size, x0 + w, y + size * 1.3 * (lines.length - 1) + size * 0.3);
  const tspans = lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size * 1.3}">${esc(l)}</tspan>`)
    .join('');
  parts.push(
    `  <text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" font-family="${FONT}" fill="#000">${tspans}</text>`,
  );
}

/* ------------------------------------------------------------------ */
/* レイアウト（主回路は x = SPINE の縦線）                               */
/* ------------------------------------------------------------------ */

const SPINE = 340;
let y = 40;

// 電柱
put('pole-utility', 'out', SPINE, y + 26);
label(SPINE + 26, y - 4, ['中電柱:大井(分)7T1H1']);
y += 26;

// 引込点（ジグザグ）
wire(SPINE, y, SPINE, y + 22);
put('incoming-point', 'in', SPINE, y + 22);
y += 72;

// 財産・責任分界点
wire(SPINE, y, SPINE, y + 16);
const [bx] = put('boundary-both', 'in', SPINE, y + 16);
wire(SPINE - 260, y + 28, bx, y + 28);
label(SPINE - 260, y + 22, ['財産・責任分界点']);
y += 40;

// PAS（内蔵の ZCT / VT / LA を枠の中に配置）
wire(SPINE, y, SPINE, y + 14);
const [px, py] = put('pas', 'in', SPINE, y + 14);
const slot = (id: string) => getSymbol('pas').slots!.find((s) => s.id === id)!;
const [zx, zy] = put('zct', 'in', px + slot('zct').x, py + slot('zct').y);
const [vx, vy] = put('vt', 'in', px + slot('vt').x, py + slot('vt').y);
const [lx, ly] = put('la', 'in', px + slot('la').x, py + slot('la').y);
wire(SPINE, py + slot('vt').y, px + slot('vt').x, py + slot('vt').y);
wire(SPINE, py + slot('la').y, px + slot('la').x, py + slot('la').y);
label(SPINE - 190, y + 60, ['PAS', '7200V200A', 'VT,LA内蔵型']);

// DGR（枠の中に文字だけ。枠の外には何も書かない）
const dgrX = SPINE + 220;
const [dx, dy] = put('relay-dgr', 'l', dgrX, py + 70);
const [zctSecX, zctSecY] = portOf('zct', 'sec', zx, zy);
const [vtSecX, vtSecY] = portOf('vt', 'sec', vx, vy);
wire(zctSecX, zctSecY, dgrX - 14, zctSecY);
wire(dgrX - 14, zctSecY, dgrX - 14, portOf('relay-dgr', 'l', dx, dy)[1]);
wire(dgrX - 14, portOf('relay-dgr', 'l', dx, dy)[1], dgrX, portOf('relay-dgr', 'l', dx, dy)[1]);
wire(vtSecX, vtSecY, dgrX - 24, vtSecY);
wire(dgrX - 24, vtSecY, dgrX - 24, zctSecY + 10);
wire(dgrX - 24, zctSecY + 10, dgrX - 14, zctSecY + 10);
void ly;
y = py + 170;

// 高圧ケーブル（埋設 → 点線）
wire(SPINE, y, SPINE, y + 20);
put('cable-head', 'in', SPINE, y + 20);
label(SPINE + 18, y + 38, ['埋ケ', 'CVT', '6600V 38mm2 14m']);
wire(SPINE, y + 60, SPINE, y + 96, true);
y += 96;

// キュービクルの範囲を示す枠（「コ」の字）
const frameL = SPINE - 200;
const frameR = SPINE + 200;
parts.push(
  `  <path d="M ${frameL} ${y} L ${frameR} ${y} M ${frameL} ${y} L ${frameL} ${y + 26} M ${frameR} ${y} L ${frameR} ${y + 26}" stroke="#000" stroke-width="1" fill="none" />`,
);
extend(frameL, y, frameR, y + 26);
label(frameL, y - 6, ['キュービクル式（地上）']);

// 受電側のケーブル端末（180°回転：頂点が上＝ケーブル側）
put('cable-head', 'out', SPINE, y, 180);
y += 40;
wire(SPINE, y, SPINE, y + 18);
y += 18;

// VCT（この現場は2台）
for (let i = 0; i < 2; i++) {
  put('vct', 'in', SPINE, y);
  y += 64;
}
wire(SPINE, y, SPINE, y + 22);
y += 22;

// LBS（PF付）
put('lbs-pf', 'in', SPINE, y);
label(SPINE + 24, y + 14, ['LBS', '7200V', '200A', 'PF×3', '7200V 50A 40kA']);
y += 78;
wire(SPINE, y, SPINE, y + 26);
y += 26;

// VT＋PF（母線から横に分岐）
const pfOrigin = put('pf', 'in', SPINE + 30, y, -90);
const [pfOutX, pfOutY] = portOf('pf', 'out', pfOrigin[0], pfOrigin[1], -90);
const vtBranch = put('vt', 'in', pfOutX + 16, y);
wire(SPINE, y, SPINE + 30, y);
wire(pfOutX, pfOutY, pfOutX + 16, y);
label(vtBranch[0] + 8, y + 24, ['VT＋PF', '6600/110V']);
wire(SPINE, y, SPINE, y + 26);
y += 26;

// CT ＋ 試験端子
const ctOrigin = put('ct', 'in', SPINE, y);
label(SPINE - 60, y + 18, ['CT', '40A/5A']);
const [ctSecX, ctSecY] = portOf('ct', 'sec', ctOrigin[0], ctOrigin[1]);
const ttOrigin = put('test-terminal', 'in', ctSecX + 10, ctSecY);
wire(ctSecX, ctSecY, ctSecX + 10, ctSecY);
void ttOrigin;
y += 44;
wire(SPINE, y, SPINE, y + 34);
y += 34;

// ZPD ＋ OVGR（左へ分岐。OVGRは枠の右側から結線する）
const zpdOrigin = put('zpd', 'in', SPINE - 160, y);
wire(SPINE - 160, y, SPINE, y);
label(zpdOrigin[0] + 62, zpdOrigin[1] + 58, ['ZPD']);
label(zpdOrigin[0] + 16, zpdOrigin[1] + 78, ['EA']);
const [zpdOutX, zpdOutY] = portOf('zpd', 'out', zpdOrigin[0], zpdOrigin[1]);
const ovgrOrigin = put('relay-ovgr', 'r', zpdOutX - 60, zpdOutY);
wire(zpdOutX - 60, zpdOutY, zpdOutX, zpdOutY);
void ovgrOrigin;
wire(SPINE, y, SPINE, y + 30);
y += 30;

// 動力変圧器（Δ-Y）
put('tr-3p-dy', 'in', SPINE, y);
label(SPINE + 42, y + 22, ['動力', 'Tr', '3φ300kVA', '6600V/440-254V']);
y += 64;
wire(SPINE, y, SPINE, y + 34);
y += 34;

// 低圧母線と分岐
wire(SPINE - 100, y, SPINE + 100, y);
for (const [dxx, amp] of [[-100, '225A'], [100, '300A']] as const) {
  const bxx = SPINE + dxx;
  put('mccb', 'in', bxx, y);
  label(bxx + 14, y + 16, ['MCCB', amp]);
  const branchY = y + 52 + 20;
  wire(bxx, y + 52, bxx, branchY);
  wire(bxx - 38, branchY, bxx + 38, branchY);
  for (const [j, cap] of (['20kW', '50kW×2'] as const).entries()) {
    const ppx = bxx - 38 + j * 76;
    wire(ppx, branchY, ppx, branchY + 12);
    put('pcs', 'in', ppx, branchY + 12);
    label(ppx, branchY + 42, [cap], 'middle', 7);
    wire(ppx, branchY + 60, ppx, branchY + 74);
    put('pv', 'out', ppx, branchY + 74);
    label(ppx, branchY + 128, ['PV'], 'middle', 7);
  }
}

/* ------------------------------------------------------------------ */
/* 図枠に収める                                                        */
/* ------------------------------------------------------------------ */

const W = 760;
const H = 1080;
const M = 24;                 // 図枠の余白
const TITLE_H = 44;           // 表題欄の高さ
const PAD = 12;               // 図枠と作図内容の間の余白
const areaX = M + PAD;
const areaY = M + TITLE_H + PAD;
const areaW = W - M * 2 - PAD * 2;
const areaH = H - M * 2 - TITLE_H - PAD * 2 - 18;

const contentW = bbox.x1 - bbox.x0;
const contentH = bbox.y1 - bbox.y0;
const scale = Math.min(areaW / contentW, areaH / contentH, 1);
const tx = areaX + (areaW - contentW * scale) / 2 - bbox.x0 * scale;
const ty = areaY - bbox.y0 * scale;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" />
  <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" fill="none" stroke="#000" stroke-width="1" />
  <rect x="${M + 60}" y="${M + 6}" width="${W - M * 2 - 120}" height="${TITLE_H - 12}" fill="none" stroke="#000" stroke-width="1" />
  <text x="${W / 2}" y="${M + 6 + (TITLE_H - 12) / 2 + 5}" font-size="14" font-weight="700" text-anchor="middle" font-family="${FONT}" fill="#000">カニエ竹原太陽光発電所　キュービクル式高圧受電設備単線結線図</text>
  <text x="${W - M - 14}" y="${H - M - 12}" font-size="9" text-anchor="end" font-family="${FONT}" fill="#000">株式会社フジエレックス</text>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">
    <g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round">
${parts.join('\n')}
    </g>
  </g>
</svg>
`;

const out = resolve(import.meta.dirname, '../docs/sample-drawing.svg');
writeFileSync(out, svg, 'utf8');
console.log(
  `生成: ${out}（作図範囲 ${contentW.toFixed(0)}×${contentH.toFixed(0)} → 縮尺 ${(scale * 100).toFixed(1)}%）`,
);
