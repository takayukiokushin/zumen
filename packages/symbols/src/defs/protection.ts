import type { SymbolDef } from '../types.ts';
import { arrowDown, circle, earth, hline, rect, text, vline } from '../shape.ts';


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
  box: { w: 38, h: 24 },
  shapes: [
    rect(0, 0, 38, 24),
    text(19, 12, t.code, { size: t.code.length >= 4 ? 9 : 10.5, tracking: 1.6 }),
  ],
  ports: [
    { id: 'l', x: 0, y: 12, dir: 'left', role: 'secondary' },
    { id: 'r', x: 38, y: 12, dir: 'right', role: 'secondary' },
  ],
  fields: [
    { key: 'tap', label: '整定値・タップ', type: 'text' },
  ],
  status: t.needsConfirm ? 'open-question' : 'confirmed',
  statusNote: '長方形の中に継電器の種類を記載する。枠の外には何も書かない。引出線は結線側で引くため、記号は枠のみ。',
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
    note: 'PAS内蔵のパターンのほか、PAS内にLAが入っていない場合にPAS〜VCT間に単独で入るパターンがある（その上部にPCが入ることも）。PAS内蔵の場合、LAの接地はPAS本体の接地と同じ箇所で施工するため、接地記号はPASの枠の一番下にまとめて描く。',
  },
  {
    id: 'zpd',
    abbr: 'ZPD',
    nameJa: '零相電圧検出装置',
    nameFormal: 'ゼロポテンシャルデバイス（ユーザー呼称）',
    category: 'protection',
    tags: ['PAS', 'DGR', 'OVGR', '零相電圧'],
    box: { w: 100, h: 70 },
    shapes: [
      vline(30, 0, 22),
      rect(14, 12, 76, 32),
      hline(22, 18, 42),
      hline(30, 18, 42),
      vline(30, 30, 58),
      ...earth(30, 58),
      hline(26, 0, 55),
      circle(64, 26, 9),
      circle(76, 26, 9),
    ],
    ports: [
      { id: 'in', x: 30, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 0, y: 26, dir: 'left', role: 'control', label: 'OVGR/DGRへ' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、箱の中にコンデンサ（2枚の板）と変圧器（二重丸）、下に接地を描く形にしました。',
    note: 'DGR方式で零相電圧が必要なときに入る。見本図面ではOVGRへ接続されていた。',
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
          { value: 'EA', label: 'A種（EA）' },
          { value: 'EB', label: 'B種（EB）' },
          { value: 'EC', label: 'C種（EC）' },
          { value: 'ED', label: 'D種（ED）' },
        ],
        allowFreeInput: true,
        help: '図面には EA / EB / ED のように記載する',
      },
      { key: 'resistance', label: '接地抵抗値', type: 'text', unit: 'Ω' },
    ],
    status: 'confirmed',
    statusNote: 'この形でOK。接地種別は実図面のとおり「EA」等の表記で脇に記載します。',
  },
];
