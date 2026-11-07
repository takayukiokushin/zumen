/**
 * 図面の見本（ゴールデン）との比較。
 *
 * 架空の現場 scripts/golden/cases.ts の図面を作り直して、docs/golden/ に保存してある見本と1文字ずつ比べる。
 * 図面の作り方（自動配置・記号・印刷）を変えたとき、意図しない変化が出ていないかを知らせる。
 *
 *   node --experimental-strip-types scripts/check-golden.ts           … 比べる（pnpm check から呼ばれる）
 *   node --experimental-strip-types scripts/check-golden.ts --update  … 見本を保存し直す（pnpm golden）
 *
 * 意図して図面を変えたときだけ、保存し直す。そのときは、変わった図面を目で見て確かめてから。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAllGolden, buildIndexHtml } from './golden/build.ts';
import type { GoldenResult } from './golden/build.ts';

const DIR = resolve(import.meta.dirname, '../docs/golden');
const update = process.argv.includes('--update');

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/** 書き間違いで、何も効いていない見本ができていないか */
function checkContent(r: GoldenResult): void {
  const ids = Object.keys(r.symbols);
  for (const want of r.case.mustHave) {
    const [name, n] = want.split('=') as [string, string | undefined];
    if (n !== undefined) {
      const got = r.symbols[name] ?? 0;
      if (got !== Number(n)) fail(`${r.case.id}：${name} が ${n}個のはずが ${got}個です`);
    } else if (!ids.some((id) => id.startsWith(name))) {
      fail(`${r.case.id}：${name} の記号が図面に入っていません（回答の書き間違いかもしれません）`);
    }
  }
  for (const bad of r.case.mustNot ?? []) {
    const hit = ids.filter((id) => id.startsWith(bad));
    if (hit.length) fail(`${r.case.id}：入っていないはずの ${hit.join('・')} が図面に入っています`);
  }
}

/** 違った最初の行を、見やすく示す */
function firstDifference(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) {
      const cut = (s: string | undefined) => (s === undefined ? '（行なし）' : s.length > 140 ? `${s.slice(0, 140)}…` : s);
      return `${i + 1}行目\n      保存済み：${cut(x[i])}\n      いまの図面：${cut(y[i])}`;
    }
  }
  return '（違いが見つかりません）';
}

console.log('■ 図面の見本（架空の現場）との比較');
const results = buildAllGolden();

// 見本の組み合わせそのものの確認
const ids = results.map((r) => r.case.id);
if (new Set(ids).size !== ids.length) fail('見本の名前が重なっています');
const sameSvg = new Map<string, string>();
for (const r of results) {
  const prev = sameSvg.get(r.svg);
  if (prev) fail(`${r.case.id} と ${prev} は、まったく同じ図面です（違いが出ていない見本は意味がありません）`);
  sameSvg.set(r.svg, r.case.id);
  checkContent(r);
}
for (const r of results) {
  const name = JSON.stringify(r.case.answers);
  // 実在のお客様の名前が紛れ込まないように、見本の名前は「見本」「架空」で始まるものだけにする
  const site = String(r.case.answers.siteName ?? '');
  if (!/^(見本|架空)/.test(site)) fail(`${r.case.id}：事業場名称は「見本」か「架空」で始めてください（${site}）`);
  if (name.length > 4000) fail(`${r.case.id}：回答が長すぎます`);
}
if (results.length < 20) fail(`見本が ${results.length}件しかありません（20件以上にしてください）`);

if (update) {
  mkdirSync(DIR, { recursive: true });
  for (const f of readdirSync(DIR)) if (/\.(svg|html)$/.test(f)) rmSync(resolve(DIR, f));
  for (const r of results) writeFileSync(resolve(DIR, `${r.case.id}.svg`), r.svg, 'utf8');
  writeFileSync(resolve(DIR, 'index.html'), buildIndexHtml(results), 'utf8');
  console.log(`  ${results.length}件の見本を保存しました（${DIR}）`);
} else {
  if (!existsSync(DIR)) fail('見本の保存場所（docs/golden）がありません。`pnpm golden` で作ってください');
  else {
    const want = new Set([...results.map((r) => `${r.case.id}.svg`), 'index.html']);
    for (const f of readdirSync(DIR)) if (/\.(svg|html)$/.test(f) && !want.has(f)) fail(`${f}：組み合わせにない見本が残っています（pnpm golden で整理できます）`);
    let same = 0;
    const files: [string, string][] = [...results.map((r): [string, string] => [`${r.case.id}.svg`, r.svg]), ['index.html', buildIndexHtml(results)]];
    for (const [file, now] of files) {
      const path = resolve(DIR, file);
      if (!existsSync(path)) {
        fail(`${file}：保存済みの見本がありません`);
        continue;
      }
      const saved = readFileSync(path, 'utf8');
      if (saved !== now) fail(`${file}：保存済みの見本と違います。${firstDifference(saved, now)}`);
      else same++;
    }
    if (failed === 0) console.log(`  ${same}件すべて、保存済みの見本と一致（図面 ${results.length}件＋一覧）`);
    else console.error('\n  意図して図面を変えたのなら、変わった図面を目で見て確かめてから、`pnpm golden` で保存し直してください。');
  }
}

console.log(failed === 0 ? '\n✓ 図面の見本の確認ができました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
