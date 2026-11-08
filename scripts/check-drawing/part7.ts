/**
 * 図面の検証（check-drawing）の7つ目：赤い接地のマーク（短絡接地器具を取り付ける場所）。
 * 「いつも下向きで、横線が地面と平行に下へ細くなる」「横棒あり／なしの2つの形」「横棒・縦の長さが自由」
 * 「つなぐのは、母線の途中か、記号の接続点だけ」「つないだものと一緒に動く」「他の図記号にかかったら分かる」
 * 「横に文字を付けられる」「そのレイヤーの印刷にだけ赤く出る」を確かめる。
 */
import { assistGroundPoint, fromLayout, moveItem, portsOf, removeItem } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayerGround, canAddLayerGround, editGround, flipGround, groundOverlapsSymbols, layerOf, purgeOrphanMarks, removeLayerItems, resolveGroundAnchor, resolveGrounds, setGroundTip, setLayerItems, toggleGroundLead } from '../../apps/web/src/editor/layers.ts';
import type { GroundAnchor, LayerGround } from '../../apps/web/src/editor/layers.ts';
import { buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, GROUND_DROP_MIN, GROUND_LEAD_MIN, GROUND_STROKE, OVERLAY_RED, groundBounds, groundFromTip, groundLabelAt, groundShapes, groundSvg, layout } from '../../packages/layout/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 赤い接地のマーク');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const d0 = base();
  const syms = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const wires = d0.items.filter((i): i is DocWire => i.kind === 'wire');
  const vcb = syms.find((s) => s.symbolId === 'vcb')!;
  const pas = syms.find((s) => s.symbolId.startsWith('pas'))!;

  // 1. 形：いつも下向き。接地の記号と同じ比率の3本の横線が、下に行くほど短い。線は太め（2）・赤
  const lines = (lead: number, drop: number) => groundShapes(lead, drop).filter((s): s is Extract<ReturnType<typeof groundShapes>[number], { k: 'line' }> => s.k === 'line');
  const horizontal = (lead: number, drop: number) => lines(lead, drop).filter((l) => l.y1 === l.y2);
  const bars = horizontal(0, 20);
  const earthBars = getSymbol('earth').shapes.filter((s) => s.k === 'line' && s.y1 === s.y2) as { x1: number; x2: number }[];
  const widths = bars.map((b) => b.x2 - b.x1);
  const ratios = widths.map((w, i) => w / (earthBars[i]!.x2 - earthBars[i]!.x1));
  if (bars.length !== 3 || ratios.some((r) => Math.abs(r - ratios[0]!) > 1e-9)) fail(`接地のマークの横線が、接地の記号と同じ比率の3本になっていません（${ratios.join(',')}）`);
  if (!(widths[0]! > widths[1]! && widths[1]! > widths[2]!) || !(bars[0]!.y1 < bars[1]!.y1 && bars[1]!.y1 < bars[2]!.y1)) fail('横線が、下に行くほど短くなっていません');
  if (GROUND_STROKE !== 2 || lines(30, 20).some((l) => l.sw !== 2)) fail('接地のマークの線の太さが2（少し太め）ではありません');
  if (!groundSvg(10, 20, 0, 20).includes(OVERLAY_RED)) fail('接地のマークが赤になっていません');
  // 横棒なし：縦の線と3本の横線だけ。横棒あり：つなぐ場所から横へ、その先から下へ、そこにマーク
  if (horizontal(0, 20).length !== 3 || horizontal(30, 20).length !== 4 || horizontal(-30, 20).length !== 4) fail('横棒なし（横線3本）／横棒あり（4本）の形になっていません');
  const lead = horizontal(30, 20).find((l) => l.y1 === 0)!;
  if (lead.x1 !== 0 || lead.x2 !== 30) fail('横棒が、つなぐ場所から、指定の長さだけ伸びていません');
  const left = horizontal(-30, 20).find((l) => l.y1 === 0)!;
  if (left.x2 !== -30) fail('横棒を左へ出せません（長さを負にすると、左）');
  const stem = lines(30, 20).find((l) => l.x1 === l.x2)!;
  if (stem.x1 !== 30 || stem.y1 !== 0 || stem.y2 !== 20) fail('縦の線が、横棒の先から、指定の長さだけ下へ伸びていません');
  const bb = groundBounds(100, 100, -30, 20);
  if (bb.y0 !== 100 || bb.x0 >= 70 || bb.x1 !== 100) fail(`外形が合いません（${JSON.stringify(bb)}）`);
  console.log('  形：いつも下向き（横線が地面と平行で、下に行くほど短い）。接地の記号と同じ比率・太さ2・赤。横棒なし（B）と、左右どちらにも出せる横棒あり（A）');

  // 2. 横棒・縦の長さは、マークを置く場所（カーソル）で決まる
  const tipCases: [string, number, number, number, number][] = [
    ['真下 → 横棒なし', 100, 150, 0, 50],
    ['右にずらす → 右へ横棒', 140, 150, 40, 50],
    ['左にずらす → 左へ横棒', 60, 150, -40, 50],
    ['少しだけずれた（短すぎる横棒）→ 横棒なし', 100 + GROUND_LEAD_MIN - 2, 150, 0, 50],
    ['つなぐ場所より上 → 縦の長さは、最小', 140, 90, 40, GROUND_DROP_MIN],
  ];
  for (const [name, tx, ty, wl, wd] of tipCases) {
    const g = groundFromTip(100, 100, tx, ty);
    if (g.lead !== wl || g.drop !== wd) fail(`${name}：横棒 ${wl}・縦 ${wd} のはずが、${g.lead}・${g.drop} です`);
  }
  console.log('  横棒・縦の長さは、カーソルの位置で決まる（真下なら横棒なし／横にずれた向きに横棒／下に引くほど縦が長い）');

  // 3. つなぐ場所：母線（線）の途中か、記号の接続点だけ。ほかには、つなげない
  const vcbIn = portsOf(vcb).find((p) => p.id === 'in')!;
  const onPort = assistGroundPoint(d0, vcbIn.x + 2, vcbIn.y + 2, 9);
  if (!onPort || onPort.anchor.kind !== 'port' || onPort.x !== vcbIn.x || onPort.y !== vcbIn.y) fail('記号の接続点の近くで、接続点に吸い付きません');
  if (!onPort) throw new Error('接続点につなげません');
  const longWire = wires.filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 60).sort((a, b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1) - Math.hypot(a.x2 - a.x1, a.y2 - a.y1))[0]!;
  const mx = (longWire.x1 + longWire.x2) / 2;
  const my = (longWire.y1 + longWire.y2) / 2;
  const onWire = assistGroundPoint(d0, mx + 1, my + 1, 9);
  if (!onWire) fail('線の途中で、線の上に吸い付きません');
  const farAway = assistGroundPoint(d0, -5000, -5000, 9);
  if (farAway !== null) fail('何も近くに無い場所で、つなげてしまいます（母線の途中か、記号の接続点だけのはずです）');
  // 枠の端（PAS の外枠）の上で、線も接続点も近くに無い場所には、吸い付かない
  const pdef = getSymbol(pas.symbolId);
  const frame = pdef.shapes.find((s) => s.k === 'rect') as { x: number; y: number; w: number; h: number };
  const edge = { x: pas.x + frame.x + frame.w, y: pas.y + frame.y + frame.h * 0.35 };
  const nearThings = wires.some((w) => Math.hypot(Math.max(Math.min(w.x1, w.x2), Math.min(Math.max(w.x1, w.x2), edge.x)) - edge.x, Math.max(Math.min(w.y1, w.y2), Math.min(Math.max(w.y1, w.y2), edge.y)) - edge.y) <= 9) || syms.some((s) => portsOf(s).some((p) => Math.hypot(p.x - edge.x, p.y - edge.y) <= 9));
  if (!nearThings && assistGroundPoint(d0, edge.x, edge.y, 9) !== null) fail('PASの外枠の端に、つなげてしまいます');
  console.log('  つなげるのは、母線（線）の途中と、記号の接続点だけ。何も近くに無い場所・枠の端には、つなげない');

  // 4. 置く・直す・反転・横棒の付け外し・長さ・文字
  const anchor: GroundAnchor = onPort.anchor;
  const placed = addLayerGround(d0, 'outage', anchor, vcbIn.x + 40, vcbIn.y + 50);
  if (!placed) throw new Error('接地のマークを置けません');
  const g1 = resolveGrounds(placed.doc, 'outage')[0]!;
  if (g1.x !== vcbIn.x || g1.y !== vcbIn.y || g1.lead !== 40 || g1.drop !== 50) fail(`置いた形が合いません（${g1.x},${g1.y} 横棒${g1.lead} 縦${g1.drop}）`);
  if (addLayerGround(d0, 'outage', { kind: 'port', item: 'nai', port: 'in' }, 0, 0) !== null) fail('存在しない記号に、つなげてしまいます');
  if (addLayerGround(d0, 'nai', anchor, 0, 0) !== null) fail('存在しないレイヤーに、置けてしまいます');
  const flipped = resolveGrounds(flipGround(placed.doc, 'outage', placed.id), 'outage')[0]!;
  if (flipped.lead !== -40 || flipped.drop !== 50) fail('左右を反転できません');
  const off = resolveGrounds(toggleGroundLead(placed.doc, 'outage', placed.id), 'outage')[0]!;
  const on = resolveGrounds(toggleGroundLead(toggleGroundLead(placed.doc, 'outage', placed.id), 'outage', placed.id), 'outage')[0]!;
  if (off.lead !== 0 || on.lead === 0) fail('横棒を付ける・なくすが効きません');
  if (resolveGrounds(flipGround(toggleGroundLead(placed.doc, 'outage', placed.id), 'outage', placed.id), 'outage')[0]!.lead !== 0) fail('横棒なしのとき、反転で横棒が出てしまいます');
  const longer = resolveGrounds(editGround(placed.doc, 'outage', placed.id, { lead: 80, drop: 70 }), 'outage')[0]!;
  if (longer.lead !== 80 || longer.drop !== 70) fail('横棒・縦の長さを変えられません');
  const clamped = resolveGrounds(editGround(placed.doc, 'outage', placed.id, { lead: 3, drop: -10 }), 'outage')[0]!;
  if (clamped.lead !== 0 || clamped.drop !== GROUND_DROP_MIN) fail(`短すぎる長さが、範囲に収まりません（横棒${clamped.lead}・縦${clamped.drop}）`);
  const tipMoved = resolveGrounds(setGroundTip(placed.doc, 'outage', placed.id, vcbIn.x - 20, vcbIn.y + 30), 'outage')[0]!;
  if (tipMoved.lead !== -20 || tipMoved.drop !== 30) fail('マークの先を動かして、横棒・縦の長さを決め直せません');
  const labeled = resolveGrounds(editGround(placed.doc, 'outage', placed.id, { label: ['No.1', '動力回路'], size: 2.5, bold: true, red: true }), 'outage')[0]!;
  if (labeled.label?.lines.join('/') !== 'No.1/動力回路' || labeled.label.size !== 2.5 || !labeled.label.bold || !labeled.label.red) fail('横に文字（番号・回路名）を付けられません');
  if (resolveGrounds(editGround(editGround(placed.doc, 'outage', placed.id, { label: ['x'] }), 'outage', placed.id, { label: [''] }), 'outage')[0]!.label !== undefined) fail('文字を空にしたのに、文字が残っています');
  if (resolveGrounds(editGround(placed.doc, 'outage', placed.id, { label: ['x'], size: 99 }), 'outage')[0]!.label?.size !== 5) fail('文字の大きさが、5倍に収まりません');
  // 文字は、横棒を出した側の、外へ書く（右へ出せば右、左へ出せば左、横棒なしは右）
  if (groundLabelAt(0, 0, 40, 20).anchor !== 'start' || groundLabelAt(0, 0, -40, 20).anchor !== 'end' || groundLabelAt(0, 0, 0, 20).anchor !== 'start') fail('文字を書く側が、横棒の向きに合っていません');
  console.log('  置く・左右反転・横棒の付け外し・横棒と縦の長さの変更（短すぎれば最小に）・先を動かして決め直す・横に文字（番号・回路名。大きさ・太字・色つき）');

  // 5. つないだものについて動く。つないだ記号・線が無くなったら出ない・保存時にデータから外す
  const moved = moveItem(placed.doc, vcb.id, 30, 40);
  const g2 = resolveGrounds(moved, 'outage')[0]!;
  if (Math.abs(g2.x - (g1.x + 30)) > 1e-9 || Math.abs(g2.y - (g1.y + 40)) > 1e-9) fail('つないだ記号を動かしても、接地のマークが一緒に動きません');
  const gone = removeItem(placed.doc, vcb.id);
  if (resolveGrounds(gone, 'outage').length !== 0) fail('つないだ記号が無くなっても、接地のマークが出ています');
  if (layerOf(gone, 'outage')!.items.length !== 1) fail('記号が無くなった直後に、接地のマークのデータを消してはいけません（「操作を戻す」で戻れるように）');
  if (layerOf(purgeOrphanMarks(gone), 'outage')!.items.length !== 0) fail('保存するとき、つないだ記号が無くなった接地のマークを、データから外せません');
  // 線の途中につないだもの
  const wireAnchor = assistGroundPoint(d0, mx, my, 9);
  const wAnchorOnly = wireAnchor && wireAnchor.anchor.kind === 'wire' ? wireAnchor : null;
  if (wAnchorOnly) {
    const wp = addLayerGround(d0, 'outage', wAnchorOnly.anchor, wAnchorOnly.x + 30, wAnchorOnly.y + 30)!;
    const at = resolveGroundAnchor(wp.doc, wAnchorOnly.anchor)!;
    if (Math.abs(at.x - wAnchorOnly.x) > 1e-9 || Math.abs(at.y - wAnchorOnly.y) > 1e-9) fail('線の途中につないだ場所が、置いたときの場所と合いません');
    const wid = wAnchorOnly.anchor.kind === 'wire' ? wAnchorOnly.anchor.id : undefined;
    const noWire: Doc = { ...wp.doc, items: wp.doc.items.filter((i) => !(i.kind === 'wire' && i.id === wid)) };
    if (wAnchorOnly.anchor.kind === 'wire' && !wAnchorOnly.anchor.key && resolveGrounds(noWire, 'outage').length !== 0) fail('つないだ線が無くなっても、接地のマークが出ています');
  }
  console.log('  つないだ記号・線が動けば一緒に動く。無くなったら出なくなり、保存するときにデータから外す');

  // 6. 古い版のデータ（置いた場所と近くの機器だけ）も、壊れずに出る。直すと、新しい形になる
  const legacyItem = { kind: 'ground', id: 'old-1', x: vcb.x + 24, y: vcb.y + 10, rotate: 90, near: 'main-breaker', ndx: 24, ndy: 10 } as LayerGround;
  const legacy = setLayerItems(d0, 'outage', [legacyItem]);
  const lg = resolveGrounds(legacy, 'outage')[0];
  if (!lg || lg.lead !== 0 || lg.drop !== 10) fail('古い版の接地のマークが、横棒なし・縦10で出ていません');
  const upgraded = layerOf(editGround(legacy, 'outage', 'old-1', { anchor }), 'outage')!.items[0] as LayerGround;
  if (!upgraded.anchor || 'near' in upgraded || 'x' in upgraded || 'rotate' in upgraded) fail('古い版のデータを、つなぎ直したのに、古い項目が残っています');

  // 7. 他の図記号にかかっているか。つなぐ記号と、外枠（キュービクルなど）は、かかっていても気にしない
  const overVcb = { x: vcb.x + 24, y: vcb.y + 36, lead: 0, drop: 8 };
  if (!groundOverlapsSymbols(d0, overVcb, undefined)) fail('他の記号の上に置いたのに、かかっていると分かりません');
  if (groundOverlapsSymbols(d0, overVcb, { kind: 'port', item: 'main-breaker', port: 'in' })) fail('つないだ記号にかかっているのを、「かかっている」としています');
  if (groundOverlapsSymbols(d0, { x: -3000, y: -3000, lead: 40, drop: 30 }, undefined)) fail('何も無い場所なのに、かかっていると出ます');
  const encl = syms.find((s) => getSymbol(s.symbolId).category === 'enclosure');
  if (encl) {
    const ed = getSymbol(encl.symbolId);
    // 外枠の中のうち、ほかの記号が無い場所
    const inside = { x: encl.x + 4, y: encl.y + ed.box.h - 6, lead: 0, drop: 8 };
    if (syms.every((s) => getSymbol(s.symbolId).category === 'enclosure' || !groundOverlapsSymbols({ ...d0, items: [s] }, inside, undefined)) && groundOverlapsSymbols(d0, inside, undefined)) fail('外枠（キュービクルなど）を、「かかっている」としています');
  }
  console.log('  他の図記号（記号の枠・横の文字）にかかっているか分かる（つなぐ記号と、外枠は、気にしない）');

  // 8. 上限
  const many: LayerGround[] = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND }, (_, i) => ({ kind: 'ground', id: `lg-${i}`, anchor, drop: 10 }));
  const full = setLayerItems(d0, 'withstand', many);
  if (canAddLayerGround(full, 'withstand') || addLayerGround(full, 'withstand', anchor, 0, 0) !== null) fail(`上限（${MAX_LAYER_ITEMS_PER_KIND}個）を超えて、置けてしまいます`);
  if (!canAddLayerGround(full, 'outage')) fail('ほかのレイヤーの数まで、数えています');
  if (layerOf(removeLayerItems(placed.doc, 'outage', [placed.id]), 'outage')!.items.length !== 0) fail('接地のマークを消せません');

  // 9. 印刷：そのレイヤーだけに、赤い接地のマーク（と文字）が出る
  const title = { site: '見本工場', name: '停電範囲図', footer: COMPANY_NAME };
  const sheet = (d: Doc, layerId: string | null) => {
    const gs = layerId ? resolveGrounds(d, layerId).map((g) => ({ x: g.x, y: g.y, lead: g.lead, drop: g.drop, ...(g.label ? { label: g.label } : {}) })) : [];
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation, [], gs);
  };
  const withLabel = editGround(placed.doc, 'outage', placed.id, { label: ['No.1', '動力回路'], size: 2, red: true });
  const outage = sheet(withLabel, 'outage');
  const reds = (svg: string) => (svg.match(new RegExp(`<g transform="translate\\([^)]*\\)" stroke="${OVERLAY_RED}"`, 'g')) ?? []).length;
  if (reds(outage) !== 1) fail(`停電範囲図の印刷に、赤い接地のマークが1つ出ていません（${reds(outage)}個）`);
  if (!outage.includes('>No.1</tspan>') || !outage.includes('>動力回路</tspan>') || !outage.includes(`fill="${OVERLAY_RED}" stroke="none"><tspan x="${Math.round(groundLabelAt(g1.x, g1.y, 40, 50).x * 100) / 100}"`)) fail('印刷に、マークの横の文字（番号・回路名）が、赤で出ていません');
  if (reds(sheet(withLabel, 'withstand')) !== 0 || reds(sheet(withLabel, null)) !== 0) fail('別のレイヤーや単線結線図の印刷に、接地のマークが出ています');
  if (sheet(withLabel, null) !== sheet(d0, null)) fail('接地のマークを置いても、単線結線図の印刷が変わっています');
  console.log('  印刷：そのレイヤーだけに、赤い接地のマークと、横の文字が出る。単線結線図・ほかのレイヤーの印刷は変わらない。上限は100個（レイヤーごと）');
}
