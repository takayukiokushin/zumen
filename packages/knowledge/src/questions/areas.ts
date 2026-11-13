import type { Question } from './types.ts';
import type { Condition } from '../condition.ts';
import { SENDOUT_SHOWN, YES_NO_Q } from './common.ts';

/** 質問の定義：表題欄、他のエリアへの送り出し、エリア間の接続 */
export const AREAS_QUESTIONS: Question[] = [
  /* ---------------- 表題欄 ---------------- */
  {
    id: 'drawingName',
    group: 'title',
    label: '図面名称',
    type: 'text',
    manualOnly: true,
    clearOnDuplicate: true,
    ask: 'always',
    help: '記載がなければ自動で表示させます。（例：キュービクル式高圧受電設備単線結線図）。ここに入力された場合は、この入力内容を優先して表示させます。',
  },


  /* ---------------- 他のエリアへの送り出し（1か所目のエリアの最後） ---------------- */
  {
    id: 'sendoutSwitch',
    group: 'sendout',
    label: '送り出しに開閉器はありますか？',
    type: 'select',
    options: [
      { value: 'none', label: 'なし（母線から直接）' },
      { value: 'ds', label: 'DS' },
      { value: 'vcb', label: 'VCB' },
      { value: 'lbs', label: 'LBS' },
      { value: 'ds-vcb', label: 'DS＋VCB' },
    ],
    defaultValue: 'none',
    dropdown: true,
    showIf: SENDOUT_SHOWN,
    ask: 'always',
    help: 'ほかのエリアは、このエリアから分岐することがある。その送り出す点に、母線から直接ではなく、開閉器が付いている場合がある。図面では、このエリアから、ほかのエリアへ向かう線の途中に描く。このエリアから送り出さないときは、「なし」のままでよい',
  },
  {
    id: 'sendoutFuseCurrent',
    group: 'sendout',
    label: 'LBSのパワーヒューズの容量（定格電流）',
    type: 'select',
    options: [10, 15, 20, 30, 40, 50, 75, 100, 150, 200].map((v) => ({ value: String(v), label: `${v}A` })),
    allowFreeInput: true,
    dropdown: true,
    unit: 'A',
    showIf: { all: [SENDOUT_SHOWN, { key: 'sendoutSwitch', eq: 'lbs' }] },
    ask: 'always',
    help: '送り出しがLBSのときだけ聞く。LBSには、パワーヒューズ（PF）が付く。図面には「PF 30A」のように書く。分からなければ、空欄にする',
  },

  {
    // 送り出しの開閉器（VCB・LBS）に付く地絡継電器。DGRは、同じエリアにZPDがあるときだけ選べる（GRは、後の項目で追加する）
    id: 'sendoutGroundRelay',
    group: 'sendout',
    label: '送り出しの開閉器の地絡継電器は？',
    type: 'select',
    options: [
      { value: 'none', label: 'なし' },
      { value: 'dgr', label: 'DGR（方向性）　※ZPDが「あり」のときだけ描く' },
      { value: 'gr', label: 'GR（無方向性）' },
    ],
    defaultValue: 'none',
    showIf: {
      all: [SENDOUT_SHOWN, { key: 'sendoutSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }],
    },
    ask: 'always',
    help:
      '送り出しの開閉器が、VCB・LBS・DS＋VCBのときだけ答える（DSだけでは遮断できない）。DGRは、このエリアにZPDがあるときだけ描く。GRは、ZCTだけで動くので、ZPDは要らない。' +
      'DGR・GRを選ぶと、送り出しの高圧ケーブルにZCTを付け、継電器をZCTの横に描き、継電器から送り出しの開閉器まで、TC（遮断の線）を描く',
  },

  {
    // 送り出しの開閉器のDGRのZCTを、どこに付けるか。ほとんどは、高圧ケーブル（送り出しの高圧ケーブル）
    id: 'sendoutZctPos',
    group: 'sendout',
    label: 'ZCT（DGR・GR用）の取り付け位置は？',
    type: 'select',
    options: [
      { value: 'cable', label: '高圧ケーブル（送り出しの高圧ケーブル）' },
      { value: 'bus-primary', label: '母線（送り出しの開閉器の一次側）' },
      { value: 'bus-secondary', label: '母線（送り出しの開閉器の二次側）' },
    ],
    defaultValue: 'cable',
    dropdown: true,
    showIf: {
      all: [SENDOUT_SHOWN, { any: [{ key: 'sendoutGroundRelay', eq: 'gr' }, { all: [{ key: 'sendoutGroundRelay', eq: 'dgr' }, { key: 'hasZpd', eq: 'yes' }] }] }, { key: 'sendoutSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }],
    },
    ask: 'always',
    help: 'ほとんどのケースは、高圧ケーブル（初期値）。母線を選ぶと、送り出しの開閉器の一次側（手前）または二次側（すぐ後ろ）に、ZCTを描く',
  },

  /* ---------------- エリア間の接続（2か所目以降のエリア） ---------------- */
  {
    id: 'linkCable',
    group: 'link',
    label: 'このエリアは、前のエリアからケーブルでつなぎますか？',
    type: 'select',
    options: YES_NO_Q,
    defaultValue: 'yes',
    showIf: { key: 'areaNo', gt: 1 },
    ask: 'always',
    help: 'エリアの間を、ケーブル（高圧ケーブル）でつなぐかどうか。「いいえ」のときも、ほかのエリアにつなぐ点は同じ（どこから分岐するか・分岐の位置は答える）。違いは、ケーブルの図記号（端末の三角・点線・ケーブルの文字）を描かず、ふつうの線でつなぐこと',
  },
  {
    id: 'linkFrom',
    group: 'link',
    label: 'どのエリアから分岐しますか？',
    type: 'select',
    // このエリアより前のエリアだけ選べる
    options: Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}か所目`, showIf: { key: 'areaNo', gt: i + 1 } as Condition })),
    defaultValue: '1',
    showIf: { key: 'areaNo', gt: 2 },
    ask: 'always',
    help: '3か所目以降は、1か所目からも、2か所目からも分岐できる',
  },
  {
    id: 'linkTap',
    group: 'link',
    label: '分岐する位置は？',
    type: 'select',
    dropdown: true,
    options: [
      { value: 'ds-source', label: 'DSの電源側（DSの手前）' },
      { value: 'ds-vcb', label: 'DSとVCBの間' },
      { value: 'vcb-load', label: 'VCBの負荷側（CTの下）' },
      { value: 'bus', label: '高圧母線（変圧器の手前）' },
    ],
    showIf: { key: 'areaNo', gt: 1 },
    ask: 'always',
    required: true,
    help: '前のエリアの、どこからケーブルを出すか。変圧器の手前は、高圧母線として扱う',
  },
  {
    id: 'linkCableInstallation',
    group: 'link',
    label: 'ケーブルは？',
    type: 'select',
    options: [
      { value: 'buried', label: '埋設（埋ケ）' },
      { value: 'overhead', label: '架空（架ケ）' },
      { value: 'none', label: '種類を書かない' },
    ],
    defaultValue: 'none',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] },
    ask: 'always',
  },
  {
    id: 'linkCableStructure',
    group: 'link',
    label: 'ケーブルの構造は？',
    type: 'select',
    options: [
      { value: 'CVT', label: 'CVT' },
      { value: 'CV', label: 'CV' },
    ],
    defaultValue: 'CVT',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] },
    ask: 'always',
  },
  {
    // 引込ケーブルの定格電圧と同じ選択肢・同じ初期値（6600V）
    id: 'linkCableVoltage',
    group: 'link',
    label: '定格電圧は？',
    type: 'select',
    dropdown: true,
    unit: 'V',
    options: [3300, 6600, 22000, 33000].map((v) => ({ value: String(v), label: `${v}V` })),
    defaultValue: '6600',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] },
    ask: 'always',
  },
  {
    id: 'linkCableCrossSection',
    group: 'link',
    label: '断面積は？',
    type: 'select',
    unit: 'mm2',
    options: [14, 22, 38, 60, 100, 150].map((v) => ({ value: String(v), label: `${v} mm2` })),
    allowFreeInput: true,
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] },
    ask: 'always',
    help: '一覧にない値は手入力できる',
  },
  {
    id: 'linkCableLength',
    group: 'link',
    label: '長さは？',
    type: 'number',
    unit: 'm',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] },
    ask: 'always',
    help: '不明な場合は空欄にする',
  },
  {
    id: 'linkCableLengthApprox',
    group: 'link',
    label: '長さに「約」を付ける',
    type: 'boolean',
    // 名前が途中で折り返されないよう、横幅をふつう（m）にする。既定値は置かない（未回答は「付けない」と同じ）
    size: 'm',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }, { key: 'linkCableLength', gt: 0 }] },
    ask: 'always',
    help: '歩測などで、きっちりした実測ではないとき。「約20m」と書かれる',
  },
  {
    // 任意。どこの変電所・出先へ送られているかが分かるように、送り出し側のケーブル端末の近くに書く（太さ・長さは、受け側に書く）
    id: 'linkName',
    group: 'link',
    label: '送り先名称（回路名称）',
    type: 'text',
    placeholder: '第2変電所 / ○○出先',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] },
    ask: 'always',
    help: '必要なときだけ入力する（任意）。図面では、送り出し側（電源側）のケーブル端末の近くに書く。太さ・長さは、これまでどおり、受け側に書く',
  },
];
