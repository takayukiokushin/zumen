import type { Shape } from '../shape.ts';
import type { SymbolDef } from '../types.ts';
import { contact, hline, line, poly, rect, vline } from '../shape.ts';

/** 円の左半分を縦線でハッチングする（電柱の記号） */
const hatchLeftHalf = (cx: number, cy: number, r: number, step = 1.7): Shape[] => {
  const out: Shape[] = [];
  for (let x = cx - r + step; x < cx; x += step) {
    const dy = Math.sqrt(Math.max(r * r - (x - cx) * (x - cx), 0));
    out.push(vline(x, cy - dy, cy + dy, { sw: 0.7 }));
  }
  return out;
};

/** 電柱（円＋左半分のハッチング＋引下線） */
const pole = (id: string, abbr: string, nameJa: string, note: string): SymbolDef => ({
  id,
  abbr,
  nameJa,
  category: 'incoming',
  tags: ['引込元', '電柱'],
  box: { w: 36, h: 48 },
  shapes: [
    { k: 'circle', cx: 16, cy: 16, r: 14 },
    ...hatchLeftHalf(16, 16, 14),
    vline(16, 30, 48),
  ],
  ports: [{ id: 'out', x: 16, y: 48, dir: 'down', role: 'line' }],
  fields: [
    {
      key: 'poleName',
      label: '電柱名称',
      type: 'text',
      help: '図面の記載例: 中電柱：猪子山（分）81',
    },
  ],
  status: 'confirmed',
  statusNote: '見本図面のとおり、円の左半分を縦線でハッチングする形にしました。',
  note,
});

export const incomingSymbols: SymbolDef[] = [
  pole('pole-utility', '電柱', '電柱（電力会社所有）', '引込元パターンA。名称は「中電柱：〇〇（分）番号」の形式で記載する。'),
  pole('pole-customer', '客柱', 'お客様電柱', 'PASは電柱上に設置するため、図面上「お客様電柱」として描かれる場合がある。'),
  {
    id: 'cabinet',
    abbr: 'CAB',
    nameJa: 'キャビネット',
    nameFormal: '地上設置金属製ボックス',
    category: 'incoming',
    tags: ['引込元', 'パターンB', '地上'],
    box: { w: 44, h: 44 },
    shapes: [rect(6, 8, 30, 28), hline(38, 10, 32), hline(22, 36, 44)],
    ports: [{ id: 'out', x: 44, y: 22, dir: 'right', role: 'line' }],
    status: 'awaiting-sample',
    statusNote: '見本待ち。',
    note: '引込元パターンB。中身はモールドディスコン／三極連動ティー型シェルター。',
  },
  {
    id: 'incoming-jumper',
    abbr: '引込',
    nameJa: '引込線（ジグザグ記号）',
    category: 'incoming',
    tags: ['引込', '電柱', '分界点'],
    box: { w: 48, h: 50 },
    shapes: [
      vline(24, 0, 9),
      line(24, 9, 4, 19),
      line(4, 19, 44, 31),
      line(44, 31, 24, 41),
      vline(24, 41, 50),
    ],
    ports: [
      { id: 'in', x: 24, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 24, y: 50, dir: 'down', role: 'line' },
    ],
    status: 'open-question',
    statusNote: '見本図面（電柱と分界点の間にあるジグザグ）を写しました。名称の確認をお願いします。',
    review: 'この記号の正式な名称（引込線／引込点／電線接続部 等）を教えてください。データ上の名前を合わせます。',
  },
  {
    id: 'incoming-point',
    abbr: '引込点',
    nameJa: '引込点',
    category: 'incoming',
    tags: ['引込', '受電点'],
    box: { w: 40, h: 40 },
    shapes: [vline(20, 0, 16), contact(20, 20, 4), vline(20, 24, 40)],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 40, dir: 'down', role: 'line' },
    ],
    status: 'open-question',
    statusNote: '見本図面に該当するものが見当たりませんでした。',
    review: '引込点を独立した記号として描きますか。ジグザグ記号がそれに当たる場合は、この記号を削除します。',
  },
  {
    id: 'mold-discon',
    abbr: 'MDS',
    nameJa: 'モールドディスコン',
    category: 'incoming',
    tags: ['キャビネット', 'パターンA'],
    box: { w: 44, h: 48 },
    shapes: [
      vline(22, 0, 10),
      rect(8, 10, 28, 28),
      hline(14.5, 17, 27),
      contact(22, 16),
      contact(22, 32),
      line(22, 30.2, 31, 18),
      vline(22, 38, 48),
    ],
    ports: [
      { id: 'in', x: 22, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 22, y: 48, dir: 'down', role: 'line' },
    ],
    status: 'awaiting-sample',
    statusNote: '見本待ち。',
    note: 'キャビネット内パターンA。',
  },
  {
    id: 'tee-shelter',
    abbr: 'TS',
    nameJa: '三極連動ティー型シェルター',
    category: 'incoming',
    tags: ['キャビネット', 'パターンB'],
    box: { w: 44, h: 48 },
    shapes: [
      vline(22, 0, 10),
      rect(8, 10, 28, 28),
      hline(17, 14, 30),
      vline(22, 17, 33),
      vline(22, 38, 48),
    ],
    ports: [
      { id: 'in', x: 22, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 22, y: 48, dir: 'down', role: 'line' },
    ],
    status: 'awaiting-sample',
    statusNote: '見本待ち。',
    note: 'キャビネット内パターンB。',
  },
  {
    id: 'cable-head',
    abbr: 'CH',
    nameJa: '高圧ケーブル端末',
    nameFormal: 'ケーブル終端接続部',
    category: 'incoming',
    tags: ['受電点', 'ケーブルヘッド', '端末処理'],
    box: { w: 40, h: 40 },
    shapes: [
      vline(20, 0, 6),
      poly([6, 6, 34, 6, 20, 30], { close: true, fill: 'none' }),
      vline(20, 30, 40),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 40, dir: 'down', role: 'line' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり三角形にしました。頂点がケーブル側を向きます。',
    note: '受電側の端末は同じ記号を180°回転して使う（頂点が常にケーブル側を向く）。電気設備側の引込点は、図面上まずこの高圧ケーブル端末が該当する。',
  },
];

/** 分界点の横線。主回路の右寄りを通し、横線を左へ長く伸ばして左上に文言を書く */
const boundary = (id: string, nameJa: string, label: string, note: string): SymbolDef => ({
  id,
  abbr: label,
  nameJa,
  category: 'boundary',
  tags: ['分界点'],
  box: { w: 120, h: 24 },
  shapes: [vline(96, 0, 24), hline(12, 0, 120)],
  ports: [
    { id: 'in', x: 96, y: 0, dir: 'up', role: 'line' },
    { id: 'out', x: 96, y: 24, dir: 'down', role: 'line' },
  ],
  defaultLabel: label,
  status: 'confirmed',
  statusNote: '見本図面のとおり、横線を左へ長く伸ばし、その左上に文言を太字で記載します。',
  note,
});

incomingSymbols.push(
  boundary(
    'boundary-both',
    '財産・責任分界点（3点一致）',
    '財産・責任分界点',
    '3点一致（全体の約99%）。引込点の図記号とPASの間に横線を引く。',
  ),
  boundary(
    'boundary-property',
    '財産分界点（3点不一致のとき）',
    '財産分界点',
    '3点不一致（全体の約1%）。引込点と同一地点に記載する。',
  ),
  boundary(
    'boundary-safety',
    '責任分界点（3点不一致のとき）',
    '責任分界点',
    '3点不一致のとき、該当するLBSまたはVCBの図記号の中央に横線を引いて記載する。',
  ),
);
