/**
 * 図面の検証（check-drawing）の9つ目：赤い丸い点と、印加点の矢印。
 * 「丸い点は、線の途中・接続点の近くに吸い付き、つないだものと一緒に動く」「矢印は丸い点を指し、1つの点に1本」
 * 「向き（8方向）と長さを自由に変えられ、文字は『印加点』から書き換えられる」「点を外せば矢印も外れる」
 * 「そのレイヤーの印刷にだけ赤く出る」を確かめる。
 */
import { fromLayout, moveItem, portsOf, removeItem, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayerArrow, addLayerDot, arrowOn, canAddLayerArrow, canAddLayerDot, editArrow, layerOf, moveLayerDots, purgeOrphanMarks, removeLayerItems, resolveArrows, resolveDots, setArrowTail, setDotPoint, setLayerItems } from '../../apps/web/src/editor/layers.ts';
import type { LayerArrow, LayerDot } from '../../apps/web/src/editor/layers.ts';
import { ARROW_LABEL_DEFAULT, buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { ARROW_DIRS, ARROW_GAP, ARROW_HEAD, ARROW_LEN_MAX, ARROW_LEN_MIN, ARROW_STROKE, COMPANY_NAME, DOT_RADIUS, OVERLAY_RED, arrowFromTail, arrowSvg, arrowTail, arrowTip, dotSvg, layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 赤い丸い点と、印加点の矢印');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const d0 = base();
  const syms = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const wires = d0.items.filter((i): i is DocWire => i.kind === 'wire');
  const vcb = syms.find((s) => s.symbolId === 'vcb')!;
  const L = 'outage';

  // 1. 形：丸い点は、赤で塗りつぶした小さな丸。矢印は、点の縁のすぐ外から、尾まで。頭つき・赤
  const dsv = dotSvg({ x: 10, y: 20 });
  if (!dsv.includes(`r="${DOT_RADIUS}"`) || !dsv.includes(`fill="${OVERLAY_RED}"`)) fail('丸い点が、赤で塗りつぶした丸になっていません');
  for (const dir of ARROW_DIRS) {
    const a = { x: 100, y: 100, dir, len: 40 };
    const tip = arrowTip(a);
    const tail = arrowTail(a);
    if (Math.abs(Math.hypot(tip.x - 100, tip.y - 100) - (DOT_RADIUS + ARROW_GAP)) > 1e-9) fail(`${dir}：矢印の先が、丸い点の縁のすぐ外にありません`);
    if (Math.abs(Math.hypot(tail.x - 100, tail.y - 100) - 40) > 1e-9) fail(`${dir}：尾までの長さが、決めた長さになっていません`);
    // 尾は、点から見て、その向きにある
    const back = arrowFromTail(tail.x - 100, tail.y - 100);
    if (back.dir !== dir || back.len !== 40) fail(`${dir}：尾の位置から、向きと長さを読み戻せません（${back.dir}・${back.len}）`);
  }
  const asv = arrowSvg({ x: 0, y: 0, dir: 'w', len: 40 });
  if (!asv.includes('<line') || !asv.includes('<polygon') || !asv.includes(OVERLAY_RED) || !asv.includes(`stroke-width="${ARROW_STROKE}"`)) fail('矢印が、赤い線と頭になっていません');
  if (arrowFromTail(0, -500).len !== ARROW_LEN_MAX || arrowFromTail(1, 1).len !== ARROW_LEN_MIN) fail('矢印の長さが、範囲（最短〜最長）に収まっていません');
  if (ARROW_LEN_MIN < ARROW_HEAD + DOT_RADIUS) fail('矢印の最短の長さが、頭と点より短くなっています');
  console.log(`  丸い点：赤で塗りつぶした半径${DOT_RADIUS}の丸。矢印：8方向・長さ${ARROW_LEN_MIN}〜${ARROW_LEN_MAX}・太さ${ARROW_STROKE}の赤い線と頭。先は、点の縁のすぐ外`);

  // 2. 点を置く：記号の接続点・線の途中の近くなら、吸い付く。Alt（free）なら、吸い付かず、その場所（格子に合わせる）
  const port = portsOf(vcb)[0]!;
  const onPort = addLayerDot(d0, L, port.x + 2, port.y + 1)!;
  const dp = layerOf(onPort.doc, L)!.items[0] as LayerDot;
  if (dp.anchor?.kind !== 'port') fail('記号の接続点の近くに置いた点が、接続点に吸い付いていません');
  const r0 = resolveDots(onPort.doc, L)[0]!;
  if (Math.abs(r0.x - port.x) > 1e-9 || Math.abs(r0.y - port.y) > 1e-9) fail('接続点に吸い付いた点が、接続点の位置にありません');
  const wire = wires.find((w) => w.x1 === w.x2 && Math.abs(w.y2 - w.y1) > 60)!;
  const onWire = addLayerDot(d0, L, wire.x1 + 2, (wire.y1 + wire.y2) / 2 + 1)!;
  const dw = layerOf(onWire.doc, L)!.items[0] as LayerDot;
  const rw = resolveDots(onWire.doc, L)[0]!;
  if (dw.anchor?.kind !== 'wire' || Math.abs(rw.x - wire.x1) > 1e-9) fail('線の途中の近くに置いた点が、線の上に吸い付いていません');
  const freeAt = addLayerDot(d0, L, port.x + 2, port.y + 1, true)!;
  const dfr = layerOf(freeAt.doc, L)!.items[0] as LayerDot;
  const rf = resolveDots(freeAt.doc, L)[0]!;
  if (dfr.anchor || rf.x % 2 !== 0 || rf.y % 2 !== 0) fail('吸い付きを切って置いた点が、置いた場所（格子に合わせた位置）になっていません');
  const far = addLayerDot(d0, L, -300, -300)!;
  if ((layerOf(far.doc, L)!.items[0] as LayerDot).anchor) fail('遠くに置いた点が、どこかに吸い付いています');
  if (addLayerDot(d0, 'nai', 10, 10) !== null) fail('存在しないレイヤーに、置けてしまいます');
  // 複数置ける
  let many = d0;
  for (let i = 0; i < 5; i++) many = addLayerDot(many, L, i * 40 - 200, -300, true)!.doc;
  if (resolveDots(many, L).length !== 5) fail('丸い点を5つ置けません');
  console.log('  記号の接続点・線の途中の近くに置くと吸い付く。Alt（吸い付きを切る）なら、置いた場所（格子に合わせる）。複数置ける');

  // 3. 動く：つないだ記号について動く。無くなれば出なくなり、保存のときにデータから外れる（矢印も）
  const moved = resolveDots(moveItem(onPort.doc, vcb.id, 30, 40), L)[0]!;
  if (Math.abs(moved.x - (port.x + 30)) > 1e-9 || Math.abs(moved.y - (port.y + 40)) > 1e-9) fail('点が、つないだ記号と一緒に動きません');
  const withArrow = addLayerArrow(onPort.doc, L, onPort.id)!;
  const gone = removeItem(withArrow.doc, vcb.id);
  if (resolveDots(gone, L).length !== 0 || resolveArrows(gone, L).length !== 0) fail('つないだ記号が無くなったのに、点や矢印が出ています');
  const purged = purgeOrphanMarks(gone);
  if (layerOf(purged, L)!.items.length !== 0) fail('無くなった点（と矢印）が、保存のときにデータから外れません');
  // 吸い付いていない点は、近くの機器について動く
  const dnear = layerOf(freeAt.doc, L)!.items[0] as LayerDot;
  const nearSym = syms.find((s) => sameName(s.id) === dnear.near);
  if (!nearSym) fail('吸い付いていない点が、近くの機器を覚えていません');
  else {
    const f0 = resolveDots(freeAt.doc, L)[0]!;
    const f1 = resolveDots(moveItem(freeAt.doc, nearSym.id, 20, 10), L)[0]!;
    if (Math.abs(f1.x - (f0.x + 20)) > 1e-9 || Math.abs(f1.y - (f0.y + 10)) > 1e-9) fail('吸い付いていない点が、近くの機器と一緒に動きません');
    if (resolveDots(removeItem(freeAt.doc, nearSym.id), L).length !== 0) fail('近くの機器が無くなったのに、吸い付いていない点が出ています');
  }
  // 動かす（矢印キー：吸い付きは外れる／ドラッグ：吸い付く）
  const key = resolveDots(moveLayerDots(onPort.doc, L, [onPort.id], 8, -4), L)[0]!;
  if (Math.abs(key.x - (port.x + 8)) > 1e-9 || Math.abs(key.y - (port.y - 4)) > 1e-9) fail('矢印キーで、点を動かせません');
  const drag = layerOf(setDotPoint(freeAt.doc, L, freeAt.id, port.x + 1, port.y), L)!.items[0] as LayerDot;
  if (drag.anchor?.kind !== 'port') fail('点をドラッグして接続点の近くに離したとき、吸い付きません');
  const dragFree = layerOf(setDotPoint(freeAt.doc, L, freeAt.id, port.x + 1, port.y, true), L)!.items[0] as LayerDot;
  if (dragFree.anchor) fail('Alt キーを押してドラッグしたとき、吸い付いています');
  console.log('  つないだ記号と一緒に動く。無くなれば出なくなり、保存のときにデータから外れる（矢印も）。ドラッグ・矢印キーで動かせる');

  // 4. 矢印：丸い点を指す。1つの点に1本。最初の文字は「印加点」
  const a1 = addLayerArrow(onPort.doc, L, onPort.id)!;
  const ar = resolveArrows(a1.doc, L)[0]!;
  if (ar.dot !== onPort.id || ar.label?.lines.join('') !== ARROW_LABEL_DEFAULT || ARROW_LABEL_DEFAULT !== '印加点') fail('矢印の最初の文字が「印加点」になっていません');
  if (ar.dir !== 'w' || ar.len !== 40) fail(`矢印の最初の向き・長さが、左・40になっていません（${ar.dir}・${ar.len}）`);
  if (addLayerArrow(a1.doc, L, onPort.id) !== null || arrowOn(a1.doc, L, onPort.id)?.id !== a1.id) fail('1つの点に、矢印を2本付けられてしまいます');
  if (addLayerArrow(onPort.doc, L, 'nai') !== null) fail('存在しない点に、矢印を付けられてしまいます');
  // 向き・長さ・文字
  const e1 = resolveArrows(editArrow(a1.doc, L, a1.id, { dir: 'ne', len: 64, label: ['印加点', '（A相）'], size: 2, bold: true }), L)[0]!;
  if (e1.dir !== 'ne' || e1.len !== 64 || e1.label?.lines.join('/') !== '印加点/（A相）' || e1.label.size !== 2 || !e1.label.bold) fail('矢印の向き・長さ・文字を、自由に変えられません');
  if (resolveArrows(editArrow(a1.doc, L, a1.id, { len: 5 }), L)[0]!.len !== ARROW_LEN_MIN || resolveArrows(editArrow(a1.doc, L, a1.id, { len: 9999 }), L)[0]!.len !== ARROW_LEN_MAX) fail('矢印の長さが、範囲に収まっていません');
  if (resolveArrows(editArrow(a1.doc, L, a1.id, { label: [''] }), L)[0]!.label !== undefined) fail('文字を空にしても、文字が残っています');
  // 尾をドラッグ：向き（8方向）と長さ
  const t1 = resolveArrows(setArrowTail(a1.doc, L, a1.id, ar.x + 3, ar.y - 60), L)[0]!;
  if (t1.dir !== 'n' || t1.len < 58 || t1.len > 62) fail(`尾をドラッグして向き・長さを決められません（${t1.dir}・${t1.len}）`);
  // 点が動けば、矢印も動く。点を外せば、矢印も外れる
  const am = resolveArrows(moveItem(a1.doc, vcb.id, 30, 40), L)[0]!;
  if (Math.abs(am.x - (port.x + 30)) > 1e-9) fail('点を動かしても、矢印が一緒に動きません');
  const rm = layerOf(removeLayerItems(a1.doc, L, [onPort.id]), L)!.items;
  if (rm.length !== 0) fail('点を外しても、その点を指す矢印が残っています');
  const rmArrow = layerOf(removeLayerItems(a1.doc, L, [a1.id]), L)!.items;
  if (rmArrow.length !== 1 || rmArrow[0]!.kind !== 'dot') fail('矢印だけを外したとき、点まで消えています');
  console.log('  矢印は丸い点を指し、1つの点に1本。最初の文字は「印加点」（書き換えられる）。向き（8方向）・長さ・大きさ・太字を変えられ、尾のドラッグでも決められる。点が動けば一緒に動き、点を外せば矢印も外れる');

  // 5. 上限（点100・矢印100）
  const dots: LayerDot[] = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND }, (_, i) => ({ kind: 'dot', id: `ld-${i}`, x: i, y: 0, ndx: i, ndy: 0 }));
  const fullDots = setLayerItems(d0, 'withstand', dots);
  if (canAddLayerDot(fullDots, 'withstand') || addLayerDot(fullDots, 'withstand', 0, 0) !== null || !canAddLayerDot(fullDots, L)) fail(`点の上限（${MAX_LAYER_ITEMS_PER_KIND}個）が合いません`);
  const arrows: LayerArrow[] = dots.map((d, i) => ({ kind: 'arrow', id: `la-${i}`, dot: d.id }));
  const fullArrows = setLayerItems(d0, 'withstand', [...dots, ...arrows]);
  if (canAddLayerArrow(fullArrows, 'withstand') || addLayerArrow(fullArrows, 'withstand', 'ld-0') !== null) fail(`矢印の上限（${MAX_LAYER_ITEMS_PER_KIND}本）が合いません`);

  // 6. 印刷：そのレイヤーだけに、赤い点・矢印・文字が出る。単線結線図・ほかのレイヤーは変わらない
  const title = { site: '見本工場', name: '停電範囲図', footer: COMPANY_NAME };
  const sheet = (d: Doc, layerId: string | null) => {
    const dots = layerId ? resolveDots(d, layerId).map((p) => ({ x: p.x, y: p.y })) : [];
    const arrows = layerId ? resolveArrows(d, layerId).map((a) => ({ x: a.x, y: a.y, dir: a.dir, len: a.len, ...(a.label ? { label: a.label } : {}) })) : [];
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation, [], [], [], { dots, arrows });
  };
  let two = addLayerDot(d0, L, port.x, port.y)!;
  two = { doc: addLayerDot(two.doc, L, port.x + 100, port.y + 100, true)!.doc, id: two.id };
  const withA = addLayerArrow(two.doc, L, two.id)!.doc;
  const svg = sheet(withA, L);
  const circles = (svg.match(new RegExp(`<circle cx="[^"]+" cy="[^"]+" r="${DOT_RADIUS}" fill="${OVERLAY_RED}"`, 'g')) ?? []).length;
  const heads = (svg.match(new RegExp(`<polygon points="[^"]+" fill="${OVERLAY_RED}" stroke="none"`, 'g')) ?? []).length;
  if (circles !== 2) fail(`印刷に、赤い丸い点が2つ出ていません（${circles}個）`);
  if (heads !== 1) fail(`印刷に、矢印が1本出ていません（${heads}本）`);
  if (!new RegExp(`fill="${OVERLAY_RED}" stroke="none"><tspan[^>]*>印加点</tspan>`).test(svg)) fail('矢印の文字が、赤で出ていません');
  const other = sheet(withA, 'withstand');
  if (other.includes(`r="${DOT_RADIUS}" fill="${OVERLAY_RED}"`) || sheet(withA, null) !== sheet(d0, null)) fail('別のレイヤー・単線結線図の印刷が、変わっています');
  console.log(`  印刷：そのレイヤーだけに、赤い丸い点・矢印・文字が出る。単線結線図・ほかのレイヤーの印刷は変わらない。上限は点・矢印とも${MAX_LAYER_ITEMS_PER_KIND}（レイヤーごと）`);
}
