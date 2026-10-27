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

/** PAS（PGSも同じ図記号）の定格電圧。3300V・22000Vの現場もあるので、ほかの開閉器より選択肢が多い */
const PAS_RATED_VOLTAGE: FieldDef = {
  key: 'ratedVoltage',
  label: '定格電圧',
  type: 'select',
  options: [
    { value: '3300', label: '3300V' },
    { value: '6600', label: '6600V（旧）' },
    { value: '7200', label: '7200V（新）' },
    { value: '22000', label: '22000V' },
  ],
  unit: 'V',
  defaultValue: '7200',
};

const RATED_CURRENT: FieldDef = { key: 'ratedCurrent', label: '定格電流', type: 'number', unit: 'A' };

/**
 * PAS（区分開閉器）の図記号。
 *
 * 内蔵機器（ZCT・LA・VT）を入れると枠の中が窮屈になるので、
 * 入れるとき用に枠を少し広げたものを別に用意している。
 * 中身の寸法は共通で、枠だけを外へ広げ、中身はそのぶん右へずらす。
 *
 * @param pad 枠を外へ広げる量。l=左・r=右・t=上・b=下
 */
const pasDef = (
  id: string,
  pad: { l: number; r: number; t: number; b: number },
  altOf?: string,
): SymbolDef => {
  const { l, r, t, b } = pad;
  /** 主回路（縦に走る線）の位置 */
  const x = 28 + l;
  const frameTop = 10 - t;
  const frameBottom = 136 + b;
  /**
   * 内蔵LAの位置。
   * LAの記号は、入口から 28 下が本体の下端、36 下が接地記号の1本目。
   * 本体は枠の中、接地記号は枠の外（下）に出したいので、
   * ちょうど枠の下の線をまたぐ位置に置く（本体の下に4、接地の上に4の余白）。
   */
  const laY = frameBottom - 32;
  /** 接地記号が枠の下へ出るぶん、箱も下へ伸ばす（内蔵版だけ） */
  const h = altOf ? laY + 48 + 8 : 148 + b;
  return {
    id,
    abbr: 'PAS',
    labelLines: ['PAS', '{ratedVoltage}V', '{ratedCurrent}A'],
    nameJa: '区分開閉器（高圧気中開閉器）',
    category: 'switchgear',
    tags: ['区分開閉器', '電柱上', 'GR', 'DGR'],
    ...(altOf ? { altOf, optional: true } : {}),
    // 内蔵するZCT・VT・LAが収まる最小限の大きさにしてある。
    // 以前は余白が多く、他の記号に比べて大きすぎた。
    box: { w: 86 + l + r, h },
    shapes: [
      vline(x, 0, frameTop),
      rect(6, frameTop, 74 + l + r, frameBottom - frameTop),
      // 枠の上端から開閉部の横バーまで、縦線を途切れさせずに引く。
      // 内蔵のZCTも同じ位置に縦線を持つが、ZCTが無い構成（制御なし）や、
      // ZCTの端と枠・バーのあいだに隙間ができる構成でも、線がつながるようにここで引いておく
      ...loadContact(x, 62, 8, frameTop),
      line(x, 84, 16 + l, 66),
      vline(x, 84, h),
    ],
    ports: [
      { id: 'in', x, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x, y: h, dir: 'down', role: 'line' },
    ],
    // 並びは見本図面のまま（上からZCT・開閉部・LAとVT）。余白だけを詰めてある。
    // VTは主回路の上に置く。少しでもずらすと、VTの横棒が主回路を貫いて左へはみ出す
    slots: [
      { id: 'zct', x, y: 12, label: 'ZCT（GR/DGR方式のとき内蔵）', accepts: ['zct'] },
      // LAは枠の左半分の真ん中に置く（枠の左の線までと主回路までが同じ余白になる）
      { id: 'la', x: 13 + l, y: laY, label: 'LA内蔵', accepts: ['la'] },
      { id: 'vt', x, y: 100, label: 'VT内蔵', accepts: ['vt'] },
    ],
    fields: [
      PAS_RATED_VOLTAGE,
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
    statusNote:
      '実図面のとおり、実線の四角＋負荷開閉器の印（横バー＋丸）＋左上がりの可動刃。内蔵機器（ZCT/VT/LA）を枠内に収められる大きさにしました。',
    note: '記載例「PAS 7200V300A VT,LA内蔵型」。制御装置（GR/DGR）は枠の外に描き、ZCT・VTから制御線を引く。枠の一番下の接地記号はLAの接地で、LAとPAS本体の接地を同じ箇所で施工していることを表す。',
  };
};

export const switchgearSymbols: SymbolDef[] = [
  {
    id: 'as',
    labelLines: ['AS', '{ratedVoltage}V', '{ratedCurrent}A'],
    abbr: 'AS',
    // 呼び方は「気中開閉器」で統一する（「エアースイッチ」とは書かない）
    nameJa: '気中開閉器',
    category: 'switchgear',
    tags: ['電力会社', '引込元', '屋側'],
    box: { w: 56, h: 72 },
    shapes: [
      vline(28, 0, 10),
      rect(6, 10, 44, 52),
      ...loadContact(28, 31, 8, 10),
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
    labelLines: ['MCCB', '{ratedCurrent}A'],
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
    labelLines: ['DS', '{ratedVoltage}V', '{ratedCurrent}A'],
    abbr: 'DS',
    nameJa: '断路器（ディスコン）',
    category: 'switchgear',
    tags: ['CB形', 'ディスコン', '受電設備'],
    box: { ...CELL },
    shapes: [
      vline(24, 0, 15),
      hline(15, 13, 35),
      // 下の丸は付けない。可動刃と下の縦線は、支点 (24,53) でそのままつなぐ
      line(24, 53, 44, 20),
      vline(24, 53, 72),
    ],
    ports: CELL_PORTS,
    fields: [RATED_VOLTAGE, RATED_CURRENT],
    status: 'confirmed',
    statusNote: '見本図面のとおり、上に横バー（固定接点）、可動刃は右上がり。下の丸は付けず、可動刃と下の縦線を直につなぎます。',
    note: 'CB形の基本構成で、高圧ケーブル端末の次に入る。DSの次にVTが並列接続、VCBが直列接続される。記載例「DS 7200V 400A」。',
  },
  {
    id: 'lbs',
    labelLines: ['LBS', '{ratedVoltage}V', '{ratedCurrent}A'],
    abbr: 'LBS',
    nameJa: '高圧負荷開閉器',
    category: 'switchgear',
    tags: ['PFS形', '主遮断装置', '責任分界点'],
    box: { w: 48, h: 62 },
    shapes: [
      ...loadContact(24, 14.5, 9, 0),
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
    labelLines: ['LBS', '{ratedVoltage}V', '{ratedCurrent}A', 'PF×{fuseCount}', '{fuseSpec}'],
    abbr: 'LBS(PF付)',
    nameJa: '限流ヒューズ付高圧負荷開閉器',
    category: 'switchgear',
    tags: ['PFS形', '主遮断装置', 'PF・S形'],
    box: { ...CELL },
    shapes: [
      ...loadContact(24, 15.5, 9, 0),
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
    labelLines: ['PF', '{ratedCurrent}A'],
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
    labelLines: ['PC', '{ratedVoltage}V', '{ratedCurrent}A', 'F:{fuseCurrent}A'],
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
      { key: 'fuseCurrent', label: 'ヒューズの定格電流', type: 'number', unit: 'A', help: '図面の記載例: F:50A' },
      { key: 'fuseCount', label: 'ヒューズ本数', type: 'number', unit: '本', defaultValue: 2, help: '図面の記載例: F×2' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、左上がりの可動刃の上に傾けた長方形のヒューズ。上下とも丸・横バーは付けません。',
    note: '変圧器の手前に入るパターン、PAS〜VCT間のLAの上部に入るパターンがある。記載例「PC 7200V 50A F×2」。',
  },
  {
    id: 'vcb',
    labelLines: ['VCB', '{ratedVoltage}V', '{ratedCurrent}A'],
    abbr: 'VCB',
    nameJa: '真空遮断器',
    category: 'switchgear',
    tags: ['CB形', '主遮断装置', '責任分界点'],
    box: { ...CELL },
    shapes: [
      // 開閉部の寸法はDS・VCSと共通（固定接点 y=15／支点 y=53／可動刃の先 (44,20)）。
      // 以前はここだけ小さく描いていたため、並べたときにVCBだけ貧相に見えていた
      vline(24, 0, 15),
      ...crossMark(24, 15, 4.5),
      // 下の丸は付けない。可動刃と下の縦線は、支点 (24,53) でそのままつなぐ
      line(24, 53, 44, 20),
      vline(24, 53, 72),
    ],
    ports: CELL_PORTS,
    fields: [RATED_VOLTAGE, RATED_CURRENT],
    status: 'confirmed',
    statusNote: '×印付き開閉器（JIS式）。可動刃は右上がり。丸は上にも下にも付けません。',
    note: 'CB形の主遮断装置。設備容量301kVA以上では必須。すぐ下にCTが入る。',
  },
  {
    id: 'vcs',
    labelLines: ['VCS', '{ratedVoltage}V', '{ratedCurrent}A'],
    abbr: 'VCS',
    nameJa: '真空電磁接触器',
    category: 'switchgear',
    tags: ['電磁接触器', '高圧進相設備', 'コンデンサ開閉'],
    // 進相コンデンサの開閉に使う。DSと見分けられるよう、固定接点を「お椀」で描く
    box: { ...CELL },
    shapes: [
      vline(24, 0, 15),
      path('M 17 15 A 7 7 0 0 0 31 15'),
      contact(24, 53),
      line(24, 49, 42, 22),
      vline(24, 57, 72),
    ],
    ports: CELL_PORTS,
    fields: [RATED_VOLTAGE, RATED_CURRENT],
    status: 'confirmed',
    statusNote: '固定接点をお椀（半円）で描き、断路器と見分けられるようにしました。',
    note: '進相コンデンサの開閉用。LBSと組み合わせて使う現場がある。',
  },
  pasDef('pas', { l: 0, r: 0, t: 0, b: 0 }),
  // 内蔵機器（LA・VT）を入れるとき用。枠を少しだけ広げてある（とくに左）
  pasDef('pas-builtin', { l: 8, r: 2, t: 4, b: 12 }, 'pas'),
];
