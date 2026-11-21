/**
 * 図面の検証（check-drawing）の20個目：蓄電池ユニットの形（第20弾 項目4）。
 * 長方形の中は「蓄電池」「ユニット」の2行（真ん中）。長方形の横幅は縮み、高さは変わらない。上の縦棒は、長方形の真ん中。
 * 保存してある古い形の図面は、開くとき、同じ場所・同じつながりのまま、新しい形に直る。
 */
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { migrateBattery, needsBatteryMigration } from '../../apps/web/src/editor/onwireMigrate.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import type { RectShape, TextShape } from '../../packages/symbols/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { answers, fail } from './common.ts';

console.log('\n■ 蓄電池ユニット：2行の文字・短くした長方形・古い図面の変換');
{
  const bad: string[] = [];
  const def = getSymbol('battery-unit');
  const rect = def.shapes.find((s): s is RectShape => s.k === 'rect')!;
  const texts = def.shapes.filter((s): s is TextShape => s.k === 'text');
  if (rect.h !== 30) bad.push(`長方形の高さが変わっています（${rect.h}。もとは30）`);
  if (rect.w >= 88) bad.push(`長方形の横幅が、短くなっていません（${rect.w}）`);
  if (def.box.h !== 44) bad.push(`外形の高さが変わっています（${def.box.h}。もとは44）`);
  if (texts.map((t) => t.s).join('/') !== '蓄電池/ユニット') bad.push(`中の文字が「蓄電池」「ユニット」の2行ではありません（${texts.map((t) => t.s).join('/')}）`);
  const cx = rect.x + rect.w / 2;
  for (const t of texts) if (Math.abs(t.x - cx) > 0.01) bad.push(`文字「${t.s}」が、長方形の真ん中にありません`);
  // 2行が、長方形の上下の真ん中に、収まる（行の間隔 11、文字の高さ 9）
  const mid = (texts[0]!.y + texts[1]!.y) / 2;
  if (Math.abs(mid - (rect.y + rect.h / 2)) > 0.01) bad.push('2行の文字が、長方形の上下の真ん中にありません');
  for (const t of texts) {
    const size = t.size ?? 9;
    const half = (t.s.length * size) / 2;
    if (t.x - half < rect.x + 2 || t.x + half > rect.x + rect.w - 2) bad.push(`文字「${t.s}」が、長方形からはみ出しそうです`);
    if (t.y - size / 2 < rect.y || t.y + size / 2 > rect.y + rect.h) bad.push(`文字「${t.s}」が、長方形の上下からはみ出しそうです`);
  }
  const bp = def.ports.find((q) => q.id === 'out')!;
  if (Math.abs(bp.x - cx) > 0.01 || def.box.w !== rect.x * 2 + rect.w) bad.push(`上の縦棒が、長方形の真ん中にない、または、外形が長方形に合っていません（接続点 ${bp.x}・外形 ${def.box.w}）`);

  // 自動作図：つながる線が、縦棒の位置に来る。点検の問題は無い
  const ab: Answers = { ...answers, transformerCount: 2, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: '4', pcsToTr1: 2, pcsToTr2: 2, hasGenerator: 'no', hasCapacitor: 'no', hasBattery: 'yes', batteryCapacity: '100kWh', batteryTransformer: '1' };
  const d0 = fromLayout(layout(buildComposition(ab), ab));
  const bat = d0.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.symbolId === 'battery-unit');
  if (!bat) bad.push('蓄電池ユニットが描かれていません（試験の前提が違います）');
  else {
    const wires = d0.items.filter((i): i is DocWire => i.kind === 'wire' && (i.at1?.item === bat.id || i.at2?.item === bat.id));
    if (wires.length === 0) bad.push('蓄電池ユニットに、線がつながっていません');
    for (const w of wires) if (Math.abs(w.x1 - w.x2) > 0.01 || Math.abs(w.x1 - (bat.x + bp.x)) > 0.01) bad.push('蓄電池ユニットにつながる線が、縦棒の位置に、まっすぐ来ていません');
    if (inspectDrawing(d0, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew'].includes(i.kind)).length > 0) bad.push('蓄電池ユニットのある図面の点検で、問題が出ます');

    // 古い形の図面（外形96・縦棒48）：開くと、同じ場所・同じつながりで、新しい形に直る
    const oldSym = (s: DocSymbol): DocSymbol => ({ ...s, x: s.x - 20, labelDx: s.labelDx === -8 ? -6 : s.labelDx + 20 });
    const oldDoc: Doc = {
      ...d0,
      layoutV: 2,
      items: d0.items.map((i) => (i.kind === 'symbol' && i.symbolId === 'battery-unit' ? oldSym(i) : i)),
      ...(d0.base ? { base: { ...d0.base, symbols: Object.fromEntries(Object.entries(d0.base.symbols).map(([n, b]) => [n, b.symbolId === 'battery-unit' ? { ...b, x: b.x - 20, labelDx: b.labelDx === -8 ? -6 : b.labelDx + 20 } : b])) } } : {}),
    };
    if (!needsBatteryMigration(oldDoc)) bad.push('古い形の蓄電池ユニットの図面が、直す対象になっていません');
    const m = migrateBattery(oldDoc);
    const k = m.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === bat.id)!;
    if (Math.abs(k.x - bat.x) > 0.01 || Math.abs(k.y - bat.y) > 0.01) bad.push(`変換のあと、位置が違います（${k.x - bat.x}, ${k.y - bat.y}）`);
    if (Math.abs(k.labelDx - bat.labelDx) > 0.01) bad.push(`変換のあと、標準の位置にあった文字が、標準の位置に直っていません（${k.labelDx} / ${bat.labelDx}）`);
    if (needsBatteryMigration(m) || m.layoutV !== 3) bad.push('変換のあと、版が新しくなっていません');
    if (m.base?.symbols[bat.id]?.x !== d0.base?.symbols[bat.id]?.x) bad.push('変換のあと、手で直した内容の控えの位置が、合っていません');
    // 手で動かした文字は、いまの場所のまま
    const moved: Doc = { ...oldDoc, items: oldDoc.items.map((i) => (i.id === bat.id && i.kind === 'symbol' ? { ...i, labelDx: i.labelDx + 33 } : i)) };
    const mm = migrateBattery(moved).items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === bat.id)!;
    const orig = moved.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === bat.id)!;
    if (Math.abs(mm.x + mm.labelDx - (orig.x + orig.labelDx)) > 0.01) bad.push('手で動かした文字の、図面の上の位置が、変換で動きました');
  }
  if (bad.length > 0) fail(`蓄電池ユニットに問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
  else console.log('  2行の文字は真ん中・長方形は横だけ縮む（高さは同じ）・縦棒は真ん中・古い図面は、位置とつながりが変わらずに直る');
}
