/**
 * 手元の確認（pnpm check）に入れる、2つの確認（第21弾 整合チェック 3）。
 * GitHub の自動確認（CI）では行っているのに、手元の確認に入っていなかったため、誤りが長く気づかれなかった。
 *
 *   1. 画面側・サーバー側の型の確認（`pnpm typecheck` は、画面側（apps/web）を含まない）
 *   2. 「記号カタログ」と「サンプル図面」が、最新の内容か（古ければ、作り直したうえで、失敗にする。作り直したものを、保存してもらう）
 *
 *   node --experimental-strip-types scripts/check-types-generated.ts
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSC = resolve(ROOT, 'node_modules/typescript/lib/tsc.js');
let failed = 0;

console.log('■ 型の確認（画面側・サーバー側）');
for (const [name, project] of [
  ['画面側', 'apps/web/tsconfig.json'],
  ['サーバー側', 'tsconfig.json'],
] as const) {
  const r = spawnSync(process.execPath, [TSC, '--noEmit', '-p', project], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) console.log(`  ${name}：問題なし`);
  else {
    failed++;
    console.error(`  NG: ${name}の型に誤りがあります。\n${(r.stdout + r.stderr).split('\n').slice(0, 8).join('\n')}`);
  }
}

console.log('■ 作って保存してある資料（記号カタログ・サンプル図面）が、最新か');
const FILES = ['docs/symbol-catalog.html', 'docs/sample-drawing.svg'];
const before = FILES.map((f) => readFileSync(resolve(ROOT, f), 'utf8'));
for (const script of ['scripts/build-catalog.ts', 'scripts/build-sample-drawing.ts']) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', script], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`  NG: ${script} が失敗しました。\n${(r.stdout + r.stderr).split('\n').slice(0, 6).join('\n')}`);
  }
}
const stale = FILES.filter((f, i) => readFileSync(resolve(ROOT, f), 'utf8') !== before[i]);
if (stale.length === 0) console.log('  2つとも、最新です');
else {
  failed++;
  console.error(`  NG: 資料が最新ではありませんでした（${stale.join('、')}）。いま、作り直しました。変更を、保存（コミット）してください。`);
}

console.log(failed === 0 ? '\n✓ 型の確認と、資料の最新の確認は、問題ありませんでした' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
