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
  /**
   * この選択肢を出す条件。満たさないときは、一覧に出さない。
   * 例：用途が「電灯」のときは、三相の結線方式を出さない。
   * 条件の見方は、質問の showIf と同じ（繰り返しの2件目以降は、その件の答えで見る）
   */
  showIf?: Condition;
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
  /**
   * selectのとき、選択肢が少なくても、ボタンではなくドロップダウン（一覧から選ぶ形）で出す。
   * 指定が無ければ、選択肢が3つ以下で短いものはボタン、それ以外はドロップダウン。
   */
  dropdown?: boolean;
  unit?: string;
  defaultValue?: Value;
  help?: string;
  placeholder?: string;
  /**
   * 文字を入れる欄のとき、数字だけが入力されたら、欄を離れたときに、この文字を後ろに足す。
   * 例：CTの変流比で「100」と入れると「100/5A」になる（2次側は必ず5A）
   */
  appendOnBlur?: string;
  /**
   * 同じまとまりの中を、見出しつきの小さな区切り（行）に分けるための名前。
   * 同じ名前の質問が続くと、1つの区切りにまとまる（画面では、区切りごとに行を分けて見出しを付ける）。
   */
  section?: string;
  /** この条件を満たすときだけ表示する */
  showIf?: Condition;
  ask: AskWhen;
  required?: boolean;
  /**
   * 繰り返しグループの中でも、1回だけ聞く質問。
   * 例：「高圧コンデンサ設備はありますか？」は台数ぶん聞く必要がない。
   */
  shared?: boolean;
}

export interface QuestionGroup {
  id: string;
  label: string;
  description?: string;
  /** 繰り返し入力するグループのとき、件数を持つ質問のID（例: 受電設備エリア） */
  repeatCountKey?: string;
  /** 繰り返しの数え方（「1台目」「1回線目」のように見出しに使う） */
  repeatUnit?: string;
  showIf?: Condition;
}

/** 台数・回線数などを選ぶための 1〜50 の一覧。一覧にない数は手入力できる */
const COUNT_OPTIONS: Choice[] = Array.from({ length: 50 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

/** 変圧器の用途で、結線方式の選択肢を絞るための条件 */
const NOT_POWER_ONLY: Condition = { not: { key: 'trUsage', eq: '動力' } };
const NOT_LIGHT_ONLY: Condition = { not: { key: 'trUsage', eq: '電灯' } };
/** 用途が「電灯および動力」で、結線方式がV結線のとき（容量を電灯・動力に分けて聞く） */
const MIXED_V: Condition = {
  all: [{ key: 'trUsage', eq: '電灯・動力' }, { key: 'trConnection', eq: 'tr-vv' }],
};

/** 引込ケーブルがあるとき（「なし」と答えたとき以外。まだ答えていないときは、あるものとして聞く） */
const CABLE_EXISTS: Condition = { not: { key: 'cableInstallation', eq: 'none' } };

export const QUESTION_GROUPS: QuestionGroup[] = [
  { id: 'customer', label: 'お客様・現場', description: '表題欄と図面の基本情報' },
  { id: 'source', label: '引込元', description: '電力会社所有の電柱' },
  { id: 'boundary', label: '責任分界点' },
  { id: 'pas', label: '区分開閉器' },
  { id: 'vct', label: 'VCT（計器用変成器）' },
  { id: 'cable', label: '引込ケーブル' },
  { id: 'area', label: '受電設備エリア', repeatCountKey: 'areaCount', repeatUnit: 'か所' },
  { id: 'receiving', label: '受電設備の構成' },
  { id: 'transformer', label: '変圧器', repeatCountKey: 'transformerCount', repeatUnit: '台' },
  {
    id: 'compensation',
    label: '高圧進相設備',
    description: '高圧側に入るコンデンサとリアクトルだけを入力する。低圧側だけにある場合は入力しない',
    repeatCountKey: 'capacitorCount',
    repeatUnit: '台',
  },
  { id: 'special', label: '特殊設備' },
  { id: 'generator', label: '発電機', repeatCountKey: 'generatorCount', repeatUnit: '台', showIf: { key: 'hasGenerator', eq: 'yes' } },
  { id: 'pv', label: '太陽光発電設備（PCS）', repeatCountKey: 'pvGroupCount', repeatUnit: '種類', showIf: { key: 'hasPv', eq: 'yes' } },
  { id: 'title', label: '表題欄' },
];

const YES_NO: Choice[] = [
  { value: 'yes', label: 'あり' },
  { value: 'no', label: 'なし' },
];

/** 「〜ですか？」と尋ねる質問は「あり／なし」ではなく「はい／いいえ」で答える */
const YES_NO_Q: Choice[] = [
  { value: 'yes', label: 'はい' },
  { value: 'no', label: 'いいえ' },
];

/* 開閉器とヒューズの定格電流。一覧から選べて、手入力もできる */
const amps = (...vals: string[]): Choice[] => vals.map((v) => ({ value: v, label: v }));
const PC_RATINGS = amps('30A', '50A', '75A', '100A');
const PC_FUSES = amps('5A', '7.5A', '10A', '15A', '20A', '25A', '30A', '50A', '75A', '100A');
const LBS_RATINGS = amps('100A', '200A', '300A', '400A');
const PF_RATINGS = amps('5A', '7.5A', '10A', '15A', '20A', '30A', '40A', '50A', '60A', '75A', '100A');
const LOAD_AMPS = amps('5A', '10A', '15A', '20A', '30A', '40A', '50A', '75A', '100A');
const SHORT_CIRCUIT = amps('12.5kA', '20kA', '31.5kA', '40kA');
/** パワーヒューズの負荷側。つなぐ相手で記号が変わる */
const PF_LOAD_KIND: Choice[] = [
  { value: 'T', label: 'T（変圧器）' },
  { value: 'C', label: 'C（コンデンサ）' },
  { value: 'M', label: 'M（モーター）' },
];

/**
 * PC と LBS の定格を聞く質問を作る。
 * 変圧器の手前・コンデンサの手前で同じことを聞くので、ひな形から作る。
 */
function breakerRatings(
  prefix: 'tr' | 'cap',
  group: string,
  showIf: Condition,
  defaultLoad: 'T' | 'C',
): Question[] {
  const cap = prefix === 'tr' ? '変圧器' : 'コンデンサ';
  const P = (id: string) => `${prefix}${id}`;
  const hasPc: Condition = { all: [showIf, { key: P('HasPc'), eq: 'yes' }] };
  const hasLbs: Condition = { all: [showIf, { key: P('HasLbs'), eq: 'yes' }] };
  return [
    {
      id: P('PcRating'), group, label: `PC本体の定格電流`, type: 'select',
      options: PC_RATINGS, allowFreeInput: true, showIf: hasPc, ask: 'always',
      help: `図面には「30A」のように、記号なしで書く`,
    },
    {
      id: P('PcFuse'), group, label: 'PCのヒューズの定格電流', type: 'select',
      options: PC_FUSES, allowFreeInput: true, showIf: hasPc, ask: 'always',
      help: '図面には「F:10A」のように、先頭にF:を付けて書く',
    },
    {
      id: P('LbsRating'), group, label: 'LBS本体の定格電流', type: 'select',
      options: LBS_RATINGS, allowFreeInput: true, defaultValue: '200A',
      showIf: hasLbs, ask: 'always',
      help: 'ふつうは200A。図面には「200A」のように、記号なしで書く',
    },
    {
      id: P('PfG'), group, label: 'パワーヒューズ（PF）の定格電流', type: 'select',
      options: PF_RATINGS, allowFreeInput: true, showIf: hasLbs, ask: 'always',
      help: '図面には「G50A」のように、先頭にGを付けて書く',
    },
    {
      id: P('PfLoad'), group, label: 'PFの負荷側につなぐもの', type: 'select',
      options: PF_LOAD_KIND, defaultValue: defaultLoad,
      showIf: hasLbs, ask: 'always',
      help: `${cap}につなぐので、ふつうは「${defaultLoad}」`,
    },
    {
      id: P('PfLoadAmp'), group, label: 'PFの負荷側の電流', type: 'select',
      options: LOAD_AMPS, allowFreeInput: true, showIf: hasLbs, ask: 'always',
      help: '図面には「T30A」のように、上で選んだ記号に続けて書く',
    },
    {
      id: P('PfKa'), group, label: 'PFの許容できる短絡電流', type: 'select',
      options: SHORT_CIRCUIT, allowFreeInput: true, defaultValue: '40kA',
      showIf: hasLbs, ask: 'always',
      help: 'ふつうは40kA',
    },
  ];
}

/**
 * 「どの変圧器につなぐか」の選択肢。
 * 変圧器が何台でも選べるよう多めに用意してある。
 * 台数より大きい番号を選んでしまっても、作図のほうで最後の台に寄せる。
 */
const TRANSFORMER_CHOICES = [
  { value: 'none', label: 'つながない（単独で置く）' },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}台目` })),
];

export const QUESTIONS: Question[] = [
  /* ---------------- お客様・現場 ---------------- */
  { id: 'siteName', group: 'customer', label: '事業場名称', type: 'text', ask: 'always', required: true },
  {
    id: 'customerNameForTitleBlock',
    group: 'customer',
    label: '表題欄への記載名',
    type: 'text',
    ask: 'always',
    help: '事業場名称と異なる書き方（略称など）をする場合に入力する',
  },
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
  {
    id: 'receivingVoltage',
    group: 'customer',
    label: '受電電圧',
    type: 'select',
    dropdown: true,
    unit: 'V',
    options: [3300, 6600, 22000].map((v) => ({ value: String(v), label: `${v}V` })),
    defaultValue: '6600',
    ask: 'always',
  },

  /* ---------------- 引込元 ---------------- */
  {
    id: 'sourceType',
    group: 'source',
    label: '引込元は何ですか？',
    type: 'select',
    options: [
      { value: 'pole', label: '電柱' },
      { value: 'cabinet', label: '地上キャビネット' },
    ],
    defaultValue: 'pole',
    ask: 'ai-uncertain',
    required: true,
    help: '図面の一番上に描く、電力会社側の引込元。電柱か、地上の電力会社キャビネットのどちらか',
  },
  // ---- 電柱のとき ----
  {
    id: 'polePrefix',
    group: 'source',
    label: '電柱番号の区分',
    type: 'text',
    defaultValue: '中電柱：',
    showIf: { key: 'sourceType', ne: 'cabinet' },
    ask: 'always',
    help: '引込元は、すべて電力会社所有の電柱。中電柱＝中国電力の電柱。この部分は全現場で共通',
  },
  {
    id: 'poleName',
    group: 'source',
    label: '電柱名称',
    type: 'text',
    placeholder: '猪子山（分）81',
    showIf: { key: 'sourceType', ne: 'cabinet' },
    ask: 'always',
    help: '「中電柱：」に続く部分。（分）（幹）（支）（連絡）などの区分は電柱の記載をそのまま反映する',
  },
  {
    id: 'hasAs',
    group: 'source',
    label: 'AS（気中開閉器）はありますか？',
    type: 'select',
    options: [
      { value: 'yes', label: 'あり' },
      { value: 'no', label: 'なし' },
    ],
    defaultValue: 'no',
    showIf: { key: 'sourceType', ne: 'cabinet' },
    ask: 'ai-uncertain',
    help: '電力会社側の開閉器。引込元〜責任分界点の間に入る場合がある',
  },
  // ---- 地上キャビネットのとき（電柱も AS も無い） ----
  {
    id: 'cabinetPrefix',
    group: 'source',
    label: 'キャビネット番号の区分',
    type: 'text',
    defaultValue: 'キャビネット番号：',
    showIf: { key: 'sourceType', eq: 'cabinet' },
    ask: 'always',
    help: '図面に書く、キャビネット名称の前の文字。ふつうは「キャビネット番号：」のままでよい',
  },
  {
    id: 'cabinetName',
    group: 'source',
    label: 'キャビネット名称',
    type: 'text',
    showIf: { key: 'sourceType', eq: 'cabinet' },
    ask: 'always',
    help: '「キャビネット番号：」に続く部分',
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
    label: '責任分界点は、LBSですか、VCBですか？',
    type: 'select',
    options: [
      { value: 'lbs', label: 'LBS' },
      { value: 'vcb', label: 'VCB' },
    ],
    // 主遮断装置の形式が決まっていれば聞かない（CB形ならVCB、PFS形ならLBSに決まる）。
    // 未入力のときだけ聞く
    showIf: {
      all: [{ key: 'boundaryPattern', eq: 'split' }, { not: { key: 'mainBreakerForm', in: ['cb', 'pfs'] } }],
    },
    ask: 'always',
    help: '3点不一致のときは、主遮断装置の図記号の中央に横線を引いて記載する。主遮断装置の形式を入力すれば、この質問は不要（CB形はVCB、PFS形はLBSに自動で決まる）',
  },

  /* ---------------- PAS ---------------- */
  {
    id: 'sectionalizer',
    group: 'pas',
    label: '区分開閉器は？',
    type: 'select',
    dropdown: true,
    options: [
      // 引込元が地上キャビネットのときは PAS ではなく UGS（図記号も構造も同じで、名前だけ違う）
      { value: 'pas', label: 'PAS（電柱上）', showIf: { key: 'sourceType', ne: 'cabinet' } },
      { value: 'ugs', label: 'UGS（地上キャビネット）', showIf: { key: 'sourceType', eq: 'cabinet' } },
      { value: 'pgs', label: 'PGS（キャビネット内）' },
      { value: 'none', label: 'なし' },
    ],
    defaultValue: 'pas',
    ask: 'ai-uncertain',
    required: true,
    help:
      'PAS＝電柱上の区分開閉器（高圧気中開閉器）。UGS＝引込元が地上キャビネットのときの区分開閉器で、図面には「UGS」と書く（図記号・定格・SOGなどの質問はPASと同じ）。PGS＝キャビネット内に設置される区分開閉器で、図面には「PGS」と書く。' +
      'どちらも、SOG（制御装置）などの質問は同じ。なしのときは、地上キャビネット（電力会社のキャビネットで受電）の有無を聞く',
  },
  {
    id: 'groundCabinet',
    group: 'pas',
    label: '地上キャビネットはありますか？',
    type: 'select',
    dropdown: true,
    options: [
      { value: 'yes', label: 'あり' },
      { value: 'no', label: 'なし' },
    ],
    defaultValue: 'yes',
    showIf: { key: 'sectionalizer', eq: 'none' },
    ask: 'ai-uncertain',
    help: '区分開閉器が無いのは、電力会社のキャビネットで受電する場合がほとんど。ありなら、区分開閉器の場所に断路器（DS）を描く',
  },
  {
    id: 'groundCabinetType',
    group: 'pas',
    label: '地上キャビネットの種類は？',
    type: 'select',
    dropdown: true,
    options: [
      { value: 'mold-discon', label: 'モールドディスコン' },
      { value: 't-shelter', label: 'T型シェルター' },
      { value: 'three-pole', label: '三極連動' },
    ],
    showIf: { all: [{ key: 'sectionalizer', eq: 'none' }, { key: 'groundCabinet', eq: 'yes' }] },
    ask: 'ai-uncertain',
    help: '断路器（DS）の図記号の横に、「地上キャビネット」と、この種類の名前を書く',
  },
  {
    id: 'pasControl',
    group: 'pas',
    label: 'SOG（制御装置）は？',
    type: 'select',
    options: [
      { value: 'none', label: 'なし' },
      { value: 'gr', label: 'GR（無方向性）' },
      { value: 'dgr', label: 'DGR（方向性）' },
    ],
    defaultValue: 'dgr',
    showIf: { key: 'sectionalizer', in: ['pas', 'ugs', 'pgs'] },
    ask: 'ai-uncertain',
    help:
      'SOGがあればZCTが内蔵される（GRはZCTのみ、DGRはZCTに加えて零相電圧＝内蔵VTかZPDが必要）。' +
      'SOGが無ければVTとZCTは入らない。LAはSOGの有無に関わらず入ることがある',
  },
  {
    id: 'pasBuiltinVt',
    group: 'pas',
    label: 'VTは内蔵されていますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'yes',
    // SOGが無ければVTは入らないので、聞く必要そのものが無い
    showIf: { all: [{ key: 'sectionalizer', in: ['pas', 'ugs', 'pgs'] }, { key: 'pasControl', in: ['gr', 'dgr'] }] },
    ask: 'ai-uncertain',
  },
  {
    id: 'pasBuiltinLa',
    group: 'pas',
    label: 'LAは内蔵されていますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'yes',
    showIf: { key: 'sectionalizer', in: ['pas', 'ugs', 'pgs'] },
    ask: 'ai-uncertain',
    help: 'SOGが無いPASでも内蔵されていることがある',
  },
  {
    id: 'pasRatedVoltage',
    group: 'pas',
    label: '定格電圧は？',
    type: 'select',
    dropdown: true,
    options: [3300, 6600, 7200, 22000].map((v) => ({ value: String(v), label: `${v}V` })),
    showIf: { key: 'sectionalizer', in: ['pas', 'ugs', 'pgs'] },
    ask: 'ai-uncertain',
    help: '3300V・6600V・7200V・22000Vから選ぶ。7200Vと6600Vは機器によって使い分ける。手書きメモに記載があればそれを使い、記載が無いときだけ確認する',
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
    showIf: { key: 'sectionalizer', in: ['pas', 'ugs', 'pgs'] },
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
    label: '引込ケーブルは？',
    type: 'select',
    options: [
      { value: 'buried', label: '埋設（埋ケ）' },
      { value: 'overhead', label: '架空（架ケ）' },
      { value: 'none', label: 'なし（ケーブルを介さない）' },
    ],
    ask: 'ai-uncertain',
    help:
      '埋設のみ図面の線を点線で描く。「なし」は、電柱の上に受電設備を構成する場合などで、' +
      '区分開閉器の後をケーブルを介さず、ふつうの電線でつなぐとき（ケーブル端末も描かない）',
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
    showIf: CABLE_EXISTS,
    ask: 'ai-uncertain',
  },
  {
    id: 'cableVoltage',
    group: 'cable',
    label: '定格電圧は？',
    type: 'select',
    dropdown: true,
    unit: 'V',
    options: [3300, 6600, 22000].map((v) => ({ value: String(v), label: `${v}V` })),
    defaultValue: '6600',
    showIf: CABLE_EXISTS,
    ask: 'always',
  },
  {
    id: 'cableCrossSection',
    group: 'cable',
    label: '断面積は？',
    type: 'select',
    unit: 'mm2',
    options: [14, 22, 38, 60, 100, 150].map((v) => ({ value: String(v), label: `${v} mm2` })),
    allowFreeInput: true,
    showIf: CABLE_EXISTS,
    ask: 'always',
    help: '一覧にない値は手入力できる',
  },
  {
    id: 'cableLength',
    group: 'cable',
    label: '長さは？',
    type: 'number',
    unit: 'm',
    showIf: CABLE_EXISTS,
    ask: 'always',
    help: '不明な場合は空欄にする（図面には「- m」と記載する）',
  },
  {
    id: 'cableLengthApprox',
    group: 'cable',
    label: '図面に「約」を付ける',
    type: 'boolean',
    // 既定値を持たせると「既定のままでよい質問」として畳まれてしまうので置かない。
    // 未回答は「付けない」と同じ扱いになる
    showIf: { all: [CABLE_EXISTS, { key: 'cableLength', gt: 0 }] },
    ask: 'always',
    help: '歩測などで、きっちりした実測ではないとき。「約20m」と書かれる',
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
      { value: 'apartment-pole', label: '高圧マンション（電柱上構成）' },
    ],
    ask: 'ai-uncertain',
    required: true,
    help: '「高圧マンション（電柱上構成）」を選ぶと、設置場所は「電柱上」に決まる（設置場所の質問は出ない）',
  },
  {
    id: 'areaPlacement',
    group: 'area',
    label: '設置場所は？',
    type: 'select',
    // 高圧マンション（電柱上構成）のときは、設置場所は電柱上に決まっているので聞かない
    showIf: { not: { key: 'areaForm', eq: 'apartment-pole' } },
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
    group: 'receiving', section: '主遮断装置の形式',
    label: '主遮断装置の形式は？',
    type: 'select',
    options: [
      { value: 'pfs', label: 'PFS形（主遮断装置＝LBS）', share: '設備容量300kVA以下で採用可能' },
      { value: 'cb', label: 'CB形（主遮断装置＝VCB）', share: '設備容量301kVA以上では必須' },
      { value: 'pole-top', label: 'それ以外（高圧マンション・電柱上構成）' },
    ],
    ask: 'ai-uncertain',
    required: true,
    help:
      'この選択で受電設備の構成が大きく変わる。高圧変圧器の合計容量から自動で提案する。' +
      '「それ以外（高圧マンション・電柱上構成）」を選んだ場合は、電柱上に受電設備が構成されているものとして扱う（追加の質問は無い）',
  },
  {
    id: 'lbsRatedVoltage',
    group: 'receiving', section: 'LBS（PFS形）',
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
  { id: 'lbsRatedCurrent', group: 'receiving', section: 'LBS（PFS形）', label: 'LBSの定格電流', type: 'number', unit: 'A', showIf: { key: 'mainBreakerForm', eq: 'pfs' }, ask: 'always' },
  { id: 'lbsFuseCount', group: 'receiving', section: 'LBS（PFS形）', label: 'LBSのヒューズ本数', type: 'number', unit: '本', defaultValue: 3, showIf: { key: 'mainBreakerForm', eq: 'pfs' }, ask: 'always' },
  { id: 'lbsFuseSpec', group: 'receiving', section: 'LBS（PFS形）', label: 'LBSのヒューズ定格', type: 'text', placeholder: '7200V G50A T40A', showIf: { key: 'mainBreakerForm', eq: 'pfs' }, ask: 'always' },
  { id: 'dsRating', group: 'receiving', section: 'DS・VCB（CB形）', label: 'DSの定格', type: 'text', placeholder: '7200V 400A', showIf: { key: 'mainBreakerForm', eq: 'cb' }, ask: 'always' },
  { id: 'vcbRating', group: 'receiving', section: 'DS・VCB（CB形）', label: 'VCBの定格', type: 'text', placeholder: '7200V 600A 12.5kA', showIf: { key: 'mainBreakerForm', eq: 'cb' }, ask: 'always' },
  {
    id: 'hasSiteVt',
    group: 'receiving', section: 'VT（計器用変圧器）',
    label: '受電設備内にVTはありますか？',
    type: 'select',
    options: YES_NO,
    showIf: { key: 'mainBreakerForm', eq: 'pfs' },
    ask: 'ai-uncertain',
    help: 'PFS形はVTが入る現場と入らない現場がある。CB形はDSの次に必ず入る',
  },
  {
    id: 'vtCount',
    group: 'receiving', section: 'VT（計器用変圧器）',
    label: 'VTの台数',
    type: 'select',
    options: COUNT_OPTIONS.slice(0, 6),
    allowFreeInput: true,
    unit: '台',
    defaultValue: '2',
    showIf: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteVt', eq: 'yes' }] },
    ask: 'ai-uncertain',
    help: '2台以上のときは、図面に「VT＋PF×2」のように書く',
  },
  {
    id: 'vtRatio',
    group: 'receiving', section: 'VT（計器用変圧器）',
    label: 'VTの変圧比',
    type: 'text',
    placeholder: '6600/110V',
    // VTの変圧比は 6600/110V のほかには無い。最初から入れておき、違うときだけ手で直す
    defaultValue: '6600/110V',
    help: '6600/110V に決まっているので、最初から入っている。違うときだけ手で直す',
    showIf: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteVt', eq: 'yes' }] },
    ask: 'ai-uncertain',
  },
  {
    id: 'hasSiteCt',
    group: 'receiving', section: 'CT（変流器）',
    label: '受電設備内にCTはありますか？',
    type: 'select',
    options: YES_NO,
    showIf: { key: 'mainBreakerForm', eq: 'pfs' },
    ask: 'ai-uncertain',
    help: 'PFS形はCTが入る現場と入らない現場がある。CB形はVCBのすぐ下に必ず入る',
  },
  {
    id: 'ctCount',
    group: 'receiving', section: 'CT（変流器）',
    label: 'CTの台数',
    type: 'select',
    options: COUNT_OPTIONS.slice(0, 6),
    allowFreeInput: true,
    unit: '台',
    defaultValue: '2',
    showIf: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteCt', eq: 'yes' }] },
    ask: 'ai-uncertain',
    help: '2台以上のときは、図面に「CT×2」のように書く',
  },
  {
    id: 'ctRatio',
    group: 'receiving', section: 'CT（変流器）',
    label: 'CTの変流比',
    type: 'text',
    placeholder: '100',
    appendOnBlur: '/5A',
    help: '1次側の電流の数字だけを入れると、「/5A」が自動で付く（例：100 → 100/5A）。2次側は、必ず5A',
    showIf: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteCt', eq: 'yes' }] },
    ask: 'ai-uncertain',
  },
  {
    id: 'hasZpd',
    group: 'receiving', section: 'ZPD・LA・接地',
    label: 'ZPD（OVGR用）はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    ask: 'ai-uncertain',
    help: '受電設備側に零相電圧検出装置を置く場合',
  },
  {
    id: 'hasLa',
    group: 'receiving', section: 'ZPD・LA・接地',
    label: '受電設備内にLA（避雷器）はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    ask: 'ai-uncertain',
  },
  { id: 'earthingNotes', group: 'receiving', section: 'ZPD・LA・接地', label: '接地方式・接地抵抗値等の特記事項', type: 'text', ask: 'always' },

  /* ---------------- 変圧器 ---------------- */
  {
    id: 'transformerCount',
    group: 'transformer',
    label: '変圧器の台数',
    type: 'select',
    options: COUNT_OPTIONS,
    allowFreeInput: true,
    unit: '台',
    defaultValue: '1',
    ask: 'ai-uncertain',
    help: '51台以上のときは手入力できる',
  },
  {
    id: 'trUsage',
    group: 'transformer',
    label: '用途',
    type: 'select',
    options: [
      { value: '電灯', label: '電灯' },
      { value: '動力', label: '動力' },
      // 図面には「電灯・動力」と書く。V結線のときは、電灯と動力の容量を分けて聞く
      { value: '電灯・動力', label: '電灯および動力' },
    ],
    allowFreeInput: true,
    ask: 'ai-uncertain',
    help: '用途によって、選べる結線方式が変わる（電灯＝単相系とV結線、動力＝三相とV結線、電灯および動力＝すべて）',
  },
  {
    id: 'trConnection',
    group: 'transformer',
    label: '結線方式',
    type: 'select',
    // 用途で選べるものを絞る。電灯＝単相系とV結線、動力＝三相とV結線、電灯および動力・未入力＝すべて
    options: [
      { value: 'tr-1p', label: '単相（単相三線式）', showIf: NOT_POWER_ONLY },
      { value: 'tr-1p-2w', label: '単相（単相2線式）', showIf: NOT_POWER_ONLY },
      { value: 'tr-3p-dy', label: '三相 Δ-Y結線', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-3p-yd', label: '三相 Y-Δ結線', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-3p-dd', label: '三相 Δ-Δ結線', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-3p-yy', label: '三相 Y-Y結線', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-vv', label: 'V結線（単相変圧器2台）' },
      { value: 'tr-1p-parallel', label: '単相変圧器 並行運転（倍容量）', showIf: NOT_POWER_ONLY },
    ],
    ask: 'ai-uncertain',
    required: true,
  },
  { id: 'trCapacity', group: 'transformer', label: '容量', type: 'number', unit: 'kVA', showIf: { not: MIXED_V }, ask: 'ai-uncertain', required: true },
  { id: 'trCapacity2', group: 'transformer', label: '2台目の容量', type: 'number', unit: 'kVA', showIf: { all: [{ key: 'trConnection', eq: 'tr-vv' }, { not: MIXED_V }] }, ask: 'always', help: 'V結線は2台の容量が異なる場合がある' },
  // 電灯および動力のV結線だけは、変圧器ごとではなく、全体の容量を電灯・動力に分けて聞く
  { id: 'trCapacityLight', group: 'transformer', label: '電灯の容量', type: 'number', unit: 'kVA', showIf: MIXED_V, ask: 'always', required: true, help: 'V結線（単相変圧器2台）全体のうち、電灯の分の容量' },
  { id: 'trCapacityPower', group: 'transformer', label: '動力の容量', type: 'number', unit: 'kVA', showIf: MIXED_V, ask: 'always', required: true, help: 'V結線（単相変圧器2台）全体のうち、動力の分の容量' },
  { id: 'trVoltage', group: 'transformer', label: '電圧', type: 'text', placeholder: '6600V/210-105V', ask: 'ai-uncertain' },
  { id: 'trComposition', group: 'transformer', label: '構成', type: 'text', placeholder: '単相変圧器×3', showIf: { key: 'trConnection', in: ['tr-3p-dd', 'tr-vv'] }, ask: 'always' },
  { id: 'trHasPc', group: 'transformer', label: '変圧器の手前にPC（高圧カットアウト）が入りますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'trHasLbs', group: 'transformer', label: '変圧器の手前にLBSが入りますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },

/* ---------------- 高圧進相設備 ---------------- */
  {
    id: 'hasCapacitor',
    group: 'compensation',
    label: '高圧コンデンサ設備はありますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    ask: 'ai-uncertain',
    shared: true,
    help:
      '高圧側（変圧器と並列に入る側）にコンデンサがあるときだけ「あり」にする。' +
      '低圧側の分電盤などにしかコンデンサが無い場合は「なし」でよい（この図面には描かない）',
  },
  {
    id: 'capacitorCount',
    group: 'compensation',
    label: '高圧コンデンサの台数',
    type: 'select',
    options: COUNT_OPTIONS,
    allowFreeInput: true,
    unit: '台',
    defaultValue: '1',
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'ai-uncertain',
  },
  // 容量もリアクトルの有無も、コンデンサ1台ごとに違う（4台あって1台だけリアクトル付き、もある）
  {
    id: 'capacitorCapacity',
    group: 'compensation',
    label: 'コンデンサの容量',
    type: 'text',
    placeholder: '3φ106kvar 7020V',
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'always',
  },
  // 手前に入る開閉器。現場によって PCのみ・LBSのみ・LBS＋VCS と分かれる
  {
    id: 'capHasPc',
    group: 'compensation',
    label: 'このコンデンサの手前にPC（高圧カットアウト）が入りますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'ai-uncertain',
  },
  {
    id: 'capHasLbs',
    group: 'compensation',
    label: 'このコンデンサの手前にLBSが入りますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'ai-uncertain',
  },
  {
    id: 'capHasVcs',
    group: 'compensation',
    label: 'このコンデンサの手前にVCS（真空電磁接触器）が入りますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'ai-uncertain',
    help: 'LBSと組み合わせて入ることが多い。LBSの下に付く',
  },
  {
    id: 'hasReactor',
    group: 'compensation',
    label: 'このコンデンサに直列リアクトルは入りますか？',
    type: 'select',
    options: YES_NO,
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'ai-uncertain',
    help: 'リアクトルの有無はコンデンサごとに決まる。台数分それぞれ答える',
  },
  {
    id: 'reactorCapacity',
    group: 'compensation',
    label: 'リアクトルの容量',
    type: 'text',
    placeholder: '3φ6.38kvar 243V',
    showIf: { key: 'hasReactor', eq: 'yes' },
    ask: 'always',
  },

  /* ---------------- 特殊設備 ---------------- */
  { id: 'hasGenerator', group: 'special', label: '発電機はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'hasPv', group: 'special', label: '太陽光発電設備はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'hasBattery', group: 'special', label: '系統用蓄電所ですか？', type: 'select', options: YES_NO_Q, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'batteryCapacity', group: 'special', label: '蓄電ユニットの規模', type: 'text', showIf: { key: 'hasBattery', eq: 'yes' }, ask: 'always' },
  {
    id: 'batteryTransformer',
    group: 'special',
    label: '蓄電池ユニットは、どの変圧器につなぎますか？',
    type: 'select',
    options: TRANSFORMER_CHOICES,
    defaultValue: 'none',
    showIf: { key: 'hasBattery', eq: 'yes' },
    ask: 'always',
    help: 'つなぎ先が決まっていなければ「つながない」のままでよい',
  },

  /* ---------------- 発電機（台ごと） ---------------- */
  {
    id: 'generatorCount',
    group: 'generator',
    label: '発電機の台数',
    type: 'select',
    options: COUNT_OPTIONS,
    allowFreeInput: true,
    unit: '台',
    defaultValue: '1',
    ask: 'ai-uncertain',
  },
  {
    id: 'generatorUsage',
    group: 'generator',
    label: '用途区分',
    type: 'select',
    options: [
      { value: 'normal', label: '常用型' },
      { value: 'emergency', label: '非常用型' },
    ],
    ask: 'always',
    required: true,
  },
  {
    id: 'generatorFuel',
    group: 'generator',
    label: '燃料の種別',
    type: 'select',
    options: [
      { value: 'diesel', label: '軽油' },
      { value: 'gas', label: '天然ガス' },
      { value: 'gasoline', label: 'ガソリン' },
      { value: 'kerosene', label: '灯油' },
      { value: 'heavy-oil', label: '重油' },
    ],
    allowFreeInput: true,
    ask: 'always',
    help: '分かる範囲でよい。図面に書くが、作図の時点で不明なら空欄のままでよい',
  },
  {
    id: 'generatorCapacity',
    group: 'generator',
    label: '発電機の容量',
    type: 'text',
    placeholder: '500kVA',
    ask: 'always',
  },
  {
    id: 'generatorPlace',
    group: 'generator',
    label: '設置場所',
    type: 'text',
    ask: 'always',
    help: '非常用発電機の場合は図面に明記する',
  },

  {
    id: 'generatorTransformer',
    group: 'generator',
    label: 'この発電機は、どの変圧器につなぎますか？',
    type: 'select',
    options: TRANSFORMER_CHOICES,
    defaultValue: 'none',
    ask: 'always',
    help: 'つなぎ先が決まっていなければ「つながない」のままでよい（図面の下に置くだけになる）',
  },

  /* ---------------- 太陽光（PCS。容量ごとのまとまりで入力） ---------------- */
  {
    id: 'pvGroupCount',
    group: 'pv',
    label: 'PCSは何種類の容量がありますか？',
    type: 'select',
    options: COUNT_OPTIONS.slice(0, 10),
    unit: '種類',
    defaultValue: '1',
    ask: 'always',
    help: '同じ容量のPCSが何台あっても1種類。50kWが7台と100kWが8台なら2種類',
  },
  {
    id: 'pcsCapacity',
    group: 'pv',
    label: 'PCS 1台の容量',
    type: 'number',
    unit: 'kW',
    ask: 'always',
    required: true,
  },
  {
    id: 'pcsCount',
    group: 'pv',
    label: 'この容量のPCSは何台ありますか？',
    type: 'select',
    options: COUNT_OPTIONS,
    allowFreeInput: true,
    unit: '台',
    defaultValue: '1',
    ask: 'always',
    required: true,
  },
  // 容量ごとに「何台目の変圧器に何台つなぐか」を入れる。
  // 変圧器が1台しかないときは聞かない（全部その1台につながる）。
  ...Array.from({ length: 8 }, (_, t) => ({
    id: `pcsToTr${t + 1}`,
    group: 'pv' as const,
    label: `うち ${t + 1}台目の変圧器につなぐ台数`,
    type: 'number' as const,
    unit: '台',
    showIf: { all: [{ key: 'transformerCount', gt: Math.max(1, t) }] },
    ask: 'always' as const,
    help: t === 0 ? 'どの変圧器にも入れなければ、全部1台目の変圧器につながる' : undefined,
  })),

  /* ---------------- 表題欄 ---------------- */
  {
    id: 'drawingName',
    group: 'title',
    label: '図面名称',
    type: 'text',
    ask: 'always',
    help: '空欄のときは、受電設備の形態から自動で決まります（例：キュービクル式高圧受電設備単線結線図）。書いた場合は、それを優先します',
  },

  // PC・LBSの定格電流とヒューズ（変圧器の手前／コンデンサの手前）
  ...breakerRatings('tr', 'transformer', { key: 'transformerCount', gt: 0 }, 'T'),
  ...breakerRatings('cap', 'compensation', { key: 'hasCapacitor', eq: 'yes' }, 'C'),
];
