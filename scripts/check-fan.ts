/**
 * 「結線」（元の記号から、下の機器たちへ、縦線・母線・縦線で結ぶ）の検証（第16弾 整合チェックのあとの追加）。
 *
 *   ・記号の位置は動かさない。母線の高さは、元の記号の下端と、いちばん上の機器の上端の、ちょうど真ん中
 *   ・各機器への縦線は、機器の上端の接続点につながる（印が付く）。記号を動かすと、縦線・母線がついていく
 *   ・機器を消すと、その縦線が消える。最後の1台を消すと、元の記号から出ている縦線・母線も消える
 *   ・あとから機器を足すと、今までの母線と同じ高さに合流する
 *   ・引き直しを何度行っても、結果が変わらない
 *
 *   node --experimental-strip-types scripts/check-fan.ts
 */
import { buildComposition } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { addFan, addSymbol, portsOf, fanSourcePort, fanTargetPort, fromLayout, moveItem, refreshFans, removeItem, removeItems, tidyDoc } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../apps/web/src/editor/doc.ts';
import { tidyDrawing } from '../apps/web/src/editor/inspect.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};
const ok = (c: boolean, msg: string) => {
  if (!c) fail(msg);
};
const near = (a: number, b: number, e = 0.6) => Math.abs(a - b) <= e;

console.log('■ 結線（縦線・母線・縦線で、まとめて結ぶ）');

// 材料：LBS（主遮断装置）と、その下の変圧器・コンデンサ。線は全部外して、記号だけにする
const a = { sourceType: 'pole', mainBreakerForm: 'pfs', hasCapacitor: 'yes' } as Record<string, string>;
let base: Doc = fromLayout(layout(buildComposition(a), a));
base = { ...base, items: base.items.filter((i) => i.kind !== 'wire') };
const sym = (d: Doc, id: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === id)!;
const SRC = 'main-breaker';
// 変圧器を、横に3台並べる（1台目は、すでにある）
let t2 = addSymbol(base, 'tr-3p-yd', sym(base, 'transformer').x + 120, sym(base, 'transformer').y);
base = t2.doc;
const T2 = t2.id;
const t3 = addSymbol(base, 'tr-3p-yd', sym(base, 'transformer').x + 240, sym(base, 'transformer').y);
base = t3.doc;
const T3 = t3.id;
const kids = ['transformer', T2, T3, 'capacitor'];
const wires = (d: Doc, fid?: string) => d.items.filter((i): i is DocWire => i.kind === 'wire' && !!i.fan && (!fid || i.fan.id === fid));
const pos = (d: Doc) => JSON.stringify(d.items.filter((i) => i.kind === 'symbol').map((i) => [i.id, (i as DocSymbol).x, (i as DocSymbol).y]));

// 1. 結線する（4台）
const r = addFan(base, SRC, kids);
const d1 = r.doc;
ok(r.added === 4 && !!r.fanId, `4台を結んだはずが ${r.added}台です`);
ok(pos(d1) === pos(base), '結線で、記号の位置が動いています');
const w1 = wires(d1, r.fanId!);
const trunk = w1.find((w) => w.fan!.role === 'trunk')!;
const bus = w1.find((w) => w.fan!.role === 'bus')!;
const drops = w1.filter((w) => w.fan!.role === 'drop');
const sp = fanSourcePort(sym(d1, SRC))!;
ok(!!trunk && !!bus && drops.length === 4, `縦線1・母線1・縦線4のはずが ${w1.map((w) => w.fan!.role).join(',')} です`);
ok(near(trunk.x1, sp.x) && near(trunk.y1, sp.y) && trunk.at1?.item === SRC, '元の記号の縦線が、元の記号の下端から出ていません');
const tops = kids.map((k) => fanTargetPort(sym(d1, k))!);
const minTop = Math.min(...tops.map((p) => p.y));
ok(near(bus.y1, (sp.y + minTop) / 2, 1) && near(bus.y1, bus.y2), `母線の高さが、真ん中ではありません（${bus.y1}／真ん中 ${(sp.y + minTop) / 2}）`);
const xs = [sp.x, ...tops.map((p) => p.x)];
ok(near(Math.min(bus.x1, bus.x2), Math.min(...xs)) && near(Math.max(bus.x1, bus.x2), Math.max(...xs)), '母線の左右の端が、元の記号と機器の左右の端にそろっていません');
for (const k of kids) {
  const dw = drops.find((w) => w.at2?.item === k);
  const p = fanTargetPort(sym(d1, k))!;
  ok(!!dw && near(dw.x2, p.x) && near(dw.y2, p.y) && near(dw.x1, p.x) && near(dw.y1, bus.y1), `${k}への縦線が、母線から機器の上端まで、まっすぐ引けていません`);
}
// 引き直しを何度行っても、結果が変わらない／「結線を整える」でも変わらない
ok(JSON.stringify(refreshFans(d1).items) === JSON.stringify(d1.items), '引き直しを重ねると、結果が変わります');
ok(JSON.stringify(wires(tidyDoc(d1), r.fanId!).map((w) => [w.x1, w.y1, w.x2, w.y2])) === JSON.stringify(w1.map((w) => [w.x1, w.y1, w.x2, w.y2])), '「結線を整える」で、結線の線が動きました');
console.log('  4台（変圧器3台・コンデンサ1台）を結んだ：縦線1・母線1・縦線4。母線は真ん中の高さ。記号は動かない');

// 2. 動かす：横にずらすと、縦線がついていき、母線が伸び縮みする
const far = moveItem(d1, T3, 200, 0);
const bus2 = wires(far, r.fanId!).find((w) => w.fan!.role === 'bus')!;
const drop3 = wires(far, r.fanId!).find((w) => w.at2?.item === T3)!;
ok(near(drop3.x1, drop3.x2) && near(drop3.x2, fanTargetPort(sym(far, T3))!.x), '動かした機器の縦線が、ついてきません');
ok(Math.max(bus2.x1, bus2.x2) > Math.max(bus.x1, bus.x2) + 100, '母線が、右へ伸びていません');
ok(near(bus2.y1, bus.y1), '横に動かしただけなのに、母線の高さが変わりました');
const back = moveItem(far, T3, -200, 0);
ok(near(Math.max(...wires(back, r.fanId!).filter((w) => w.fan!.role === 'bus').map((w) => Math.max(w.x1, w.x2))), Math.max(bus.x1, bus.x2)), '元の位置へ戻したのに、母線が元の長さに戻りません');
// 元の記号を動かす：縦線が、ついていく
const srcMoved = moveItem(d1, SRC, 30, 0);
const trunk3 = wires(srcMoved, r.fanId!).find((w) => w.fan!.role === 'trunk')!;
ok(near(trunk3.x1, fanSourcePort(sym(srcMoved, SRC))!.x), '元の記号を動かしたとき、縦線がついてきません');
console.log('  横に動かすと縦線がついていき、母線が伸び縮みする。元の記号を動かしても縦線がついていく');

// 3. 消す：機器を1台消すと、その縦線だけが消える。母線と、ほかの機器は残る
let del = removeItem(d1, T2);
const left = wires(del, r.fanId!);
ok(left.filter((w) => w.fan!.role === 'drop').length === 3 && !left.some((w) => w.at2?.item === T2), '機器を消したのに、その縦線が残っています／ほかの縦線まで消えました');
ok(left.some((w) => w.fan!.role === 'bus') && left.some((w) => w.fan!.role === 'trunk'), '機器を1台消したら、母線・縦線まで消えました');
// 最後の1台を消す：元の記号から出ている縦線も、母線も消える
del = removeItems(d1, kids);
ok(wires(del).length === 0, `全部の機器を消したのに、結線の線が残っています（${wires(del).length}本）`);
const one = addFan(base, SRC, ['capacitor']);
const oneDel = removeItem(one.doc, 'capacitor');
ok(wires(oneDel).length === 0, '機器が1台だけのとき、その機器を消しても、縦線が残っています');
// 元の記号を消す：元の記号の縦線は消える。母線と、機器への縦線は残る
const noSrc = removeItem(d1, SRC);
const ns = wires(noSrc, r.fanId!);
ok(!ns.some((w) => w.fan!.role === 'trunk') && ns.some((w) => w.fan!.role === 'bus') && ns.filter((w) => w.fan!.role === 'drop').length === 4, '元の記号を消したとき、縦線だけが消えて、母線・機器への縦線は残るはずです');
console.log('  機器を消すと、その縦線が消える（母線は残る）。最後の1台を消すと、縦線・母線も消える。元の記号を消すと、元の縦線だけが消える');

// 4. あとから足す：同じ元の記号を、もう一度結ぶと、今までの母線に合流する
const t4 = addSymbol(d1, 'tr-3p-yd', sym(d1, 'transformer').x - 120, sym(d1, 'transformer').y);
const added = addFan(t4.doc, SRC, [t4.id]);
const wa = wires(added.doc, r.fanId!);
ok(added.fanId === r.fanId && added.added === 1, '同じ元の記号を結ぶと、同じ結線に足されるはずです');
ok(wa.filter((w) => w.fan!.role === 'bus').length === 1 && wa.filter((w) => w.fan!.role === 'trunk').length === 1, '足したとき、母線・縦線が、増えています');
ok(near(wa.find((w) => w.fan!.role === 'bus')!.y1, bus.y1), '足したとき、母線の高さが変わりました');
ok(near(Math.min(...wa.filter((w) => w.fan!.role === 'bus').map((w) => Math.min(w.x1, w.x2))), fanTargetPort(sym(added.doc, t4.id))!.x), '足した機器まで、母線が伸びていません');
ok(addFan(added.doc, SRC, [t4.id]).added === 0, 'すでに結んだ機器を、もう一度結ぼうとすると、増えるはずがありません');
console.log('  あとから機器を足して結ぶと、同じ母線の高さで合流する（同じ機器を重ねて結んでも増えない）');

// 5. 「結線を整える」：きれいな結線は、そのまま。少しずれた機器の高さをそろえ、偏った母線を真ん中に戻す。斜めにはならない
const geom = (d: Doc, fid: string) => JSON.stringify(wires(d, fid).map((w) => [w.fan!.role, Math.round(w.x1), Math.round(w.y1), Math.round(w.x2), Math.round(w.y2)]).sort());
const t1 = tidyDrawing(d1);
ok(geom(t1.doc, r.fanId!) === geom(d1, r.fanId!), '「結線を整える」で、きれいな結線が変わりました');
ok(pos(t1.doc) === pos(d1), '「結線を整える」で、きれいな結線の記号が動きました');
// 機器の1台を、少し（8）上へずらす／母線を、元の記号の近くへ寄せる
let skew = moveItem(d1, T2, 0, -8);
const bs = wires(skew, r.fanId!).find((w) => w.fan!.role === 'bus')!;
skew = { ...skew, items: skew.items.map((i) => (i.id === bs.id ? { ...bs, y1: sp.y + 14, y2: sp.y + 14 } : i)) };
const ts = tidyDrawing(skew);
const topsAfter = kids.map((k) => fanTargetPort(sym(ts.doc, k))!.y);
const topsBefore = kids.map((k) => fanTargetPort(sym(d1, k))!.y);
// 同じ種類の2台（T2・T3）は、同じ高さ。ずれていたT2が、元の高さに戻る（種類が違って、元から高さが違うものは、動かさない）
ok(near(fanTargetPort(sym(ts.doc, T2))!.y, fanTargetPort(sym(ts.doc, T3))!.y), `少しずれた機器の高さが、そろっていません（${topsAfter.map(Math.round).join('，')}）`);
ok(near(topsAfter[3]! - topsAfter[0]!, topsBefore[3]! - topsBefore[0]!), 'ずれていない機器の、お互いの高さが変わりました');
const busAfter = wires(ts.doc, r.fanId!).find((w) => w.fan!.role === 'bus')!;
ok(near(busAfter.y1, (sp.y + Math.min(...topsAfter)) / 2, 1.1), `偏った母線が、真ん中に戻っていません（${busAfter.y1}）`);
ok(wires(ts.doc, r.fanId!).every((w) => near(w.x1, w.x2) || near(w.y1, w.y2)), '結線の線に、斜めの線があります');
ok(ts.issues.every((i) => i.kind !== 'floating' && i.kind !== 'stray'), '「結線を整える」のあとに、つながっていない線・余分な線が残りました');
// 大きくずれた機器（わざと置いた高さ）は、動かさない
const big = moveItem(d1, T3, 0, 60);
const tb = tidyDrawing(big);
ok(near(fanTargetPort(sym(tb.doc, T3))!.y, fanTargetPort(sym(big, T3))!.y), '大きくずれた機器まで、動かしました');
console.log('  「結線を整える」：きれいな結線はそのまま。少しずれた機器の高さをそろえ、偏った母線を真ん中に戻す。大きくずれたものは動かさない。斜めにならない');

// 6. すでに線でつながっている記号は、結線しても、線が二重にならない（全体デバッグ 問題2）
{
  const a = { sourceType: 'pole', mainBreakerForm: 'pfs', hasCapacitor: 'yes' } as Record<string, string>;
  const gen = fromLayout(layout(buildComposition(a), a)); // 線つきの図面
  const wiresIn = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
  const direct = wiresIn(gen).find((w) => w.at1 && w.at2 && w.at1.item !== w.at2.item && !w.fan)!;
  const r1 = addFan(gen, direct.at1!.item, [direct.at2!.item]);
  ok(r1.added === 0 && wiresIn(r1.doc).length === wiresIn(gen).length, `すでに線でつながっている2つを結線して、線が増えました（${wiresIn(gen).length}→${wiresIn(r1.doc).length}）`);
  ok(r1.doc === gen, 'すでにつながっているときは、図面そのものを変えないはずです');
  // つながっていない機器だけ、結線する：つながっている機器には、線を足さない
  const added1 = addSymbol(gen, 'vcb', 400, 400);
  const gen2 = added1.doc;
  const other = gen2.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === added1.id);
  ok(!!other, 'つながっていない記号が、試験用の図面にありません');
  if (other) {
    const r2 = addFan(gen2, direct.at1!.item, [direct.at2!.item, other.id]);
    ok(r2.added === 1 && wires(r2.doc).filter((w) => w.fan!.role === 'drop').length === 1, `2つのうち、つながっていない1つだけ、結線されるはずです（added ${r2.added}／${other.id}）`);
  }
  console.log('  すでに線でつながっている記号は、結線しても、線を足さない（「新しくつなぐ機器がありません」と知らせる）');
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
