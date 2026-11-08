/**
 * 図面の検証（check-drawing）の8つ目：赤い枠（停電範囲・充電範囲・印加範囲）と、充電範囲の斜線。
 * 「斜線は充電範囲だけ・均等・細い」「枠は複数置ける」「近くの機器について動く（大きさは変わらない・機器が無くなっても残る）」
 * 「近くの文字は自由に書き換えられ、四隅から位置を選べる」「そのレイヤーの印刷にだけ赤く出る」を確かめる。
 */
import { fromLayout, moveItem, removeItem, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayerArea, canAddLayerArea, editArea, layerOf, moveAreas, normalizeRect, purgeOrphanMarks, removeLayerItems, resolveAreas, setLayerItems } from '../../apps/web/src/editor/layers.ts';
import type { LayerArea } from '../../apps/web/src/editor/layers.ts';
import { AREA_KINDS, buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { AREA_MIN, AREA_STROKE, COMPANY_NAME, HATCH_GAP, HATCH_STROKE, OVERLAY_RED, areaLabelAt, areaSvg, hatchSegments, layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 赤い枠（停電範囲・充電範囲・印加範囲）と斜線');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const d0 = base();
  const syms = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const vcb = syms.find((s) => s.symbolId === 'vcb')!;

  // 1. 種類：斜線は、充電範囲だけ
  const kinds = AREA_KINDS.map((k) => `${k.id}:${k.label}:${k.hatch}`).join(',');
  if (kinds !== 'outage:停電範囲:false,live:充電範囲:true,applied:印加範囲:false') fail(`枠の種類が決めたとおりではありません（${kinds}）`);

  // 2. 斜線：右上がり・枠の中だけ・均等（間隔が一定）・細い。大きな枠でも、間隔は同じ
  for (const rect of [{ x: 10, y: 20, w: 100, h: 60 }, { x: 0, y: 0, w: 500, h: 400 }, { x: 5, y: 7, w: 30, h: 200 }]) {
    const segs = hatchSegments(rect);
    const sums = segs.map((s) => s.x1 + s.y1);
    const inside = segs.every((s) => [s.x1, s.x2].every((x) => x >= rect.x - 1e-6 && x <= rect.x + rect.w + 1e-6) && [s.y1, s.y2].every((y) => y >= rect.y - 1e-6 && y <= rect.y + rect.h + 1e-6));
    const straight = segs.every((s) => Math.abs(s.x1 + s.y1 - (s.x2 + s.y2)) < 1e-6 && s.x2 > s.x1);
    const gaps = sums.slice(1).map((v, i) => (v - sums[i]!) / Math.SQRT2);
    if (!inside) fail(`斜線が、枠からはみ出しています（${rect.w}×${rect.h}）`);
    if (!straight) fail(`斜線が、右上がりの直線になっていません（${rect.w}×${rect.h}）`);
    if (gaps.some((g) => Math.abs(g - HATCH_GAP) > 1e-6)) fail(`斜線の間隔が一定ではありません（${rect.w}×${rect.h}：${gaps.slice(0, 3).join(',')}）`);
    if (segs.length < (rect.w + rect.h) / (HATCH_GAP * Math.SQRT2) - 2) fail(`斜線の数が足りません（${segs.length}本）`);
  }
  if (!(HATCH_STROKE < 1 && HATCH_STROKE > 0) || AREA_STROKE !== 2) fail('斜線は細く（1より細い）、枠の線は太さ2のはずです');
  const live = areaSvg({ x: 0, y: 0, w: 60, h: 40, hatch: true });
  const plain = areaSvg({ x: 0, y: 0, w: 60, h: 40, hatch: false });
  if (!live.includes('<path') || plain.includes('<path') || !live.includes(OVERLAY_RED) || !live.includes(`stroke-width="${HATCH_STROKE}"`)) fail('斜線の有無（充電範囲だけ入る）・赤・細さが合いません');
  console.log(`  斜線は充電範囲だけ。右上がりで、枠の中だけに、均等（間隔 ${HATCH_GAP}）に入る。大きな枠でも間隔は同じ。線は細く（${HATCH_STROKE}）、枠の線は太さ${AREA_STROKE}の赤`);

  // 3. 置く：ドラッグで描いた四角（格子に合わせる）。小さすぎれば置かない。種類で、文字と斜線が最初に決まる
  const rect = normalizeRect(vcb.x - 21, vcb.y - 19, vcb.x + 90, vcb.y + 100);
  const results = AREA_KINDS.map((k) => addLayerArea(d0, 'outage', rect, k.id));
  if (results.some((r) => !r)) throw new Error('赤い枠を置けません');
  for (const [i, k] of AREA_KINDS.entries()) {
    const a = resolveAreas(results[i]!.doc, 'outage')[0]!;
    if (a.hatch !== k.hatch || a.label?.lines.join('') !== k.label || a.label.pos !== 'tl') fail(`${k.label}の枠の、最初の文字・斜線が合いません`);
    if (a.x !== rect.x || a.y !== rect.y || a.w !== rect.w || a.h !== rect.h || a.x % 2 !== 0 || a.w % 2 !== 0) fail('置いた枠の位置・大きさが、描いた四角（格子に合わせたもの）と違います');
  }
  const reversed = normalizeRect(300, 300, 100, 120);
  if (reversed.x !== 100 || reversed.y !== 120 || reversed.w !== 200 || reversed.h !== 180) fail('右下から左上へ描いても、四角にならない');
  if (addLayerArea(d0, 'outage', { x: 0, y: 0, w: AREA_MIN - 2, h: 80 }, 'outage') !== null) fail('小さすぎる枠を置けてしまいます');
  if (addLayerArea(d0, 'nai', rect, 'outage') !== null) fail('存在しないレイヤーに、置けてしまいます');
  // 枠は、複数置ける（5台の変圧器を、それぞれ囲む、など）
  let five = d0;
  for (let i = 0; i < 5; i++) five = addLayerArea(five, 'withstand', { x: i * 60, y: 500, w: 50, h: 70 }, 'applied')!.doc;
  if (resolveAreas(five, 'withstand').length !== 5) fail('枠を5つ置けません');
  console.log('  ドラッグで描いた四角に置ける（格子に合わせる。反対向きに描いても同じ）。小さすぎれば置かない。複数の枠を置ける。種類で、文字と斜線が最初に決まる');

  // 4. 直す：種類の入れ替え・斜線の入り切り・文字の書き換え・大きさ・太字・位置（四隅）
  const one = addLayerArea(d0, 'outage', rect, 'outage')!;
  const asLive = resolveAreas(editArea(one.doc, 'outage', one.id, { kind: 'live' }), 'outage')[0]!;
  if (!asLive.hatch || asLive.label?.lines[0] !== '充電範囲') fail('種類を充電範囲に入れ替えても、文字・斜線が変わりません');
  const hatchOn = resolveAreas(editArea(one.doc, 'outage', one.id, { hatch: true }), 'outage')[0]!;
  const hatchOff = resolveAreas(editArea(editArea(one.doc, 'outage', one.id, { hatch: true }), 'outage', one.id, { hatch: false }), 'outage')[0]!;
  if (!hatchOn.hatch || hatchOff.hatch) fail('斜線を入れる・外すが効きません');
  const edited = resolveAreas(editArea(one.doc, 'outage', one.id, { label: ['停電範囲', '（作業A）'], size: 2, bold: true, labelPos: 'br' }), 'outage')[0]!;
  if (edited.label?.lines.join('/') !== '停電範囲/（作業A）' || edited.label.size !== 2 || !edited.label.bold || edited.label.pos !== 'br') fail('枠の近くの文字を、自由に書き換えられません');
  if (resolveAreas(editArea(one.doc, 'outage', one.id, { label: [''] }), 'outage')[0]!.label !== undefined) fail('文字を空にしても、文字が残っています');
  const ar = { x: 100, y: 100, w: 80, h: 50 };
  const lab = (pos: 'tl' | 'tr' | 'bl' | 'br') => areaLabelAt(ar, { lines: ['A'], pos });
  if (lab('tl').x !== 100 || lab('tl').anchor !== 'start' || lab('tl').y >= 100 || lab('tr').x !== 180 || lab('tr').anchor !== 'end' || lab('bl').y <= 150 || lab('br').x !== 180) fail('文字を書く位置が、四隅の外側になっていません');
  if (areaLabelAt(ar, { lines: ['A', 'B', 'C'], pos: 'tl' }).y >= areaLabelAt(ar, { lines: ['A'], pos: 'tl' }).y) fail('複数行の文字が、枠の上に収まっていません（上側は、行数ぶん上に書き始めるはずです）');
  console.log('  種類の入れ替え・斜線の入り切り・近くの文字の書き換え（複数行・大きさ・太字）・文字の位置（左上・右上・左下・右下の外側）');

  // 5. 近くの機器について動く（大きさは変わらない）。機器が無くなっても、枠は残る
  const a0 = resolveAreas(one.doc, 'outage')[0]!;
  const moved = resolveAreas(moveItem(one.doc, vcb.id, 30, 40), 'outage')[0]!;
  const tracked = layerOf(one.doc, 'outage')!.items[0] as LayerArea;
  const nearSym = syms.find((s) => sameName(s.id) === tracked.near);
  if (nearSym) {
    const m2 = resolveAreas(moveItem(one.doc, nearSym.id, 30, 40), 'outage')[0]!;
    if (Math.abs(m2.x - (a0.x + 30)) > 1e-9 || Math.abs(m2.y - (a0.y + 40)) > 1e-9 || m2.w !== a0.w || m2.h !== a0.h) fail('近くの機器を動かしても、枠の位置が一緒に動かない（または、大きさが変わりました）');
    const gone = removeItem(one.doc, nearSym.id);
    const rg = resolveAreas(gone, 'outage')[0];
    if (!rg || rg.x !== a0.x || rg.y !== a0.y || layerOf(purgeOrphanMarks(gone), 'outage')!.items.length !== 1) fail('近くの機器が無くなったとき、枠が消えています（枠は、最後に置いた場所に残るはずです）');
  } else fail('枠が、近くの機器を覚えていません');
  void moved;
  // 動かす（矢印キー）と、大きさの変更（ハンドル）
  const shifted = resolveAreas(moveAreas(one.doc, 'outage', [one.id], 8, -4), 'outage')[0]!;
  if (shifted.x !== a0.x + 8 || shifted.y !== a0.y - 4 || shifted.w !== a0.w) fail('枠を動かせません');
  const resized = resolveAreas(editArea(one.doc, 'outage', one.id, { rect: { x: a0.x, y: a0.y, w: 200, h: 90 } }), 'outage')[0]!;
  if (resized.w !== 200 || resized.h !== 90) fail('枠の大きさを変えられません');
  if (resolveAreas(editArea(one.doc, 'outage', one.id, { rect: { x: 0, y: 0, w: 3, h: 3 } }), 'outage')[0]!.w !== a0.w) fail('小さすぎる大きさに、変えられてしまいます');
  if (layerOf(removeLayerItems(one.doc, 'outage', [one.id]), 'outage')!.items.length !== 0) fail('枠を消せません');
  console.log('  近くの機器について動く（大きさは変わらない）。機器が無くなっても、枠は消えず、最後に置いた場所に残る。動かす・大きさを変える・消す');

  // 6. 上限
  const many: LayerArea[] = Array.from({ length: MAX_LAYER_ITEMS_PER_KIND }, (_, i) => ({ kind: 'area', id: `la-${i}`, x: i, y: 0, w: 20, h: 20, ndx: i, ndy: 0 }));
  const full = setLayerItems(d0, 'withstand', many);
  if (canAddLayerArea(full, 'withstand') || addLayerArea(full, 'withstand', rect, 'outage') !== null) fail(`上限（${MAX_LAYER_ITEMS_PER_KIND}個）を超えて、置けてしまいます`);
  if (!canAddLayerArea(full, 'outage')) fail('ほかのレイヤーの数まで、数えています');

  // 7. 印刷：そのレイヤーだけに、赤い枠（充電範囲は斜線つき）と、近くの文字が出る
  const title = { site: '見本工場', name: '停電範囲図', footer: COMPANY_NAME };
  const sheet = (d: Doc, layerId: string | null) => {
    const as = layerId ? resolveAreas(d, layerId).map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h, hatch: a.hatch, ...(a.label ? { label: a.label } : {}) })) : [];
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation, [], [], as);
  };
  const two = addLayerArea(addLayerArea(d0, 'outage', rect, 'outage')!.doc, 'outage', { x: rect.x + 200, y: rect.y, w: 80, h: 70 }, 'live')!.doc;
  const svg = sheet(two, 'outage');
  const redRects = (svg.match(new RegExp(`<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="none" stroke="${OVERLAY_RED}" stroke-width="${AREA_STROKE}"`, 'g')) ?? []).length;
  const hatchPaths = (svg.match(new RegExp(`<path d="M [^"]+" fill="none" stroke="${OVERLAY_RED}" stroke-width="${HATCH_STROKE}"`, 'g')) ?? []).length;
  if (redRects !== 2) fail(`停電範囲図の印刷に、赤い枠が2つ出ていません（${redRects}個）`);
  if (hatchPaths !== 1) fail(`斜線が、充電範囲の枠だけ（1つ）に入っていません（${hatchPaths}個）`);
  if (!svg.includes('>停電範囲</tspan>') || !svg.includes('>充電範囲</tspan>') || !new RegExp(`fill="${OVERLAY_RED}" stroke="none"><tspan[^>]*>停電範囲</tspan>`).test(svg)) fail('枠の近くの文字が、赤で出ていません');
  if (/stroke="#d40000" stroke-width="2" stroke-linejoin/.test(sheet(two, 'withstand')) || /stroke="#d40000" stroke-width="2" stroke-linejoin/.test(sheet(two, null))) fail('別のレイヤーや単線結線図の印刷に、赤い枠が出ています');
  if (sheet(two, null) !== sheet(d0, null)) fail('枠を置いても、単線結線図の印刷が変わっています');
  console.log('  印刷：そのレイヤーだけに、赤い枠（充電範囲は斜線つき）と、近くの文字が赤で出る。単線結線図・ほかのレイヤーの印刷は変わらない。上限は100個（レイヤーごと）');
}
