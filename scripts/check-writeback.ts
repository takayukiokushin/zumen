/**
 * 「図面で手を加えたことが、入力にも反映され、そのあと入力画面から直しても、矛盾が出ない」ことの、大量の検証（第18弾 追加）。
 *
 * でたらめな案件（ふつうのものと、ケーブル・開閉器・電動機・エリア間の接続を多く付けたもの）で、
 * 図面の部品を1〜3個、続けて消す → 入力に反映する → 入力画面から、さらに1つ直す → 図面を作り直す。
 *   ・反映したあと、もう一度反映しようとしても、何も起きない（二重に反映しない）
 *   ・入力を直して作り直したあとも、反映した内容が戻らない（消した部品が、復活しない）
 *   ・作り直した図面に、「線が浮く・斜め・突き抜け・重なり」が、増えない
 *   ・途中で落ちない
 * 回数は、環境変数 FUZZ_COUNT で増やせる（`pnpm fuzz` は10倍）。
 *
 *   node --experimental-strip-types scripts/check-writeback.ts
 */
import { run } from './sweep-roundtrip.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
console.log('■ 図面で消す → 入力に反映 → 入力を直す → 作り直す：矛盾が出ない');
let failed = 0;
for (const [name, rich] of [['ふつうの案件', false], ['ケーブル・開閉器・電動機・エリア間の接続を多く付けた案件', true]] as const) {
  const { stats, examples } = run(45 * SCALE, rich);
  console.log(`  ${name}：${stats.runs}通りを試し、${stats.reflected}通りで入力に反映された`);
  const bad = stats.notIdempotent + stats.resurrected + stats.worse + stats.crash;
  if (bad > 0) {
    failed++;
    console.error(`  NG: ${name}：二重に反映 ${stats.notIdempotent}・復活 ${stats.resurrected}・図面の欠陥が増えた ${stats.worse}・落ちた ${stats.crash}（例：${examples[0] ?? ''}）`);
  }
  if (stats.reflected < Math.max(5, stats.runs / 5)) {
    failed++;
    console.error(`  NG: ${name}：入力に反映された図面が少なすぎます（${stats.reflected}／${stats.runs}）。反映の仕組みが壊れていないか確かめてください`);
  }
}
if (failed === 0) console.log('\n✓ 図面で手を加えても、入力と矛盾せず、くり返しても、崩れません');
else console.error(`\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
