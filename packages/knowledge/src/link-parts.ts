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
