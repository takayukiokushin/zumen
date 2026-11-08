/**
 * 図面の検証（check-drawing）の10個目：渡り線（赤い丸い点と点を、弧の線でつなぐもの）。
 * 「弧の形は4つ（直線・ゆるい弧・普通の弧・すごく丸い弧）で、ふくらみの高さが決めた割合」「ふくらむ向きを反転できる」
 * 「点から点へ、続けて引ける」「同じ2つの点は、重ねて引けない」「点が動けば、渡り線も動く。点を外せば、渡り線も外れる」
 * 「そのレイヤーの印刷にだけ赤く出て、点は線の上に重なる」を確かめる。
 */
import { fromLayout, portsOf, removeItem } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayerArrow, addLayerDot, addLayerLink, canAddLayerLink, editLink, layerOf, linkBetween, purgeOrphanMarks, removeLayerItems, resolveArrows, resolveDots, resolveLinks, setLayerItems } from '../../apps/web/src/editor/layers.ts';
import type { LayerDot, LayerLink } from '../../apps/web/src/editor/layers.ts';
import { buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, DOT_RADIUS, LINK_SHAPES, LINK_STROKE, OVERLAY_RED, layout, linkApex, linkPath, linkSvg } from '../../packages/layout/src/index.ts';
import type { DrawingLink } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 渡り線（点と点を結ぶ弧の線）');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const d0 = base();
  const syms = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const vcb = syms.find((s) => s.symbolId === 'vcb')!;
  const L = 'outage';

  // 1. 形：4つ。ふくらみの高さ＝弦の長さ×割合（半円で 0.5）。向きは、点から点へ向かう向きの左側。反転で右側
  if (LINK_SHAPES.map((s) => `${s.id}:${s.bulge}`).join(',') !== 'straight:0,gentle:0.12,normal:0.25,round:0.5') fail('渡り線の形が、決めた4つ（直線・ゆるい弧・普通の弧・すごく丸い弧）になっていません');
  const chord = 100;
  for (const sh of LINK_SHAPES) {
    const l: DrawingLink = { x1: 0, y1: 0, x2: chord, y2: 0, shape: sh.id, flip: false };
    const ap = linkApex(l);
    const flipped = linkApex({ ...l, flip: true });
    if (Math.abs(ap.x - chord / 2) > 1e-9 || Math.abs(Math.abs(ap.y) - chord * sh.bulge) > 1e-9) fail(`${sh.id}：ふくらみの高さが、弦の長さの ${sh.bulge} 倍になっていません（${ap.y}）`);
    if (sh.bulge > 0 && !(ap.y < 0 && flipped.y > 0)) fail(`${sh.id}：東向きの線は、上（左側）にふくらみ、反転で下になるはずです`);
    const d = linkPath(l);
    if (sh.bulge === 0 ? !/^M [\d.-]+ [\d.-]+ L /.test(d) : !/ A /.test(d)) fail(`${sh.id}：直線は L、弧は A の道すじになるはずです（${d}）`);
    if (sh.bulge > 0) {
      // 弧は、両端と、いちばんふくらんだ所を通る円の一部（中心から3点までの距離が同じ）
      const m = /A ([\d.]+) ([\d.]+) 0 0 ([01]) /.exec(d)!;
      const r = Number(m[1]);
      const sweep = Number(m[3]);
      if (sweep !== 1) fail(`${sh.id}：反転なしは、時計回り（sweep=1）のはずです`);
      const h = chord * sh.bulge;
      // 中心は、ふくらむ向きと反対側（弦の中央から、ふくらむ向きへ h-r）
      const center = { x: chord / 2, y: ap.y > 0 ? h - r : -(h - r) };
      const dist = (p: { x: number; y: number }) => Math.hypot(p.x - center.x, p.y - center.y);
      if (Math.abs(dist({ x: 0, y: 0 }) - r) > 0.05 || Math.abs(dist({ x: chord, y: 0 }) - r) > 0.05 || Math.abs(dist(ap) - r) > 0.05) fail(`${sh.id}：弧が、両端と頂点を通る円になっていません`);
      if (Number(/A [\d.]+ [\d.]+ 0 0 ([01]) /.exec(linkPath({ ...l, flip: true }))![1]) !== 0) fail(`${sh.id}：反転は、反時計回り（sweep=0）のはずです`);
    }
  }
  const sv = linkSvg({ x1: 0, y1: 0, x2: 50, y2: 30, shape: 'normal', flip: false });
  if (!sv.includes(OVERLAY_RED) || !sv.includes(`stroke-width="${LINK_STROKE}"`) || !sv.includes('fill="none"') || LINK_STROKE !== 2) fail('渡り線が、赤い・太さ2・塗りなしの線になっていません');
  if (linkSvg({ x1: 5, y1: 5, x2: 5, y2: 5, shape: 'normal', flip: false }) !== '') fail('両端が同じ場所のとき、線を描いています');
  console.log('  弧の形は4つ（直線・ゆるい弧0.12・普通の弧0.25・すごく丸い弧0.5＝半円）。弧は、両端と頂点を通る円の一部。ふくらむ向きは点から点へ向かう向きの左側で、反転すると右側。赤・太さ2');

  // 2. 引く：点から点へ。形は選んだもの。同じ2つの点は重ねて引けない。続けて引ける（A→B、B→C、C→D）
  const port = portsOf(vcb)[0]!;
  let doc = d0;
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = addLayerDot(doc, L, port.x + 80 * i + 100, port.y + 200, true)!;
    doc = r.doc;
    ids.push(r.id);
  }
  const ab = addLayerLink(doc, L, ids[0]!, ids[1]!)!;
  const lk = layerOf(ab.doc, L)!.items.find((i) => i.kind === 'link') as LayerLink;
  if (lk.shape !== undefined || lk.a !== ids[0] || lk.b !== ids[1]) fail('最初の渡り線は、普通の弧（形の記録なし）で、点Aから点Bのはずです');
  if (resolveLinks(ab.doc, L)[0]!.shape !== 'normal') fail('最初の形が、普通の弧になっていません');
  if (addLayerLink(ab.doc, L, ids[0]!, ids[1]!) !== null || addLayerLink(ab.doc, L, ids[1]!, ids[0]!) !== null) fail('同じ2つの点を結ぶ渡り線を、重ねて引けてしまいます');
  if (linkBetween(ab.doc, L, ids[1]!, ids[0]!)?.id !== ab.id) fail('向きを逆にしても、同じ2つの点の線として見つかるはずです');
  if (addLayerLink(doc, L, ids[0]!, ids[0]!) !== null) fail('同じ点どうしを結べてしまいます');
  if (addLayerLink(doc, L, ids[0]!, 'nai') !== null || addLayerLink(doc, 'nai', ids[0]!, ids[1]!) !== null) fail('存在しない点・レイヤーに引けてしまいます');
  let chain = doc;
  for (let i = 0; i < 3; i++) chain = addLayerLink(chain, L, ids[i]!, ids[i + 1]!, LINK_SHAPES[i + 1]!.id)!.doc;
  const rl = resolveLinks(chain, L);
  if (rl.length !== 3 || rl.map((k) => k.shape).join() !== 'gentle,normal,round') fail(`続けて引いた3本の形が、選んだとおりになっていません（${rl.map((k) => k.shape).join()}）`);
  // 3. 直す：形・ふくらむ向き（1本ごと）
  const ed = resolveLinks(editLink(chain, L, rl[0]!.id, { shape: 'round', flip: true }), L);
  if (ed[0]!.shape !== 'round' || !ed[0]!.flip || ed[1]!.shape !== rl[1]!.shape || ed[1]!.flip) fail('渡り線の形・ふくらむ向きを、1本ごとに変えられません');
  if (resolveLinks(editLink(editLink(chain, L, rl[0]!.id, { flip: true }), L, rl[0]!.id, { flip: false }), L)[0]!.flip) fail('反転を戻せません');
  if (resolveLinks(editLink(chain, L, rl[0]!.id, { shape: 'nai' as never }), L)[0]!.shape !== 'gentle') fail('存在しない形に変えられてしまいます');
  console.log('  点から点へ、続けて引ける（A→B→C→D）。同じ2つの点は重ねて引けない。形・ふくらむ向きは1本ごとに変えられる');

  // 4. 点が動けば動く／点を外せば外れる／点が無くなれば出ない
  const dm = resolveDots(chain, L);
  const dotsMoved = resolveLinks(setLayerItems(chain, L, (layerOf(chain, L)!.items as (LayerDot | LayerLink)[]).map((i) => (i.kind === 'dot' && i.id === ids[1] ? { ...i, x: i.x + 30, y: i.y + 10, ndx: i.ndx + 30, ndy: i.ndy + 10 } : i))), L);
  if (Math.abs(dotsMoved[0]!.x2 - (dm.find((d) => d.id === ids[1])!.x + 30)) > 1e-9 || Math.abs(dotsMoved[1]!.x1 - (dm.find((d) => d.id === ids[1])!.x + 30)) > 1e-9) fail('点が動いても、渡り線の端が一緒に動きません');
  const rmDot = layerOf(removeLayerItems(chain, L, [ids[1]!]), L)!.items;
  if (rmDot.some((i) => i.kind === 'link' && (i.a === ids[1] || i.b === ids[1])) || rmDot.filter((i) => i.kind === 'link').length !== 1) fail('点を外したのに、その点につないだ渡り線が残っています（または、ほかの線まで消えています）');
  const rmLink = layerOf(removeLayerItems(chain, L, [rl[0]!.id]), L)!.items;
  if (rmLink.filter((i) => i.kind === 'dot').length !== 4 || rmLink.filter((i) => i.kind === 'link').length !== 2) fail('渡り線だけを外したとき、点まで消えています');
  // つないだ記号が無くなれば、点が出ず、渡り線も出ない（保存で外れる）
  const onPort = addLayerDot(addLayerDot(d0, L, port.x, port.y)!.doc, L, port.x + 100, port.y + 100, true)!;
  const pid = (layerOf(onPort.doc, L)!.items[0] as LayerDot).id;
  const withLink = addLayerLink(onPort.doc, L, pid, onPort.id)!.doc;
  const gone = removeItem(withLink, vcb.id);
  if (resolveLinks(gone, L).length !== 0) fail('点が無くなったのに、渡り線が出ています');
  if (layerOf(purgeOrphanMarks(gone), L)!.items.some((i) => i.kind === 'link')) fail('無くなった点につないだ渡り線が、保存のときにデータから外れません');
  // 点に矢印があっても、渡り線とは別々に動く
  const withBoth = addLayerArrow(chain, L, ids[0]!)!.doc;
  if (resolveArrows(withBoth, L).length !== 1 || resolveLinks(withBoth, L).length !== 3) fail('矢印と渡り線を、同じ点に付けられません');
  console.log('  点が動けば渡り線も動く。点を外せば、つないだ渡り線も外れる（渡り線だけ外せば、点は残る）。つないだ記号が無くなれば出なくなり、保存のときにデータから外れる');

  // 5. 上限（100本）
  const dots: LayerDot[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'dot', id: `d${i}`, x: i, y: 0, ndx: i, ndy: 0 }));
  const links: LayerLink[] = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND }, (_, i) => ({ kind: 'link', id: `k${i}`, a: `d${i % 30}`, b: `d${(i + 1 + Math.floor(i / 30)) % 30}` }));
  const full = setLayerItems(d0, 'withstand', [...dots, ...links]);
  if (canAddLayerLink(full, 'withstand') || !canAddLayerLink(full, L)) fail(`渡り線の上限（${MAX_LAYER_ITEMS_PER_KIND}本）が合いません`);

  // 6. 印刷：そのレイヤーだけに、赤い線。点は線の上に重なる（点が後に描かれる）
  const title = { site: '見本工場', name: '停電範囲図', footer: COMPANY_NAME };
  const sheet = (d: Doc, layerId: string | null) => {
    const ds = layerId ? resolveDots(d, layerId).map((p) => ({ x: p.x, y: p.y })) : [];
    const ls = layerId ? resolveLinks(d, layerId).map((k) => ({ x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2, shape: k.shape, flip: k.flip })) : [];
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation, [], [], [], { dots: ds, links: ls });
  };
  const svg = sheet(chain, L);
  const paths = svg.match(new RegExp(`<path d="M [^"]+" fill="none" stroke="${OVERLAY_RED}" stroke-width="${LINK_STROKE}"`, 'g')) ?? [];
  if (paths.length !== 3) fail(`印刷に、赤い渡り線が3本出ていません（${paths.length}本）`);
  const firstDot = svg.indexOf(`r="${DOT_RADIUS}" fill="${OVERLAY_RED}"`);
  const lastPath = svg.lastIndexOf(`stroke="${OVERLAY_RED}" stroke-width="${LINK_STROKE}"`);
  if (firstDot < 0 || lastPath > firstDot) fail('点が、渡り線より先に描かれています（点が線の上に重なるはずです）');
  if (sheet(chain, 'withstand').includes(`stroke="${OVERLAY_RED}" stroke-width="${LINK_STROKE}" stroke-linecap="round"`) || sheet(chain, null) !== sheet(d0, null)) fail('別のレイヤー・単線結線図の印刷が、変わっています');
  console.log(`  印刷：そのレイヤーだけに、赤い渡り線が出て、点は線の上に重なる。単線結線図・ほかのレイヤーの印刷は変わらない。上限は${MAX_LAYER_ITEMS_PER_KIND}本（レイヤーごと）`);
}
