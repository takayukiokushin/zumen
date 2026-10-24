import type { Condition } from './condition.ts';

/**
 * 構成テンプレート。上流（引込側）から下流へ、どの記号がどの条件で入るかをデータで定義する。
 *
 * ナレッジベースの分岐（3点一致／PFS形・CB形／PASの制御装置／VCTの位置 等）は
 * すべて when の条件式として書いてあるので、新しい分岐は1件追加するだけで反映される。
 */

export type PlacementKind =
  /** 主回路に直列に入る */
  | 'series'
  /** 主回路から左へ分岐する */
  | 'branch-left'
  /** 主回路から右へ分岐する */
  | 'branch-right'
  /** 親の記号の中（slot）に入る */
  | 'inside'
  /** 主回路を囲む枠（キュービクルの範囲など） */
  | 'frame'
  /**
   * 高圧母線から下へ並列にぶら下がる（変圧器・高圧進相設備など）。
   * 1台だけのときは母線を描かず、主回路にそのまま直列で入る。
   */
  | 'parallel'
  /** 低圧母線から下へ出る回線（回線ごとに縦に並べる） */
  | 'feeder'
  /**
   * どこにも結線せず、図面の下に置くだけ。
   * 発電機・太陽光・蓄電池は、変圧器のどこにつながるかが現地のメモで初めて分かるため、
   * たたき台の段階では線をつながずに置いておき、あとから図面上で結線する。
   */
  | 'free';

export interface Placement {
  role: string;
  symbolId: string;
  kind: PlacementKind;
  when?: Condition;
  /** kind==='inside' のときの親のロールとスロット */
  parent?: string;
  slot?: string;
  /** 図面に添える文字。{質問ID} を回答で置き換え、値が無い行は落とす */
  labelTemplate?: string[];
  /** 記号の入力項目 ← 質問ID の対応 */
  props?: Record<string, string>;
  /** 同じ機器を繰り返す件数を持つ質問ID */
  repeatCountKey?: string;
  /** この機器の下に空ける間隔（既定より広げたいとき） */
  gapAfter?: number;
  /** この機器の下の線を点線にする条件（埋設ケーブルなど） */
  dashedAfter?: Condition;
  /** 二次側から結線してくる機器のロール（継電器など） */
  connectFrom?: string[];
  /** 文字を記号のどちら側に書くか（既定は右） */
  labelSide?: 'left' | 'right';
  /**
   * kind==='feeder' のときの列番号の始まり。
   * 低圧の回線と、あとから結線する発電機などが同じ列に重ならないよう、
   * 種類ごとに離れた番号から始める。
   */
  laneBase?: number;
  /**
   * 高圧母線から並列にぶら下がるときの「段」。
   * 同じ段の機器は、どの列でも同じ高さに揃う。
   * PCやLBSが無い列は、その段を空けたまま母線からの線を長く引く。
   *   0 … PC（高圧カットアウト）
   *   1 … LBS
   *   2 … VCS（真空電磁接触器）
   *   3 … SR（直列リアクトル）
   *   4 … 本体（変圧器・コンデンサ）既定
   */
  row?: number;
  note?: string;
}

/** 並列の段。読みやすさのために名前を付けておく */
export const ROW = { pc: 0, lbs: 1, vcs: 2, reactor: 3, main: 4 } as const;
export const ROW_COUNT = 5;

/** 引込元から受電設備の入口まで（主遮断装置の形式によらず共通） */
export const UPSTREAM: Placement[] = [
  {
    role: 'source-pole',
    symbolId: 'pole-utility',
    kind: 'series',
    when: { key: 'sourceType', eq: 'pole' },
    labelTemplate: ['{polePrefix}{poleName}'],
  },
  {
    role: 'source-cabinet',
    symbolId: 'cabinet',
    kind: 'series',
    when: { key: 'sourceType', eq: 'cabinet' },
    labelTemplate: ['{cabinetName}'],
    props: { content: 'cabinetContent' },
  },
  {
    role: 'as',
    symbolId: 'as',
    kind: 'series',
    when: { all: [{ key: 'sourceType', eq: 'pole' }, { key: 'hasAs', eq: 'yes' }] },
    labelTemplate: ['AS'],
  },
  { role: 'incoming-point', symbolId: 'incoming-point', kind: 'series' },
  {
    role: 'boundary',
    labelSide: 'left',
    symbolId: 'boundary-both',
    kind: 'series',
    when: { key: 'boundaryPattern', eq: 'coincident' },
    labelTemplate: ['財産・責任分界点'],
    note: '3点一致（約99%）。引込点の図記号とPASの間に横線を引く',
  },
  {
    role: 'boundary-property',
    labelSide: 'left',
    symbolId: 'boundary-property',
    kind: 'series',
    when: { key: 'boundaryPattern', eq: 'split' },
    labelTemplate: ['財産分界点'],
  },
  {
    role: 'pas',
    // 内蔵機器（LA・VT）が入るときは、枠を少し広げたほうを使う（engine の pasSymbol）
    symbolId: '{pasSymbol}',
    kind: 'series',
    when: { key: 'hasPas', eq: 'yes' },
    labelTemplate: ['PAS', '{pasRatingText}', '{pasBuiltinText}'],
    props: { ratedVoltage: 'pasRatedVoltage', ratedCurrent: 'pasRatedCurrent', control: 'pasControl' },
  },
  {
    // SOG（GR/DGR）があれば、ZCTはPASに内蔵される。無ければ入らない
    role: 'pas-zct',
    symbolId: 'zct',
    kind: 'inside',
    parent: 'pas',
    slot: 'zct',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', in: ['gr', 'dgr'] }] },
  },
  {
    // VTもSOGがあるときだけ。SOGが無いPASにVTは入らない
    role: 'pas-vt',
    symbolId: 'vt',
    kind: 'inside',
    parent: 'pas',
    slot: 'vt',
    when: {
      all: [
        { key: 'hasPas', eq: 'yes' },
        { key: 'pasControl', in: ['gr', 'dgr'] },
        { key: 'pasBuiltinVt', eq: 'yes' },
      ],
    },
  },
  {
    role: 'pas-la',
    symbolId: 'la',
    kind: 'inside',
    parent: 'pas',
    slot: 'la',
    // LAはSOGの有無に関わらず内蔵されることがある
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasBuiltinLa', eq: 'yes' }] },
    note: 'LAの接地はPAS本体の接地と同じ箇所で施工する',
  },
  {
    role: 'pas-relay',
    symbolId: 'relay-gr',
    kind: 'branch-right',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'gr' }] },
    connectFrom: ['pas-zct'],
  },
  {
    role: 'pas-relay',
    symbolId: 'relay-dgr',
    kind: 'branch-right',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'dgr' }] },
    connectFrom: ['pas-zct', 'pas-vt'],
  },
  {
    role: 'vct-pole',
    symbolId: 'vct',
    kind: 'series',
    when: { key: 'vctLocation', eq: 'pole' },
    repeatCountKey: 'vctCount',
    props: { location: 'vctLocation' },
  },
  {
    role: 'cable-head-source',
    symbolId: 'cable-head',
    kind: 'series',
    labelTemplate: ['{cableInstallationLabel}', '{cableStructure}', '{cableSpecLine}'],
    gapAfter: 56,
    dashedAfter: { key: 'cableInstallation', eq: 'buried' },
    note: '埋設（埋ケ）のときはケーブルの線を点線で描く',
  },
  {
    role: 'area-frame',
    symbolId: 'enclosure-cubicle',
    kind: 'frame',
    labelTemplate: ['{areaLabel}'],
    note: 'この枠から下がキュービクル（電気室）の中',
  },
  {
    role: 'cable-head-site',
    symbolId: 'cable-head',
    kind: 'series',
    note: '受電側の端末。同じ記号を180°回転して使う',
  },
  {
    role: 'vct-indoor',
    symbolId: 'vct',
    kind: 'series',
    when: { key: 'vctLocation', eq: 'indoor' },
    repeatCountKey: 'vctCount',
    props: { location: 'vctLocation' },
    note: 'PFS形ならケーブルとLBSの間、CB形ならケーブルとDSの間に入る',
  },
];

/** 主遮断装置がLBSの構成 */
export const PFS_CHAIN: Placement[] = [
  {
    role: 'main-breaker',
    symbolId: 'lbs-pf',
    kind: 'series',
    labelTemplate: ['LBS', '{lbsRatedVoltage}V', '{lbsRatedCurrent}A', 'PF×{lbsFuseCount}', '{lbsFuseSpec}'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent', fuseCount: 'lbsFuseCount', fuseSpec: 'lbsFuseSpec' },
  },
];

/** 主遮断装置がVCBの構成 */
export const CB_CHAIN: Placement[] = [
  { role: 'ds', symbolId: 'ds', kind: 'series', labelTemplate: ['DS', '{dsRating}'] },
  {
    role: 'ds-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    labelTemplate: ['VT＋PF', '{vtRatio}'],
    note: 'DSの次にVTを並列接続する（直列ではない）。VTの手前にPFが入る',
  },
  { role: 'ds-vt', symbolId: 'vt', kind: 'branch-right', props: { ratio: 'vtRatio' } },
  {
    role: 'main-breaker',
    symbolId: 'vcb',
    kind: 'series',
    labelTemplate: ['VCB', '{vcbRating}'],
  },
];

/** 主遮断装置の下流（PFS形・CB形で共通） */
export const DOWNSTREAM: Placement[] = [
  {
    role: 'ct',
    symbolId: 'ct',
    kind: 'series',
    when: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteCt', eq: 'yes' }] },
    labelTemplate: ['CT', '{ctRatio}'],
    props: { ratio: 'ctRatio' },
  },
  {
    role: 'ct-test-terminal',
    symbolId: 'test-terminal',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'cb' },
  },
  {
    role: 'ocr',
    symbolId: 'relay-ocr',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'cb' },
    connectFrom: ['ct-test-terminal'],
    note: 'CB形では CT の次に OCR が入る',
  },
  {
    role: 'site-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    when: { all: [{ key: 'mainBreakerForm', eq: 'pfs' }, { key: 'hasSiteVt', eq: 'yes' }] },
    labelTemplate: ['VT＋PF', '{vtRatio}'],
  },
  {
    role: 'site-vt',
    symbolId: 'vt',
    kind: 'branch-right',
    when: { all: [{ key: 'mainBreakerForm', eq: 'pfs' }, { key: 'hasSiteVt', eq: 'yes' }] },
    props: { ratio: 'vtRatio' },
  },
  {
    role: 'zpd',
    symbolId: 'zpd',
    kind: 'branch-left',
    when: { key: 'hasZpd', eq: 'yes' },
    labelTemplate: ['ZPD'],
  },
  {
    role: 'ovgr',
    symbolId: 'relay-ovgr',
    kind: 'branch-left',
    when: { key: 'hasZpd', eq: 'yes' },
    connectFrom: ['zpd'],
  },
  {
    role: 'site-la',
    symbolId: 'la',
    kind: 'branch-left',
    when: { key: 'hasLa', eq: 'yes' },
    labelTemplate: ['LA'],
  },
];

/** 変圧器（台数分くり返す） */
export const TRANSFORMER: Placement[] = [
  // 変圧器は主回路から「分岐」して並列に入る（直列ではない）。
  // PCやLBSが手前に付く場合は、その変圧器と同じ列の上に入る。
  {
    role: 'tr-pc',
    symbolId: 'pc',
    kind: 'parallel',
    row: ROW.pc,
    when: { key: 'trHasPc', eq: 'yes' },
    labelTemplate: ['{trPcHead}', 'F:{trPcFuse}'],
    repeatCountKey: 'transformerCount',
  },
  {
    role: 'tr-lbs',
    symbolId: 'lbs-pf',
    kind: 'parallel',
    row: ROW.lbs,
    when: { key: 'trHasLbs', eq: 'yes' },
    labelTemplate: ['{trLbsHead}', '{trPfLine}'],
    repeatCountKey: 'transformerCount',
  },
  {
    role: 'transformer',
    symbolId: '{trConnection}',
    kind: 'parallel',
    row: ROW.main,
    labelTemplate: ['{trUsage}', 'Tr', '{trCapacityLine}', '{trVoltage}', '{trComposition}'],
    props: { usage: 'trUsage', capacity: 'trCapacity', voltage: 'trVoltage', composition: 'trComposition' },
    repeatCountKey: 'transformerCount',
  },
];

/** 低圧母線から下へ出る回線（回線数ぶん横に並べる） */
/**
 * 変圧器の低圧側にぶら下がるもの。
 *
 * PCSは「容量の種類ごとに、何台目の変圧器に何台」を入れてもらい、
 * 変圧器ごとに1つの枠にまとめて（例「50kW×2台 / 5kW×1台」）ぶら下げる。
 * 低圧開閉器（MCCB）の記号は、いまのところ描かない。
 */
export const FEEDERS: Placement[] = Array.from({ length: 8 }, (_, t) => ({
  role: `pcs-tr${t + 1}`,
  symbolId: 'pcs',
  kind: 'feeder' as const,
  when: { all: [{ key: 'hasPv', eq: 'yes' }, { key: `pcsAtTr${t + 1}`, ne: '' }] },
  labelTemplate: [`{pcsAtTr${t + 1}}`],
  props: { transformer: `pcsTrNo${t + 1}` },
  laneBase: 200 + t,
}));

/** 高圧進相設備・特殊設備 */
export const EXTRAS: Placement[] = [
  // リアクトルの有無はコンデンサごとに決まるので、同じ件数で並べて書く。
  // 隣り合わせにしてあるため SR1→SC1→SR2→SC2 の順に出る
  // 高圧進相設備は変圧器と並列に入る。1台ごとに「リアクトル→コンデンサ」が1本の列になる
  // コンデンサの手前に入る開閉器。PCだけ・LBSだけ・LBS＋VCS など現場によって違う
  {
    role: 'cap-pc',
    symbolId: 'pc',
    kind: 'parallel',
    row: ROW.pc,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'capHasPc', eq: 'yes' }] },
    labelTemplate: ['{capPcHead}', 'F:{capPcFuse}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'cap-lbs',
    symbolId: 'lbs-pf',
    kind: 'parallel',
    row: ROW.lbs,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'capHasLbs', eq: 'yes' }] },
    labelTemplate: ['{capLbsHead}', '{capPfLine}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'cap-vcs',
    symbolId: 'vcs',
    kind: 'parallel',
    row: ROW.vcs,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'capHasVcs', eq: 'yes' }] },
    labelTemplate: ['VCS'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'reactor',
    symbolId: 'sr',
    kind: 'parallel',
    row: ROW.reactor,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'hasReactor', eq: 'yes' }] },
    labelTemplate: ['SR', '{reactorCapacity}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'capacitor',
    symbolId: 'sc',
    kind: 'parallel',
    row: ROW.main,
    when: { key: 'hasCapacitor', eq: 'yes' },
    labelTemplate: ['SC', '{capacitorCapacity}'],
    repeatCountKey: 'capacitorCount',
  },
  /*
   * 発電機・太陽光・蓄電池。
   * 「どの変圧器につなぐか」を答えていれば、その変圧器の低圧側からぶら下げる。
   * 「つながない」なら、これまでどおり結線せずに図面の下に置く
   * （つなぎ先が現地のメモを見ないと分からない場合）。
   */
  {
    role: 'generator',
    symbolId: 'generator',
    kind: 'feeder',
    when: { all: [{ key: 'hasGenerator', eq: 'yes' }, { key: 'generatorTransformer', ne: 'none' }] },
    labelTemplate: ['G', '{generatorText}', '{generatorPlace}'],
    props: { usage: 'generatorUsage', place: 'generatorPlace', fuel: 'generatorFuel', transformer: 'generatorTransformer' },
    repeatCountKey: 'generatorCount',
    laneBase: 100,
  },
  {
    role: 'generator',
    symbolId: 'generator',
    kind: 'free',
    when: { all: [{ key: 'hasGenerator', eq: 'yes' }, { key: 'generatorTransformer', eq: 'none' }] },
    labelTemplate: ['G', '{generatorText}', '{generatorPlace}'],
    props: { usage: 'generatorUsage', place: 'generatorPlace', fuel: 'generatorFuel' },
    repeatCountKey: 'generatorCount',
  },
  {
    // PCSをどの変圧器にもつないでいないときだけ、太陽光を単独で置く
    role: 'pv',
    symbolId: 'pv',
    kind: 'free',
    when: { all: [{ key: 'hasPv', eq: 'yes' }, { key: 'pcsAssigned', eq: 'no' }] },
    labelTemplate: ['PV', '{pcsText}'],
  },
  {
    role: 'battery',
    symbolId: 'battery-unit',
    kind: 'feeder',
    when: { all: [{ key: 'hasBattery', eq: 'yes' }, { key: 'batteryTransformer', ne: 'none' }] },
    labelTemplate: ['蓄電池ユニット', '{batteryCapacity}'],
    props: { transformer: 'batteryTransformer' },
    laneBase: 300,
  },
  {
    role: 'battery',
    symbolId: 'battery-unit',
    kind: 'free',
    when: { all: [{ key: 'hasBattery', eq: 'yes' }, { key: 'batteryTransformer', eq: 'none' }] },
    labelTemplate: ['蓄電池ユニット', '{batteryCapacity}'],
  },
];

export const CHAIN_BY_FORM: Record<string, Placement[]> = {
  pfs: PFS_CHAIN,
  cb: CB_CHAIN,
  /** 高圧マンションの電柱上構成は主遮断装置なし */
  'pole-top': [],
};
