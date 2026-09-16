import type { FieldDef, SymbolDef } from '../types.ts';
import type { Shape } from '../shape.ts';
import { circle, deltaMark, hline, line, starMark, vline } from '../shape.ts';

/** 変圧器の2つの巻線（重なった2円）。cy1=一次側、cy2=二次側 */
const windings = (cx: number, cy1: number, cy2: number, r: number): Shape[] => [
  circle(cx, cy1, r),
  circle(cx, cy2, r),
];

type Conn = 'y' | 'd' | 'none';

const connMark = (conn: Conn, cx: number, cy: number, r = 4.5): Shape[] => {
  if (conn === 'y') return starMark(cx, cy, r);
  if (conn === 'd') return [deltaMark(cx, cy, r + 0.6)];
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

/** 三相変圧器（結線方式違い）を1つの定義から生成する */
const threePhase = (
  id: string,
  primary: Conn,
  secondary: Conn,
  label: string,
): SymbolDef => ({
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
  fields: [CAPACITY, SECONDARY_V],
  note: '使用用途によって巻線の結線方式が異なる。基本は Y-Y / Δ-Δ / Y-Δ / Δ-Y の4種類。',
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
    note: '単相用は基本的に1種類のみ（結線方式のバリエーションなし）。',
  },
  threePhase('tr-3p-yy', 'y', 'y', 'Y-Y結線'),
  threePhase('tr-3p-dd', 'd', 'd', 'Δ-Δ結線'),
  threePhase('tr-3p-yd', 'y', 'd', 'Y-Δ結線'),
  threePhase('tr-3p-dy', 'd', 'y', 'Δ-Y結線'),
  {
    id: 'tr-scott',
    abbr: 'T',
    nameJa: 'スコット変圧器（スコット結線）',
    category: 'transformer',
    tags: ['変圧器', 'スコット', '単相三線'],
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
    note: '三相交流から2種類の単相三線式を取り出す結線方式。三相回路のアンバランスを防ぎつつ単相電源を取得する用途。',
    review: 'M座/T座の描き分けを簡略化している。実際の図面での表現を確認したい。',
  },
  {
    id: 'tr-vv',
    abbr: 'T',
    nameJa: 'V-V結線（単相変圧器2台）',
    category: 'transformer',
    tags: ['変圧器', 'V-V', '単相2台'],
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
    note: '単相変圧器を2台接続して三相を構成する。',
  },
  {
    id: 'tr-dd-3units',
    abbr: 'T',
    nameJa: 'Δ-Δ結線（単相変圧器3台）',
    category: 'transformer',
    tags: ['変圧器', 'デルタ', '単相3台'],
    box: { w: 104, h: 56 },
    shapes: [
      vline(52, 0, 8),
      hline(8, 20, 84),
      vline(20, 8, 11),
      vline(52, 8, 11),
      vline(84, 8, 11),
      ...windings(20, 20, 32, 9),
      ...windings(52, 20, 32, 9),
      ...windings(84, 20, 32, 9),
      vline(20, 41, 48),
      vline(52, 41, 48),
      vline(84, 41, 48),
      hline(48, 20, 84),
      vline(52, 48, 56),
    ],
    ports: [
      { id: 'in', x: 52, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 52, y: 56, dir: 'down', role: 'line' },
    ],
    fields: [CAPACITY, SECONDARY_V],
    note: '単相変圧器3台を組み合わせてΔ-Δ結線とするパターン（三相変圧器単体のΔ-Δ結線とは別物）。',
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
    note: '単相変圧器2台を並行運転させ、倍容量の単相変圧器として使用するパターン。',
    review: 'V-V結線と図形が同一のため、図面上どう描き分けているか確認したい（注記のみで区別か）。',
  },
];
