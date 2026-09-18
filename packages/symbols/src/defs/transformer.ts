import type { FieldDef, SymbolDef } from '../types.ts';
import type { Shape } from '../shape.ts';
import { circle, deltaMark, hline, line, starMark, text, vline } from '../shape.ts';

/** 変圧器の2つの巻線（重なった2円）。cy1=一次側、cy2=二次側 */
const windings = (cx: number, cy1: number, cy2: number, r: number): Shape[] => [
  circle(cx, cy1, r),
  circle(cx, cy2, r),
];

type Conn = 'y' | 'd' | 'v' | 'none';

const connMark = (conn: Conn, cx: number, cy: number, r = 4.5): Shape[] => {
  if (conn === 'y') return starMark(cx, cy, r);
  if (conn === 'd') return [deltaMark(cx, cy, r + 0.6)];
  if (conn === 'v') return [text(cx, cy, 'V', { size: 10 })];
  return [];
};

const CAPACITY: FieldDef = { key: 'capacity', label: '容量', type: 'number', unit: 'kVA' };
const SECONDARY_V: FieldDef = {
  key: 'secondaryVoltage',
  label: '二次電圧',
  type: 'text',
  unit: 'V',
  help: '例: 210V / 105-210V / 420V',
};
/**
 * 単相変圧器を組み合わせて三相を構成する場合、専用の図記号は作らず
 * 通常の三相変圧器の図記号を使い、この欄に構成を書く。
 */
const COMPOSITION: FieldDef = {
  key: 'composition',
  label: '構成',
  type: 'text',
  help: '単相変圧器を組み合わせて構成する場合に記載する。例: 単相変圧器×3',
};

/** 三相変圧器（結線方式違い）を1つの定義から生成する */
const threePhase = (id: string, primary: Conn, secondary: Conn, label: string): SymbolDef => ({
  id,
  abbr: 'T',
  nameJa: `三相変圧器（${label}）`,
  category: 'transformer',
  tags: ['変圧器', '三相', label],
  box: { w: 44, h: 52 },
  shapes: [
    vline(22, 0, 6),
    ...windings(22, 15, 29, 9),
    ...connMark(primary, 22, 15),
    ...connMark(secondary, 22, 29),
    vline(22, 38, 52),
  ],
  ports: [
    { id: 'in', x: 22, y: 0, dir: 'up', role: 'line' },
    { id: 'out', x: 22, y: 52, dir: 'down', role: 'line' },
  ],
  fields: [CAPACITY, SECONDARY_V, COMPOSITION],
  status: 'confirmed',
  statusNote: '三相変圧器の図記号はこの形でOK。',
  note:
    label === 'Δ-Δ結線'
      ? '単相変圧器3台で構成するΔ-Δ結線も、専用の図記号を作らずこの記号を使い、構成欄に「単相変圧器×3」と記載する。'
      : '使用用途によって巻線の結線方式が異なる。基本は Y-Y / Δ-Δ / Y-Δ / Δ-Y の4種類。',
});

export const transformerSymbols: SymbolDef[] = [
  {
    id: 'tr-1p',
    abbr: 'T',
    nameJa: '単相変圧器',
    category: 'transformer',
    tags: ['変圧器', '単相'],
    box: { w: 44, h: 52 },
    shapes: [vline(22, 0, 6), ...windings(22, 15, 29, 9), vline(22, 38, 52)],
    ports: [
      { id: 'in', x: 22, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 22, y: 52, dir: 'down', role: 'line' },
    ],
    fields: [CAPACITY, SECONDARY_V],
    status: 'awaiting-sample',
    statusNote: '単相変圧器の図記号は見本をいただいてから修正します。',
    note: '単相用は基本的に1種類のみ（結線方式のバリエーションなし）。',
  },
  threePhase('tr-3p-yy', 'y', 'y', 'Y-Y結線'),
  threePhase('tr-3p-dd', 'd', 'd', 'Δ-Δ結線'),
  threePhase('tr-3p-yd', 'y', 'd', 'Y-Δ結線'),
  threePhase('tr-3p-dy', 'd', 'y', 'Δ-Y結線'),
  {
    id: 'tr-vv',
    abbr: 'T',
    nameJa: '三相変圧器（V結線）',
    category: 'transformer',
    tags: ['変圧器', 'V結線', '単相2台'],
    box: { w: 44, h: 52 },
    shapes: [
      vline(22, 0, 6),
      ...windings(22, 15, 29, 9),
      ...connMark('v', 22, 15),
      ...connMark('v', 22, 29),
      vline(22, 38, 52),
    ],
    ports: [
      { id: 'in', x: 22, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 22, y: 52, dir: 'down', role: 'line' },
    ],
    fields: [
      { key: 'capacity1', label: '1台目の容量', type: 'number', unit: 'kVA' },
      { key: 'capacity2', label: '2台目の容量', type: 'number', unit: 'kVA' },
      SECONDARY_V,
      { ...COMPOSITION, defaultValue: '単相変圧器×2' },
    ],
    status: 'confirmed',
    statusNote: '丸を縦に2つ並べ、それぞれの中にVを記載する形でOK。',
    note: '単相変圧器2台で三相を構成する。2台の定格容量が異なる場合があるため、容量は2台分を別々に記載する（例: 50kVA、30kVA）。',
  },
  {
    id: 'tr-1p-parallel',
    abbr: 'T',
    nameJa: '単相変圧器 並行運転（倍容量）',
    category: 'transformer',
    tags: ['変圧器', '単相', '並行運転'],
    box: { w: 72, h: 56 },
    shapes: [
      vline(36, 0, 8),
      hline(8, 20, 52),
      vline(20, 8, 11),
      vline(52, 8, 11),
      ...windings(20, 20, 32, 9),
      ...windings(52, 20, 32, 9),
      vline(20, 41, 48),
      vline(52, 41, 48),
      hline(48, 20, 52),
      vline(36, 48, 56),
    ],
    ports: [
      { id: 'in', x: 36, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 36, y: 56, dir: 'down', role: 'line' },
    ],
    fields: [CAPACITY, SECONDARY_V],
    status: 'confirmed',
    statusNote: '並行運転の構成はこの図でOK（単相変圧器そのものの図記号は見本待ち）。',
    note: '単相変圧器2台を並行運転させ、倍容量の単相変圧器として使用するパターン。',
  },
  {
    id: 'tr-scott',
    abbr: 'T',
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
    fields: [CAPACITY, SECONDARY_V],
    status: 'awaiting-sample',
    statusNote: '図記号は見本待ち。既定では図面に描かず、「低圧スコット変圧器」と指示されたときだけ配置します。',
    note: 'ほとんどが低圧から低圧への変換のため、通常は単線結線図に記載しない。任意で記載する場合のみ使用する。',
  },
];
