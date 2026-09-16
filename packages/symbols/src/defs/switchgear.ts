import type { SymbolDef } from '../types.ts';
import { blade, contact, hline, line, path, rect, vline } from '../shape.ts';

/** 負荷開閉器の消弧室を表す半円（固定接点の上に描く） */
const arcCap = (x: number, y: number, r = 7) =>
  path(`M ${x - r} ${y} A ${r} ${r} 0 0 1 ${x + r} ${y}`);

/** 遮断器を表す×印 */
const crossMark = (x: number, y: number, s = 3.6) => [
  line(x - s, y - s, x + s, y + s),
  line(x + s, y - s, x - s, y + s),
];

const RATED_VOLTAGE = {
  key: 'ratedVoltage',
  label: '定格電圧',
  type: 'select' as const,
  options: [
    { value: '7200', label: '7200V（新）' },
    { value: '6600', label: '6600V（旧）' },
  ],
  unit: 'V',
  defaultValue: '7200',
};

export const switchgearSymbols: SymbolDef[] = [
  {
    id: 'as',
    abbr: 'AS',
    nameJa: 'エアースイッチ',
    nameFormal: '気中開閉器（電力会社側）',
    category: 'switchgear',
    tags: ['電力会社', '引込元'],
    box: { w: 40, h: 44 },
    shapes: [vline(20, 0, 12), ...blade(20, 12, 30), vline(20, 30, 44)],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    note: '電柱パターンのとき、引込元〜責任分界点の間に入る場合がある（電力会社側の機器）。',
  },
  {
    id: 'ds',
    abbr: 'DS',
    nameJa: '断路器（ディスコン）',
    category: 'switchgear',
    tags: ['CB形', 'ディスコン', '受電設備'],
    box: { w: 40, h: 44 },
    shapes: [
      vline(20, 0, 12),
      hline(9.5, 13, 27),
      ...blade(20, 12, 30),
      vline(20, 30, 44),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    note: 'CB形の基本構成で、高圧ケーブル端末の次に入る。DSの次にVTが並列接続、VCBが直列接続される。',
  },
  {
    id: 'lbs',
    abbr: 'LBS',
    nameJa: '高圧負荷開閉器',
    category: 'switchgear',
    tags: ['PFS形', '主遮断装置', '責任分界点'],
    box: { w: 40, h: 44 },
    shapes: [
      vline(20, 0, 12),
      arcCap(20, 12),
      ...blade(20, 12, 30),
      vline(20, 30, 44),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    note: '3点不一致のとき、この記号の中央に横線を引いて「責任分界点」と記載することがある。',
  },
  {
    id: 'lbs-pf',
    abbr: 'LBS(PF付)',
    nameJa: '限流ヒューズ付高圧負荷開閉器',
    category: 'switchgear',
    tags: ['PFS形', '主遮断装置', 'PF・S形'],
    box: { w: 40, h: 68 },
    shapes: [
      vline(20, 0, 12),
      arcCap(20, 12),
      ...blade(20, 12, 30),
      vline(20, 30, 68),
      rect(14, 44, 12, 16),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 68, dir: 'down', role: 'line' },
    ],
    fields: [
      { key: 'fuseRating', label: 'ヒューズ定格電流', type: 'number', unit: 'A' },
    ],
    note: 'PFS形（PF・S形）の主遮断装置。設備容量300kVA以下で採用可能。',
  },
  {
    id: 'pf',
    abbr: 'PF',
    nameJa: '限流ヒューズ',
    category: 'switchgear',
    tags: ['ヒューズ'],
    box: { w: 40, h: 40 },
    shapes: [vline(20, 0, 40), rect(14, 12, 12, 16)],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 40, dir: 'down', role: 'line' },
    ],
    fields: [{ key: 'ratedCurrent', label: '定格電流', type: 'number', unit: 'A' }],
  },
  {
    id: 'pc',
    abbr: 'PC',
    nameJa: '高圧カットアウト',
    category: 'switchgear',
    tags: ['カットアウトスイッチ', '変圧器一次側'],
    box: { w: 40, h: 44 },
    shapes: [
      vline(20, 0, 44),
      rect(13, 12, 14, 18),
      line(13, 30, 27, 12),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    fields: [{ key: 'fuseRating', label: 'ヒューズ定格電流', type: 'number', unit: 'A' }],
    note: '変圧器の手前に入るパターン、PAS〜VCT間のLAの上部に入るパターンがある。',
    review: 'ヒューズ記号＋斜線で表現している。実際の図面での高圧カットアウトの描き方を確認したい。',
  },
  {
    id: 'vcb',
    abbr: 'VCB',
    nameJa: '真空遮断器',
    category: 'switchgear',
    tags: ['CB形', '主遮断装置', '責任分界点'],
    box: { w: 40, h: 44 },
    shapes: [
      vline(20, 0, 12),
      ...crossMark(20, 12),
      contact(20, 30),
      line(20, 28.2, 31, 14),
      vline(20, 30, 44),
    ],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    note: 'CB形の主遮断装置。設備容量301kVA以上では必須。すぐ下にCTが入る。',
    review: '×印付き開閉器（JIS式）で描いている。角型（□）表記を使っている図面もあるため要確認。',
  },
  {
    id: 'vcb-box',
    abbr: 'VCB',
    nameJa: '真空遮断器（角型・別表記）',
    category: 'switchgear',
    altOf: 'vcb',
    tags: ['CB形', '主遮断装置', '別表記'],
    box: { w: 40, h: 44 },
    shapes: [vline(20, 0, 14), rect(12, 14, 16, 16), vline(20, 30, 44)],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    note: 'VCBを四角で表す描き方。どちらを標準にするか確認のうえ、一方に統一する。',
  },
  {
    id: 'pas',
    abbr: 'PAS',
    nameJa: '区分開閉器（高圧気中開閉器）',
    category: 'switchgear',
    tags: ['区分開閉器', '電柱上', 'GR', 'DGR'],
    box: { w: 48, h: 56 },
    shapes: [
      vline(24, 0, 18),
      rect(4, 8, 40, 40, { dash: '4 3' }),
      arcCap(24, 18),
      ...blade(24, 18, 38),
      vline(24, 38, 56),
    ],
    ports: [
      { id: 'in', x: 24, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 24, y: 56, dir: 'down', role: 'line' },
    ],
    slots: [
      { id: 'zct', x: 24, y: 44, label: 'ZCT（GR/DGR方式のとき内蔵）', accepts: ['zct'] },
      { id: 'zpd', x: 38, y: 44, label: 'ZPD（DGR方式のとき内蔵）', accepts: ['zpd'] },
      { id: 'vt', x: 10, y: 30, label: 'VT内蔵', accepts: ['vt'] },
      { id: 'la', x: 38, y: 30, label: 'LA内蔵', accepts: ['la'] },
    ],
    fields: [
      RATED_VOLTAGE,
      {
        key: 'ratedCurrent',
        label: '定格電流',
        type: 'select',
        options: [
          { value: '100', label: '100A' },
          { value: '200', label: '200A' },
          { value: '300', label: '300A' },
          { value: '400', label: '400A' },
        ],
        unit: 'A',
      },
      {
        key: 'control',
        label: '制御装置の種類',
        type: 'select',
        options: [
          { value: 'none', label: 'なし' },
          { value: 'gr', label: 'GR（無方向性）' },
          { value: 'dgr', label: 'DGR（方向性）' },
        ],
        defaultValue: 'dgr',
        help: 'GRはZCTが入る。DGRはZCTに加えZPDが入る（DGRはGRの上位互換）。',
      },
      { key: 'builtinVt', label: 'VT内蔵', type: 'boolean', defaultValue: false },
      { key: 'builtinLa', label: 'LA内蔵', type: 'boolean', defaultValue: false },
    ],
    note: '内蔵機器（ZCT/ZPD/VT/LA）は個別の記号として持ち、この点線枠の中に配置する方式にしている（新しい内蔵機器が増えてもデータ追加のみで対応できる）。',
  },
];
