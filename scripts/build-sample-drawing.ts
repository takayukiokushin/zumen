/**
 * 記号ライブラリの検証用に、実際の単線結線図（カニエ竹原太陽光発電所）を
 * 記号マスタだけで描き直す。読み取り内容が合っているかの確認用。
 *
 *   node --experimental-strip-types scripts/build-sample-drawing.ts
 *   → docs/sample-drawing.svg
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSymbol, shapesToSvg } from '../packages/symbols/src/index.ts';

const parts: string[] = [];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 記号を、指定したポートが (x, y) に来るように置く */
function put(id: string, portId: string, x: number, y: number, rotate = 0): void {
  const def = getSymbol(id);
  const port = def.ports.find((p) => p.id === portId);
  if (!port) throw new Error(`${id} にポート ${portId} がありません`);
  const cx = def.box.w / 2;
  const cy = def.box.h / 2;
  // 回転後のポート位置を求めて、そこが (x,y) に来るよう平行移動する
  const rad = (rotate * Math.PI) / 180;
  const rx = cx + (port.x - cx) * Math.cos(rad) - (port.y - cy) * Math.sin(rad);
  const ry = cy + (port.x - cx) * Math.sin(rad) + (port.y - cy) * Math.cos(rad);
  const tx = x - rx;
  const ty = y - ry;
  parts.push(
    `  <g transform="translate(${tx} ${ty})${rotate ? ` rotate(${rotate} ${cx} ${cy})` : ''}">\n` +
      shapesToSvg(def.shapes, '    ') +
      `\n  </g>`,
  );
}

/** 記号の外形の左上に置いたときの、ポート位置を求める補助 */
function portAt(id: string, portId: string, originX: number, originY: number): [number, number] {
  const def = getSymbol(id);
  const p = def.ports.find((q) => q.id === portId)!;
  return [originX + p.x, originY + p.y];
}

function wire(x1: number, y1: number, x2: number, y2: number, dashed = false): void {
  parts.push(
    `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="1"${
      dashed ? ' stroke-dasharray="5 4"' : ''
    } />`,
  );
}

function label(x: number, y: number, lines: string[], anchor: 'start' | 'middle' | 'end' = 'start', size = 8): void {
  const tspans = lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size * 1.25}">${esc(l)}</tspan>`)
    .join('');
  parts.push(
    `  <text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" font-family="sans-serif" fill="#000">${tspans}</text>`,
  );
}

/* ------------------------------------------------------------------ */
/* レイアウト（主回路は x = SPINE の縦線）                               */
/* ------------------------------------------------------------------ */

const SPINE = 330;
const TOP = 46; // 表題欄の下から描き始める
const RIGHT = SPINE + 40;

// 電柱
put('pole-utility', 'out', SPINE, TOP + 66);
label(SPINE + 26, TOP + 36, ['中電柱:大井(分)7T1H1']);

// 引込点（ジグザグ）
wire(SPINE, TOP + 66, SPINE, TOP + 86);
put('incoming-point', 'in', SPINE, TOP + 86);

// 財産保安責任分界点
wire(SPINE, TOP + 136, SPINE, TOP + 152);
put('boundary-both', 'in', SPINE, TOP + 152);
  wire(150, TOP + 164, SPINE - 96, TOP + 164);
label(150, TOP + 158, ['財産保安責任分界点'], 'start', 8);

// PAS ＋ DGR
wire(SPINE, TOP + 176, SPINE, TOP + 190);
put('pas', 'in', SPINE, TOP + 190);
label(SPINE - 130, TOP + 216, ['PAS', '7200V200A', 'VT,LA内蔵型']);
put('relay-dgr', 'in', RIGHT + 50, TOP + 212);
label(RIGHT + 52, TOP + 194, ['DGR']);
wire(SPINE + 22, TOP + 212, RIGHT + 50, TOP + 212);

// 高圧ケーブル（埋設 → 点線）
wire(SPINE, TOP + 262, SPINE, TOP + 282);
put('cable-head', 'in', SPINE, TOP + 282);
label(SPINE + 18, TOP + 300, ['埋ケ', 'CVT', '6600V 38mm2 14m']);
wire(SPINE, TOP + 322, SPINE, TOP + 352, true);

// キュービクルの範囲を示す枠
const frameY = TOP + 352;
parts.push(
  `  <path d="M 150 ${frameY} L 520 ${frameY} M 150 ${frameY} L 150 ${frameY + 26} M 520 ${frameY} L 520 ${frameY + 26}" stroke="#000" stroke-width="1" fill="none" />`,
);
label(150, frameY - 6, ['キュービクル式（地上）']);

// 受電側のケーブル端末（180°回転：頂点が上＝ケーブル側）
put('cable-head', 'out', SPINE, frameY, 180);
wire(SPINE, frameY + 40, SPINE, frameY + 56);

// VCT
put('vct', 'in', SPINE, frameY + 56);
wire(SPINE, frameY + 120, SPINE, frameY + 140);

// LBS（PF付）
put('lbs-pf', 'in', SPINE, frameY + 140);
label(SPINE + 22, frameY + 152, ['LBS', '7200V', '200A', 'PF×3', '7200V 50A 40kA']);
const afterLbs = frameY + 218;
wire(SPINE, afterLbs, SPINE, afterLbs + 24);

// VT＋PF（母線から横に分岐）
const vtY = afterLbs + 24;
put('pf', 'in', SPINE + 26, vtY, 90);
put('vt', 'in', SPINE + 70, vtY);
label(SPINE + 78, vtY + 20, ['VT＋PF', '6600/110V']);
wire(SPINE, vtY, SPINE + 26, vtY);
wire(SPINE, vtY, SPINE, vtY + 26);

// CT
put('ct', 'in', SPINE, vtY + 26);
label(SPINE - 52, vtY + 44, ['CT', '40A/5A']);
const afterCt = vtY + 70;
wire(SPINE, afterCt, SPINE, afterCt + 30);

// ZPD ＋ OVGR（左へ分岐）
const zpdY = afterCt + 30;
put('zpd', 'in', SPINE - 150, zpdY);
wire(SPINE - 150, zpdY, SPINE, zpdY);
label(SPINE - 100, zpdY + 58, ['ZPD']);
label(SPINE - 178, zpdY + 74, ['EA']);
put('relay-ovgr', 'in', SPINE - 270, zpdY + 26);
wire(SPINE - 270, zpdY + 26, SPINE - 230, zpdY + 26);
wire(SPINE, zpdY, SPINE, zpdY + 30);

// 動力変圧器（Δ-Y）
const trY = zpdY + 30;
put('tr-3p-dy', 'in', SPINE, trY);
label(SPINE + 40, trY + 24, ['動力', 'Tr', '3φ300kVA', '6600V/440-254V']);
const busY = trY + 92;
wire(SPINE, trY + 64, SPINE, busY);

// 低圧母線と分岐
wire(SPINE - 90, busY, SPINE + 90, busY);
for (const [i, [dx, amp]] of ([[-90, '225A'], [90, '300A']] as const).entries()) {
  const bx = SPINE + dx;
  put('mccb', 'in', bx, busY);
  label(bx + 12, busY + 16, ['MCCB', amp]);
  const pcsY = busY + 52 + 18;
  wire(bx, busY + 52, bx, pcsY);
  wire(bx - 34, pcsY, bx + 34, pcsY);
  for (const [j, cap] of (['20kW', '50kW×2'] as const).entries()) {
    const px = bx - 34 + j * 68;
    wire(px, pcsY, px, pcsY + 10);
    put('pcs', 'in', px, pcsY + 10);
    label(px, pcsY + 42, [cap], 'middle', 7);
    wire(px, pcsY + 54, px, pcsY + 66);
    put('pv', 'out', px, pcsY + 66);
    label(px, pcsY + 118, ['PV'], 'middle', 7);
  }
  void i;
}

/* ------------------------------------------------------------------ */

const W = 700;
const H = 1060;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" />
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="#000" stroke-width="1" />
  <rect x="90" y="40" width="520" height="30" fill="none" stroke="#000" stroke-width="1" />
  <text x="350" y="60" font-size="15" font-weight="700" text-anchor="middle" font-family="sans-serif" fill="#000">カニエ竹原太陽光発電所　キュービクル式高圧受電設備単線結線図</text>
  <text x="${W - 40}" y="${H - 34}" font-size="9" text-anchor="end" font-family="sans-serif" fill="#000">株式会社フジエレックス</text>
  <g stroke="#000" fill="none" stroke-linecap="round" stroke-linejoin="round">
${parts.join('\n')}
  </g>
</svg>
`;

const out = resolve(import.meta.dirname, '../docs/sample-drawing.svg');
writeFileSync(out, svg, 'utf8');
console.log(`生成: ${out}`);
