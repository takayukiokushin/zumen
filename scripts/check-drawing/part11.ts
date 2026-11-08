/**
 * 図面の検証（check-drawing）の11個目：「元の図面が変わったとき」の確認のうながし。
 * 「レイヤーに手を入れたとき、元の図面の署名を覚える」「元の図面が変わると、要確認になる」
 * 「要確認のあいだに手を入れても、確認したことにならない」「『確認した』を押すまで要確認が残る」
 * 「レイヤーを置いても、向きを変えても、元の図面の署名は変わらない」「置いたものの無いレイヤー・古いデータは対象にしない」を確かめる。
 */
import { fromLayout, moveItem } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { addLayerDot, addLayerText, baseSignature, confirmLayerReview, layerNeedsReview, layerOf, removeLayerItems, setLayerItems, setLayerOrientation } from '../../apps/web/src/editor/layers.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 元の図面が変わったときの確認');
{
  const d0: Doc = fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const vcb = d0.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.symbolId === 'vcb')!;
  const L = 'outage';
  const sig0 = baseSignature(d0);

  // 1. 何も置いていないレイヤー・まだ手を入れていないレイヤーは、対象にしない
  if (layerNeedsReview(d0, L)) fail('何も置いていないレイヤーが、要確認になっています');
  // 2. 手を入れると、そのときの元の図面の署名を覚える。元の図面が同じなら、要確認にならない
  const a = addLayerText(d0, L, 10, 10, 'メモ')!;
  if (layerOf(a.doc, L)?.seen !== sig0) fail('レイヤーに手を入れたとき、元の図面の署名を覚えていません');
  if (layerNeedsReview(a.doc, L)) fail('元の図面が変わっていないのに、要確認になっています');
  // 3. レイヤーを置いても、向きを変えても、元の図面の署名は変わらない
  const b = setLayerOrientation(addLayerDot(a.doc, L, 50, 50, true)!.doc, L, 'landscape');
  if (baseSignature(b) !== sig0 || layerNeedsReview(b, L)) fail('レイヤーの印や向きの変更で、元の図面の署名が変わっています');
  // 4. 元の図面が変わる（記号を動かす）と、要確認になる。ほかのレイヤーは、置いたものが無ければ対象外
  const moved = moveItem(b, vcb.id, 20, 0);
  if (baseSignature(moved) === sig0) fail('記号を動かしても、元の図面の署名が変わりません');
  if (!layerNeedsReview(moved, L)) fail('元の図面が変わったのに、要確認になっていません');
  if (layerNeedsReview(moved, 'withstand')) fail('何も置いていないレイヤーまで、要確認になっています');
  // 5. 要確認のあいだに手を入れても、確認したことにならない（署名はそのまま）
  const edited = addLayerText(moved, L, 30, 30, 'もう1つ')!.doc;
  if (layerOf(edited, L)?.seen !== sig0 || !layerNeedsReview(edited, L)) fail('要確認のあいだに手を入れたら、確認したことになっています');
  // 6. 「確認した」で、いまの元の図面を確認したことになる。その後は、元の図面が同じなら要確認にならない
  const ok = confirmLayerReview(edited, L);
  if (layerNeedsReview(ok, L) || layerOf(ok, L)?.seen !== baseSignature(moved)) fail('「確認した」を押しても、要確認が残っています');
  if (layerOf(ok, L)!.items.length !== layerOf(edited, L)!.items.length) fail('「確認した」で、置いたものが変わっています');
  if (!layerNeedsReview(moveItem(ok, vcb.id, 0, 20), L)) fail('確認したあとにまた元の図面が変わったのに、要確認になりません');
  // 7. 署名のない古いデータは、対象にしない。置いたものを全部外した（空の）レイヤーも、対象にしない
  const legacy = { ...moved, layers: [{ id: L, items: layerOf(a.doc, L)!.items }] };
  if (layerNeedsReview(legacy, L)) fail('署名のない古いデータが、要確認になっています');
  const emptied = removeLayerItems(moved, L, layerOf(moved, L)!.items.map((i) => i.id));
  if (layerNeedsReview(emptied, L)) fail('置いたものが無いレイヤーが、要確認になっています');
  // 8. 「操作を戻す」のように、置いたものを入れ替えても、署名の扱いは同じ（要確認のあいだは、変えない）
  const undone = setLayerItems(moved, L, layerOf(a.doc, L)!.items);
  if (layerOf(undone, L)?.seen !== sig0) fail('要確認のあいだに置いたものを入れ替えたら、署名が書き換わっています');
  console.log('  手を入れると、そのときの元の図面の署名を覚える。元の図面が変わると要確認。要確認のあいだに手を入れても、確認したことにならない。「確認した」で消え、また変われば再び要確認。置いたものが無いレイヤー・古いデータは対象外');
}
