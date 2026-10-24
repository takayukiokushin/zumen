import type { FieldDef, SymbolDef } from '../types.ts';
import { blade, contact, hline, line, loadContact, path, rect, tiltedBar, vline } from '../shape.ts';

/** 遮断器を表す×印 */
/**
 * 主回路に直列に入る機器の共通の枠。
 * DS・VCB・PC・LBS・変圧器・リアクトル・コンデンサを同じ大きさに揃えてある。
 * 大小がまちまちだと図面のつり合いが崩れるため。
 * 接続点は上下の中央（x=24）に置き、記号の絵は枠の中で上下中央に収める。
 */
export const CELL = { w: 48, h: 72 } as const;
export const CELL_PORTS = [
  { id: 'in', x: 24, y: 0, dir: 'up' as const, role: 'line' as const },
  { id: 'out', x: 24, y: CELL.h, dir: 'down' as const, role: 'line' as const },
];

const crossMark = (x: number, y: number, s = 3.6) => [
  line(x - s, y - s, x + s, y + s),
  line(x + s, y - s, x - s, y + s),
];

const RATED_VOLTAGE: FieldDef = {
  key: 'ratedVoltage',
  label: '定格電圧',
  type: 'select',
  options: [
    { value: '7200', label: '7200V（新）' },
    { value: '6600', label: '6600V（旧）' },
  ],
  unit: 'V',
  defaultValue: '7200',
};

const RATED_CURRENT: FieldDef = { key: 'ratedCurrent', label: '定格電流', type: 'number', unit: 'A' };

export const switchgearSymbols: SymbolDef[] = [
  {
    id: 'as',
    abbr: 'AS',
    nameJa: 'エアースイッチ',
    nameFormal: '気中開閉器',
    category: 'switchgear',
    tags: ['電力会社', '引込元', '屋側'],
    box: { w: 56, h: 72 },
    shapes: [
      vline(28, 0, 10),
      rect(6, 10, 44, 52),
      ...loadContact(28, 31, 4, 8, 10),
      line(28, 54, 16, 38),
      vline(28, 54, 72),
    ],
    ports: [
      { id: 'in', x: 28, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 28, y: 72, dir: 'down', role: 'line' },
    ],
    fields: [RATED_VOLTAGE, RATED_CURRENT, { key: 'place', label: '設置場所', type: 'text', help: '図面の記載例: 屋側' }],
    status: 'confirmed',
    statusNote: '見本図面のとおり、実線の四角＋負荷開閉器の印（横バー＋丸）＋左上がりの可動刃にしました。',
    note: '記載例「屋側 / AS / 7200V200A」。電柱パターンのとき、引込元〜責任分界点の間に入る場合がある。',
  },
  {
    id: 'mccb',
    abbr: 'MCCB',
    nameJa: '配線用遮断器',
    category: 'switchgear',
    tags: ['低圧', '遮断器', 'PCS'],
    box: { w: 44, h: 52 },
    shapes: [
      vline(16, 0, 12),
      line(10, 6, 24, 20),
      line(24, 6, 10, 20),
      line(16, 38, 28, 18),
      vline(16, 38, 52),
    ],
    ports: [
      { id: 'in', x: 16, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 16, y: 52, dir: 'down', role: 'line' },
    ],
    fields: [RATED_CURRENT],
    status: 'confirmed',
    statusNote: '実図面のとおり、×印＋可動刃。低圧側の分岐に使う。',
    note: '記載例「MCCB 225A」。',
  },
  {
    id: 'ds',
    abbr: 'DS',
    nameJa: '断路器（ディスコン）',
    category: 'switchgear',
    tags: ['CB形', 'ディスコン', '受電設備'],
    box: { ...CELL },
    shapes: [
      vline(24, 0, 15),
      hline(15, 13, 35),
      contact(24, 53, 4),
      line(24, 49, 44, 20),
      vline(24, 57, 72),
    ],
    ports: CELL_PORTS,
    fields: [RATED_VOLTAGE, RATED_CURRENT],
    status: 'confirmed',
    statusNote: '見本図面のとおり、上に横バー（固定接点）、下に丸（可動接点）、可動刃は右上がりにしました。',
    note: 'CB形の基本構成で、高圧ケーブル端末の次に入る。DSの次にVTが並列接続、VCBが直列接続される。記載例「DS 7200V 400A」。',
  },
  {
    id: 'lbs',
    abbr: 'LBS',
    nameJa: '高圧負荷開閉器',
    category: 'switchgear',
    tags: ['PFS形', '主遮断装置', '責任分界点'],
    box: { w: 48, h: 62 },
    shapes: [
      ...loadContact(24, 14.5, 5.5, 9, 0),
      line(24, 48, 13, 24),
      vline(24, 48, 62),
    ],
    ports: [
      { id: 'in', x: 24, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 24, y: 62, dir: 'down', role: 'line' },
    ],
    fields: [RATED_VOLTAGE, RATED_CURRENT],
    status: 'confirmed',
    statusNote: 'PF付LBSからヒューズの形だけを除いた形で確定。上の丸は負荷開閉器であることを表すためLBSにのみ付き、下の丸は付けません。',
    note: '3点不一致のとき、この記号の中央に横線を引いて「責任分界点」と記載することがある。',
  },
  {
    id: 'lbs-pf',
    abbr: 'LBS(PF付)',
    nameJa: '限流ヒューズ付高圧負荷開閉器',
    category: 'switchgear',
    tags: ['PFS形', '主遮断装置', 'PF・S形'],
    box: { ...CELL },
    shapes: [
      ...loadContact(24, 15.5, 5.5, 9, 0),
      line(24, 63, 12, 27),
      tiltedBar(22.1, 57.3, 13.9, 32.7, 5),
      vline(24, 63, 72),
    ],
    ports: CELL_PORTS,
    fields: [
      RATED_VOLTAGE,
      RATED_CURRENT,
      { key: 'fuseCount', label: 'ヒューズ本数', type: 'number', unit: '本', defaultValue: 3, help: '図面の記載例: PF×3' },
      { key: 'fuseSpec', label: 'ヒューズ定格', type: 'text', help: '図面の記載例: 7200V G50A T40A' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、上部に横バー＋丸（負荷開閉器の印）、左上がりの可動刃の上に傾けた長方形のヒューズを描く形にしました。',
    note: 'PFS形（PF・S形）の主遮断装置。設備容量300kVA以下で採用可能。記載例「LBS 7200V 200A PF×3 7200V G50A T40A」。',
  },
  {
    id: 'pf',
    abbr: 'PF',
    nameJa: '限流ヒューズ',
    category: 'switchgear',
    tags: ['ヒューズ', 'VT'],
    box: { w: 40, h: 44 },
    shapes: [vline(20, 0, 44), rect(15, 11, 10, 22)],
    ports: [
      { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 20, y: 44, dir: 'down', role: 'line' },
    ],
    fields: [RATED_CURRENT],
    status: 'confirmed',
    statusNote: '見本図面（VT＋PF）のとおり、導体方向に細長い長方形にしました。',
    note: 'VTの手前に入る。横向きの分岐に付く場合は90°回転して使う。',
  },
  {
    id: 'pc',
    abbr: 'PC',
    nameJa: '高圧カットアウト',
    category: 'switchgear',
    tags: ['カットアウトスイッチ', '変圧器一次側'],
    box: { ...CELL },
    shapes: [
      vline(24, 0, 12),
      line(24, 60, 8, 12),
      tiltedBar(21.5, 52.5, 10.5, 19.5, 5.5),
      vline(24, 60, 72),
    ],
    ports: CELL_PORTS,
    fields: [
      RATED_VOLTAGE,
      RATED_CURRENT,
      { key: 'fuseCount', label: 'ヒューズ本数', type: 'number', unit: '本', defaultValue: 2, help: '図面の記載例: F×2' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、左上がりの可動刃の上に傾けた長方形のヒューズ。上下とも丸・横バーは付けません。',
    note: '変圧器の手前に入るパターン、PAS〜VCT間のLAの上部に入るパターンがある。記載例「PC 7200V 50A F×2」。',
  },
  {
    id: 'vcb',
    abbr: 'VCB',
    nameJa: '真空遮断器',
    category: 'switchgear',
    tags: ['CB形', '主遮断装置', '責任分界点'],
    box: { ...CELL },
    shapes: [
      // 開閉部の寸法はDS・VCSと共通（固定接点 y=15／可動接点 y=53／可動刃の先 (44,20)）。
      // 以前はここだけ小さく描いていたため、並べたときにVCBだけ貧相に見えていた
      vline(24, 0, 15),
      ...crossMark(24, 15, 4.5),
      contact(24, 53, 4),
      line(24, 49, 44, 20),
      // 丸（可動接点）の中を線が突き抜けないよう、下端から引き直す
      vline(24, 57, 72),
    ],
    ports: CELL_PORTS,
    status: 'confirmed',
    statusNote: '×印付き開閉器（JIS式）。可動刃は右上がり、下に丸（可動接点）を付けます。上の丸は付けません。',
    note: 'CB形の主遮断装置。設備容量301kVA以上では必須。すぐ下にCTが入る。',
  },
  {
    id: 'vcs',
    abbr: 'VCS',
    nameJa: '真空電磁接触器',
    category: 'switchgear',
    tags: ['電磁接触器', '進相設備', 'コンデンサ開閉'],
    // 進相コンデンサの開閉に使う。DSと見分けられるよう、固定接点を「お椀」で描く
    box: { ...CELL },
    shapes: [
      vline(24, 0, 15),
      path('M 17 15 A 7 7 0 0 0 31 15'),
      contact(24, 53, 4),
      line(24, 49, 42, 22),
      vline(24, 57, 72),
    ],
    ports: CELL_PORTS,
    fields: [RATED_VOLTAGE, RATED_CURRENT],
    status: 'confirmed',
    statusNote: '固定接点をお椀（半円）で描き、断路器と見分けられるようにしました。',
    note: '進相コンデンサの開閉用。LBSと組み合わせて使う現場がある。',
  },
  {
    id: 'pas',
    abbr: 'PAS',
    nameJa: '区分開閉器（高圧気中開閉器）',
    category: 'switchgear',
    tags: ['区分開閉器', '電柱上', 'GR', 'DGR'],
    // 内蔵するZCT・VT・LAが収まる最小限の大きさにしてある。
    // 以前は余白が多く、他の記号に比べて大きすぎた。
    box: { w: 86, h: 148 },
    shapes: [
      vline(28, 0, 10),
      rect(6, 10, 74, 126),
      ...loadContact(28, 62, 4.5, 8),
      line(28, 84, 16, 66),
      vline(28, 84, 148),
    ],
    ports: [
      { id: 'in', x: 28, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 28, y: 148, dir: 'down', role: 'line' },
    ],
    // 並びは見本図面のまま（上からZCT・開閉部・LAとVT）。余白だけを詰めてある
    slots: [
      { id: 'zct', x: 28, y: 12, label: 'ZCT（GR/DGR方式のとき内蔵）', accepts: ['zct'] },
      { id: 'la', x: 20, y: 88, label: 'LA内蔵', accepts: ['la'] },
      { id: 'vt', x: 24, y: 105, label: 'VT内蔵', accepts: ['vt'] },
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
        help: 'GRはZCTが入る。DGRはZCTに加え零相電圧（内蔵VTまたはZPD）が必要。',
      },
      { key: 'builtinVt', label: 'VT内蔵', type: 'boolean', defaultValue: false },
      { key: 'builtinLa', label: 'LA内蔵', type: 'boolean', defaultValue: false },
    ],
    status: 'confirmed',
    statusNote: '実図面のとおり、実線の四角＋負荷開閉器の印（横バー＋丸）＋左上がりの可動刃。内蔵機器（ZCT/VT/LA）を枠内に収められる大きさにしました。',
    note: '記載例「PAS 7200V300A VT,LA内蔵型」。制御装置（GR/DGR）は枠の外に描き、ZCT・VTから制御線を引く。枠の一番下の接地記号はLAの接地で、LAとPAS本体の接地を同じ箇所で施工していることを表す。',
  },
];
