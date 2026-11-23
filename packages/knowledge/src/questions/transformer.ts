import type { Question } from './types.ts';
import { COUNT_OPTIONS, NOT_POWER_ONLY, NOT_LIGHT_ONLY, RECEIVING_NOT_3300, MIXED_V, THREE_WINDING, YES_NO } from './common.ts';

/** 質問の定義：変圧器、高圧進相設備 */
export const TRANSFORMER_QUESTIONS: Question[] = [
  /* ---------------- 変圧器 ---------------- */
  {
    id: 'transformerCount',
    group: 'transformer',
    label: '変圧器の台数',
    type: 'select',
    // 0台は、2か所目以降のエリアだけ（電動機だけを置くエリアなど。1か所目は、1台以上）
    options: [{ value: '0', label: '0（なし）', showIf: { key: 'areaNo', gt: 1 } }, ...COUNT_OPTIONS],
    allowFreeInput: true,
    unit: '台',
    defaultValue: '1',
    autoValue: [{ value: '1' }],
    ask: 'ai-uncertain',
    required: true,
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
    required: true,
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
      // 三巻線変圧器（調整用・力率改善用などの特殊なもの）。丸だけの記号は、記号の一覧から手で置く
      { value: 'tr-3w-yyd', label: '三巻線変圧器 Y-Y-Δ結線', showIf: NOT_LIGHT_ONLY },
      { value: 'tr-3w-ddy', label: '三巻線変圧器 Δ-Δ-Y結線', showIf: NOT_LIGHT_ONLY },
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
    showIf: { all: [{ not: MIXED_V }, { not: THREE_WINDING }] },
    ask: 'ai-uncertain',
    required: true,
    help: '単相変圧器3台を組み合わせたΔ-Δ結線の場合は、3台の合計値を入力する',
  },
  // 三巻線変圧器は、巻線ごとに容量を書ける（どれも任意。入力した巻線だけ図面に書く）
  { id: 'trCapacityW1', group: 'transformer', label: '一次巻線の容量', type: 'number', unit: 'kVA', showIf: THREE_WINDING, ask: 'always', help: '三巻線変圧器の一次巻線（上）。入力しなくてもよい' },
  { id: 'trCapacityW2', group: 'transformer', label: '二次巻線の容量', type: 'number', unit: 'kVA', showIf: THREE_WINDING, ask: 'always', help: '三巻線変圧器の二次巻線（左下）。入力しなくてもよい' },
  { id: 'trCapacityW3', group: 'transformer', label: '三次巻線の容量', type: 'number', unit: 'kVA', showIf: THREE_WINDING, ask: 'always', help: '三巻線変圧器の三次巻線（右下）。入力しなくてもよい' },
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
    // 受電電圧は6600V（入力欄は無い。3300Vの現場は、電圧を手で入力する）。結線方式に合わせた電圧が最初から入る（単相三線式・V結線＝6600/210-105V、Y-Δ＝6600/210V、
    // ほかの結線方式は「6600/」だけ）。消しても書き換えてもよい
    autoValue: [
      { when: { all: [RECEIVING_NOT_3300, { key: 'trConnection', in: ['tr-1p', 'tr-vv'] }] }, value: '6600/210-105V' },
      { when: { all: [RECEIVING_NOT_3300, { key: 'trConnection', eq: 'tr-3p-yd' }] }, value: '6600/210V' },
      // 白紙で始めた案件は、用途を選んだあとに、先頭の「6600/」が入る
      { when: RECEIVING_NOT_3300, value: '6600/', afterAnswered: 'trUsage' },
    ],
    keepEmpty: true,
    ask: 'ai-uncertain',
  },
  { id: 'trComposition', group: 'transformer', label: '構成', type: 'text', placeholder: '単相変圧器×3', showIf: { key: 'trConnection', in: ['tr-3p-dd', 'tr-vv'] }, ask: 'always' },
  { id: 'trHasPc', group: 'transformer', label: '変圧器の手前にPC（高圧カットアウト）が入りますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  { id: 'trHasLbs', group: 'transformer', label: '変圧器の手前にLBSが入りますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain' },
  // 変圧器の枝の中の、VT・CT（第20弾・図面再現の診断から。受電側の開閉器が無いエリア（VEM）の、変圧器の手前のVT・CT）。付けた変圧器だけに付く
  { id: 'trHasVt', group: 'transformer', label: 'この変圧器の手前にVT（PF付）を付けますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain', help: 'この変圧器の枝の中に付ける。LBSがあれば、LBSの下で右へ分かれ、必ずPFが付く。主回路全体のVT（受電設備内のVT）とは別' },
  { id: 'trVtRatio', group: 'transformer', label: 'VTの変圧比', type: 'text', placeholder: '6600/110V', autoValue: [{ value: '6600/110V' }], showIf: { key: 'trHasVt', eq: 'yes' }, ask: 'always' },
  { id: 'trHasCt', group: 'transformer', label: 'この変圧器の手前にCTを付けますか？', type: 'select', options: YES_NO, defaultValue: 'no', ask: 'ai-uncertain', help: 'この変圧器の枝の中に付ける。LBSがあれば、LBSと変圧器のあいだに入る。主回路全体のCT（受電設備内のCT）とは別' },
  { id: 'trCtRatio', group: 'transformer', label: 'CTの変流比', type: 'text', placeholder: '40/5A', showIf: { key: 'trHasCt', eq: 'yes' }, ask: 'always', help: '数字だけ（40）なら、「40/5A」と書く' },

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
      required: true,
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
    required: true,
  },
  /*
   * 【背景知識メモ】定格電圧の入力例（placeholder）が、2つ並んでいる理由（第15弾 項目3。画面には出さない）。
   * 入力例は、入力欄が空のときだけ薄く出る見本で、実際の値としては入らない・図面には出ない。同じ入力欄で、古い設備も新しい設備も答える（欄を分けない）。
   *
   * ・改定前（6600V定格の時代）：リアクトルなしで、コンデンサ単体で使うことが多かった。ただし、6600V定格に合わせた229Vのリアクトルを
   *   接続する場合もあった。その場合は、リアクトルがコンデンサの電圧を上げるため、コンデンサの端子電圧が、定格の6600Vを上回る。
   *   その結果、表記の容量（例：100kvar）よりも、少ない無効電力（例：約94kvar）しか出せなかった。
   * ・改定後（7020V定格）：コンデンサに、容量の6%のリアクトルを直列につなぐ。リアクトルとコンデンサは位相が逆なので、リアクトルが
   *   電圧を打ち消す形になり、コンデンサの端子電圧は、回路電圧より6%上がる。6600V ÷ 0.94 ≒ 7021V。世の中のコンデンサは、
   *   有効数字3桁で「7020V」と表記しているので、アプリでも「7020V」と記載する。
   * ・リアクトルの定格電圧は、線間ではなく、相電圧。コンデンサの端子電圧（7021V）の6%が、相にかかる：7021V ÷ √3 × 6% ≒ 243V。
   *   6600V定格の場合は、6600V ÷ √3 × 6% ≒ 229V。コンデンサの端子電圧とリアクトルの電圧をベクトルで合成すると、ちょうど回路電圧の6600Vになる。
   * ・容量：7020V定格のコンデンサは、106kvarと表記され、6%のリアクトル（約6.38kvar）で消費される分を引いても、約100kvarの
   *   進み無効電力を確保できる。
   * この違いが、見本の数字（コンデンサ 7020V／6600V、リアクトル 243V／229V、容量 3φ106kvar／3φ6.38kvar）の理由。
   */
  // 容量もリアクトルの有無も、コンデンサ1台ごとに違う（4台あって1台だけリアクトル付き、もある）
  {
    // 任意。どんな値でも入れてよい（新しいものは7020V、古いものは6600Vのことがある。値の範囲で、エラーにしない）
    id: 'capacitorRatedVoltage',
    group: 'compensation',
    label: 'コンデンサの定格電圧',
    type: 'text',
    placeholder: '7020V , 6600V',
    showIf: { key: 'hasCapacitor', eq: 'yes' },
    ask: 'always',
    help: '現場のとおりに入れる（7020V・6600Vなど、どの値でもよい）。数字だけなら、図面には「7020V」と書く。空欄でもよい',
  },
  {
    id: 'capacitorCapacity',
    group: 'compensation',
    label: 'コンデンサの容量',
    type: 'text',
    placeholder: '3φ106kvar',
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
    // 任意。どんな値でも入れてよい（243Vでないものもある。値の範囲で、エラーにしない）
    id: 'reactorRatedVoltage',
    group: 'compensation',
    label: 'リアクトルの定格電圧',
    type: 'text',
    placeholder: '243V , 229V',
    showIf: { key: 'hasReactor', eq: 'yes' },
    ask: 'always',
    help: '現場のとおりに入れる（243Vなど、どの値でもよい）。数字だけなら、図面には「243V」と書く。空欄でもよい',
  },
  {
    id: 'reactorCapacity',
    group: 'compensation',
    label: 'リアクトルの容量',
    type: 'text',
    placeholder: '3φ6.38kvar',
    showIf: { key: 'hasReactor', eq: 'yes' },
    ask: 'always',
  },
];
