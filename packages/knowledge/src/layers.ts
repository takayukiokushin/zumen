/**
 * 図面の「レイヤー」（停電範囲図・絶縁耐力試験範囲図など）の決まり。
 *
 * レイヤーは、別の図面ではなく、いまある単線結線図に重ねる赤い印のまとまり。
 * 変わるのは、印刷したときの一番上のタイトルの「図面名称」の部分と、重ねる赤い印だけ
 * （事業場名・お客様名・入力済みの図面名称は変えない）。
 *
 * 固定の2つは、名前を変えられず、消せない。そのほかに、名前を自由に付けたレイヤーを、
 * MAX_CUSTOM_LAYERS 個まで追加できる（合計5個。重くならないように）。
 */

export interface FixedLayerDef {
  id: 'outage' | 'withstand';
  /** 印刷のタイトルに入る名前（図面は日本語で書くので、画面の言葉を切り替えても、変えない） */
  title: string;
}

export const FIXED_LAYERS: readonly FixedLayerDef[] = [
  { id: 'outage', title: '停電範囲図' },
  { id: 'withstand', title: '絶縁耐力試験範囲図' },
];

/** 追加できるレイヤーの数（固定の2つのほか） */
export const MAX_CUSTOM_LAYERS = 3;

/** 1つのレイヤーに置けるものの数の上限（種類ごと。赤い枠・点・印・渡り線・文字それぞれ） */
export const MAX_LAYER_ITEMS_PER_KIND = 100;

export const isFixedLayerId = (id: string): boolean => FIXED_LAYERS.some((l) => l.id === id);

/**
 * 赤い枠（範囲を囲む四角）の種類。枠を置くときに選ぶと、枠の近くに書く文字と、斜線の有無が、最初に決まる
 * （文字は、置いたあとで、自由に書き換えられる。斜線も、あとから入り切りできる）。
 * 斜線を入れるのは、充電範囲だけ。停電範囲・印加範囲には、入れない。
 */
export interface AreaKindDef {
  id: 'outage' | 'live' | 'applied';
  /** 枠の近くに、最初に書く文字（図面は日本語で書くので、画面の言葉を切り替えても、変えない） */
  label: string;
  /** 枠の中に、赤い斜線を入れるか */
  hatch: boolean;
}

export const AREA_KINDS: readonly AreaKindDef[] = [
  { id: 'outage', label: '停電範囲', hatch: false },
  { id: 'live', label: '充電範囲', hatch: true },
  { id: 'applied', label: '印加範囲', hatch: false },
];
