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

console.log('\n■ 複数エリアで、ほかのエリアの枠の線を、「文字が近すぎる」と数えない');
{
  // 枠（キュービクルなど）は、そのエリアの幅だけ。枠の無いエリア（屋内開放など）の文字は、となりのエリアの枠の線と、高さが近くても、問題ではない
  let checked = 0;
  for (const areas of ['2', '3', '4']) {
    for (const form of ['room-open', 'cubicle', 'apartment-pole']) {
      for (const mb of ['pfs', 'cb']) {
        const a: Answers = { ...answersSpread, areaCount: areas, areaForm: form, mainBreakerForm: mb };
        const near = findLabelCollisions(layout(buildComposition(a), a)).filter((m) => m.includes('枠の線'));
        checked++;
        if (near.length > 0) fail(`エリア${areas}か所（${form}・${mb}）で、枠の線に近すぎる文字が${near.length}件あります（${near.slice(0, 2).join(' / ')}）`);
      }
    }
  }
  // 1か所目が枠のあるキュービクル、2か所目が枠の無い柱上（集合住宅）：2か所目の文字が、1か所目の枠の線と、同じ高さの近くに来る
  for (const mb of ['pfs', 'cb']) {
    const a: Answers = { ...answersSpread, areaCount: '2', areaForm: 'room-cubicle', areaForm__2: 'apartment-pole', mainBreakerForm: mb };
    const near = findLabelCollisions(layout(buildComposition(a), a)).filter((m) => m.includes('枠の線'));
    checked++;
    if (near.length > 0) fail(`枠のあるエリアと枠の無いエリア（${mb}）で、枠の線に近すぎる文字が${near.length}件あります（${near.slice(0, 2).join(' / ')}）`);
  }
  console.log(`  エリア2〜4か所 × 屋内開放・キュービクル・集合住宅（柱上）× PFS・CB の${checked}通り：枠の線に近すぎる文字は0件`);
}
