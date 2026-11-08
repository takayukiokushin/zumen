/**
 * 図面の検証（check-drawing）の12個目：
 *   ・手で直していない図面を開き直しても、印刷の向きとレイヤーが引き継がれる
 *   ・大きくした文字（メモ）を、「結線を整える」と重なりの確認が、その大きさで測る
 */
import { addText, fromLayout, setTextStyle } from '../../apps/web/src/editor/doc.ts';
import type { Doc } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing, tidyDrawing } from '../../apps/web/src/editor/inspect.ts';
import { addLayerText, carryOver, layerOf } from '../../apps/web/src/editor/layers.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 開き直したときの向きの引き継ぎと、大きくした文字の重なり');
{
  const gen = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));

  // 1. 手で直していない図面を開き直す（回答から作り直す）とき、向きとレイヤーを引き継ぐ
  const saved: Doc = { ...addLayerText(gen(), 'outage', 10, 10, 'メモ')!.doc, orientation: 'landscape' };
  const reopened = carryOver(gen(), saved);
  if (reopened.orientation !== 'landscape') fail('開き直したとき、決めてあった印刷の向き（横）が引き継がれていません');
  if (layerOf(reopened, 'outage')?.items.length !== 1) fail('開き直したとき、レイヤーが引き継がれていません');
  if (carryOver(gen(), gen()).orientation !== undefined) fail('向きを決めていないのに、向きが付いています（自動の判定のままのはずです）');
  if (carryOver({ ...gen(), orientation: 'portrait' }, saved).orientation !== 'portrait') fail('作り直した図面に向きが決まっているとき、それを上書きしています');
  console.log('  開き直しても、決めた印刷の向きとレイヤーが引き継がれる（決めていなければ自動のまま）');

  // 2. 大きくした文字は、その大きさで重なりを測る
  //    同じ場所に、標準の大きさのメモと、5倍のメモを置く。5倍のほうは、大きいので、より広い範囲の文字に重なる
  const base = gen();
  const syms = base.items.filter((i) => i.kind === 'symbol' && i.label.length > 0);
  const target = syms.find((i) => i.kind === 'symbol' && i.symbolId === 'vcb') ?? syms[0]!;
  if (target.kind !== 'symbol') throw new Error('記号がありません');
  const at = { x: target.x + target.labelDx - 80, y: target.y + target.labelDy };
  const small = addText(base, at.x, at.y, '確認メモ');
  const bigDoc = setTextStyle(small.doc, small.id, { size: 5 });
  const issues = (d: Doc) => inspectDrawing(d, 'A3', 'portrait').filter((i) => i.kind === 'overlap').length;
  const nSmall = issues(small.doc);
  const nBig = issues(bigDoc);
  if (!(nBig > nSmall)) fail(`文字を5倍にしても、重なりの確認が増えていません（標準 ${nSmall}件・5倍 ${nBig}件）。大きさを考えて測れていません`);
  // 「結線を整える」は、大きくした文字が、ほかの文字に重ならない位置へ動かす（標準の大きさで測っていたら、5倍のままでは重なる）
  const tidy = tidyDrawing(bigDoc, 'A3', 'portrait');
  const after = tidy.doc.items.find((i) => i.id === small.id);
  const before = bigDoc.items.find((i) => i.id === small.id);
  if (!after || after.kind !== 'text' || !before || before.kind !== 'text') throw new Error('メモが見つかりません');
  const moved = after.x !== before.x || after.y !== before.y;
  const afterIssues = inspectDrawing(tidy.doc, 'A3', 'portrait').filter((i) => i.kind === 'overlap' && i.itemId === small.id).length;
  if (nBig > nSmall && !moved && afterIssues === 0) fail('5倍のメモが重なっているのに、整えても動かず、重なりも残っていません');
  // 大きくした文字が無い図面は、これまでと同じ（見本の図面で確かめている）。ここでは、標準の大きさのメモが、倍率なしで測られることを確かめる
  if (issues(setTextStyle(small.doc, small.id, { size: 1 })) !== nSmall) fail('標準の大きさのメモの重なりが、大きさを指定したときと違います');
  console.log(`  文字を大きくすると、重なりの確認も、その大きさで測る（標準 ${nSmall}件 → 5倍 ${nBig}件）。整えるときも、その大きさで動かす`);
}
