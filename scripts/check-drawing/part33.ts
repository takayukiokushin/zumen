/**
 * 図面の検証（check-drawing）の33個目：発電機が1台の変圧器に3台以上つながり、太陽光があり、発電機に設置場所の名前を入れても、
 * 発電機の文字が、変圧器の文字に重ならない（第21弾 項目18の4。以前は「まれに重なる（324通り中10通り）」と記録されていたが、再び調べると、
 * 5,600通りの組み合わせで、重なりは1件も無かった。以後、重なりが戻らないように、代表的な組み合わせを検査に入れる）。
 */
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { findLabelCollisions, layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 発電機が3台以上＋太陽光＋設置場所の名前：発電機の文字が、変圧器の文字に重ならない');
{
  let total = 0;
  const bad: string[] = [];
  for (const trN of [1, 2, 3]) {
    for (const gens of [3, 4, 6]) {
      for (const place of ['', '非常用', '第二工場 北側 非常用発電機室']) {
        for (const pcs of [1, 3]) {
          const a: Answers = {
            ...answersSpread,
            mainBreakerForm: 'cb',
            transformerCount: trN,
            hasPv: 'yes',
            pvGroupCount: '1',
            pcsCapacity: 50,
            pcsCount: String(pcs),
            hasGenerator: 'yes',
            generatorCount: String(gens),
            generatorTransformer: '1',
            generatorPlace: place,
            generatorUsage: 'emergency',
            generatorFuel: 'diesel',
            generatorCapacity: '100',
          } as Answers;
          const L = layout(buildComposition(a), a);
          const overlaps = inspectDrawing(fromLayout(L), 'A3', 'landscape').filter((i) => i.kind === 'overlap');
          const near = findLabelCollisions(L);
          total++;
          if (overlaps.length > 0 || near.length > 0) bad.push(`変圧器${trN}台・発電機${gens}台・場所「${place}」・PCS${pcs}台：${overlaps[0]?.message ?? near[0]}`);
        }
      }
    }
  }
  if (bad.length > 0) fail(`発電機の文字が重なる組み合わせが ${bad.length}/${total} 通りあります（例：${bad.slice(0, 2).join(' ／ ')}）`);
  else console.log(`  ${total}通りの組み合わせで、文字の重なり・近すぎは、1件も無い`);
}
