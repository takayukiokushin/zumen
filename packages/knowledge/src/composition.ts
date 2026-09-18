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
  | 'inside';

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
  note?: string;
}

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
    symbolId: 'boundary-both',
    kind: 'series',
    when: { key: 'boundaryPattern', eq: 'coincident' },
    labelTemplate: ['財産・責任分界点'],
    note: '3点一致（約99%）。引込点の図記号とPASの間に横線を引く',
  },
  {
    role: 'boundary-property',
    symbolId: 'boundary-property',
    kind: 'series',
    when: { key: 'boundaryPattern', eq: 'split' },
    labelTemplate: ['財産分界点'],
  },
  {
    role: 'pas',
    symbolId: 'pas',
    kind: 'series',
    when: { key: 'hasPas', eq: 'yes' },
    labelTemplate: ['PAS', '{pasRatedVoltage}V{pasRatedCurrent}A', '{pasBuiltinText}'],
    props: { ratedVoltage: 'pasRatedVoltage', ratedCurrent: 'pasRatedCurrent', control: 'pasControl' },
  },
  {
    role: 'pas-zct',
    symbolId: 'zct',
    kind: 'inside',
    parent: 'pas',
    slot: 'zct',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', in: ['gr', 'dgr'] }] },
  },
  {
    role: 'pas-vt',
    symbolId: 'vt',
    kind: 'inside',
    parent: 'pas',
    slot: 'vt',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasBuiltinVt', eq: 'yes' }] },
  },
  {
    role: 'pas-la',
    symbolId: 'la',
    kind: 'inside',
    parent: 'pas',
    slot: 'la',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasBuiltinLa', eq: 'yes' }] },
    note: 'LAの接地はPAS本体の接地と同じ箇所で施工する',
  },
  {
    role: 'pas-relay',
    symbolId: 'relay-gr',
    kind: 'branch-right',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'gr' }] },
  },
  {
    role: 'pas-relay',
    symbolId: 'relay-dgr',
    kind: 'branch-right',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'dgr' }] },
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
    note: '埋設（埋ケ）のときはケーブルの線を点線で描く',
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
    when: { key: 'ctRatio', answered: true },
    labelTemplate: ['CT', '{ctRatio}'],
    props: { ratio: 'ctRatio' },
  },
  {
    role: 'ct-test-terminal',
    symbolId: 'test-terminal',
    kind: 'branch-right',
    when: { all: [{ key: 'ctRatio', answered: true }, { key: 'mainBreakerForm', eq: 'cb' }] },
  },
  {
    role: 'ocr',
    symbolId: 'relay-ocr',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'cb' },
    note: 'CB形では CT の次に OCR が入る',
  },
  {
    role: 'site-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'pfs' },
    labelTemplate: ['VT＋PF', '{vtRatio}'],
  },
  {
    role: 'site-vt',
    symbolId: 'vt',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'pfs' },
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
  {
    role: 'tr-pc',
    symbolId: 'pc',
    kind: 'series',
    when: { key: 'trHasPc', eq: 'yes' },
    labelTemplate: ['PC'],
  },
  {
    role: 'tr-lbs',
    symbolId: 'lbs-pf',
    kind: 'series',
    when: { key: 'trHasLbs', eq: 'yes' },
    labelTemplate: ['LBS'],
  },
  {
    role: 'transformer',
    symbolId: '{trConnection}',
    kind: 'series',
    labelTemplate: ['{trUsage}', 'Tr', '{trCapacityLine}', '{trVoltage}', '{trComposition}'],
    props: { usage: 'trUsage', capacity: 'trCapacity', voltage: 'trVoltage', composition: 'trComposition' },
    repeatCountKey: 'transformerCount',
  },
];

/** 進相設備・特殊設備 */
export const EXTRAS: Placement[] = [
  {
    role: 'reactor',
    symbolId: 'sr',
    kind: 'branch-right',
    when: { key: 'hasReactor', eq: 'yes' },
    labelTemplate: ['SR', '{reactorCapacity}'],
  },
  {
    role: 'capacitor',
    symbolId: 'sc',
    kind: 'branch-right',
    when: { key: 'hasCapacitor', eq: 'yes' },
    labelTemplate: ['SC', '{capacitorCapacity}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'generator',
    symbolId: 'generator',
    kind: 'branch-left',
    when: { key: 'hasGenerator', eq: 'yes' },
    labelTemplate: ['G', '{generatorPlace}'],
    props: { usage: 'generatorUsage', place: 'generatorPlace' },
  },
  {
    role: 'pv',
    symbolId: 'pv',
    kind: 'series',
    when: { key: 'hasPv', eq: 'yes' },
    labelTemplate: ['PV', '{pvCapacity}'],
  },
  {
    role: 'battery',
    symbolId: 'battery-unit',
    kind: 'series',
    when: { key: 'hasBattery', eq: 'yes' },
    labelTemplate: ['蓄電池ユニット', '{batteryCapacity}'],
  },
];

export const CHAIN_BY_FORM: Record<string, Placement[]> = {
  pfs: PFS_CHAIN,
  cb: CB_CHAIN,
  /** 高圧マンションの電柱上構成は主遮断装置なし */
  'pole-top': [],
};
