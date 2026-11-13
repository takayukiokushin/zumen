import type { Question, Choice } from './types.ts';
import type { Condition } from '../condition.ts';
import { MAX_COUNT, PCS_INPUT_MAX, COUNT_LIMITS } from '../counts.ts';
import { BUS_SWITCH_OPTIONS, CABLE_VOLTAGE_OPTIONS, COUNT_OPTIONS, FUSE_CURRENT_OPTIONS, YES_NO, YES_NO_Q, TRANSFORMER_CHOICES, RELAY_COUNT_OPTIONS, connectionCableQuestions } from './common.ts';

/** 電動機：変圧器があるエリアか（変圧器が0台のエリアは、二次側から接続できない） */
const MOTOR_HAS_TR: Condition = { not: { key: 'transformerCount', lte: 0 } };
/** 電動機：接続元が、変圧器の二次側のとき */
const MOTOR_FROM_SECONDARY: Condition = { key: 'motorSource', eq: 'secondary' };

/**
 * PCSをつなぐ変圧器の選択肢（「1台目」〜変圧器の台数の上限）。
 * 変圧器の台数より大きい番号は、一覧に出さない（Choice.showIf）。どの質問も、同じ一覧を使う
 */
const DEST_OPTIONS: Choice[] = Array.from({ length: COUNT_LIMITS.transformerCount ?? MAX_COUNT }, (_, j): Choice => ({
  value: String(j + 1),
  label: `${j + 1}台目`,
  showIf: { key: 'transformerCount', gt: j },
}));

/** 質問の定義：特殊設備、補助変圧器、発電機、太陽光 */
export const EQUIPMENT_QUESTIONS: Question[] = [
  /* ---------------- 特殊設備 ---------------- */
  { id: 'hasGenerator', group: 'special', label: '発電機はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'hasMotor', group: 'special', label: '電動機はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain', help: '高圧の電動機（モーター）がある場合。台数・始動方式・容量・設置場所を、台ごとに入力する' },
  { id: 'hasPv', group: 'special', label: '太陽光発電設備はありますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'hasBattery', group: 'special', label: '系統用蓄電所ですか？', type: 'select', options: YES_NO_Q, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'batteryCapacity', group: 'special', label: '蓄電ユニットの規模', type: 'text', showIf: { key: 'hasBattery', eq: 'yes' }, ask: 'always' },
  {
    id: 'batteryTransformer',
    group: 'special',
    label: '蓄電池ユニットは、どの変圧器につなぎますか？',
    type: 'select',
    options: TRANSFORMER_CHOICES,
    // 「はい」と答えたときの初期値は、1台目の変圧器
    defaultValue: '1',
    showIf: { key: 'hasBattery', eq: 'yes' },
    ask: 'always',
    help: '最初は、1台目の変圧器につなぐ設定になっている。つなぎ先が決まっていなければ「つながない」を選ぶ',
  },

  /* ---------------- 補助変圧器（系統用蓄電所のとき。台ごと） ---------------- */
  {
    id: 'auxTrCount',
    group: 'auxtr',
    label: '補助変圧器の台数',
    type: 'select',
    options: RELAY_COUNT_OPTIONS.slice(0, 5),
    allowFreeInput: true,
    unit: '台',
    autoValue: [{ value: '1' }],
    ask: 'always',
    help: '蓄電所の補助電源（照明・空調・制御）に使う変圧器。0台にすると描かない',
  },
  {
    id: 'auxTrFrom',
    group: 'auxtr',
    label: 'どの変圧器の低圧側につなぎますか？',
    type: 'select',
    options: TRANSFORMER_CHOICES.slice(1),
    autoValue: [{ value: '1' }],
    ask: 'always',
    help: '補助変圧器盤のMCCBを通して、その変圧器の低圧側からつなぐ',
  },
  {
    id: 'auxTrUsage',
    group: 'auxtr',
    label: '用途',
    type: 'select',
    options: [
      { value: '動力', label: '動力' },
      { value: '電灯', label: '電灯' },
      { value: '電灯・動力', label: '電灯および動力' },
    ],
    autoValue: [{ value: '動力' }],
    allowFreeInput: true,
    ask: 'always',
    help: '図面には「動力用 Tr」のように書く',
  },
  {
    id: 'auxTrConnection',
    group: 'auxtr',
    label: '結線方式',
    type: 'select',
    options: [
      { value: 'tr-1p', label: '単相（単相三線式）', showIf: { not: { key: 'auxTrUsage', eq: '動力' } } },
      { value: 'tr-1p-2w', label: '単相（単相2線式）', showIf: { not: { key: 'auxTrUsage', eq: '動力' } } },
      { value: 'tr-3p-dy', label: '三相 Δ-Y結線', showIf: { not: { key: 'auxTrUsage', eq: '電灯' } } },
      { value: 'tr-3p-yd', label: '三相 Y-Δ結線', showIf: { not: { key: 'auxTrUsage', eq: '電灯' } } },
      { value: 'tr-3p-dd', label: '三相 Δ-Δ結線', showIf: { not: { key: 'auxTrUsage', eq: '電灯' } } },
      { value: 'tr-3p-yy', label: '三相 Y-Y結線', showIf: { not: { key: 'auxTrUsage', eq: '電灯' } } },
      { value: 'tr-vv', label: 'V結線（単相変圧器2台）' },
    ],
    ask: 'always',
    help: '決まっていなければ空のままでよい（円の中が空の記号で描く。勝手にΔやYは描かない）',
  },
  { id: 'auxTrCapacity', group: 'auxtr', label: '容量', type: 'number', unit: 'kVA', ask: 'always', placeholder: '150' },
  { id: 'auxTrVoltage', group: 'auxtr', label: '定格電圧（一次/二次）', type: 'text', placeholder: '550/220V', ask: 'always', help: '図面の記載例：550/220V' },
  { id: 'auxTrMccb', group: 'auxtr', label: '補助変圧器盤のMCCBの定格', type: 'text', unit: 'A', placeholder: '400', ask: 'always', help: '数字だけでよい。図面には「MCCB400A」のように書く' },

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

  /* ---------------- 電動機（台ごと。入力の順番：台数・始動方式・容量・設置場所。接続元は、このあとの項目で足す） ---------------- */
  {
    id: 'motorCount',
    group: 'motor',
    label: '電動機の台数',
    type: 'select',
    options: COUNT_OPTIONS,
    allowFreeInput: true,
    unit: '台',
    defaultValue: '1',
    autoValue: [{ value: '1' }],
    ask: 'ai-uncertain',
  },
  {
    id: 'motorStartMethod',
    group: 'motor',
    label: '始動方式',
    type: 'select',
    // 選択肢の順番は、依頼のとおり（直入れ → リアクトル → コンドルファ → インバータ → スターデルタ）
    options: [
      { value: '直入れ始動', label: '直入れ始動' },
      { value: 'リアクトル始動', label: 'リアクトル始動' },
      { value: 'コンドルファ始動', label: 'コンドルファ始動' },
      { value: 'インバータ始動', label: 'インバータ始動' },
      { value: 'スターデルタ始動', label: 'スターデルタ始動' },
    ],
    dropdown: true,
    ask: 'always',
    help: '図面には、電動機の記号の右横に書く。分からなければ、空欄のままでよい',
  },
  {
    id: 'motorCapacity',
    group: 'motor',
    label: '電動機の容量',
    type: 'number',
    unit: 'kW',
    ask: 'always',
    help: '図面には、始動方式の下に「500kW」のように書く（台数は、記号の数で分かるので、文字には書かない）',
  },
  {
    id: 'motorPlace',
    group: 'motor',
    label: '設置場所',
    type: 'text',
    ask: 'always',
  },

  /* ---- 電動機の接続元と、途中にあるもの（第13弾 項目25）。台ごとに答える ---- */
  {
    // 初期値：変圧器があるときは二次側、変圧器が0台のエリアは母線
    id: 'motorSource',
    group: 'motor', section: '接続元',
    label: '接続元は？',
    type: 'select',
    options: [
      { value: 'secondary', label: '変圧器の二次側から接続する', showIf: MOTOR_HAS_TR },
      { value: 'bus', label: '母線（高圧母線）から分岐して接続する' },
    ],
    autoValue: [{ when: MOTOR_HAS_TR, value: 'secondary' }, { value: 'bus' }],
    dropdown: true,
    ask: 'always',
    help: '変圧器の二次側（低圧側）から接続するか、高圧母線から分岐して接続するか。変圧器が0台のエリアは、母線だけ選べる',
  },
  {
    id: 'motorSourceTr',
    group: 'motor', section: '接続元',
    label: '何台目の変圧器の二次側ですか？',
    type: 'select',
    options: DEST_OPTIONS,
    defaultValue: '1',
    dropdown: true,
    showIf: { all: [MOTOR_FROM_SECONDARY, { key: 'transformerCount', gt: 1 }] },
    ask: 'always',
    help: '変圧器が1台のときは、聞かない（その1台）',
  },
  {
    id: 'motorCable',
    group: 'motor', section: '接続元',
    label: '途中にケーブルはありますか？',
    type: 'select',
    options: YES_NO_Q,
    defaultValue: 'no',
    ask: 'always',
    help: '接続元から電動機までの間に、ケーブルがあるかどうか。引込・エリア間と同じ入力欄（種類・構造・定格電圧・断面積・長さ）で答える',
  },
  // 途中のケーブルの入力欄は、エリア間の接続と同じ部品。定格電圧だけ、接続元で変わる（母線＝高圧、二次側＝低圧）
  ...connectionCableQuestions({
    prefix: 'motor',
    group: 'motor',
    section: '接続元',
    when: { key: 'motorCable', eq: 'yes' },
    voltage: {
      options: [
        ...CABLE_VOLTAGE_OPTIONS.map((o) => ({ ...o, showIf: { not: MOTOR_FROM_SECONDARY } as Condition })),
        { value: '600', label: '600V', showIf: MOTOR_FROM_SECONDARY },
      ],
      autoValue: [{ when: MOTOR_FROM_SECONDARY, value: '600' }, { value: '6600' }],
      allowFreeInput: true,
    },
  }),
  {
    // 母線から：エリア間の送り出しと同じ並び。二次側から：低圧側の開閉器（いまある記号は、MCCBだけ）
    id: 'motorSwitch',
    group: 'motor', section: '接続元',
    label: '途中に開閉器はありますか？',
    type: 'select',
    options: [
      ...BUS_SWITCH_OPTIONS.map((o) => ({ ...o, showIf: { not: MOTOR_FROM_SECONDARY } as Condition })),
      { value: 'none', label: 'なし', showIf: MOTOR_FROM_SECONDARY },
      { value: 'mccb', label: 'MCCB（配線用遮断器）', showIf: MOTOR_FROM_SECONDARY },
    ],
    defaultValue: 'none',
    dropdown: true,
    ask: 'always',
    help: '接続元から電動機までの間に付く開閉器。接続元が母線のときは、DS・VCB・LBS・DS＋VCB。変圧器の二次側のときは、低圧側のもの（いまは、MCCBだけ）',
  },
  {
    id: 'motorFuseCurrent',
    group: 'motor', section: '接続元',
    label: 'LBSのパワーヒューズの容量（定格電流）',
    type: 'select',
    options: FUSE_CURRENT_OPTIONS,
    allowFreeInput: true,
    dropdown: true,
    unit: 'A',
    showIf: { key: 'motorSwitch', eq: 'lbs' },
    ask: 'always',
    help: 'LBSのときだけ聞く。LBSには、パワーヒューズ（PF）が付く。図面には「PF 30A」のように書く。分からなければ、空欄にする',
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
  // PCSのつなぎ先の入れ方は、2通り。入力欄の数が少ないほうを、自動で出す（pcsMode。engine.ts の pcsInputMode）。
  //   ① PCSごとに、「何台目の変圧器につなぐか」を一覧から選ぶ（PCSの台数が、変圧器の台数以下のとき）
  //   ② 変圧器ごとに、「何台つなぐか」を入れる（PCSのほうが多いとき）
  // どちらも、図面を組み立てるときは、「変圧器ごとの台数」に直して使う。
  // 変圧器が1台しかないときは聞かない（全部その1台につながる）。
  // AI（スケッチ・音声）には、①の欄と、②の9台目以降の欄は渡さない（数が多く、指示文が長くなりすぎるため）。

  // ① PCSごと（「1台目のPCS」「2台目のPCS」…）。何も選ばなければ、1台目の変圧器につながる
  ...Array.from({ length: PCS_INPUT_MAX }, (_, k) => ({
    id: `pcsDest${k + 1}`,
    group: 'pv' as const,
    label: `${k + 1}台目のPCSをつなぐ変圧器`,
    type: 'select' as const,
    options: DEST_OPTIONS,
    showIf: { all: [{ key: 'pcsMode', eq: 'perPcs' }, { key: 'pcsCount', gt: k }] },
    ask: 'always' as const,
    noAi: true,
    help: k === 0 ? '選ばなければ、1台目の変圧器につながる' : undefined,
  })),
  // ① PCSごとの、PV（太陽電池パネル）の容量。任意。同じ変圧器につなぐPCSのぶんは、足して、1つの枠の下に書く
  ...Array.from({ length: PCS_INPUT_MAX }, (_, k) => ({
    id: `pvKwPcs${k + 1}`,
    group: 'pv' as const,
    label: `${k + 1}台目のPCSの下の、PVの容量`,
    type: 'number' as const,
    unit: 'kW',
    showIf: { all: [{ key: 'pcsMode', eq: 'perPcs' }, { key: 'pcsCount', gt: k }] },
    ask: 'always' as const,
    noAi: true,
    help:
      k === 0
        ? '任意。入れると、PCSの枠の真下のPVの下に「100kW」のように書く（同じ変圧器につなぐPCSが2台以上あるときは、足した値）。空欄なら「PV」だけ'
        : '任意。空欄なら「PV」だけ書く',
  })),

  // ② 変圧器ごと
  ...Array.from({ length: PCS_INPUT_MAX }, (_, t) => ({
    id: `pcsToTr${t + 1}`,
    group: 'pv' as const,
    label: `うち ${t + 1}台目の変圧器につなぐ台数`,
    type: 'number' as const,
    unit: '台',
    showIf: { all: [{ key: 'transformerCount', gt: Math.max(1, t) }, { key: 'pcsMode', eq: 'perTr' }] },
    ask: 'always' as const,
    ...(t >= 8 ? { noAi: true } : {}),
    help:
      t === 0
        ? 'どの変圧器にも入れなければ、全部1台目の変圧器につながる'
        : t === PCS_INPUT_MAX - 1
          ? '変圧器が31台以上あるときは、ここまでです。PCSの台数を30台以下にすると、PCSごとに、つなぐ変圧器を選べます'
          : undefined,
  })),

  // PCSの枠の真下に描くPV（太陽電池パネル）の容量。任意。② のときの入力欄（変圧器ごとの枠に1つずつなので、容量の種類ごとには繰り返さず、1回だけ聞く）。
  // ① のときは、PCSごと（pvKwPcs）に入れる
  ...Array.from({ length: PCS_INPUT_MAX }, (_, t) => ({
    id: `pvKw${t + 1}`,
    group: 'pv' as const,
    label: `${t + 1}台目の変圧器につなぐPCSの下の、PVの容量`,
    type: 'number' as const,
    unit: 'kW',
    shared: true,
    showIf: { all: [{ key: 'transformerCount', gt: Math.max(0, t) }, { key: 'pcsMode', ne: 'perPcs' }] },
    ask: 'always' as const,
    ...(t >= 8 ? { noAi: true } : {}),
    help: t === 0
      ? '任意。入れると、PCSの枠の真下のPVの下に「PV」と並べて、「100kW」のように書く。空欄なら「PV」だけ。変圧器が1台のときは、この1つだけ'
      : t >= 8 ? undefined : '任意。空欄なら「PV」だけ書く',
  })),
];
