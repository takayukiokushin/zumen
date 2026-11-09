/** 「操作を戻す」で、さかのぼれる回数の上限（長時間つけっぱなしでも、覚えている量が増え続けないように） */
export const MAX_UNDO = 200;

/** 履歴に1つ足す。上限を超えたら、いちばん古いものから忘れる */
export function pushPast<T>(past: T[], item: T): T[] {
  return past.length >= MAX_UNDO ? [...past.slice(past.length - MAX_UNDO + 1), item] : [...past, item];
}
