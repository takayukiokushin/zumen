/**
 * 図面の検証（check-drawing）の13個目：保存データを読み込むときの、レイヤーの整理（sanitizeLayers）と、数でない値の扱い。
 * 「このアプリが作ったデータは、そのまま通る」「形の合わないものは、その項目だけ外す」「同じ id・上限・追加レイヤーの数を収める」
 * 「数でない値（NaN）が入っても、図に NaN が出ない」を確かめる。
 */
import { fromLayout, portsOf, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc } from '../../apps/web/src/editor/doc.ts';
import { addLayerArea, addLayerArrow, addLayerCross, addLayerDot, addLayerGround, addLayerLink, addLayerText, editArrow, editGround, layerOf, sanitizeLayers, withCleanLayers } from '../../apps/web/src/editor/layers.ts';
import { buildComposition, MAX_CUSTOM_LAYERS, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { ARROW_LEN_DEFAULT, GROUND_DROP_MIN, clampArrowLen, clampDrop, clampLead, layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 保存データの読み込み（レイヤーの整理）と、数でない値');
{
  const d0: Doc = fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const vcb = d0.items.find((i) => i.kind === 'symbol' && i.symbolId === 'vcb')!;
  if (vcb.kind !== 'symbol') throw new Error('VCB がありません');
  const L = 'outage';

  // 1. このアプリが作ったデータは、そのまま通る（すべての種類・すべての項目）
  let d = addLayerText(d0, L, 1, 2, 'メモ')!.doc;
  d = addLayerCross(d, L, vcb.id, 'L')!.doc;
  const port = portsOf(vcb)[0]!;
  const gr = addLayerGround(d, L, { kind: 'port', item: sameName(vcb.id), port: port.id }, port.x + 30, port.y + 40)!;
  d = editGround(gr.doc, L, gr.id, { lead: 24, label: ['No.1'], size: 2, bold: true });
  const a = addLayerDot(d, L, 5, 6, true)!;
  const b = addLayerDot(a.doc, L, 50, 60, true)!;
  d = addLayerArea(b.doc, L, { x: 0, y: 0, w: 100, h: 80 }, 'live')!.doc;
  const ar = addLayerArrow(d, L, a.id)!;
  d = editArrow(ar.doc, L, ar.id, { dir: 'ne', len: 60, label: ['印加点'], size: 2, bold: true });
  d = addLayerLink(d, L, a.id, b.id, 'round')!.doc;
  const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));
  if (canon(sanitizeLayers(d.layers)) !== canon(d.layers)) fail('このアプリが作ったレイヤーのデータが、読み込むときの整理で変わっています');
  if (withCleanLayers(d0) !== d0) fail('レイヤーが無い図面は、そのまま返すはずです');

  // 2. 形の合わないものは、その項目だけ外す
  const bad = sanitizeLayers([
    { id: 'outage', items: [{ kind: 'dot', id: 'ok', x: 1, y: 2, ndx: 1, ndy: 2 }, { kind: 'dot', id: 'noX', y: 2, ndx: 1, ndy: 2 }, { kind: 'zzz', id: 'q' }, null, 5, { kind: 'arrow', id: 'ar', dot: 'ok', dir: 'sideways', len: 'long', label: [1, 2] }] },
    'x',
    null,
    { id: '', items: [] },
    { id: 'custom-1', items: [] },
  ])!;
  if (bad.length !== 1 || bad[0]!.id !== 'outage') fail(`形の合わないレイヤーを外せていません（${bad.map((l) => l.id).join(',')}）`);
  const items = bad[0]!.items;
  if (items.map((i) => i.id).join() !== 'ok,ar') fail(`必要な項目が合わない項目を外せていません（${items.map((i) => i.id).join()}）`);
  const arrow = items.find((i) => i.kind === 'arrow');
  if (!arrow || 'dir' in arrow || 'len' in arrow || 'label' in arrow) fail('なくてよい項目が合わないとき、その項目だけ外すはずです');
  if (sanitizeLayers('x')?.length !== 0 || sanitizeLayers(undefined) !== undefined) fail('レイヤー全体が配列でないときは空に、無いときは無いままのはずです');

  // 3. 同じ id・追加レイヤーの数・種類ごとの上限を収める
  const many = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND + 20 }, (_, i) => ({ kind: 'dot', id: `d${i}`, x: i, y: 0, ndx: i, ndy: 0 }));
  const lim = sanitizeLayers([
    { id: 'outage', items: [...many, { kind: 'dot', id: 'd0', x: 9, y: 9, ndx: 9, ndy: 9 }] },
    { id: 'outage', items: [] },
    ...Array.from({ length: MAX_CUSTOM_LAYERS + 2 }, (_, i) => ({ id: `custom-${i + 1}`, name: `名${i}`, items: [] })),
  ])!;
  if (lim.filter((l) => l.id === 'outage').length !== 1) fail('同じ id のレイヤーが重なっています');
  if (lim[0]!.items.length !== MAX_LAYER_ITEMS_PER_KIND) fail(`種類ごとの上限（${MAX_LAYER_ITEMS_PER_KIND}）に収まっていません（${lim[0]!.items.length}）`);
  if (lim.filter((l) => l.id.startsWith('custom-')).length !== MAX_CUSTOM_LAYERS) fail(`追加レイヤーが ${MAX_CUSTOM_LAYERS} 個に収まっていません`);
  if (new Set(lim[0]!.items.map((i) => i.id)).size !== lim[0]!.items.length) fail('同じ id の項目が重なっています');

  // 4. 数でない値（NaN）が入っても、図に NaN が出ない
  if (clampArrowLen(NaN) !== ARROW_LEN_DEFAULT || clampArrowLen(Infinity) !== ARROW_LEN_DEFAULT) fail('矢印の長さが数でないとき、最初の長さにするはずです');
  if (clampDrop(NaN) !== GROUND_DROP_MIN || clampLead(NaN) !== 0) fail('接地の縦・横棒の長さが数でないとき、最小の縦・横棒なしにするはずです');
  const gd = editGround(d, L, gr.id, { drop: NaN, lead: NaN });
  if (JSON.stringify(layerOf(gd, L)).includes('null')) fail('接地の長さに NaN を入れると、保存データに null が入ります');
  console.log('  このアプリが作ったデータは、そのまま通る／形の合わない項目だけ外す／同じ id・上限・追加レイヤーの数を収める／数でない値は、既定の値にする');
}
