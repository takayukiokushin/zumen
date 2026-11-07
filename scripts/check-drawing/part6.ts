/**
 * 図面の検証（check-drawing）の6つ目：開放の赤い×印。
 * 「形は正方形で太さは均一」「大きさ・太さは決めた値」「開閉器の中央に付く」「機器と一緒に動く・機器が無くなれば消える」
 * 「そのレイヤーの印刷にだけ出る」を確かめる。
 */
import { fromLayout, moveItem, removeItem } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addExtraCross, addLayerCross, addLayerText, canAddLayerCross, CROSS_CENTER_SNAP, moveLayerCrosses, resetCross, canMark, crossOn, layerOf, markPoint, purgeOrphanCrosses, resolveCrosses, setCrossSize, setLayerItems } from '../../apps/web/src/editor/layers.ts';
import type { LayerCross } from '../../apps/web/src/editor/layers.ts';
import { buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, CROSS_SPECS, OVERLAY_RED, crossPoints, layout, rotatedPort } from '../../packages/layout/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 開放の赤い×印');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const d0 = base();
  const syms = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const vcb = syms.find((s) => s.symbolId === 'vcb')!;
  const pas = syms.find((s) => s.symbolId.startsWith('pas'))!;

  // 1. 大きさ・太さ（決めた値）：小＝変圧器の丸の横幅36・太さ9、中＝60・12、大＝PASの外枠の横幅84・太さ15（母線の太さ3の、3・4・5倍）
  const want = { S: [36, 9], M: [60, 12], L: [84, 15] } as const;
  for (const k of ['S', 'M', 'L'] as const) {
    if (CROSS_SPECS[k].size !== want[k][0] || CROSS_SPECS[k].thickness !== want[k][1]) fail(`×印の${k}は、横幅${want[k][0]}・太さ${want[k][1]}のはずが、${CROSS_SPECS[k].size}・${CROSS_SPECS[k].thickness}です`);
  }
  if (getSymbol('bus').shapes.find((s) => s.k === 'line')?.sw !== 3) fail('母線の太さが3ではありません（×印の太さの元になる値）');

  // 2. 形：外形がちょうど size×size の正方形。太さは均一（斜めの帯の、向かい合う辺の間隔が、太さと同じ）
  for (const k of ['S', 'M', 'L'] as const) {
    const { size, thickness } = CROSS_SPECS[k];
    const pts = crossPoints(100, 200, size, thickness);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (Math.abs(w - size) > 1e-9 || Math.abs(h - size) > 1e-9 || Math.abs(Math.min(...xs) - (100 - size / 2)) > 1e-9) fail(`×印${k}の外形が、${size}の正方形（中心 100,200）になっていません（${w}×${h}）`);
    // 帯の太さ：点1→点2 を通る直線と、点15（0,a）との距離
    const [x1, y1] = pts[1]!;
    const [x2, y2] = pts[2]!;
    const [px, py] = pts[15]!;
    const dist = Math.abs((x2 - x1) * (y1 - py) - (x1 - px) * (y2 - y1)) / Math.hypot(x2 - x1, y2 - y1);
    if (Math.abs(dist - thickness) > 1e-9) fail(`×印${k}の太さが均一ではありません（帯の幅 ${dist}、太さ ${thickness}）`);
  }
  console.log('  大きさ・太さは決めた値（小36・9／中60・12／大84・15）。形は正方形で、太さは均一');

  // 3. 付けられる記号と、付ける位置（図の中央）
  const can = (id: string) => canMark({ ...vcb, symbolId: id });
  const okIds = ['vcb', 'lbs', 'lbs-pf', 'ds', 'pc', 'vcs', 'mccb', 'as', 'pas', 'pas-builtin', 'ugs', 'pgs'];
  const ngIds = ['pf', 'tr-3p-dy', 'vt', 'la', 'ct', 'earth'];
  for (const id of okIds) if (!can(id)) fail(`${id} に×印を付けられません`);
  for (const id of ngIds) if (can(id)) fail(`${id} に×印を付けられてしまいます（開閉器・遮断器だけのはずです）`);
  const pm = markPoint(pas)!;
  const pdef = getSymbol(pas.symbolId);
  const frame = pdef.shapes.find((s) => s.k === 'rect') as { x: number; y: number; w: number; h: number };
  if (Math.abs(pm.x - (pas.x + frame.x + frame.w / 2)) > 1e-9 || Math.abs(pm.y - (pas.y + frame.y + frame.h / 2)) > 1e-9) fail(`PASの×印が、外枠の中央に付いていません（${pm.x},${pm.y}）`);
  const vm = markPoint(vcb)!;
  if (vm.x !== vcb.x + 24 || vm.y !== vcb.y + 36) fail(`VCBの×印が、記号の中央に付いていません（${vm.x - vcb.x},${vm.y - vcb.y}）`);
  const rot = markPoint({ ...pas, rotate: 90 })!;
  const [rx, ry] = rotatedPort(pdef.box, pdef.markCenter!.x, pdef.markCenter!.y, 90);
  if (Math.abs(rot.x - (pas.x + rx)) > 1e-9 || Math.abs(rot.y - (pas.y + ry)) > 1e-9) fail('記号を回したとき、×印の位置が合いません');
  console.log('  付けられるのは、開閉器・遮断器（PAS・UGS・PGS・VCB・LBS・DS・PC・VCS・MCCB・AS）。付ける位置は、PASは外枠の中央、そのほかは記号の中央（回していても合う）');

  // 4. 付ける・外す・大きさを変える
  const r1 = addLayerCross(d0, 'outage', vcb.id, 'M');
  if (!r1) throw new Error('VCBに×印を付けられません');
  if (addLayerCross(r1.doc, 'outage', vcb.id, 'L') !== null) fail('同じ開閉器に、×印を2つ付けられてしまいます');
  if (addLayerCross(d0, 'outage', syms.find((s) => s.symbolId.startsWith('tr-'))!.id, 'M') !== null) fail('変圧器に×印を付けられてしまいます');
  if (addLayerCross(d0, 'nai', vcb.id, 'M') !== null) fail('存在しないレイヤーに、×印が付けられてしまいます');
  if (!crossOn(r1.doc, 'outage', vcb.id) || crossOn(r1.doc, 'withstand', vcb.id)) fail('×印が付いている開閉器の見分けが合いません（レイヤーごとのはずです）');
  const r2 = addLayerCross(r1.doc, 'outage', pas.id, 'S')!;
  const big = setCrossSize(r2.doc, 'outage', r1.id, 'L');
  if (resolveCrosses(big, 'outage').find((c) => c.id === r1.id)?.size !== 84) fail('×印の大きさを変えられません');

  // 5. 機器と一緒に動く。機器が無くなったら、画面にも印刷にも出ない。保存するときに、データから外す
  const moved = moveItem(r1.doc, vcb.id, 30, 40);
  const c0 = resolveCrosses(r1.doc, 'outage')[0]!;
  const c1 = resolveCrosses(moved, 'outage')[0]!;
  if (Math.abs(c1.x - (c0.x + 30)) > 1e-9 || Math.abs(c1.y - (c0.y + 40)) > 1e-9) fail('開閉器を動かしても、×印が一緒に動きません');
  const gone = removeItem(r1.doc, vcb.id);
  if (resolveCrosses(gone, 'outage').length !== 0) fail('開閉器が無くなっても、×印が出ています');
  if (layerOf(gone, 'outage')!.items.length !== 1) fail('開閉器が無くなった直後に、×印のデータを消してはいけません（「操作を戻す」で戻れるように、取っておく）');
  if (layerOf(purgeOrphanCrosses(gone), 'outage')!.items.length !== 0) fail('保存するとき、機器が無くなった×印を、データから外せません');
  const withText = addLayerText(gone, 'outage', 10, 10, '残る文字')!.doc;
  if (layerOf(purgeOrphanCrosses(withText), 'outage')!.items.length !== 1) fail('×印を外すとき、文字まで消えています');
  if (purgeOrphanCrosses(r1.doc) !== r1.doc) fail('外すものが無いときは、図面をそのまま返すはずです');
  console.log('  付ける・外す・大きさを変える。開閉器を動かすと一緒に動く。開閉器が無くなったら出なくなり、保存するときにデータから外す（文字は残す）');

  // 5b. 中央からずらせる（付けた開閉器について動く）。中央の近くまで戻すと中央に戻る。同じ開閉器に、2つ以上付けられる
  const shifted = moveLayerCrosses(r1.doc, 'outage', [r1.id], 10, 6);
  const sc = resolveCrosses(shifted, 'outage')[0]!;
  if (Math.abs(sc.x - (c0.x + 10)) > 1e-9 || Math.abs(sc.y - (c0.y + 6)) > 1e-9 || sc.dx !== 10 || sc.dy !== 6) fail('×印を中央からずらせません');
  const shiftedMoved = resolveCrosses(moveItem(shifted, vcb.id, 30, 40), 'outage')[0]!;
  if (Math.abs(shiftedMoved.x - (sc.x + 30)) > 1e-9 || Math.abs(shiftedMoved.y - (sc.y + 40)) > 1e-9) fail('ずらした×印が、開閉器を動かしたときに、一緒に動きません');
  const back = moveLayerCrosses(shifted, 'outage', [r1.id], -10, -6);
  const bc = layerOf(back, 'outage')!.items[0] as LayerCross;
  if ('dx' in bc || 'dy' in bc || crossOn(back, 'outage', vcb.id)?.id !== r1.id) fail('元の位置に戻したとき、×印が中央に戻っていません');
  const near = moveLayerCrosses(shifted, 'outage', [r1.id], -10 + (CROSS_CENTER_SNAP - 1), -6);
  if ('dx' in (layerOf(near, 'outage')!.items[0] as LayerCross)) fail('中央の近くまで戻したのに、中央に戻りません');
  if (crossOn(shifted, 'outage', vcb.id) !== undefined) fail('ずらした×印が、「中央の×印」として扱われています（開閉器をクリックしたとき、ずらした×印を外してはいけません）');
  const resetDoc = resetCross(shifted, 'outage', r1.id);
  if ('dx' in (layerOf(resetDoc, 'outage')!.items[0] as LayerCross)) fail('「中央に戻す」が効きません');
  // 同じ開閉器に、もう1つ。ずらした×印があれば、中央にも付けられる
  const extra = addExtraCross(r1.doc, 'outage', r1.id);
  if (!extra) throw new Error('同じ開閉器に、×印を増やせません');
  const ex = resolveCrosses(extra.doc, 'outage');
  const [e0, e1] = [ex.find((c) => c.id === r1.id)!, ex.find((c) => c.id === extra.id)!];
  if (ex.length !== 2 || e1.target !== e0.target || e1.sizeId !== e0.sizeId) fail('増やした×印が、同じ開閉器・同じ大きさになっていません');
  if (Math.abs(e1.x - e0.x) < e0.size) fail(`増やした×印が、元の×印と重なっています（中心の間隔 ${Math.abs(e1.x - e0.x)}、大きさ ${e0.size}）`);
  if (crossOn(extra.doc, 'outage', vcb.id)?.id !== r1.id) fail('増やしたあとも、中央の×印は、元のものを指すはずです');
  const centerFree = addLayerCross(shifted, 'outage', vcb.id, 'S');
  if (!centerFree || resolveCrosses(centerFree.doc, 'outage').length !== 2) fail('×印をずらしたあと、同じ開閉器の中央に、別の×印を付けられません');
  const both = purgeOrphanCrosses(removeItem(extra.doc, vcb.id));
  if (layerOf(both, 'outage')!.items.length !== 0) fail('開閉器が無くなったとき、増やした×印まで、データから外れません');
  const movedBoth = resolveCrosses(moveItem(extra.doc, vcb.id, 20, 0), 'outage');
  if (Math.abs(movedBoth[0]!.x - (ex[0]!.x + 20)) > 1e-9 || Math.abs(movedBoth[1]!.x - (ex[1]!.x + 20)) > 1e-9) fail('増やした×印が、開閉器と一緒に動きません');
  console.log('  中央からずらせる（ドラッグ・矢印キー）。中央の近くへ戻すと中央に戻る。同じ開閉器に、大きさの違う×印も含めて、何個でも付けられる。どれも開閉器について動く');

  // 6. 上限（1つのレイヤーに100個まで）
  const many: LayerCross[] = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND }, (_, i) => ({ kind: 'cross', id: `lc-${i}`, target: 'x', size: 'S' }));
  const full = setLayerItems(d0, 'withstand', many);
  if (canAddLayerCross(full, 'withstand') || addLayerCross(full, 'withstand', vcb.id, 'S') !== null) fail(`上限（${MAX_LAYER_ITEMS_PER_KIND}個）を超えて、×印が付けられます`);
  if (!canAddLayerCross(full, 'outage')) fail('ほかのレイヤーの×印の数まで、数えています');

  // 7. 印刷：そのレイヤーの印刷にだけ、赤い×印が出る。元の図面の印刷は変わらない
  const title = { site: '見本工場', name: '停電範囲図', footer: COMPANY_NAME };
  const sheet = (d: Doc, layerId: string | null) => {
    const crosses = layerId ? resolveCrosses(d, layerId).map((c) => ({ x: c.x, y: c.y, size: c.size, thickness: c.thickness })) : [];
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation, crosses);
  };
  const baseSvg = sheet(r2.doc, null);
  const outageSvg = sheet(r2.doc, 'outage');
  const withstandSvg = sheet(r2.doc, 'withstand');
  // 記号の中にも polygon（矢じりなど）があるので、赤い色のものだけを数える
  const reds = (svg: string) => svg.match(new RegExp(`<polygon points="[^"]+" fill="${OVERLAY_RED}"`, 'g')) ?? [];
  if (reds(outageSvg).length !== 2) fail(`停電範囲図の印刷に、赤い×印が2つ出ていません（${reds(outageSvg).length}個）`);
  if (reds(baseSvg).length > 0 || reds(withstandSvg).length > 0) fail('別のレイヤーや単線結線図の印刷に、×印が出ています');
  if (baseSvg !== sheet(d0, null)) fail('×印を付けても、単線結線図の印刷が変わっています');
  const pts16 = new RegExp(`<polygon points="([^"]+)" fill="${OVERLAY_RED}"`).exec(outageSvg)![1]!.split(' ');
  if (pts16.length !== 16) fail(`×印の点が16個ではありません（${pts16.length}個）`);
  console.log('  印刷：そのレイヤーだけに、赤い×印が出る。単線結線図・ほかのレイヤーの印刷は変わらない。上限は100個（レイヤーごと）');
}
