/**
 * 図面の検証（check-drawing）の15個目：蓄電池のPCSの文字（出力ごとの「3kW×3台」の一覧）が長いときに、下の記号と重ならない。
 * （全体デバッグ 直し5。特殊設備を重ねた構成で、PCSの文字が、すぐ下の蓄電池ユニットに重なっていた）
 */
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { findLabelCollisions, layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 蓄電池のPCSの文字が長いとき、下の記号と重ならない');
{
  for (const groups of [3, 6, 10]) {
    for (const areas of ['1', '2', '3']) {
      const a: Answers = {
        ...answersSpread,
        hasBattery: 'yes',
        hasAuxTr: 'yes',
        areaCount: areas,
        batteryUnitCount: 3,
        batteryUnitRating: 'テスト',
        batteryPcsGroupCount: String(groups),
      };
      for (let g = 1; g <= groups; g++) {
        const sfx = g === 1 ? '' : `__${g}`;
        a[`batteryPcsKw${sfx}`] = 1 + (g % 3);
        a[`batteryPcsUnits${sfx}`] = String(1 + ((g * 5) % 12));
      }
      const L = layout(buildComposition(a), a);
      const hits = inspectDrawing(fromLayout(L), 'A4', 'portrait').filter((i) => i.kind === 'overlap');
      if (hits.length > 0) fail(`PCSの文字の組（${groups}組・エリア${areas}）で、文字が記号に重なっています（${hits.map((h) => h.message).join(' / ')}）`);
      const near = findLabelCollisions(L).filter((m) => m.includes('が記号（'));
      if (near.length > 0) fail(`PCSの文字の組（${groups}組・エリア${areas}）で、文字が記号に近すぎます（${near.slice(0, 2).join(' / ')}）`);
    }
  }
  console.log('  PCSの文字の組 3・6・10組 × エリア1〜3：文字が下の記号に重ならない');
}
