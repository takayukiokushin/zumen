/**
 * 図面の検証（check-drawing）の5つ目：テキストボックス（文字の大きさ・太字・赤）と、レイヤーに置いた文字。
 * 「大きさは、縦横の比を変えず、記号の横の文字（1倍）〜5倍」「赤い文字はレイヤーだけ」
 * 「近くの機器と一緒に動く。機器が無くなっても、文字は消えない」を確かめる。
 */
import { addText, fromLayout, itemBounds, moveItem, removeItem, setTextStyle } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocText } from '../../apps/web/src/editor/doc.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayerText, canAddLayerText, layerItemsAsDocItems, layerOf, moveLayerItems, removeLayerItems, resolveText, updateLayerText } from '../../apps/web/src/editor/layers.ts';
import { collectOverrides, rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import { buildComposition, MAX_LAYER_ITEMS_PER_KIND } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, LABEL_FONT, LABEL_LINE, OVERLAY_RED, TEXT_SIZE_MAX, TEXT_SIZE_MIN, clampTextSize, layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ テキストボックス（大きさ・太字・赤）');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const title = { site: '見本工場', name: '単線結線図', footer: COMPANY_NAME };
  const sheet = (d: Doc) => {
    const { paper, orientation } = chooseSheet(d, title);
    return buildSheetSvg(d, title, paper, orientation);
  };
  const textLine = (svg: string, word: string) => svg.split('\n').find((l) => l.includes('<text') && l.includes(`>${word}</tspan>`)) ?? '';

  // 1. 大きさの範囲：記号の横の文字（1倍）〜5倍
  if (TEXT_SIZE_MIN !== 1 || TEXT_SIZE_MAX !== 5) fail(`文字の大きさは1〜5倍のはずが、${TEXT_SIZE_MIN}〜${TEXT_SIZE_MAX}倍です`);
  const clamps: [unknown, number][] = [[undefined, 1], [0, 1], [0.2, 1], [1, 1], [2.5, 2.5], [5, 5], [99, 5], [Number.NaN, 1], ['3', 1], [Infinity, 1]];
  for (const [v, want] of clamps) if (clampTextSize(v) !== want) fail(`文字の大きさ ${String(v)} は ${want}倍になるはずが ${clampTextSize(v)}倍です`);
  else if (v === clamps.at(-1)![0]) console.log('  文字の大きさは、1倍（記号の横の文字と同じ）〜5倍の範囲に収まる。1倍より小さくはできない');

  // 2. 印刷：大きさ・太字・赤は、文字と行の間隔が同じ倍率で変わる（縦横の比は変わらない）
  const d0 = base();
  const mk = (extra: Partial<DocText>): Doc => ({ ...d0, items: [...d0.items, { kind: 'text', id: 't-x', x: 100, y: 100, lines: ['試験文字', '二行目'], anchor: 'start', ...extra }] });
  const plain = textLine(sheet(mk({})), '試験文字');
  if (!plain.includes(`font-size="${LABEL_FONT}"`) || plain.includes('font-weight') || !plain.includes('fill="currentColor"')) fail(`標準の文字の出力が、これまでと変わっています：${plain}`);
  const big = sheet(mk({ size: 3, bold: true, red: true }));
  const bigLine = textLine(big, '試験文字');
  const dy = /<tspan x="100" dy="([\d.]+)">二行目/.exec(big)?.[1];
  if (!bigLine.includes(`font-size="${LABEL_FONT * 3}"`) || !bigLine.includes('font-weight="700"') || !bigLine.includes(`fill="${OVERLAY_RED}"`)) fail(`3倍・太字・赤の文字の出力が違います：${bigLine}`);
  else if (Number(dy) !== LABEL_LINE * 3) fail(`行の間隔が3倍になっていません（${dy}）`);
  else console.log('  印刷：3倍にすると、文字も行の間隔も3倍。太字・赤はその指定のときだけ。標準の文字の出力は、これまでと同じ');
  const over = textLine(sheet(mk({ size: 99 })), '試験文字');
  if (!over.includes(`font-size="${LABEL_FONT * 5}"`)) fail(`範囲を超える大きさが、5倍に収まっていません：${over}`);

  // 3. 外形：大きさに比例して広がる（図枠に収める計算に入る）
  const w1 = (() => { const b = itemBounds({ kind: 'text', id: 'a', x: 0, y: 0, lines: ['ABC'], anchor: 'start' }); return b.x1 - b.x0; })();
  const w3 = (() => { const b = itemBounds({ kind: 'text', id: 'a', x: 0, y: 0, lines: ['ABC'], anchor: 'start', size: 3 }); return b.x1 - b.x0; })();
  if (Math.abs(w3 / w1 - 3) > 0.001) fail(`3倍の文字の幅が3倍になっていません（${w3 / w1}倍）`);

  // 4. 元の図面の文字：大きさ・太字を変えられる（赤は付かない）。作り直しても残る
  const added = addText(d0, 50, 50, '注記');
  const styled = setTextStyle(setTextStyle(added.doc, added.id, { size: 4 }), added.id, { bold: true });
  const st = styled.items.find((i) => i.id === added.id) as DocText;
  if (st.size !== 4 || st.bold !== true || st.red !== undefined) fail('元の図面の文字の、大きさ・太字が付きません');
  const unbold = setTextStyle(styled, added.id, { bold: false }).items.find((i) => i.id === added.id) as DocText;
  if ('bold' in unbold) fail('太字を外したのに、bold の項目が残っています');
  const clampedSet = setTextStyle(added.doc, added.id, { size: 50 }).items.find((i) => i.id === added.id) as DocText;
  if (clampedSet.size !== 5) fail('範囲を超える大きさが、5倍に収まりません');
  const edited: Doc = { ...styled, edited: true };
  const rebuilt = rebuildWithOverrides(base(), { ...edited, overrides: collectOverrides(edited) }).doc;
  const kept = rebuilt.items.find((i) => i.kind === 'text' && i.lines[0] === '注記') as DocText | undefined;
  if (!kept || kept.size !== 4 || kept.bold !== true) fail('図面を作り直すと、文字の大きさ・太字が消えます');
  else console.log('  元の図面の文字：大きさ・太字を変えられ、図面を作り直しても残る（赤は付かない）');

  // 5. レイヤーに置いた文字：近くの機器について動く。機器が無くなっても、文字は消えない
  const sym = d0.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.symbolId.startsWith('vcb'))!;
  const r0 = addLayerText(d0, 'outage', sym.x + 60, sym.y + 20, '停電範囲');
  if (!r0) throw new Error('レイヤーに文字を足せません');
  const r = r0;
  const lt = layerOf(r.doc, 'outage')!.items[0]!;
  if (lt.red !== true || lt.near === undefined) fail('レイヤーの文字は、ふつう赤で、近くの機器を覚えるはずです');
  const at0 = resolveText(r.doc, lt);
  if (Math.abs(at0.x - (sym.x + 60)) > 0.001 || Math.abs(at0.y - (sym.y + 20)) > 0.001) fail(`置いた場所が合いません（${at0.x},${at0.y}）`);
  const movedSym = moveItem(r.doc, sym.id, 30, 40);
  const at1 = resolveText(movedSym, layerOf(movedSym, 'outage')!.items[0]!);
  if (Math.abs(at1.x - (at0.x + 30)) > 0.001 || Math.abs(at1.y - (at0.y + 40)) > 0.001) fail(`機器を動かしても、文字が一緒に動きません（${at1.x - at0.x},${at1.y - at0.y}）`);
  const gone = removeItem(r.doc, sym.id);
  const at2 = resolveText(gone, layerOf(gone, 'outage')!.items[0]!);
  if (layerOf(gone, 'outage')!.items.length !== 1 || at2.x !== at0.x || at2.y !== at0.y) fail('機器が無くなったとき、文字が消えたり、動いたりしました（最後に置いた場所に残るはずです）');
  else console.log('  レイヤーの文字：近くの機器を動かすと一緒に動く。機器が無くなっても、文字は消えず、最後に置いた場所に残る');

  // 6. 文字を直す・動かす・消す・上限
  const upd = updateLayerText(r.doc, 'outage', r.id, { lines: ['停電', '範囲'], size: 2.5, bold: true, red: false });
  const u = layerOf(upd, 'outage')!.items[0]!;
  if (u.lines.length !== 2 || u.size !== 2.5 || u.bold !== true || 'red' in u) fail('レイヤーの文字の中身・大きさ・太字・色を直せません');
  const mv = moveLayerItems(r.doc, 'outage', [r.id], 10, -5);
  const m1 = resolveText(mv, layerOf(mv, 'outage')!.items[0]!);
  if (Math.abs(m1.x - (at0.x + 10)) > 0.001 || Math.abs(m1.y - (at0.y - 5)) > 0.001) fail('レイヤーの文字を動かせません');
  if (layerOf(removeLayerItems(r.doc, 'outage', [r.id]), 'outage')!.items.length !== 0) fail('レイヤーの文字を消せません');
  let full = d0;
  for (let i = 0; i < MAX_LAYER_ITEMS_PER_KIND; i++) {
    const a = addLayerText(full, 'withstand', 10 * i, 10, `文字${i}`);
    if (!a) {
      fail(`${i + 1}個目の文字が足せません（上限は${MAX_LAYER_ITEMS_PER_KIND}個）`);
      break;
    }
    full = a.doc;
  }
  if (canAddLayerText(full, 'withstand') || addLayerText(full, 'withstand', 0, 0, 'もう1つ') !== null) fail(`上限（${MAX_LAYER_ITEMS_PER_KIND}個）を超えて、文字が足せてしまいます`);
  if (!canAddLayerText(full, 'outage')) fail('ほかのレイヤーの文字の数まで、数えています（レイヤーごとに数えるはずです）');
  if (addLayerText(d0, 'nai', 0, 0, 'x') !== null) fail('存在しないレイヤーに、文字が足せてしまいます');
  console.log(`  レイヤーの文字：中身・大きさ・太字・色を直せる。動かせる・消せる。1つのレイヤーに${MAX_LAYER_ITEMS_PER_KIND}個まで（レイヤーごとに数える）`);

  // 7. 印刷：レイヤーの文字は、そのレイヤーの印刷にだけ赤で出る。元の図面の文字は、どのレイヤーにも出る
  const withBaseNote: Doc = { ...r.doc, items: [...r.doc.items, { kind: 'text', id: 'base-note', x: 20, y: 20, lines: ['元の図面の注記'], anchor: 'start', size: 2 }] };
  const viewOf = (d: Doc, layerId: string | null): Doc => (layerId ? { ...d, items: [...d.items, ...layerItemsAsDocItems(d, layerId)] } : d);
  const baseSvg = sheet(viewOf(withBaseNote, null));
  const outageSvg = sheet(viewOf(withBaseNote, 'outage'));
  const withstandSvg = sheet(viewOf(withBaseNote, 'withstand'));
  if (baseSvg.includes('停電範囲') || baseSvg.includes(OVERLAY_RED)) fail('単線結線図の印刷に、レイヤーの文字・赤い色が出ています');
  if (!outageSvg.includes('>停電範囲</tspan>') || !textLine(outageSvg, '停電範囲').includes(`fill="${OVERLAY_RED}"`)) fail('停電範囲図の印刷に、赤い文字が出ていません');
  if (withstandSvg.includes('>停電範囲</tspan>') || withstandSvg.includes(OVERLAY_RED)) fail('絶縁耐力試験範囲図の印刷に、停電範囲図の文字が出ています');
  for (const [name, svg] of [['単線結線図', baseSvg], ['停電範囲図', outageSvg], ['絶縁耐力試験範囲図', withstandSvg]] as const) {
    if (!svg.includes('>元の図面の注記</tspan>')) fail(`${name}の印刷に、元の図面の文字が出ていません（元の図面の文字は、どのレイヤーにも出るはずです）`);
  }
  console.log('  印刷：レイヤーの文字は、そのレイヤーだけに赤で出る。元の図面の文字は、どのレイヤーにも出る');
}
