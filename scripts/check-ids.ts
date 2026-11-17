/**
 * 図面の要素の id（番号）が、重ならないことの検証（全体デバッグ 問題1）。
 *
 *   ・以前は、画面を読み込み直すと、新しい要素の id が最初から数え直されて、保存してある図面の id と重なることがあった
 *     （保存した図面を開いて記号を足すと、同じ id が2つの記号に付く）
 *   ・記号・線・文字・結線を足すとき、いまの図面にある id とぶつからない
 *   ・すでに重なっている図面を開いたとき、あとのほうを付け替える（線のつなぎ先は、位置で見分ける）
 *
 *   node --experimental-strip-types scripts/check-ids.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { addFan, addSymbol, addText, addWire, dedupeIds, portsOf } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../apps/web/src/editor/doc.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};
const ok = (c: boolean, msg: string) => {
  if (!c) fail(msg);
};
const dupsOf = (d: Doc) => d.items.map((i) => i.id).filter((x, i, a) => a.indexOf(x) !== i);

console.log('■ 図面の要素の id（番号）が、重ならない');
const empty: Doc = { items: [] };

// 1. 保存してあった図面の id と、ぶつからない（画面を読み込み直した状態を作る：次に作られる id を、先に使っておく）
let d: Doc = addSymbol(empty, 'lbs-pf', 0, 0).doc;
const probe = addSymbol(d, 'vcb', 0, 100); // 次の番号を知るために1つ作る
const n = Number(/(\d+)$/.exec(probe.id)![1]);
const occupied = (prefix: string, k: number): Doc => ({ items: [{ kind: 'text', id: `${prefix}-${k}`, x: 0, y: 0, lines: ['x'], anchor: 'start' }] });
for (const [prefix, make] of [
  ['sym', (doc: Doc) => addSymbol(doc, 'vcb', 0, 0).id],
  ['text', (doc: Doc) => addText(doc, 0, 0, 'a').id],
  ['wire', (doc: Doc) => addWire(doc, 0, 0, 0, 100, { assist: false }).id],
] as const) {
  // 次の次の番号まで、すでに使われている図面
  const doc: Doc = { items: [occupied(prefix, n + 1).items[0]!, occupied(prefix, n + 2).items[0]!, occupied(prefix, n + 3).items[0]!] };
  const id = make(doc);
  ok(!doc.items.some((i) => i.id === id), `${prefix}：すでにある id と同じ id（${id}）を作りました`);
}
// 結線の線の id も、ぶつからない
{
  let doc: Doc = addSymbol(empty, 'lbs-pf', 0, 0).doc;
  const a1 = addSymbol(doc, 'vcb', -60, 160);
  doc = a1.doc;
  const a2 = addSymbol(doc, 'vcb', 60, 160);
  doc = a2.doc;
  const src = doc.items.find((i) => i.kind === 'symbol')!.id;
  const r = addFan(doc, src, [a1.id, a2.id]);
  ok(dupsOf(r.doc).length === 0, '結線を足したあとに、同じ id が残っています');
  const r2 = addFan(r.doc, src, [a1.id]);
  ok(dupsOf(r2.doc).length === 0, '結線を重ねて足したあとに、同じ id が残っています');
}
console.log('  記号・線・文字・結線を足しても、いまの図面にある id と重ならない');

// 2. すでに重なっている図面：あとのほうを付け替える。線のつなぎ先は、位置で見分ける
{
  const mk = (id: string, x: number, y: number): DocSymbol =>
    ({ kind: 'symbol', id, symbolId: 'vcb', x, y, rotate: 0, label: [], labelDx: 10, labelDy: 0, labelAnchor: 'start' }) as DocSymbol;
  const s1 = mk('sym-1', 0, 0);
  const s2 = mk('sym-1', 200, 300); // 同じ id（あとから足した記号）
  const p1 = portsOf(s1)[0]!;
  const p2 = portsOf(s2)[0]!;
  const w1: DocWire = { kind: 'wire', id: 'wire-1', x1: p1.x, y1: p1.y - 40, x2: p1.x, y2: p1.y, at2: { item: 'sym-1', port: p1.id } };
  const w2: DocWire = { kind: 'wire', id: 'wire-2', x1: p2.x, y1: p2.y - 40, x2: p2.x, y2: p2.y, at2: { item: 'sym-1', port: p2.id } };
  const bad: Doc = { items: [s1, s2, w1, w2] };
  ok(dupsOf(bad).length === 1, '試験用の図面が、重なった id になっていません');
  const fixed = dedupeIds(bad);
  ok(dupsOf(fixed).length === 0, '重なった id が、付け替えられていません');
  ok(fixed.items.length === 4, '付け替えで、要素の数が変わりました');
  const fw1 = fixed.items.find((i) => i.id === 'wire-1') as DocWire;
  const fw2 = fixed.items.find((i) => i.id === 'wire-2') as DocWire;
  const newSymId = fixed.items.filter((i) => i.kind === 'symbol')[1]!.id;
  ok(fw1.at2?.item === 'sym-1', '1つ目の記号につながっていた線が、1つ目の記号のままではありません');
  ok(fw2.at2?.item === newSymId && newSymId !== 'sym-1', `2つ目の記号につながっていた線が、付け替えた2つ目の記号を指していません（${fw2.at2?.item}）`);
  ok(dedupeIds(fixed) === fixed, '重なりが無い図面は、そのまま（同じもの）が返るはずです');
  console.log('  すでに重なっている図面は、あとの要素を付け替え、線のつなぎ先は位置で見分ける。重なりが無ければ、何も変えない');
}

// 3. 古い案件の見本（9件）：重なりがあれば付け替わり、無ければ、そのまま
{
  const dir = new URL('../docs/legacy-projects/', import.meta.url);
  let checked = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { drawing: Doc | null };
    if (!s.drawing) continue;
    const dups = dupsOf(s.drawing).length;
    const out = dedupeIds(s.drawing);
    ok(dupsOf(out).length === 0, `${f}：付け替えたあとも、重なりが残っています`);
    ok(dups > 0 || out === s.drawing, `${f}：重なりが無い図面を、変えました`);
    ok(out.items.length === s.drawing.items.length, `${f}：要素の数が変わりました`);
    checked++;
  }
  console.log(`  古い形式の案件の図面 ${checked}件：重なりを付け替えても、要素の数は変わらない（重なりが無ければ、そのまま）`);
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
