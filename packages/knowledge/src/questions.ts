import type { Condition, Value } from './condition.ts';

/**
 * ヒアリングの質問定義。
 *
 * 仕様書10-1（共通項目）と10-2（機器別・ナレッジベースの分岐点から生成）の両方を
 * ここに1本化している。質問はデータなので、機器や分岐が増えても1件追加するだけでよい。
 */

export type QuestionType = 'text' | 'number' | 'select' | 'boolean' | 'date';

export interface Choice {
  value: string;
  label: string;
  /** 現場での出現割合（ユーザーに目安として見せる） */
  share?: string;
}

/** いつ聞くか */
export type AskWhen =
  /** 必ず聞く */
  | 'always'
  /** スケッチ画像から判別できる場合はAIに任せ、判別できないときだけ聞く */
  | 'ai-uncertain';

export interface Question {
  id: string;
  group: string;
  label: string;
  type: QuestionType;
  options?: Choice[];
  /** selectのとき、一覧にない値の手入力を許すか */
  allowFreeInput?: boolean;
  unit?: string;
  defaultValue?: Value;
  help?: string;
  placeholder?: string;
  /** この条件を満たすときだけ表示する */
  showIf?: Condition;
  ask: AskWhen;
  required?: boolean;
}

export interface QuestionGroup {
  id: string;
  label: string;
  description?: string;
  /** 繰り返し入力するグループのとき、件数を持つ質問のID（例: 受電設備エリア） */
  repeatCountKey?: string;
  showIf?: Condition;
}

export const QUESTION_GROUPS: QuestionGroup[] = [
  { id: 'customer', label: 'お客様・現場', description: '表題欄と図面の基本情報' },
  { id: 'source', label: '引込元', description: '電柱かキャビネットか' },
  { id: 'boundary', label: '責任分界点' },
  { id: 'pas', label: 'PAS（区分開閉器）' },
  { id: 'vct', label: 'VCT（計器用変成器）' },
  { id: 'cable', label: '引込ケーブル' },
  { id: 'area', label: '受電設備エリア', repeatCountKey: 'areaCount' },
  { id: 'receiving', label: '受電設備の構成' },
  { id: 'transformer', label: '変圧器', repeatCountKey: 'transformerCount' },
  { id: 'feeder', label: '低圧側の分岐', description: '変圧器の下の母線から出る回線', repeatCountKey: 'feederCount' },
  { id: 'compensation', label: '進相設備' },
  { id: 'special', label: '特殊設備' },
  { id: 'title', label: '表題欄' },
];

const YES_NO: Choice[] = [
  { value: 'yes', label: 'あり' },
  { value: 'no', label: 'なし' },
];

export const QUESTIONS: Question[] = [
  /* ---------------- お客様・現場 ---------------- */
  { id: 'customerName', group: 'customer', label: 'お客様名称', type: 'text', ask: 'always', required: true },
  {
    id: 'customerNameForTitleBlock',
    group: 'customer',
    label: '表題欄への記載名',
    type: 'text',
    ask: 'always',
    help: 'お客様名称と異なる書き方をする場合に入力する',
  },
  { id: 'siteName', group: 'customer', label: '事業場名称', type: 'text', ask: 'always', required: true },
  { id: 'siteAddress', group: 'customer', label: '現場住所', type: 'text', ask: 'always' },
  {
    id: 'receivingType',
    group: 'customer',
    label: '受電方式',
    type: 'select',
    options: [
      { value: 'high', label: '高圧受電' },
      { value: 'extra-high', label: '特別高圧受電' },
    ],
    defaultValue: 'high',
    ask: 'always',
    required: true,
  },
  { id: 'contractPower', group: 'customer', label: '契約電力', type: 'number', unit: 'kW', ask: 'always' },
  { id: 'receivingVoltage', group: 'customer', label: '受電電圧', type: 'number', unit: 'V', defaultValue: 6600, ask: 'always' },

  /* ---------------- 引込元 ---------------- */
  {
    id: 'sourceType',
    group: 'source',
    label: '引込元は？',
    type: 'select',
    options: [
      { value: 'pole', label: '電柱（電力会社所有）' },
      { value: 'cabinet', label: 'キャビネット（地上設置）' },
    ],
    ask: 'ai-uncertain',
    required: true,
  },
  {
    id: 'polePrefix',
    group: 'source',
    label: '電力会社の区分',
    type: 'text',
    defaultValue: '中電柱：',
    showIf: { key: 'sourceType', eq: 'pole' },
    ask: 'always',
    help: '中電柱＝中国電力の電柱。この部分は全現場で共通',
  },
  {
    id: 'poleName',
    group: 'source',
    label: '電柱名称',
    type: 'text',
    placeholder: '猪子山（分）81',
    showIf: { key: 'sourceType', eq: 'pole' },
    ask: 'always',
    help: '「中電柱：」に続く部分。（分）（幹）（支）（連絡）などの区分は電柱の記載をそのまま反映する',
  },
  {
    id: 'cabinetName',
    group: 'source',
    label: 'キャビネット名称',
    type: 'text',
    placeholder: '高圧キャビネット（地下佐東西11号）',
    showIf: { key: 'sourceType', eq: 'cabinet' },
    ask: 'always',
  },
  {
    id: 'cabinetContent',
    group: 'source',
    label: 'キャビネットの中身',
    type: 'select',
    options: [
      { value: 'mold-discon', label: 'モールドディスコン' },
      { value: 'tee-shelter', label: '三極連動ティー型シェルター' },
    ],
    showIf: { key: 'sourceType', eq: 'cabinet' },
    ask: 'always',
    help: 'どちらも図記号は同じ。図面上の区別はしない',
  },
  {
    id: 'hasAs',
    group: 'source',
    label: 'AS（エアースイッチ）はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    showIf: { key: 'sourceType', eq: 'pole' },
    ask: 'ai-uncertain',
    help: '電力会社側の開閉器。引込元〜責任分界点の間に入る場合がある',
  },

  /* ---------------- 責任分界点 ---------------- */
  {
    id: 'boundaryPattern',
    group: 'boundary',
    label: '3点一致ですか？',
    type: 'select',
    options: [
      { value: 'coincident', label: 'はい（3点一致）', share: '約99%' },
      { value: 'split', label: 'いいえ（3点不一致）', share: '約1%' },
    ],
    defaultValue: 'coincident',
    ask: 'ai-uncertain',
    required: true,
    help: '引込点・財産分界点・保安上の責任分界点が同じ地点なら「3点一致」',
  },
  {
    id: 'boundarySafetyDevice',
    group: 'boundary',
    label: '責任分界点はどの機器の上にありますか？',
    type: 'select',
    options: [
      { value: 'lbs', label: 'LBS' },
      { value: 'vcb', label: 'VCB' },
    ],
    showIf: { key: 'boundaryPattern', eq: 'split' },
    ask: 'always',
    help: '3点不一致の約99%はLBSかVCBのどちらか。その記号の中央に横線を引いて記載する',
  },

  /* ---------------- PAS ---------------- */
  {
    id: 'hasPas',
    group: 'pas',
    label: 'PASの設置はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'yes',
    ask: 'ai-uncertain',
    required: true,
  },
  {
    id: 'pasControl',
    group: 'pas',
    label: '制御装置の種類は？',
    type: 'select',
    options: [
      { value: 'none', label: 'なし' },
      { value: 'gr', label: 'GR（無方向性）' },
      { value: 'dgr', label: 'DGR（方向性）' },
    ],
    defaultValue: 'dgr',
    showIf: { key: 'hasPas', eq: 'yes' },
    ask: 'ai-uncertain',
    help: 'GRはZCTが入る。DGRはZCTに加えて零相電圧（内蔵VTまたはZPD）が必要',
  },
  {
    id: 'pasBuiltinVt',
    group: 'pas',
    label: 'VTは内蔵されていますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'yes',
    showIf: { key: 'hasPas', eq: 'yes' },
    ask: 'ai-uncertain',
  },
  {
    id: 'pasBuiltinLa',
    group: 'pas',
    label: 'LAは内蔵されていますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'yes',
    showIf: { key: 'hasPas', eq: 'yes' },
    ask: 'ai-uncertain',
  },
  {
    id: 'pasRatedVoltage',
    group: 'pas',
    label: '定格電圧は？',
    type: 'select',
    options: [
      { value: '7200', label: '7200V' },
      { value: '6600', label: '6600V' },
    ],
    showIf: { key: 'hasPas', eq: 'yes' },
    ask: 'ai-uncertain',
    help: '7200Vと6600Vは機器によって使い分ける。手書きメモに記載があればそれを使い、記載が無いときだけ確認する',
  },
  {
    id: 'pasRatedCurrent',
    group: 'pas',
    label: '定格電流は？',
    type: 'select',
    options: [
      { value: '100', label: '100A' },
      { value: '200', label: '200A' },
      { value: '300', label: '300A' },
      { value: '400', label: '400A' },
    ],
    showIf: { key: 'hasPas', eq: 'yes' },
    ask: 'always',
  },

  /* ---------------- VCT ---------------- */
  {
    id: 'vctLocation',
    group: 'vct',
    label: 'VCTの位置は？',
    type: 'select',
    options: [
      { value: 'pole', label: '電柱上', share: '約70%' },
      { value: 'indoor', label: '電気設備内（キュービクル／電気室）', share: '約30%' },
    ],
    defaultValue: 'pole',
    ask: 'ai-uncertain',
  },
  {
    id: 'vctCount',
    group: 'vct',
    label: 'VCTの台数は？',
    type: 'select',
    options: [
      { value: '1', label: '1台' },
      { value: '2', label: '2台（受電用＋発電量計量用）' },
    ],
    defaultValue: '1',
    ask: 'ai-uncertain',
  },

  /* ---------------- 引込ケーブル ---------------- */
  {
    id: 'cableInstallation',
    group: 'cable',
    label: '付設方法は？',
    type: 'select',
    options: [
      { value: 'buried', label: '埋設（埋ケ）' },
      { value: 'overhead', label: '架空（架ケ）' },
    ],
    ask: 'ai-uncertain',
    help: '埋設のみ図面の線を点線で描く',
  },
  {
    id: 'cableStructure',
    group: 'cable',
    label: 'ケーブルの構造は？',
    type: 'select',
    options: [
      { value: 'CVT', label: 'CVT' },
      { value: 'CV', label: 'CV' },
    ],
    defaultValue: 'CVT',
    ask: 'ai-uncertain',
  },
  { id: 'cableVoltage', group: 'cable', label: '定格電圧は？', type: 'number', unit: 'V', defaultValue: 6600, ask: 'always' },
  {
    id: 'cableCrossSection',
    group: 'cable',
    label: '断面積は？',
    type: 'select',
    unit: 'mm2',
    options: [14, 22, 38, 60, 100, 150, 200, 250].map((v) => ({ value: String(v), label: `${v} mm2` })),
    allowFreeInput: true,
    ask: 'always',
    help: '一覧にない値は手入力できる',
  },
  {
    id: 'cableLength',
    group: 'cable',
    label: '長さは？',
    type: 'number',
    unit: 'm',
    ask: 'always',
    help: '不明な場合は空欄にする（図面には「- m」と記載する）',
  },

  /* ---------------- 受電設備エリア ---------------- */
  {
    id: 'areaCount',
    group: 'area',
    label: '電気設備（受電設備）は何箇所に分かれていますか？',
    type: 'number',
    defaultValue: 1,
    ask: 'ai-uncertain',
    help: '画像から1箇所と判別できる場合は聞かない。2箇所以上のときだけ各エリアを一点鎖線で囲う',
  },
  {
    id: 'areaForm',
    group: 'area',
    label: '形態は？',
    type: 'select',
    options: [
      { value: 'cubicle', label: 'キュービクル式' },
      { value: 'room-cubicle', label: '電気室（内にキュービクル）' },
      { value: 'room-open', label: 'オープンフレーム式' },
    ],
    ask: 'ai-uncertain',
    required: true,
  },
  {
    id: 'areaPlacement',
    group: 'area',
    label: '設置場所は？',
    type: 'select',
    options: [
      { value: 'indoor', label: '屋内' },
      { value: 'rooftop', label: '屋上' },
      { value: 'outdoor', label: '屋外（地上）' },
      { value: 'semi-outdoor', label: '半屋外' },
    ],
    allowFreeInput: true,
    ask: 'always',
    required: true,
  },
  { id: 'areaFloor', group: 'area', label: '階層', type: 'text', placeholder: '1階 / 中2階', ask: 'always' },
  { id: 'areaDetail', group: 'area', label: '場所の補足', type: 'text', placeholder: '駐車場横', ask: 'always' },

  /* ---------------- 受電設備の構成 ---------------- */
  {
    id: 'mainBreakerForm',
    group: 'receiving',
    label: '主遮断装置の形式は？',
    type: 'select',
    options: [
      { value: 'pfs', label: 'PFS形（主遮断装置＝LBS）', share: '設備容量300kVA以下で採用可能' },
      { value: 'cb', label: 'CB形（主遮断装置＝VCB）', share: '設備容量301kVA以上では必須' },
      { value: 'pole-top', label: 'それ以外（高圧マンション・電柱上構成）' },
    ],
    ask: 'ai-uncertain',
    required: true,
    help: 'この選択で受電設備の構成が大きく変わる。高圧変圧器の合計容量から自動で提案する',
  },
  {
    id: 'isHighRiseApartment',
    group: 'receiving',
    label: '高圧マンションで、電柱上に受電設備が構成されていますか？',
    type: 'select',
    options: YES_NO,
    showIf: { key: 'mainBreakerForm', eq: 'pole-top' },
    ask: 'always',
  },
  {
    id: 'lbsRatedVoltage',
    group: 'receiving',
    label: 'LBSの定格電圧',
    type: 'select',
    options: [
      { value: '7200', label: '7200V' },
      { value: '6600', label: '6600V' },
    ],
    showIf: { key: 'mainBreakerForm', eq: 'pfs' },
    ask: 'ai-uncertain',
    help: '7200Vと6600Vは機器によって使い分ける。手書きメモの記載を優先し、記載が無いときだけ確認する',
  },
  { id: 'lbsRatedCurrent', group: 'receiving', label: 'LBSの定格電流', type: 'number', unit: 'A', showIf: { key: 'mainBreakerForm', eq: 'pfs' }, ask: 'always' },
  { id: 'lbsFuseCount', group: 'receiving', label: 'LBSのヒューズ本数', type: 'number', unit: '本', defaultValue: 3, showIf: { key: 'mainBreakerForm', eq: 'pfs' }, ask: 'always' },
  { id: 'lbsFuseSpec', group: 'receiving', label: 'LBSのヒューズ定格', type: 'text', placeholder: '7200V G50A T40A', showIf: { key: 'mainBreakerForm', eq: 'pfs' }, ask: 'always' },
  { id: 'dsRating', group: 'receiving', label: 'DSの定格', type: 'text', placeholder: '7200V 400A', showIf: { key: 'mainBreakerForm', eq: 'cb' }, ask: 'always' },
  { id: 'vcbRating', group: 'receiving', label: 'VCBの定格', type: 'text', placeholder: '7200V 600A 12.5kA', showIf: { key: 'mainBreakerForm', eq: 'cb' }, ask: 'always' },
  {
    id: 'hasSiteVt',
    group: 'receiving',
    label: '受電設備内にVTはありますか？',
    type: 'select',
    options: YES_NO,
    showIf: { key: 'mainBreakerForm', eq: 'pfs' },
    ask: 'ai-uncertain',
    help: 'PFS形はVTが入る現場と入らない現場がある。CB形はDSの次に必ず入る',
  },
  {
    id: 'hasSiteCt',
    group: 'receiving',
    label: '受電設備内にCTはありますか？',
    type: 'select',
    options: YES_NO,
    showIf: { key: 'mainBreakerForm', eq: 'pfs' },
    ask: 'ai-uncertain',
    help: 'PFS形はCTが入る現場と入らない現場がある。CB形はVCBのすぐ下に必ず入る',
  },
  {
    id: 'ctRatio',
    group: 'receiving',
    label: 'CTの変流比',
    type: 'text',
    placeholder: '300A/5A',
    showIf: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteCt', eq: 'yes' }] },
    ask: 'ai-uncertain',
  },
  {
    id: 'vtRatio',
    group: 'receiving',
    label: 'VTの変圧比',
    type: 'text',
    placeholder: '6600/110V',
    showIf: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteVt', eq: 'yes' }] },
    ask: 'ai-uncertain',
  },
  {
    id: 'hasZpd',
    group: 'receiving',
    label: 'ZPD（OVGR用）はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    ask: 'ai-uncertain',
    help: '受電設備側に零相電圧検出装置を置く場合',
  },
  {
    id: 'hasLa',
    group: 'receiving',
    label: '受電設備内にLA（避雷器）はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    ask: 'ai-uncertain',
  },
  { id: 'earthingNotes', group: 'receiving', label: '接地方式・接地抵抗値等の特記事項', type: 'text', ask: 'always' },

  /* ---------------- 変圧器 ---------------- */
  { id: 'transformerCount', group: 'transformer', label: '変圧器の台数', type: 'number', defaultValue: 1, ask: 'ai-uncertain' },
  {
    id: 'trUsage',
    group: 'transformer',
    label: '用途',
    type: 'select',
    options: [
      { value: '電灯', label: '電灯' },
      { value: '動力', label: '動力' },
    ],
    allowFreeInput: true,
    ask: 'ai-uncertain',
  },
  {
    id: 'trConnection',
    group: 'transformer',
    label: '結線方式',
    type: 'select',
    options: [
      { value: 'tr-1p', label: '単相（単相三線式）' },
      { value: 'tr-1p-2w', label: '単相（単相2線式）' },
      { value: 'tr-3p-dy', label: '三相 Δ-Y結線' },
      { value: 'tr-3p-yd', label: '三相 Y-Δ結線' },
      { value: 'tr-3p-dd', label: '三相 Δ-Δ結線' },
      { value: 'tr-3p-yy', label: '三相 Y-Y結線' },
      { value: 'tr-vv', label: 'V結線（単相変圧器2台）' },
      { value: 'tr-1p-parallel', label: '単相変圧器 並行運転（倍容量）' },
    ],
    ask: 'ai-uncertain',
    required: true,
  },
  { id: 'trCapacity', group: 'transformer', label: '容量', type: 'number', unit: 'kVA', ask: 'ai-uncertain', required: true },
  { id: 'trCapacity2', group: 'transformer', label: '2台目の容量', type: 'number', unit: 'kVA', showIf: { key: 'trConnection', eq: 'tr-vv' }, ask: 'always', help: 'V結線は2台の容量が異なる場合がある' },
  { id: 'trVoltage', group: 'transformer', label: '電圧', type: 'text', placeholder: '6600V/210-105V', ask: 'ai-uncertain' },
  { id: 'trComposition', group: 'transformer', label: '構成', type: 'text', placeholder: '単相変圧器×3', showIf: { key: 'trConnection', in: ['tr-3p-dd', 'tr-vv'] }, ask: 'always' },
  { id: 'trHasPc', group: 'transformer', label: '変圧器の手前にPC（高圧カットアウト）が入りますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'trHasLbs', group: 'transformer', label: '変圧器の手前にLBSが入りますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },

  /* ---------------- 低圧側の分岐 ---------------- */
  {
    id: 'feederCount',
    group: 'feeder',
    label: '低圧側の分岐回線数',
    type: 'number',
    defaultValue: 0,
    ask: 'ai-uncertain',
    help: '変圧器の下の母線から出る回線の数。無ければ0',
  },
  { id: 'feederName', group: 'feeder', label: '回線名', type: 'text', placeholder: 'PCSNo1〜No5', showIf: { key: 'feederCount', gt: 0 }, ask: 'ai-uncertain' },
  { id: 'feederBreaker', group: 'feeder', label: '遮断器の定格', type: 'text', placeholder: 'MCCB225A', showIf: { key: 'feederCount', gt: 0 }, ask: 'ai-uncertain' },
  {
    id: 'feederDevice',
    group: 'feeder',
    label: '回線の先の機器',
    type: 'select',
    options: [
      { value: 'none', label: 'なし（負荷へ）' },
      { value: 'pcs', label: 'PCS' },
    ],
    defaultValue: 'none',
    showIf: { key: 'feederCount', gt: 0 },
    ask: 'ai-uncertain',
  },
  { id: 'feederDeviceCapacity', group: 'feeder', label: 'PCSの容量', type: 'text', placeholder: '100kW×5', showIf: { key: 'feederDevice', eq: 'pcs' }, ask: 'ai-uncertain' },
  {
    id: 'feederSource',
    group: 'feeder',
    label: 'PCSの先',
    type: 'select',
    options: [
      { value: 'none', label: 'なし' },
      { value: 'pv', label: '太陽電池パネル' },
      { value: 'battery', label: '蓄電池ユニット' },
    ],
    defaultValue: 'none',
    showIf: { key: 'feederDevice', eq: 'pcs' },
    ask: 'ai-uncertain',
  },
  { id: 'feederSourceLabel', group: 'feeder', label: '先の機器の表記', type: 'text', placeholder: '蓄電池ユニットNo.1', showIf: { key: 'feederSource', ne: 'none' }, ask: 'ai-uncertain' },

  /* ---------------- 進相設備 ---------------- */
  { id: 'hasCapacitor', group: 'compensation', label: 'コンデンサ設備はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'capacitorCount', group: 'compensation', label: 'コンデンサの台数', type: 'number', defaultValue: 1, showIf: { key: 'hasCapacitor', eq: 'yes' }, ask: 'ai-uncertain' },
  { id: 'capacitorCapacity', group: 'compensation', label: 'コンデンサの容量', type: 'text', placeholder: '3φ106kvar 7020V', showIf: { key: 'hasCapacitor', eq: 'yes' }, ask: 'always' },
  { id: 'hasReactor', group: 'compensation', label: '直列リアクトルは入りますか？', type: 'select', options: YES_NO, showIf: { key: 'hasCapacitor', eq: 'yes' }, ask: 'ai-uncertain' },
  { id: 'reactorCapacity', group: 'compensation', label: 'リアクトルの容量', type: 'text', placeholder: '3φ6.38kvar 243V', showIf: { key: 'hasReactor', eq: 'yes' }, ask: 'always' },

  /* ---------------- 特殊設備 ---------------- */
  { id: 'hasGenerator', group: 'special', label: '発電機はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'generatorUsage', group: 'special', label: '発電機の用途区分', type: 'select', options: [{ value: 'normal', label: '常用型' }, { value: 'emergency', label: '非常用型' }], showIf: { key: 'hasGenerator', eq: 'yes' }, ask: 'always' },
  { id: 'generatorPlace', group: 'special', label: '発電機の設置場所', type: 'text', showIf: { key: 'hasGenerator', eq: 'yes' }, ask: 'always', help: '非常用発電機の場合は図面に明記する' },
  { id: 'hasPv', group: 'special', label: '太陽光発電設備はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'pvCapacity', group: 'special', label: '太陽光の設備規模', type: 'text', placeholder: '50kW×2', showIf: { key: 'hasPv', eq: 'yes' }, ask: 'always' },
  { id: 'hasBattery', group: 'special', label: '系統用蓄電所ですか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'batteryCapacity', group: 'special', label: '蓄電ユニットの規模', type: 'text', showIf: { key: 'hasBattery', eq: 'yes' }, ask: 'always' },

  /* ---------------- 表題欄 ---------------- */
  { id: 'drawingName', group: 'title', label: '図面名称', type: 'text', defaultValue: 'キュービクル式高圧受電設備単線結線図', ask: 'always' },
  { id: 'drawingNumber', group: 'title', label: '図面番号', type: 'text', ask: 'always' },
  { id: 'revision', group: 'title', label: '版数', type: 'text', ask: 'always' },
  { id: 'author', group: 'title', label: '作成者名', type: 'text', ask: 'always' },
  { id: 'createdAt', group: 'title', label: '作成日', type: 'date', ask: 'always' },
  { id: 'notes', group: 'title', label: 'その他の特記事項・注意書き', type: 'text', ask: 'always' },
];
