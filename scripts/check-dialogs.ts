/**
 * ブラウザ標準の確認画面・入力画面（confirm / prompt / alert）が、画面のコードに残っていないか。
 * 端末やブラウザごとに見た目が違い、図面の編集中に出ると、後ろの画面のキー操作も受けてしまうため、
 * アプリ内の窓（apps/web/src/Dialogs.tsx）だけを使う。
 *
 *   node --experimental-strip-types scripts/check-dialogs.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../apps/web/src', import.meta.url));
const found: string[] = [];

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) {
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // コメントの中の言及は、見ない
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/\/\*.*?\*\//g, '');
          if (/(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(code)) found.push(`${p.replace(ROOT + '/', '')}:${i + 1}  ${line.trim()}`);
        });
    }
  }
}
walk(ROOT);

console.log('■ ブラウザ標準の確認・入力の窓が、残っていないか');
if (found.length === 0) {
  console.log('  残っていません（アプリ内の窓だけを使っています）');
  console.log('\n✓ すべて確認できました');
} else {
  for (const f of found) console.error(`  NG: ${f}`);
  console.error(`\n✗ ${found.length}件の問題があります。apps/web/src/Dialogs.tsx の ask / input を使ってください`);
  process.exit(1);
}
