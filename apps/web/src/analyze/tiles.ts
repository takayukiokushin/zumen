/**
 * 大きな図面を、AI が文字を読める大きさに分けるための、割り付けの計算（画面の部品に頼らない、計算だけ）。
 *
 * AI は、1枚の画像を、長い辺が 1568px くらいまでに縮めて見る。A1・A3 などの大きな図面を、そのまま渡すと、
 * 機器の名前・容量・形式のような、細かい文字がつぶれて、「解像度が低い」と言われる。
 * そこで、大きな図面は、文字が読める大きさに拡大して、縦横に分け（つなぎ目は少し重ねる）、全体の縮小図といっしょに渡す。
 */

/** AI が縮めずに見る、画像の長い辺（px） */
export const AI_EDGE = 1568;
/** 分けた1枚の、長い辺の上限（px）。AI が縮めないように、AI_EDGE より、少し小さくする */
export const TILE_EDGE = 1500;
/** 分けた画像どうしの、重ねる幅（px）。つなぎ目の文字が、切れないように */
export const TILE_OVERLAP = 150;
/** 分けずに1枚にしてよい、AI が縮める度合いの上限（1.2＝2割まで） */
const ONE_SHEET_SLACK = 1.2;
/** PDF（線でできた図面）を描く大きさ。1pt（1/72インチ）を、何pxにするか。文字が読める大きさ */
export const PX_PER_PT = 2;

export interface Tile {
  /** 全体の中の位置と大きさ（px。全体は width×height） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 何段目・何列目か（1から）と、全部で何段・何列か */
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface SheetPlan {
  /** 元の大きさ（PDF は pt、画像は px）に、かける倍率（描く大きさ） */
  scale: number;
  /** 描いたときの、全体の大きさ（px） */
  width: number;
  height: number;
  /** 分けるか。false のときは、全体を1枚として渡す（width×height は、AI_EDGE 以内） */
  tiled: boolean;
  tiles: Tile[];
  /** 全体の縮小図の倍率（分けるときだけ使う。長い辺が AI_EDGE になる） */
  overviewScale: number;
}

/** 長さ len を、n 個に分けて、重ねる幅 ov で並べたときの、各個の始まりと長さ（全体が、ちょうど覆われる） */
function split(len: number, n: number, ov: number): { at: number; size: number }[] {
  if (n <= 1) return [{ at: 0, size: len }];
  const size = Math.ceil((len + (n - 1) * ov) / n);
  const out: { at: number; size: number }[] = [];
  for (let i = 0; i < n; i++) {
    const at = i === n - 1 ? Math.max(0, len - size) : i * (size - ov);
    out.push({ at, size: Math.min(size, len - at) });
  }
  return out;
}

/** 長さ len を、1個の長さが edge 以下で、重ね ov で覆うのに、いくつに分ければよいか */
function countFor(len: number, edge: number, ov: number): number {
  if (len <= edge) return 1;
  return Math.ceil((len - ov) / (edge - ov));
}

/**
 * 1枚の図（PDF の1ページ、または1枚の画像）の、割り付けを決める。
 *
 * @param w0 元の幅（PDF は pt、画像は px）
 * @param h0 元の高さ
 * @param target 描く倍率の希望（PDF は PX_PER_PT、画像は 1＝そのままの大きさ）
 * @param maxTiles 分けてよい枚数の上限（1のときは、分けずに、全体を1枚に縮める）
 */
export function planSheet(w0: number, h0: number, target: number, maxTiles: number): SheetPlan {
  const long0 = Math.max(w0, h0);
  const fit = AI_EDGE / long0;
  const asOne = (): SheetPlan => {
    const s = Math.min(target, fit);
    return { scale: s, width: Math.max(1, Math.round(w0 * s)), height: Math.max(1, Math.round(h0 * s)), tiled: false, tiles: [], overviewScale: s };
  };
  // 希望の大きさでも、AI が縮めない大きさに収まる（A4 くらいまでの図、普通の写真）
  // 希望の大きさでも、AI が縮める度合いが小さい（2割まで。A4 の PDF など）なら、分けずに、AI が縮めない大きさの1枚にする。文字は、まだ読める
  if (long0 * target <= AI_EDGE * ONE_SHEET_SLACK || maxTiles <= 1) return asOne();

  let s = target;
  for (let guard = 0; guard < 60; guard++) {
    const W = Math.round(w0 * s);
    const H = Math.round(h0 * s);
    const cols = countFor(W, TILE_EDGE, TILE_OVERLAP);
    const rows = countFor(H, TILE_EDGE, TILE_OVERLAP);
    if (cols * rows <= maxTiles) {
      // 分けても1枚（縮小図と同じ）にしかならないなら、分けない
      if (cols * rows <= 1) return asOne();
      const xs = split(W, cols, TILE_OVERLAP);
      const ys = split(H, rows, TILE_OVERLAP);
      const tiles: Tile[] = [];
      ys.forEach((y, r) =>
        xs.forEach((x, c) => tiles.push({ x: x.at, y: y.at, w: x.size, h: y.size, row: r + 1, col: c + 1, rows, cols })),
      );
      return { scale: s, width: W, height: H, tiled: true, tiles, overviewScale: fit };
    }
    s *= 0.92;
    if (long0 * s <= AI_EDGE) return asOne();
  }
  return asOne();
}

/** 1回に AI へ送る、画像の枚数の上限（サーバーも同じ値で断る） */
export const MAX_SEND_IMAGES = 60;

/** 図（ページ・画像）の数に応じて、1枚の図を、いくつまで分けてよいか。図が多いほど、1枚あたりを減らす（料金・時間・枚数の上限のため） */
export function tilesPerSheet(sheets: number): number {
  if (sheets <= 2) return 12;
  if (sheets <= 5) return 6;
  if (sheets <= 10) return 3;
  return 1;
}
