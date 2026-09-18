import type { FieldDef, SymbolDef } from '../types.ts';
import type { Shape } from '../shape.ts';
import { circle, deltaMark, hline, line, starMark, text, vline } from '../shape.ts';

/**
 * 変圧器の共通の形（縦に重なった2つの円）。
 * 見本図面（電灯Tr・V結線）に合わせ、上下の円を大きめに重ねている。
 */
const CX = 24;
const CY1 = 22;
const CY2 = 40;
const R = 12;
const BOX = { w: 48, h: 64 };

const body = (primary: Shape[], secondary: Shape[]): Shape[] => [
  vline(CX, 0, 10),
  circle(CX, CY1, R),
  circle(CX, CY2, R),
  ...primary,
  ...secondary,
  vline(CX, 52, 64),
];

const PORTS = [
  { id: 'in', x: CX, y: 0, dir: 'up' as const, role: 'line' as const },
  { id: 'out', x: CX, y: BOX.h, dir: 'down' as const, role: 'line' as const },
];

/** 巻線の線数（単相変圧器は一次1本・二次3本で単相三線式を表す） */
const wires = (cy: number, count: number): Shape[] => {
  const gap = 4;
  const top = cy - ((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => hline(top + i * gap, CX - 6, CX + 6));
};

const VOLTAGE: FieldDef = {
  key: 'voltage',
  label: '電圧',
  type: 'text',
  help: '図面の記載例: 6600V/210-105V',
};
const USAGE: FieldDef = {
  key: 'usage',
  label: '用途',
  type: 'select',
  options: [
    { value: 'light', label: '電灯' },
    { value: 'power', label: '動力' },
  ],
  allowFreeInput: true,
  help: '図面の1行目に記載する（例: 電灯）',
};
const CAPACITY: FieldDef = { key: 'capacity', label: '容量', type: 'number', unit: 'kVA' };
/** 単相変圧器を組み合わせて三相を構成する場合、専用の図記号は作らずこの欄に構成を書く */
const COMPOSITION: FieldDef = {
  key: 'composition',
  label: '構成',
  type: 'text',
  help: '単相変圧器を組み合わせて構成する場合に記載する。例: 単相変圧器×3',
};

type Conn = 'y' | 'd';
const connMark = (conn: Conn, cy: number): Shape[] =>
  conn === 'y' ? starMark(CX, cy, 6) : [deltaMark(CX, cy, 7)];

/** 三相変圧器（結線方式違い）を1つの定義から生成する */
const threePhase = (id: string, primary: Conn, secondary: Conn, label: string): SymbolDef => ({
  id,
  abbr: 'Tr',
  nameJa: `三相変圧器（${label}）`,
  category: 'transformer',
  tags: ['変圧器', '三相', label],
  box: BOX,
  shapes: body(connMark(primary, CY1), connMark(secondary, CY2)),
  ports: PORTS,
  fields: [USAGE, CAPACITY, VOLTAGE, COMPOSITION],
  status: 'confirmed',
  statusNote: '三相変圧器の図記号はこの形でOK。円の大きさは見本図面（電灯Tr）に合わせました。',
  note:
    label === 'Δ-Δ結線'
      ? '単相変圧器3台で構成するΔ-Δ結線も、専用の図記号を作らずこの記号を使い、構成欄に「単相変圧器×3」と記載する。'
      : '使用用途によって巻線の結線方式が異なる。基本は Y-Y / Δ-Δ / Y-Δ / Δ-Y の4種類。',
});

export const transformerSymbols: SymbolDef[] = [
  {
    id: 'tr-1p',
    abbr: 'Tr',
    nameJa: '単相変圧器',
    category: 'transformer',
    tags: ['変圧器', '単相', '電灯', '単相三線'],
    box: BOX,
    shapes: body(wires(CY1, 1), wires(CY2, 3)),
    ports: PORTS,
    fields: [USAGE, CAPACITY, VOLTAGE],
    status: 'confirmed',
    statusNote: '見本図面のとおり、上の円に横線1本、下の円に横線3本（単相三線式）を入れる形にしました。',
    note: '記載例「電灯 / Tr / 1φ200kVA / 6600V/210-105V」。',
    review: '二次側が単相2線の場合は下の円の横線を2本にしますか。線の本数＝電線の本数という理解で合っていますか。',
  },
  threePhase('tr-3p-yy', 'y', 'y', 'Y-Y結線'),
  threePhase('tr-3p-dd', 'd', 'd', 'Δ-Δ結線'),
  threePhase('tr-3p-yd', 'y', 'd', 'Y-Δ結線'),
  threePhase('tr-3p-dy', 'd', 'y', 'Δ-Y結線'),
  {
    id: 'tr-vv',
    abbr: 'Tr',
    nameJa: '三相変圧器（V結線）',
    category: 'transformer',
    tags: ['変圧器', 'V結線', '単相2台'],
    box: BOX,
    shapes: body([text(CX, CY1, 'V', { size: 13 })], [text(CX, CY2, 'V', { size: 13 })]),
    ports: PORTS,
    fields: [
      { key: 'capacity1', label: '1台目の容量', type: 'number', unit: 'kVA' },
      { key: 'capacity2', label: '2台目の容量', type: 'number', unit: 'kVA' },
      VOLTAGE,
      { ...COMPOSITION, defaultValue: '単相変圧器×2' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、丸を縦に2つ並べそれぞれの中にVを記載する形で確定。',
    note: '単相変圧器2台で三相を構成する。2台の定格容量が異なる場合があるため容量は2台分を別々に記載する。記載例「V結線 / Tr / 1φ50kVA / 1φ75kVA / 6600V/210-105V」。',
  },
  {
    id: 'tr-1p-parallel',
    abbr: 'Tr',
    nameJa: '単相変圧器 並行運転（倍容量）',
    category: 'transformer',
    tags: ['変圧器', '単相', '並行運転'],
    box: { w: 84, h: 68 },
    shapes: [
      vline(42, 0, 8),
      hline(8, 22, 62),
      vline(22, 8, 12),
      vline(62, 8, 12),
      circle(22, 24, 12), circle(22, 42, 12),
      circle(62, 24, 12), circle(62, 42, 12),
      hline(24, 16, 28), hline(24, 56, 68),
      hline(38, 16, 28), hline(42, 16, 28), hline(46, 16, 28),
      hline(38, 56, 68), hline(42, 56, 68), hline(46, 56, 68),
      vline(22, 54, 60),
      vline(62, 54, 60),
      hline(60, 22, 62),
      vline(42, 60, 68),
    ],
    ports: [
      { id: 'in', x: 42, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 42, y: 68, dir: 'down', role: 'line' },
    ],
    fields: [USAGE, CAPACITY, VOLTAGE],
    status: 'confirmed',
    statusNote: '並行運転の構成はこの図でOK。単相変圧器の図記号を見本どおりに差し替えました。',
    note: '単相変圧器2台を並行運転させ、倍容量の単相変圧器として使用するパターン。',
  },
  {
    id: 'tr-scott',
    abbr: 'Tr',
    nameJa: 'スコット変圧器（低圧）',
    category: 'transformer',
    tags: ['変圧器', 'スコット', '単相三線', '低圧'],
    optional: true,
    box: { w: 60, h: 60 },
    shapes: [
      vline(30, 0, 6),
      circle(30, 15, 9),
      hline(11, 24, 36),
      vline(30, 11, 21),
      line(30, 24, 18, 29),
      line(30, 24, 42, 29),
      circle(16, 37, 8),
      circle(44, 37, 8),
      vline(16, 45, 60),
      vline(44, 45, 60),
    ],
    ports: [
      { id: 'in', x: 30, y: 0, dir: 'up', role: 'line' },
      { id: 'out1', x: 16, y: 60, dir: 'down', role: 'line', label: '単相三線 M座' },
      { id: 'out2', x: 44, y: 60, dir: 'down', role: 'line', label: '単相三線 T座' },
    ],
    fields: [CAPACITY, VOLTAGE],
    status: 'awaiting-sample',
    statusNote: '図記号は見本待ち。既定では図面に描かず、「低圧スコット変圧器」と指示されたときだけ配置します。',
    note: 'ほとんどが低圧から低圧への変換のため、通常は単線結線図に記載しない。',
  },
];
