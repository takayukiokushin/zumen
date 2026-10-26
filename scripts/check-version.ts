/**
 * 版の番号と、変更履歴がずれていないかの検証。
 *
 *   ・package.json の版が、すべて同じであること
 *   ・版が「0.1.0」のような形であること
 *   ・CHANGELOG.md の一番上の版が、いまの版と同じであること
 *     （版を上げたのに、変更履歴を書き忘れるのを防ぐ）
 *
 *   node --experimental-strip-types scripts/check-version.ts
 */
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

console.log('■ 版の番号と変更履歴');

const files = ['package.json', 'apps/web/package.json', 'apps/server/package.json', 'apps/desktop/package.json'];
const versions = files.map((f) => ({ f, v: (JSON.parse(read(f)) as { version?: string }).version ?? '' }));
const main = versions[0]!.v;

if (!/^\d+\.\d+\.\d+$/.test(main)) fail(`版の形が違います：「${main}」（0.1.0 のように書く）`);
for (const { f, v } of versions) {
  if (v !== main) fail(`${f} の版が ${v} です（package.json の ${main} とそろえてください）`);
}
if (failed === 0) console.log(`  すべての package.json が ${main}`);

const top = /^## (\d+\.\d+\.\d+)（(\d{4}-\d{2}-\d{2})）/m.exec(read('CHANGELOG.md'));
if (!top) fail('CHANGELOG.md に「## 0.1.0（2026-10-26）」の形の見出しがありません');
else if (top[1] !== main) {
  fail(`CHANGELOG.md の一番上は ${top[1]} ですが、いまの版は ${main} です（変更履歴を書き足してください）`);
} else {
  console.log(`  変更履歴の一番上は ${top[1]}（${top[2]}）で、いまの版と同じ`);
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
