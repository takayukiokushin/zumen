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
import { checkNodeVersion } from '../apps/server/src/env.ts';

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

// Node.js の版の固定：動作を確かめてあるのは22系（22.13以上）。工具・手順書・起動時の確認が、同じ版をさしていること
console.log('\n■ Node.js の版の固定');
const nodeOf = (v: string) => checkNodeVersion(v);
if (nodeOf('22.13.0') !== 'ok' || nodeOf('22.22.0') !== 'ok' || nodeOf('22.12.9') !== 'old' || nodeOf('20.18.0') !== 'old' || nodeOf('24.1.0') !== 'newer') fail('Node.js の版の判定が違います（22.13以上の22系＝ok／それより古い＝old／23以上＝newer）');
const engines = (JSON.parse(read('package.json')) as { engines?: { node?: string } }).engines?.node;
if (engines !== '>=22.13.0 <23') fail(`package.json の engines.node が違います：「${engines}」（>=22.13.0 <23）`);
if (read('.nvmrc').trim() !== '22') fail('.nvmrc は 22 のはずです');
if (!/node-version:\s*'22'/.test(read('.github/workflows/ci.yml'))) fail('CI（.github/workflows/ci.yml）の Node の版が 22 ではありません');
for (const f of ['docs/server-setup.md', 'docs/install.md', 'docs/first-aid.md', 'docs/start-here.md', 'start-server.command', 'test-mac.command']) {
  const t = read(f);
  if (/LTS版を入れ|LTS版 を入れ|LTS版（22以上）|\*\*LTS\*\* の大きいボタン(から)?ダウンロード/.test(t)) fail(`${f} に、「LTS版を入れる」という案内が残っています（22の版を入れる、と書く）`);
  if (!/22/.test(t)) fail(`${f} に、Node.js は22の版、という案内がありません`);
}
if (failed === 0) console.log('  22系（22.13以上）で固定：engines・.nvmrc・CI・手順書・起動の確認・自己診断');

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
