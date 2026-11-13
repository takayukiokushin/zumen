import type { Question } from './types.ts';
import type { Condition } from '../condition.ts';
import { BUS_SWITCH_OPTIONS, FUSE_CURRENT_OPTIONS, YES_NO_Q, connectionCableQuestions } from './common.ts';

/** 質問の定義：表題欄、エリア間の接続（分岐する位置・ケーブル・送り出す側の開閉器。送り先ごとに、送り出す側の欄で入力する） */
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


  /* ---------------- エリア間の接続（2か所目以降のエリアごとに持つ。入力画面では、送り出す側のエリアの欄に出す） ---------------- */
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
    help: 'このエリア（送り出す側）の、どこから、この送り先へ線を出すか。変圧器の手前は、高圧母線として扱う',
  },
  {
    id: 'linkCable',
    group: 'link',
    label: 'この送り先へは、ケーブルでつなぎますか？',
    type: 'select',
    options: YES_NO_Q,
    defaultValue: 'yes',
    showIf: { key: 'areaNo', gt: 1 },
    ask: 'always',
    help: 'この送り先へ向かう線を、ケーブル（高圧ケーブル）でつなぐかどうか。「いいえ」のときも、つなぐ点は同じ（分岐する位置は答える）。違いは、ケーブルの図記号（端末の三角・点線・ケーブルの文字）を描かず、ふつうの線でつなぐこと',
  },
  // 途中のケーブルの入力欄（種類・構造・定格電圧・断面積・長さ・約）は、電動機の接続と同じ部品（connectionCableQuestions）
  ...connectionCableQuestions({ prefix: 'link', group: 'link', when: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkCable', ne: 'no' }] } }),
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
  /* ---- 送り出す側の開閉器（この送り先へ向かう線ごとに答える。第13弾 項目22） ---- */
  {
    id: 'linkSwitch',
    group: 'link',
    label: '送り出しに開閉器はありますか？',
    type: 'select',
    options: BUS_SWITCH_OPTIONS,
    defaultValue: 'none',
    dropdown: true,
    showIf: { key: 'areaNo', gt: 1 },
    ask: 'always',
    help: 'この送り先へ向かう線の、送り出す側の点に、母線から直接ではなく、開閉器が付いている場合がある。図面では、送り出す側のエリアから、この送り先へ向かう線の途中に描く。送り先ごとに答える',
  },
  {
    id: 'linkFuseCurrent',
    group: 'link',
    label: 'LBSのパワーヒューズの容量（定格電流）',
    type: 'select',
    options: FUSE_CURRENT_OPTIONS,
    allowFreeInput: true,
    dropdown: true,
    unit: 'A',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkSwitch', eq: 'lbs' }] },
    ask: 'always',
    help: '送り出しがLBSのときだけ聞く。LBSには、パワーヒューズ（PF）が付く。図面には「PF 30A」のように書く。分からなければ、空欄にする',
  },
  {
    // 送り出しの開閉器（VCB・LBS）に付く地絡継電器。DGRは、送り出す側のエリアにZPDがあるときだけ選べる
    id: 'linkGroundRelay',
    group: 'link',
    label: '送り出しの開閉器の地絡継電器は？',
    type: 'select',
    options: [
      { value: 'none', label: 'なし' },
      { value: 'dgr', label: 'DGR（方向性）　※ZPDが「あり」のときだけ描く' },
      { value: 'gr', label: 'GR（無方向性）' },
    ],
    defaultValue: 'none',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }] },
    ask: 'always',
    help:
      '送り出しの開閉器が、VCB・LBS・DS＋VCBのときだけ答える（DSだけでは遮断できない）。DGRは、送り出す側のエリアにZPDがあるときだけ描く。GRは、ZCTだけで動くので、ZPDは要らない。' +
      'DGR・GRを選ぶと、送り出しの高圧ケーブルにZCTを付け、継電器をZCTの横に描き、継電器から送り出しの開閉器まで、TC（遮断の線）を描く',
  },
  {
    // 送り出しの開閉器のDGRのZCTを、どこに付けるか。ほとんどは、高圧ケーブル（送り出しの高圧ケーブル）
    id: 'linkZctPos',
    group: 'link',
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
      all: [{ key: 'areaNo', gt: 1 }, { any: [{ key: 'linkGroundRelay', eq: 'gr' }, { all: [{ key: 'linkGroundRelay', eq: 'dgr' }, { key: 'linkSenderZpd', eq: 'yes' }] }] }, { key: 'linkSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }],
    },
    ask: 'always',
    help: 'ほとんどのケースは、高圧ケーブル（初期値）。母線を選ぶと、送り出しの開閉器の一次側（手前）または二次側（すぐ後ろ）に、ZCTを描く',
  },
];
