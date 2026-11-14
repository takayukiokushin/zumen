import type { Condition } from './condition.ts';

/**
 * 送り出しの途中に付ける部品（VT・CT・ZPD・GC）。第13弾 項目55 修正19・段階3-1
 *
 * 「変圧器の二次側」から送り出すときだけ付けられる。最大6個。
 * 付ける位置は、「変圧器の出口の次」「k段目の開閉器の次」「k段目の線の次」。
 * その段の開閉器が「なし」、または線が「電線」のときは、その位置は選べない（描かない）。
 */
export const LINK_PART_MAX = 6;
export const LINK_PART_KINDS = ['vt', 'ct', 'zpd', 'gc'] as const;
export type LinkPartKind = (typeof LINK_PART_KINDS)[number];

/** 質問IDの作り方（n：1始まり） */
export const linkPartKey = (n: number, name: 'Kind' | 'Pos' | 'VtCount' | 'VtRatio' | 'VtConn' | 'CtRatio' | 'Ovgr'): string => `linkPart${n}${name}`;

const stageCountIn = (k: number): Condition => ({
  key: 'linkStageCount',
  in: [1, 2, 3, 4].filter((n) => n >= k).flatMap((n) => [String(n), n]),
});
const switchKeyOf = (k: number) => (k <= 1 ? 'linkSwitch' : `link${k}Switch`);
const cableKeyOf = (k: number) => (k <= 1 ? 'linkCable' : `link${k}Cable`);

/** 「k段目の開閉器の次」（その段の開閉器があるとき）・「k段目の線の次」（その段の線がケーブルのとき）が、いま選べる位置か */
export const swSlotOpen = (k: number): Condition => ({ all: [stageCountIn(k), { key: switchKeyOf(k), ne: 'none' }] });
export const lineSlotOpen = (k: number): Condition => ({ all: [stageCountIn(k), { key: cableKeyOf(k), ne: 'no' }] });

/** 位置の値と、画面に出す名前 */
export const linkPartPositions = (): { value: string; label: string; open?: Condition }[] => [
  { value: 'tr', label: '変圧器の出口の次' },
  ...[1, 2, 3, 4].flatMap((k) => [
    { value: `sw${k}`, label: `${k}段目の開閉器の次`, open: swSlotOpen(k) },
    { value: `line${k}`, label: `${k}段目の線の次`, open: lineSlotOpen(k) },
  ]),
];

/** n個目の部品が、いま描けるか（個数の範囲内で、位置がいまの構成にある） */
export const linkPartOpen = (n: number): Condition => ({
  all: [
    { key: 'areaNo', gt: 1 },
    { key: 'linkTap', eq: 'tr-secondary' },
    { key: 'linkPartCount', gt: n - 1 },
    {
      any: [
        { key: linkPartKey(n, 'Pos'), eq: 'tr' },
        ...[1, 2, 3, 4].flatMap((k): Condition[] => [
          { all: [{ key: linkPartKey(n, 'Pos'), eq: `sw${k}` }, swSlotOpen(k)] },
          { all: [{ key: linkPartKey(n, 'Pos'), eq: `line${k}` }, lineSlotOpen(k)] },
        ]),
      ],
    },
  ],
});

/**
 * 送り出しの途中に付ける保護継電器（第13弾 項目55 修正19・段階3-2）。
 * 個数は聞かず、チェックボックスで「付けるもの」を選ぶ。よく使うもの（OCR・UVR・RPR）は最初から見える。
 * それ以外は「特殊な継電器を選ぶ」にチェックしたとき（または、どれかにチェックが入っているとき）だけ見える。
 * GR・DGRは段階2、OVGRはZPD（3-1）で選ぶので、ここには入れない。OCGRは、GRで足りるので入れない。
 * on：つなぐ先の機器（ct＝途中のCTの二次側／vt＝途中のVTの二次側）
 */
export interface LinkRelay { code: string; name: string; on: 'ct' | 'vt'; special: boolean }
export const LINK_RELAYS: readonly LinkRelay[] = [
  { code: 'OCR', name: '過電流継電器', on: 'ct', special: false },
  { code: 'UVR', name: '不足電圧継電器', on: 'vt', special: false },
  { code: 'RPR', name: '逆電力継電器', on: 'vt', special: false },
  { code: 'OVR', name: '過電圧継電器', on: 'vt', special: true },
  { code: 'UFR', name: '不足周波数継電器', on: 'vt', special: true },
  { code: 'OFR', name: '過周波数継電器', on: 'vt', special: true },
  { code: 'DSR', name: '短絡方向継電器', on: 'vt', special: true },
  { code: 'UPR', name: '不足電力継電器', on: 'vt', special: true },
  { code: '2E', name: '電動機保護継電器（2要素）', on: 'ct', special: true },
  { code: '3E', name: '電動機保護継電器（3要素）', on: 'ct', special: true },
];
/** 質問ID：チェック（付けるか）／つなぐ先の答え／つなぐ先（決まった値。engine が作る） */
export const linkRelayKey = (code: string, kind: '' | 'At' | 'Target' = ''): string => `linkRelay${code}${kind}`;
/** 「特殊な継電器を選ぶ」のチェックと、試験端子を付けないチェック */
export const LINK_RELAY_SPECIAL_KEY = 'linkRelaySpecial';
export const LINK_RELAY_NO_TEST_KEY = 'linkRelayNoTest';
/** 途中の機器n個目につなぐ試験端子を入れるか（engine が作る 'yes'／'no'） */
export const linkRelayTtKey = (n: number): string => `linkRelayTt${n}`;
/** 途中のCT・VTの数（areaView が作る） */
export const LINK_PART_CT_COUNT = 'linkPartCtCount';
export const LINK_PART_VT_COUNT = 'linkPartVtCount';
/** 継電器のどれかにチェックが入っているか */
export const anyLinkRelay: Condition = { any: LINK_RELAYS.map((r): Condition => ({ key: linkRelayKey(r.code), eq: 'yes' })) };
/** 特殊な継電器のどれかにチェックが入っているか */
export const anySpecialLinkRelay: Condition = { any: LINK_RELAYS.filter((r) => r.special).map((r): Condition => ({ key: linkRelayKey(r.code), eq: 'yes' })) };
