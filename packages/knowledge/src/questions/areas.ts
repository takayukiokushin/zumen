import type { Question, Choice } from './types.ts';
import type { Condition } from '../condition.ts';
import { FUSE_CURRENT_OPTIONS, TRANSFORMER_CHOICES, YES_NO_Q, connectionCableQuestions } from './common.ts';
import { LINK_PART_MAX, linkPartKey, linkPartPositions } from '../link-parts.ts';

/**
 * 送り出しの開閉器の選択肢（段ごとに同じ。第13弾 項目55 修正19・段階2）。
 * 並び：なし → DS → VCB → LBS（パワーヒューズ付き）→ VCS → DS＋VCB → DS＋VCB＋VCS → VCB＋VCS → LBS＋VCS。低圧用は入れない
 */
const linkSwitchOptions = (first: boolean): Choice[] => [
  { value: 'none', label: first ? 'なし（母線から直接）' : 'なし' },
  { value: 'ds', label: 'DS' },
  { value: 'vcb', label: 'VCB' },
  { value: 'lbs', label: 'LBS' },
  { value: 'vcs', label: 'VCS' },
  { value: 'ds-vcb', label: 'DS＋VCB' },
  { value: 'ds-vcb-vcs', label: 'DS＋VCB＋VCS' },
  { value: 'vcb-vcs', label: 'VCB＋VCS' },
  { value: 'lbs-vcs', label: 'LBS＋VCS' },
];
/** 何段目まであるか（k段目の質問を出す条件。段の数は、「変圧器の二次側」から送り出すときだけ選べる） */
const stageCond = (k: number): Condition => ({
  all: [{ key: 'areaNo', gt: 1 }, { key: 'linkTap', eq: 'tr-secondary' }, { key: 'linkStageCount', in: [2, 3, 4].filter((n) => n >= k).flatMap((n) => [String(n), n]) }],
});

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
    noTrend: true,
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
      { value: 'tr-secondary', label: '変圧器の二次側' },
    ],
    showIf: { key: 'areaNo', gt: 1 },
    ask: 'always',
    required: true,
    help: 'このエリア（送り出す側）の、どこから、この送り先へ線を出すか。変圧器の手前は、高圧母線として扱う。「変圧器の二次側」を選ぶと、何台目の変圧器かを、次の質問で選ぶ（二次側が高圧のとき）',
  },
  {
    // 「変圧器の二次側」から送り出すときだけ（第13弾 項目55 修正19）。台数より大きい番号は、最後の台に寄せる
    id: 'linkSourceTr',
    noTrend: true,
    group: 'link',
    label: '何台目の変圧器の二次側ですか？',
    type: 'select',
    options: TRANSFORMER_CHOICES.slice(1),
    defaultValue: '1',
    dropdown: true,
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkTap', eq: 'tr-secondary' }] },
    ask: 'always',
    help: '送り出す側のエリアの、何台目の変圧器か。台数より大きい番号は、最後の台に寄せる。二次側が高圧（600Vを超える）の変圧器から送り出す。二次側が低圧（600V以下）のときは、注意を出す',
  },
  {
    // 「変圧器の二次側」から送り出すときだけ。開閉器と線（電線・ケーブル）を、段にして、何段かつなぐ（最大4段。第13弾 項目55 修正19・段階2）
    id: 'linkStageCount',
    noTrend: true,
    group: 'link',
    label: '何段つなぎますか？',
    type: 'select',
    options: [1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}段` })),
    defaultValue: '1',
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkTap', eq: 'tr-secondary' }] },
    ask: 'always',
    help: '1段は、「開閉器 → 線（電線またはケーブル）」の1組。1段目は、下の「この送り先へは、ケーブルでつなぎますか？」「送り出しに開閉器はありますか？」で答える。2段以上のときは、2段目からの質問が、このあと（いちばん下）に出る',
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
    options: linkSwitchOptions(true),
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
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkSwitch', in: ['lbs', 'lbs-vcs'] }] },
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
    showIf: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkGroundStage', gt: 0 }] },
    ask: 'always',
    help:
      '送り出しの開閉器に、VCB・LBSが含まれるときだけ答える（DS・VCSだけでは遮断できない）。段が2つ以上のときは、はじめにVCB・LBSがある段の開閉器に付く。DGRは、送り出す側のエリアにZPDがあるときだけ描く。GRは、ZCTだけで動くので、ZPDは要らない。' +
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
      all: [{ key: 'areaNo', gt: 1 }, { any: [{ key: 'linkGroundRelay', eq: 'gr' }, { all: [{ key: 'linkGroundRelay', eq: 'dgr' }, { key: 'linkSenderZpd', eq: 'yes' }] }] }, { key: 'linkGroundStage', gt: 0 }],
    },
    ask: 'always',
    help: 'ほとんどのケースは、高圧ケーブル（初期値）。母線を選ぶと、送り出しの開閉器の一次側（手前）または二次側（すぐ後ろ）に、ZCTを描く',
  },
  ...[2, 3, 4].flatMap((k): Question[] => stageQuestions(k)),
  ...partQuestions(),
];

/**
 * 2段目〜4段目の質問（開閉器と、線）。1段目と同じ質問・同じ選択肢。小見出しは「2段目」など
 * （1段目のものと同じ文言は、同じ訳を使う）
 */
function stageQuestions(k: number): Question[] {
  const sec = `${k}段目`;
  const when = stageCond(k);
  const p = `link${k}`;
  return [
    {
      id: `${p}Switch`, noTrend: true, group: 'link', section: sec,
      label: '送り出しに開閉器はありますか？', type: 'select', options: linkSwitchOptions(false), defaultValue: 'none', dropdown: true, showIf: when, ask: 'always',
      help: `${k}段目の開閉器。VCSの入る組み合わせも選べる。低圧用の開閉器は、選べない`,
    },
    {
      id: `${p}FuseCurrent`, noTrend: true, group: 'link', section: sec,
      label: 'LBSのパワーヒューズの容量（定格電流）', type: 'select', options: FUSE_CURRENT_OPTIONS, allowFreeInput: true, dropdown: true, unit: 'A',
      showIf: { all: [when, { key: `${p}Switch`, in: ['lbs', 'lbs-vcs'] }] }, ask: 'always',
      help: 'LBSのときだけ聞く。LBSには、パワーヒューズ（PF）が付く。図面には「PF 30A」のように書く。分からなければ、空欄にする',
    },
    {
      id: `${p}Cable`, noTrend: true, group: 'link', section: sec,
      label: 'この送り先へは、ケーブルでつなぎますか？', type: 'select', options: YES_NO_Q, defaultValue: 'yes', showIf: when, ask: 'always',
      help: `${k}段目の線を、ケーブル（高圧ケーブル）でつなぐかどうか。「いいえ」のときは、電線（端末のない、ふつうの線）`,
    },
    ...connectionCableQuestions({ prefix: p, group: 'link', section: sec, when: { all: [when, { key: `${p}Cable`, ne: 'no' }] } }).map((q) => ({ ...q, noTrend: true })),
  ];
}

/**
 * 送り出しの途中に付ける部品（VT・CT・ZPD・GC）の質問。最大6個。個数が0のときは、なにも聞かない
 * （第13弾 項目55 修正19・段階3-1）。位置は、いまの構成にある位置だけを選べる
 */
function partQuestions(): Question[] {
  const base: Condition = { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkTap', eq: 'tr-secondary' }] };
  // VTの変圧比：送り出しのケーブルが3300Vなら 3300/110V、それ以外は 6600/110V
  const volt3300: Condition = { any: ['link', 'link2', 'link3', 'link4'].map((p) => ({ key: `${p}CableVoltage`, in: ['3300', 3300] })) };
  const out: Question[] = [
    {
      id: 'linkPartCount',
      noTrend: true,
      group: 'link',
      label: '途中に付ける機器（VT・CT・ZPD・GC）は何個ですか？',
      type: 'select',
      options: Array.from({ length: LINK_PART_MAX + 1 }, (_, i) => ({ value: String(i), label: i === 0 ? '0（なし）' : `${i}個` })),
      defaultValue: '0',
      showIf: base,
      ask: 'always',
      help: '送り出しの途中（変圧器の出口・開閉器・線のあと）に、VT・CT・ZPD・GCを付けるとき、その個数。最大6個。0のときは、なにも付けない',
    },
  ];
  for (let n = 1; n <= LINK_PART_MAX; n++) {
    const sec = `途中の機器${n}`;
    const here: Condition = { all: [base, { key: 'linkPartCount', gt: n - 1 }] };
    const kind = (k: string): Condition => ({ all: [here, { key: linkPartKey(n, 'Kind'), eq: k }] });
    const q = (x: Omit<Question, 'group' | 'section' | 'noTrend' | 'ask'>): Question => ({ ...x, group: 'link', section: sec, noTrend: true, ask: 'always' });
    out.push(
      q({
        id: linkPartKey(n, 'Kind'), label: '機器の種類は？', type: 'select', dropdown: true,
        options: [{ value: 'vt', label: 'VT' }, { value: 'ct', label: 'CT' }, { value: 'zpd', label: 'ZPD' }, { value: 'gc', label: 'GC（接地コンデンサ）' }],
        defaultValue: 'vt', showIf: here,
        help: 'VTには、必ずヒューズ（PF）が付く。ZPDは、OVGRを一緒に描くか選べる。GCは、接地コンデンサ',
      }),
      q({
        id: linkPartKey(n, 'Pos'), label: '付ける位置は？', type: 'select', dropdown: true,
        options: linkPartPositions().map((o) => ({ value: o.value, label: o.label, ...(o.open ? { showIf: o.open } : {}) })),
        defaultValue: 'tr', showIf: here,
        help: '送り出しの途中の、どこに付けるか。その段の開閉器が「なし」、または線が「電線」のときは、その位置は選べない',
      }),
      q({
        id: linkPartKey(n, 'VtCount'), label: 'VTの台数', type: 'select', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }], defaultValue: '2', unit: '台',
        showIf: kind('vt'), help: '2台のときは、図面に「VT＋PF×2」のように書く',
      }),
      q({
        id: linkPartKey(n, 'VtRatio'), label: 'VTの変圧比', type: 'text', placeholder: '6600/110V',
        autoValue: [{ when: volt3300, value: '3300/110V' }, { value: '6600/110V' }],
        showIf: kind('vt'),
      }),
      q({
        id: linkPartKey(n, 'VtConn'), label: 'VTの接続', type: 'select',
        options: [{ value: 'independent', label: '独立（それぞれ別に接続）' }, { value: 'v', label: 'V結線' }],
        autoValue: [{ when: { key: linkPartKey(n, 'VtCount'), in: ['2', 2] }, value: 'v' }, { value: 'independent' }],
        showIf: { all: [kind('vt'), { key: linkPartKey(n, 'VtCount'), gt: 1 }] },
        help: 'V結線のときは、図面に「V結線」と書く',
      }),
      q({
        id: linkPartKey(n, 'CtRatio'), label: 'CTの変流比', type: 'text', placeholder: '100/5A', showIf: kind('ct'),
        help: '数字だけ（100）なら、「100/5A」と書く',
      }),
      q({
        id: linkPartKey(n, 'Ovgr'), label: 'OVGR（地絡過電圧継電器）も描きますか？', type: 'select', options: YES_NO_Q, defaultValue: 'no', showIf: kind('zpd'),
        help: 'ZPDにつなぐOVGRを、ZPDの横に描く',
      }),
    );
  }
  return out;
}
