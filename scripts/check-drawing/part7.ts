/**
 * 図面の検証（check-drawing）の7つ目：赤い接地のマーク（短絡接地器具を取り付ける場所）。
 * 「図面の好きな場所に置ける」「近くの機器について動く」「機器が無くなれば出なくなり、保存時にデータから外す」
 * 「向きを変えられる」「そのレイヤーの印刷にだけ赤く出る」を確かめる。
 */
import { fromLayout, moveItem, removeItem, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayerGround, canAddLayerGround, layerOf, moveLayerItems, purgeOrphanMarks, removeLayerItems, resolveGrounds, rotateGround, setLayerItems } from '../../apps/web/src/editor/layers.ts';
import type { LayerGround } from '../../apps/web/src/editor/layers.ts';
import { buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, GROUND_STROKE, GROUND_ROTATES, OVERLAY_RED, groundBounds, groundShapes, groundSvg, layout } from '../../packages/layout/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 赤い接地のマーク');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const d0 = base();
  const syms = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const vcb = syms.find((s) => s.symbolId === 'vcb')!;

  // 1. 形：接地の記号と同じ比率（3本の横線）に、縦の線をつけたもの。線は太め（2）
  const shapes = groundShapes();
  const bars = shapes.filter((s) => s.k === 'line' && s.y1 === s.y2) as { x1: number; x2: number }[];
  const earthBars = getSymbol('earth').shapes.filter((s) => s.k === 'line' && s.y1 === s.y2) as { x1: number; x2: number }[];
  const ratios = bars.map((b, i) => (b.x2 - b.x1) / (earthBars[i]!.x2 - earthBars[i]!.x1));
  if (bars.length !== 3 || ratios.some((r) => Math.abs(r - ratios[0]!) > 1e-9)) fail(`接地のマークの横線が、接地の記号と同じ比率の3本になっていません（${ratios.join(',')}）`);
  if (GROUND_STROKE !== 2 || shapes.some((s) => (s as { sw?: number }).sw !== 2)) fail('接地のマークの線の太さが2（少し太め）ではありません');
  if (!groundSvg(10, 20, 0).includes(OVERLAY_RED)) fail('接地のマークが赤になっていません');
  // 外形：向きを回しても、面積は同じで、取り付ける点が角に来る
  const b0 = groundBounds(100, 100, 0);
  const sizes = GROUND_ROTATES.map((r) => groundBounds(100, 100, r)).map((b) => [Math.round((b.x1 - b.x0) * 100) / 100, Math.round((b.y1 - b.y0) * 100) / 100]);
  if (sizes[0]![0] !== sizes[2]![0] || sizes[1]![0] !== sizes[0]![1] || sizes[3]![1] !== sizes[0]![0]) fail(`向きを回したときの外形の縦横が合いません（${JSON.stringify(sizes)}）`);
  if (b0.y0 !== 100 || groundBounds(100, 100, 180).y1 !== 100 || groundBounds(100, 100, 90).x1 !== 100 || groundBounds(100, 100, 270).x0 !== 100) fail('取り付ける点が、外形の端（縦の線の先）に来ていません');
  console.log('  形：接地の記号と同じ比率の3本の横線に、縦の線を付けたもの。赤・太さ2（ふつうの線の2倍）。向きは、下・左・上・右');

  // 2. 図面の好きな場所に置ける
  const near = addLayerGround(d0, 'outage', vcb.x + 70, vcb.y + 10, 90);
  if (!near) throw new Error('接地のマークを置けません');
  const gNear = layerOf(near.doc, 'outage')!.items[0] as LayerGround;
  if (gNear.near === undefined || gNear.rotate !== 90) fail('機器の近くに置いたとき、近くの機器と向きを覚えていません');
  const r0 = resolveGrounds(near.doc, 'outage')[0]!;
  if (r0.x !== vcb.x + 70 || r0.y !== vcb.y + 10 || r0.rotate !== 90) fail(`置いた場所に出ません（${r0.x},${r0.y}）`);
  const far = addLayerGround(d0, 'outage', 5000, 5000);
  if (!far) throw new Error('機器から遠い場所に、置けません');
  const gFar = layerOf(far.doc, 'outage')!.items[0] as LayerGround;
  if (gFar.near !== undefined) fail('近くに機器が無い場所なのに、機器にくっつけています');
  if (addLayerGround(d0, 'nai', 0, 0) !== null) fail('存在しないレイヤーに、置けてしまいます');
  console.log('  図面の好きな場所に置ける（置いた場所と向きのとおりに出る）。近くに機器が無い場所は、その場所のまま');

  // 3. 近くの機器について動く。機器が無くなったら出ない・保存時にデータから外す。遠くに置いたものは、そのまま残る
  // （「近くの機器」は、置いた場所にいちばん近い記号。VCBとは限らないので、覚えている機器を探す）
  const nearSym = syms.find((x) => sameName(x.id) === gNear.near)!;
  const moved = resolveGrounds(moveItem(near.doc, nearSym.id, 30, 40), 'outage')[0]!;
  if (Math.abs(moved.x - (r0.x + 30)) > 1e-9 || Math.abs(moved.y - (r0.y + 40)) > 1e-9) fail('近くの機器を動かしても、接地のマークが一緒に動きません');
  const gone = removeItem(near.doc, nearSym.id);
  if (resolveGrounds(gone, 'outage').length !== 0) fail('近くの機器が無くなっても、接地のマークが出ています');
  if (layerOf(gone, 'outage')!.items.length !== 1) fail('機器が無くなった直後に、接地のマークのデータを消してはいけません（「操作を戻す」で戻れるように）');
  if (layerOf(purgeOrphanMarks(gone), 'outage')!.items.length !== 0) fail('保存するとき、機器が無くなった接地のマークを、データから外せません');
  const farGone = removeItem(far.doc, nearSym.id);
  if (resolveGrounds(farGone, 'outage').length !== 1 || layerOf(purgeOrphanMarks(farGone), 'outage')!.items.length !== 1) fail('機器から遠い場所に置いたものまで、消えています');
  console.log('  近くの機器を動かすと一緒に動く。その機器が無くなったら、出なくなり、保存するときにデータから外す（遠くに置いたものは残る）');

  // 4. 動かす・向きを変える・消す・上限
  const mv = moveLayerItems(near.doc, 'outage', [near.id], 10, -6);
  const m1 = resolveGrounds(mv, 'outage')[0]!;
  if (Math.abs(m1.x - (r0.x + 10)) > 1e-9 || Math.abs(m1.y - (r0.y - 6)) > 1e-9) fail('接地のマークを動かせません');
  const rot = resolveGrounds(rotateGround(near.doc, 'outage', near.id, 270), 'outage')[0]!;
  if (rot.rotate !== 270) fail('接地のマークの向きを変えられません');
  if (layerOf(removeLayerItems(near.doc, 'outage', [near.id]), 'outage')!.items.length !== 0) fail('接地のマークを消せません');
  const many: LayerGround[] = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND }, (_, i) => ({ kind: 'ground', id: `lg-${i}`, x: i, y: 0, rotate: 0, ndx: i, ndy: 0 }));
  const full = setLayerItems(d0, 'withstand', many);
  if (canAddLayerGround(full, 'withstand') || addLayerGround(full, 'withstand', 0, 0) !== null) fail(`上限（${MAX_LAYER_ITEMS_PER_KIND}個）を超えて、置けてしまいます`);
  if (!canAddLayerGround(full, 'outage')) fail('ほかのレイヤーの数まで、数えています');
  console.log(`  動かせる・向きを変えられる・消せる。1つのレイヤーに${MAX_LAYER_ITEMS_PER_KIND}個まで（レイヤーごとに数える）`);

  // 5. 印刷：そのレイヤーだけに、赤い接地のマークが出る
  const title = { site: '見本工場', name: '停電範囲図', footer: COMPANY_NAME };
  const sheet = (d: Doc, layerId: string | null) => {
    const grounds = layerId ? resolveGrounds(d, layerId).map((g) => ({ x: g.x, y: g.y, rotate: g.rotate })) : [];
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation, [], grounds);
  };
  const outage = sheet(near.doc, 'outage');
  const reds = (svg: string) => (svg.match(new RegExp(`<g transform="translate\\([^)]*\\)[^"]*" stroke="${OVERLAY_RED}"`, 'g')) ?? []).length;
  if (reds(outage) !== 1) fail(`停電範囲図の印刷に、赤い接地のマークが1つ出ていません（${reds(outage)}個）`);
  if (reds(sheet(near.doc, 'withstand')) !== 0 || reds(sheet(near.doc, null)) !== 0) fail('別のレイヤーや単線結線図の印刷に、接地のマークが出ています');
  if (sheet(near.doc, null) !== sheet(d0, null)) fail('接地のマークを置いても、単線結線図の印刷が変わっています');
  console.log('  印刷：そのレイヤーだけに、赤い接地のマークが出る。単線結線図・ほかのレイヤーの印刷は変わらない');
}
