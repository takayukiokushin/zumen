import type { Question } from './types.ts';
import { COUNT_OPTIONS, YES_NO, YES_NO_Q, TRANSFORMER_CHOICES, RELAY_COUNT_OPTIONS } from './common.ts';

/** 質問の定義：特殊設備、補助変圧器、発電機、太陽光 */
/**
 * PCSをつなげる変圧器は、8台目まで（入力欄も、図面に描くPCS・PVも、8台目まで）。変圧器そのものは、もっと多く入れられる。
 * その注意を、8台目の欄に出す（この欄が出るのは、変圧器が8台以上のとき）
 */
export const PCS_LIMIT_NOTE =
  'PCSは8台目の変圧器までしかつなげません（9台目以降は不可。図面のPCS・PVも8台目まで。入れ残した台数は、1台目に数えます）';

export const EQUIPMENT_QUESTIONS: Question[] = [
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
  { id: 'auxTrVoltage', group: 'auxtr', label: '定格電圧（一次/二次）', type: 'text', placeholder: '550V/220V', ask: 'always', help: '図面の記載例：550V/220V' },
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
    help:
      t === 0
        ? 'どの変圧器にも入れなければ、全部1台目の変圧器につながる'
        : t === 7
          ? PCS_LIMIT_NOTE
          : undefined,
  })),

  // PCSの枠の真下に描くPV（太陽電池パネル）の容量。任意。変圧器ごとの枠に1つずつなので、容量の種類ごとには繰り返さず、1回だけ聞く
  ...Array.from({ length: 8 }, (_, t) => ({
    id: `pvKw${t + 1}`,
    group: 'pv' as const,
    label: `${t + 1}台目の変圧器につなぐPCSの下の、PVの容量`,
    type: 'number' as const,
    unit: 'kW',
    shared: true,
    showIf: { all: [{ key: 'transformerCount', gt: Math.max(0, t) }] },
    ask: 'always' as const,
    help: t === 0
      ? '任意。入れると、PCSの枠の真下のPVの下に「PV」と並べて、「100kW」のように書く。空欄なら「PV」だけ。変圧器が1台のときは、この1つだけ'
      : '任意。空欄なら「PV」だけ書く',
  })),
];
