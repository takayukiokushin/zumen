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
