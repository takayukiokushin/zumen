import type { Question } from './types.ts';
import { COUNT_OPTIONS, NOT_POWER_ONLY, NOT_LIGHT_ONLY, RECEIVING_6600, MIXED_V, YES_NO } from './common.ts';

/** 質問の定義：変圧器、高圧進相設備 */
export const TRANSFORMER_QUESTIONS: Question[] = [
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
      // 単相変圧器3台を組み合わせたΔ-Δ結線の動力変圧器。3台で1台の動力変圧器と考え、図面では1台として描く（文字に「単相変圧器×3」と入る）
      { value: 'tr-3p-dd-1p3', label: '三相 Δ-Δ結線（単相変圧器×3）', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-3p-yy', label: '三相 Y-Y結線', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-vv', label: 'V結線（単相変圧器2台）' },
      { value: 'tr-1p-parallel', label: '単相変圧器 並行運転（倍容量）', showIf: NOT_POWER_ONLY },
    ],
    // 用途を選ぶと、結線方式の初期値が決まる（あとから自由に変えられる）
    autoValue: [
      { when: { key: 'trUsage', eq: '電灯' }, value: 'tr-1p' },
      { when: { key: 'trUsage', eq: '動力' }, value: 'tr-3p-yd' },
      { when: { key: 'trUsage', eq: '電灯・動力' }, value: 'tr-vv' },
    ],
    ask: 'ai-uncertain',
    required: true,
    help: '単相変圧器3台のΔ-Δ結線の動力変圧器は、3台で1台と考え、図面では1台として描く。用途は「動力」、結線方式は「三相 Δ-Δ結線（単相変圧器×3）」を選ぶ',
  },
  {
    id: 'trCapacity',
    group: 'transformer',
    label: '容量',
    type: 'number',
    unit: 'kVA',
    showIf: { not: MIXED_V },
    ask: 'ai-uncertain',
    required: true,
    help: '単相変圧器3台を組み合わせたΔ-Δ結線の場合は、3台の合計値を入力する',
  },
  { id: 'trCapacity2', group: 'transformer', label: '2台目の容量', type: 'number', unit: 'kVA', showIf: { all: [{ key: 'trConnection', eq: 'tr-vv' }, { not: MIXED_V }] }, ask: 'always', help: 'V結線は2台の容量が異なる場合がある' },
  // 電灯および動力のV結線だけは、変圧器ごとではなく、全体の容量を電灯・動力に分けて聞く
  { id: 'trCapacityLight', group: 'transformer', label: '電灯の容量', type: 'number', unit: 'kVA', showIf: MIXED_V, ask: 'always', required: true, help: 'V結線（単相変圧器2台）全体のうち、電灯の分の容量' },
  { id: 'trCapacityPower', group: 'transformer', label: '動力の容量', type: 'number', unit: 'kVA', showIf: MIXED_V, ask: 'always', required: true, help: 'V結線（単相変圧器2台）全体のうち、動力の分の容量' },
  {
    id: 'trVoltage',
    group: 'transformer',
    label: '電圧',
    type: 'text',
    placeholder: '6600/210-105V',
    // 受電電圧が6600Vのとき、結線方式に合わせた電圧が最初から入る（単相三線式・V結線＝6600/210-105V、Y-Δ＝6600/210V、
    // ほかの結線方式は「6600/」だけ）。消しても書き換えてもよい
    autoValue: [
      { when: { all: [RECEIVING_6600, { key: 'trConnection', in: ['tr-1p', 'tr-vv'] }] }, value: '6600/210-105V' },
      { when: { all: [RECEIVING_6600, { key: 'trConnection', eq: 'tr-3p-yd' }] }, value: '6600/210V' },
      { when: RECEIVING_6600, value: '6600/' },
    ],
    keepEmpty: true,
    ask: 'ai-uncertain',
  },
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
    // 標準は「なし」。2台目以降も、答えるまでは「なし」（未入力のままにしない）。図面は、「なし」も未入力も、リアクトルを描かない
    defaultValue: 'no',
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
];
