/**
 * ナレッジベースの検証（check-knowledge）で、3つの部分が共有する「問題」の数え方。
 * 部分は、part1.ts → part2.ts → part3.ts の順に、scripts/check-knowledge.ts から呼ばれる。
 */
/** 問題の件数（最後に、scripts/check-knowledge.ts が見て、終了の番号を決める） */
export const state = { failed: 0 };
export const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  state.failed++;
};
