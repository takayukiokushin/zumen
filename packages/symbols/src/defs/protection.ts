import type { SymbolDef } from '../types.ts';
import { arrowDown, earth, hline, rect, text, vline } from '../shape.ts';

/**
 * 保護継電器の種類マスタ。
 *
 * 図面には「長方形の中に継電器の種類を記載する」形で描く。
 * 手書き図面に書かれている記号をそのまま載せるのが原則で、この一覧にない記号が
 * 出てきた場合は「誤字か／新しい継電器か」をユーザーに確認したうえで、
 * このリストに1行追加する（＝新しい継電器はデータ追加のみで対応できる）。
 */
export interface RelayType {
  code: string;
  nameJa: string;
  /** 正式名称が未確定のものは要確認として扱う */
  needsConfirm?: boolean;
  note?: string;
}

export const RELAY_TYPES: RelayType[] = [
  { code: 'OCR', nameJa: '過電流継電器', note: 'CB形の基本構成で、CTの次に入る。' },
  { code: 'GR', nameJa: '地絡継電器（無方向性）', note: 'GR方式のPASに入る。ZCTが必要。' },
  { code: 'DGR', nameJa: '地絡方向継電器（方向性）', note: 'DGR方式のPASに入る。ZCTに加えZPDが必要。GRの上位互換。' },
  { code: 'OCGR', nameJa: '地絡過電流継電器' },
  { code: 'OVGR', nameJa: '地絡過電圧継電器' },
  { code: 'UVR', nameJa: '不足電圧継電器' },
  { code: 'OVR', nameJa: '過電圧継電器' },
  { code: 'UFR', nameJa: '不足周波数継電器' },
  { code: 'OFR', nameJa: '過周波数継電器' },
  { code: 'RPR', nameJa: '逆電力継電器' },
  { code: 'UPR', nameJa: '不足電力継電器' },
  { code: 'DSR', nameJa: '方向短絡継電器', needsConfirm: true, note: '正式名称の確認をお願いします。' },
  { code: '2E', nameJa: '電動機保護継電器（2要素：過負荷・欠相）' },
  { code: '3E', nameJa: '電動機保護継電器（3要素：過負荷・欠相・反相）' },
];

/** 継電器の記号（長方形＋種類の文字）を1件生成する */
const relay = (t: RelayType): SymbolDef => ({
  id: `relay-${t.code.toLowerCase()}`,
  abbr: t.code,
  nameJa: t.nameJa,
  category: 'protection',
  tags: ['保護継電器', t.code],
  box: { w: 50, h: 40 },
  shapes: [
    hline(20, 0, 11),
    rect(11, 8, 34, 24),
    text(28, 20, t.code, { size: t.code.length >= 4 ? 9.5 : 11 }),
  ],
  ports: [{ id: 'in', x: 0, y: 20, dir: 'left', role: 'secondary' }],
  fields: [
    { key: 'tap', label: '整定値・タップ', type: 'text' },
  ],
  status: t.needsConfirm ? 'open-question' : 'confirmed',
  statusNote: '長方形の中に継電器の種類を記載する形に統一。',
  note: t.note,
  review: t.needsConfirm ? `${t.code} の正式名称が未確定です。` : undefined,
});

export const protectionSymbols: SymbolDef[] = [
  ...RELAY_TYPES.map(relay),
  {
    id: 'la',
    abbr: 'LA',
    nameJa: '避雷器',
    category: 'protection',
    tags: ['PAS内蔵', '雷'],
    box: { w: 40, h: 48 },
    shapes: [
      vline(20, 0, 10),
      rect(13, 10, 14, 18),
      vline(20, 12, 23),
      arrowDown(20, 26.5),
      vline(20, 28, 36),
      ...earth(20, 36),
    ],
    ports: [{ id: 'in', x: 20, y: 0, dir: 'up', role: 'line' }],
    fields: [{ key: 'ratedVoltage', label: '定格電圧', type: 'text', unit: 'V' }],
    status: 'confirmed',
    statusNote: 'この形でOK。',
    note: 'PAS内蔵のパターンのほか、PAS内にLAが入っていない場合にPAS〜VCT間に単独で入るパターンがある（その上部にPCが入ることも）。',
  },
  {
    id: 'zpd',
    abbr: 'ZPD',
    nameJa: '零相電圧検出装置',
    nameFormal: 'ゼロポテンシャルデバイス（ユーザー呼称）',
    category: 'protection',
    tags: ['PAS', 'DGR', '零相電圧'],
    box: { w: 48, h: 48 },
    shapes: [
      vline(20, 0, 48),
      hline(20, 20, 34),
      vline(34, 20, 26),
      hline(26, 27, 41),
      hline(30, 27, 41),
      vline(34, 30, 36),
      ...earth(34, 36),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 48, dir: 'down', role: 'line' },
    ],
    status: 'awaiting-sample',
    statusNote: '修正が必要。代表図面の到着後に描き直します。',
    note: 'DGR方式のときZCTに加えて入る。',
  },
  {
    id: 'earth',
    abbr: 'E',
    nameJa: '接地',
    category: 'protection',
    tags: ['アース', '接地'],
    box: { w: 28, h: 20 },
    shapes: [vline(14, 0, 8), ...earth(14, 8)],
    ports: [{ id: 'in', x: 14, y: 0, dir: 'up', role: 'earth' }],
    fields: [
      {
        key: 'earthType',
        label: '接地種別',
        type: 'select',
        options: [
          { value: 'A', label: 'A種' },
          { value: 'B', label: 'B種' },
          { value: 'C', label: 'C種' },
          { value: 'D', label: 'D種' },
        ],
        allowFreeInput: true,
      },
      { key: 'resistance', label: '接地抵抗値', type: 'text', unit: 'Ω' },
    ],
    status: 'confirmed',
    statusNote: 'この形でOK。',
  },
];
