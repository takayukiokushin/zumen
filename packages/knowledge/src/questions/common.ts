import type { Choice, Question } from './types.ts';
import type { Condition } from '../condition.ts';

/** 台数・回線数などを選ぶための 1〜50 の一覧。一覧にない数は手入力できる */
export const COUNT_OPTIONS: Choice[] = Array.from({ length: 50 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

/** 変圧器の用途で、結線方式の選択肢を絞るための条件 */
export const NOT_POWER_ONLY: Condition = { not: { key: 'trUsage', eq: '動力' } };
export const NOT_LIGHT_ONLY: Condition = { not: { key: 'trUsage', eq: '電灯' } };
/** 用途が「電灯および動力」で、結線方式がV結線のとき（容量を電灯・動力に分けて聞く） */
/**
 * 受電電圧が、3300Vではないとき（＝6600V。いまは、受電電圧を入力する欄は無く、新しい案件は、いつも6600Vとして扱う）。
 * 受電電圧を入力する欄があったころに、3300Vで保存した案件（回答に receivingVoltage が残っているもの。文字か数で入っている）だけは、
 * これまでどおり、変圧器の電圧を自動では入れない。
 */
export const RECEIVING_NOT_3300: Condition = { not: { key: 'receivingVoltage', in: ['3300', 3300] } };
export const MIXED_V: Condition = {
  all: [{ key: 'trUsage', eq: '電灯・動力' }, { key: 'trConnection', eq: 'tr-vv' }],
};

/** 結線方式が三巻線変圧器のとき（容量を、一次・二次・三次の巻線ごとに聞く） */
export const THREE_WINDING: Condition = { key: 'trConnection', in: ['tr-3w-yyd', 'tr-3w-ddy'] };

/** 引込ケーブルがあるとき（「なし」と答えたとき以外。まだ答えていないときは、あるものとして聞く） */
export const CABLE_EXISTS: Condition = { not: { key: 'cableInstallation', eq: 'none' } };

/**
 * 送り出しの開閉器を聞くエリア：エリアが2か所以上のとき、最後のエリア以外（最後のエリアから送り出すことは無い）。
 * 1か所目は、areaNo が入っていない（2か所目以降は、areaNo が入っている）
 */
export const SENDOUT_SHOWN: Condition = {
  any: [
    { all: [{ not: { key: 'areaNo', gt: 1 } }, { key: 'areaCount', gt: 1 }] },
    ...Array.from({ length: 8 }, (_, i) => ({ all: [{ key: 'areaNo', eq: i + 2 }, { key: 'areaCount', gt: i + 2 }] }) as Condition),
  ],
};

export const YES_NO: Choice[] = [
  { value: 'yes', label: 'あり' },
  { value: 'no', label: 'なし' },
];

/** 「〜ですか？」と尋ねる質問は「あり／なし」ではなく「はい／いいえ」で答える */
export const YES_NO_Q: Choice[] = [
  { value: 'yes', label: 'はい' },
  { value: 'no', label: 'いいえ' },
];

/* 開閉器とヒューズの定格電流。一覧から選べて、手入力もできる */
export const amps = (...vals: string[]): Choice[] => vals.map((v) => ({ value: v, label: v }));
export const PC_RATINGS = amps('30A', '50A', '100A');
export const PC_FUSES = amps('5A', '7.5A', '10A', '12.5A', '15A', '20A', '25A', '30A', '50A', '60A', '75A', '100A');
export const LBS_RATINGS = amps('100A', '200A', '300A', '400A');
export const PF_RATINGS = amps('5A', '7.5A', '10A', '15A', '20A', '30A', '40A', '50A', '60A', '75A', '100A');
export const LOAD_AMPS = amps('5A', '10A', '15A', '20A', '30A', '40A', '50A', '75A', '100A');
export const SHORT_CIRCUIT = amps('12.5kA', '20kA', '31.5kA', '40kA');
/** パワーヒューズの負荷側。つなぐ相手で記号が変わる */
export const PF_LOAD_KIND: Choice[] = [
  { value: 'T', label: 'T（変圧器）' },
  { value: 'C', label: 'C（コンデンサ）' },
  { value: 'M', label: 'M（モーター）' },
];

/**
 * PC と LBS の定格を聞く質問を作る。
 * 変圧器の手前・コンデンサの手前で同じことを聞くので、ひな形から作る。
 */
export function breakerRatings(
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
      id: P('LbsVoltage'), group, label: 'LBS本体の定格電圧', type: 'select',
      options: [{ value: '7200', label: '7200V' }, { value: '6600', label: '6600V' }],
      allowFreeInput: true, defaultValue: '7200', showIf: hasLbs, ask: 'always',
      help: 'ふつうは7200V。図面には「7200V 200A」のように、定格電流と並べて書く',
    },
    {
      id: P('LbsRating'), group, label: 'LBS本体の定格電流', type: 'select',
      options: LBS_RATINGS, allowFreeInput: true, defaultValue: '200A',
      showIf: hasLbs, ask: 'always',
      help: 'ふつうは200A。図面には「200A」のように、記号なしで書く',
    },
    {
      id: P('PfG'), group, label: 'パワーヒューズ（PF）の定格電流（G）', type: 'select',
      options: PF_RATINGS, allowFreeInput: true, showIf: hasLbs, ask: 'always',
      help: '図面には「G50A」のように、先頭にGを付けて書く',
    },
    {
      id: P('PfLoad'), group, label: 'PFの負荷側につなぐもの', type: 'select',
      // 3つのボタンを並べると、1行に収まらず、縦に伸びる。ふだんは標準のまま使うので、プルダウンにする
      options: PF_LOAD_KIND, defaultValue: defaultLoad, dropdown: true,
      showIf: hasLbs, ask: 'always',
      help: `${cap}につなぐので、ふつうは「${defaultLoad}」`,
    },
    {
      id: P('PfLoadAmp'), group, label: 'パワーヒューズの用途ごとの定格電流', type: 'select',
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
export const TRANSFORMER_CHOICES = [
  { value: 'none', label: 'つながない（単独で置く）' },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}台目` })),
];

/** 継電器の個数（0個もありうる） */
export const RELAY_COUNT_OPTIONS: Choice[] = Array.from({ length: 9 }, (_, i) => ({ value: String(i), label: String(i) }));

/** VCBの継電器として選べる種類（GR・DGRはPAS、OVGRはZPDの有無の質問で答えるので、ここには入れない） */
export const RELAY_CHOICES: Choice[] = [
  ['OCR', '過電流継電器'],
  ['UVR', '不足電圧継電器'],
  ['OVR', '過電圧継電器'],
  ['OCGR', '地絡過電流継電器'],
  ['UFR', '不足周波数継電器'],
  ['OFR', '過周波数継電器'],
  ['RPR', '逆電力継電器'],
  ['UPR', '不足電力継電器'],
  ['DSR', '短絡方向継電器'],
  ['2E', '電動機保護継電器（2要素）'],
  ['3E', '電動機保護継電器（3要素）'],
].map(([value, name]) => ({ value: value!, label: `${value}（${name}）` }));
