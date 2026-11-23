import type { Condition } from '../condition.ts';
import type { Choice, Question } from './types.ts';
import { GS_CURRENTS, GS_VOLTAGES, YES_NO, connectionCableQuestions } from './common.ts';

/**
 * 変圧器・高圧コンデンサ（進相設備）・高圧の発電機の、電源側の高圧ケーブル（第18弾 F）。
 *
 * 入力の流れ（それぞれの機器の、手前のPC・LBSの質問の前に出る）：
 *   「電源側に、高圧ケーブルがありますか？」（最初は「あり」だけ） → 「あり」を選ぶと、
 *   ケーブルの手前の開閉器（1つ目〜3つ目。選んだ順に、上から並ぶ） → ケーブルの入力欄（引込・電動機・エリア間と同じ部品）
 *   → ケーブルのあとの開閉器（1つ目〜3つ目）。
 * 開閉器は、「DS＋LBS」「LBS＋VCS」「DS＋LBS＋VCS」のような組み合わせを、選ぶ順番で作る（組み合わせごとの選択肢は持たない）。
 * 同じ開閉器は、1つの並びに、2回は選べない。ケーブルの途中には、何も入れない（ZCT以外は入れない決まり）。
 */

/** 開閉器の選択肢（1つ目〜3つ目で共通）。「なし」を選ぶと、そのあとの欄は出ない */
const SWITCHES: Choice[] = [
  { value: 'ds', label: 'DS' },
  { value: 'vcb', label: 'VCB' },
  { value: 'lbs', label: 'LBS（PF付）' },
  { value: 'lbs-plain', label: 'LBS（PFなし）', share: '実務では、ほとんど使わない' },
  { value: 'vcs', label: 'VCS' },
  { value: 'as', label: 'AS（気中開閉器）' },
  { value: 'gs', label: 'GS（ガス開閉器）' },
];

interface Device {
  /** 質問IDの先頭（tr・cap・gen） */
  p: 'tr' | 'cap' | 'gen';
  group: string;
  /** その機器があるとき */
  base?: Condition;
  label: string;
  help: string;
  /** この質問を、この質問IDの後ろに入れる（その機器の、手前のPC・LBSなどの質問の後ろ） */
  after: string;
}

const DEVICES: Device[] = [
  {
    p: 'tr',
    group: 'transformer',
    label: '変圧器の電源側に、高圧ケーブルがありますか？',
    help: '母線から変圧器までの間に、高圧ケーブルがあるとき（オープンフレーム式の電気室で、離れた場所の変圧器へ、ケーブルで送る場合など）。「あり」を押すと、ケーブルの手前・あとの開閉器と、ケーブルの入力欄が出る。ふだんは、何も押さなくてよい',
    after: 'trHasLbs',
  },
  {
    p: 'cap',
    group: 'compensation',
    base: { key: 'hasCapacitor', eq: 'yes' },
    label: 'このコンデンサの電源側に、高圧ケーブルがありますか？',
    help: '母線からコンデンサ（リアクトル）までの間に、高圧ケーブルがあるとき。「あり」を押すと、ケーブルの手前・あとの開閉器と、ケーブルの入力欄が出る。ふだんは、何も押さなくてよい',
    after: 'capHasVcs',
  },
  {
    p: 'gen',
    group: 'generator',
    base: { key: 'generatorTransformer', eq: 'bus' },
    label: 'この発電機の電源側に、高圧ケーブルがありますか？',
    help: '高圧母線から発電機までの間に、高圧ケーブルがあるとき（接続先が「高圧母線から接続する」のときだけ）。「あり」を押すと、ケーブルの手前・あとの開閉器と、ケーブルの入力欄が出る。ふだんは、何も押さなくてよい',
    after: 'generatorTransformer',
  },
];

const all = (...c: (Condition | undefined)[]): Condition => ({ all: c.filter((x): x is Condition => x !== undefined) });

/** 開閉器の欄（1つ目〜3つ目）。ケーブルの手前（Up）・あと（Dn）。has：ケーブルがあるとき。help1：1つ目の説明 */
export function cableSwitchSlots(o: { p: string; group: string; section: string; has: Condition; side: 'Up' | 'Dn'; help1: string }): Question[] {
  const { p, side } = o;
  return [1, 2, 3].map((k): Question => {
    const id = `${p}Cable${side}${k}`;
    const earlier = [1, 2, 3].filter((n) => n < k).map((n) => `${p}Cable${side}${n}`);
    return {
      id,
      noTrend: true,
      group: o.group,
      section: o.section,
      label: side === 'Up' ? `ケーブルの手前の開閉器（${k}つ目）` : `ケーブルのあとの開閉器（${k}つ目）`,
      type: 'select',
      // 前の欄で選んだ開閉器は、選べない（同じ並びに、2回は入らない）
      options: [
        { value: 'none', label: 'なし' },
        ...SWITCHES.map((c) => ({ ...c, ...(earlier.length > 0 ? { showIf: { all: earlier.map((e) => ({ not: { key: e, eq: c.value } })) } as Condition } : {}) })),
      ],
      defaultValue: 'none',
      dropdown: true,
      // 1つ目は、ケーブルが「あり」のとき。2つ目以降は、前の欄で開閉器を選んだとき
      showIf: all(o.has, ...(k > 1 ? [{ key: `${p}Cable${side}${k - 1}`, in: SWITCHES.map((c) => c.value) } as Condition] : [])),
      ask: 'always',
      help: k === 1 ? o.help1 : `${k - 1}つ目の次に付く開閉器。付かないときは「なし」`,
    };
  });
}

/**
 * GS（ガス開閉器）の定格（第20弾・図面再現の診断から）。その機器の高圧ケーブルの開閉器に、GSがあるときだけ聞く。
 * 図面には、GSの文字の下に、「7200V 200A」の形（電圧と電流のあいだは半角スペース1つ）で書く。電流が不明なら「7200V -A」。
 * その機器のGSには、すべて同じ定格を書く（GSが2つ以上あるときは、図面で、文字を手で直す）
 */
export function gsRatingQuestions(o: { p: string; group: string; section: string; has: Condition; slots: string[] }): Question[] {
  const anyGs: Condition = all(o.has, { any: o.slots.map((k) => ({ key: k, eq: 'gs' }) as Condition) });
  const base = { noTrend: true, group: o.group, section: o.section, type: 'select' as const, dropdown: true, allowFreeInput: true, showIf: anyGs, ask: 'always' as const };
  return [
    { ...base, id: `${o.p}GsVoltage`, label: 'GSの定格電圧', options: GS_VOLTAGES, help: '任意。図面には、GSの文字の下に、「7200V 200A」のように書く（電圧と電流のあいだは半角スペース1つ）' },
    { ...base, id: `${o.p}GsCurrent`, label: 'GSの定格電流', options: GS_CURRENTS, help: '任意。不明なときは「-A（未記入）」。図面には「7200V -A」のように書く' },
  ];
}

function questionsOf(d: Device): Question[] {
  const has = `${d.p}HasCable`;
  const hasCable: Condition = all(d.base, { key: has, eq: 'yes' });
  const slots = (side: 'Up' | 'Dn'): Question[] =>
    cableSwitchSlots({
      p: d.p,
      group: d.group,
      section: '高圧ケーブル',
      has: hasCable,
      side,
      help1:
        side === 'Up'
          ? '母線から、ケーブルの電源側の端末までの間に付く開閉器。上から、選んだ順に並ぶ（「DS＋LBS」「LBS＋VCS」「DS＋LBS＋VCS」など。1つ目に、いちばん母線に近いものを選ぶ）。付かないときは「なし」'
          : 'ケーブルの機器側の端末から、機器（手前のPC・LBSがあれば、その手前）までの間に付く開閉器。上から、選んだ順に並ぶ（「DS＋LBS」「LBS＋VCS」「DS＋LBS＋VCS」など）。付かないときは「なし」',
    });
  return [
    fromQuestion(d.p, d.group, d.base),
    {
      id: has,
      group: d.group,
      label: d.label,
      type: 'select',
      options: YES_NO,
      defaultValue: 'no',
      ...(d.base ? { showIf: d.base } : {}),
      ask: 'ai-uncertain',
      help: d.help,
    },
    ...slots('Up'),
    // ケーブルの入力欄（種類・構造・定格電圧・断面積・長さ・約）は、引込・電動機・エリア間と同じ部品
    ...connectionCableQuestions({ prefix: d.p, group: d.group, section: '高圧ケーブル', when: hasCable }),
    ...slots('Dn'),
    ...gsRatingQuestions({ p: d.p, group: d.group, section: '高圧ケーブル', has: hasCable, slots: [1, 2, 3].flatMap((k) => [`${d.p}CableUp${k}`, `${d.p}CableDn${k}`]) }),
  ];
}

/**
 * 接続元の質問（第18弾 F-②）：「母線から」（初めから選ばれている）か、すでに入力した、ほかの機器の開閉器の二次側から。
 * 選択肢の「ほかの機器の開閉器」は、入力画面が、入力の内容から、自動で作る（rows.ts の sectionRows）ので、ここには「母線から」だけ書く。
 * 選べる開閉器が1つも無いときは、この質問は出さない。AIは答えない（選択肢が、入力の内容で変わるため）。
 */
export const fromQuestion = (p: string, group: string, showIf?: Condition): Question => ({
  id: `${p}From`,
  noAi: true,
  noTrend: true,
  group,
  label: 'どこから接続しますか？',
  type: 'select',
  options: [{ value: 'bus', label: '母線から' }],
  defaultValue: 'bus',
  dropdown: true,
  ...(showIf ? { showIf } : {}),
  ask: 'always',
  help: 'ふつうは「母線から」。ほかの機器の開閉器の二次側から分かれて出ているときだけ、その開閉器を選ぶ（自分より前に入力した機器の開閉器だけ選べる。たとえば、1台のVCBの二次側から、3台の変圧器へ、ケーブルで分かれる場合）。選べる開閉器が無いときは、この質問は出ない',
});

/** 機器ごとの質問の組：その質問IDの後ろに入れる。電動機は、ケーブルの質問がすでにあるので、「ケーブルのあとの開閉器」だけを足す（母線から接続するときだけ） */
export const DEVICE_CABLE_QUESTIONS: { after: string; questions: Question[] }[] = [
  ...DEVICES.map((d) => ({ after: d.after, questions: questionsOf(d) })),
  {
    // 電動機：接続元が「母線から分岐して接続する」のとき。選んだ接続元の質問のすぐあとに出す
    after: 'motorSourceTr',
    questions: [fromQuestion('motor', 'motor', { key: 'motorSource', eq: 'bus' })],
  },
  {
    after: 'motorFuseCurrent',
    questions: [
      ...cableSwitchSlots({
        p: 'motor',
        group: 'motor',
        section: '接続元',
        has: { all: [{ key: 'motorSource', eq: 'bus' }, { key: 'motorCable', eq: 'yes' }] },
        side: 'Dn',
        help1: 'ケーブルの電動機側の端末から、電動機までの間に付く開閉器。上から、選んだ順に並ぶ（「DS＋LBS」「LBS＋VCS」など）。付かないときは「なし」。母線から接続するときだけ',
      }),
      // 電動機のケーブルのあとの開閉器に、GSがあるとき：その定格
      ...gsRatingQuestions({ p: 'motor', group: 'motor', section: '接続元', has: { all: [{ key: 'motorSource', eq: 'bus' }, { key: 'motorCable', eq: 'yes' }] }, slots: ['motorCableDn1', 'motorCableDn2', 'motorCableDn3'] }),
    ],
  },
];

/** 質問の並び questions に、機器ごとの高圧ケーブルの質問を、それぞれの位置（after の質問の後ろ）に入れた並びを返す */
export function withDeviceCableQuestions(questions: Question[]): Question[] {
  const out: Question[] = [];
  for (const q of questions) {
    out.push(q);
    for (const g of DEVICE_CABLE_QUESTIONS) if (g.after === q.id) out.push(...g.questions);
  }
  return out;
}
