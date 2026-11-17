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

console.log('\n■ 複数エリア：エリアをつなぐケーブルが、ケーブルの端末（CH）を突き抜けない');
{
  // 2か所目以降が、1か所目の「どこから」分岐するか（5通り）の、全部の組み合わせ。3か所なら25通り、4か所なら125通り
  const TAPS = ['ds-source', 'ds-vcb', 'vcb-load', 'bus', 'tr-secondary'];
  let checked = 0;
  const bad: string[] = [];
  const combos = (n: number): string[][] => (n === 0 ? [[]] : combos(n - 1).flatMap((c) => TAPS.map((t) => [...c, t])));
  for (const areas of [3, 4]) {
    for (const form of ['pfs', 'cb']) {
      if (areas === 4 && form === 'cb') continue;
      for (const taps of combos(areas - 1)) {
        const a: Answers = { ...answersSpread, areaCount: String(areas), mainBreakerForm: form };
        taps.forEach((t, i) => {
          a[`a${i + 2}:linkTap`] = t;
        });
        const hits = inspectDrawing(fromLayout(layout(buildComposition(a), a)), 'A4', 'portrait').filter((i) => i.kind === 'through');
        checked++;
        if (hits.length > 0) bad.push(`${areas}か所・${form}・${taps.join('／')}`);
      }
    }
  }
  // エリアが多いとき（6・8・10か所）：1か所目から出るケーブルが多くなる。縦線が、となりのエリアの記号に食い込まない
  for (const areas of [6, 8, 10]) {
    for (let shift = 0; shift < TAPS.length; shift++) {
      const a: Answers = { ...answersSpread, areaCount: String(areas), mainBreakerForm: 'pfs' };
      for (let i = 2; i <= areas; i++) a[`a${i}:linkTap`] = TAPS[(i + shift) % TAPS.length]!;
      const hits = inspectDrawing(fromLayout(layout(buildComposition(a), a)), 'A4', 'portrait').filter((i) => i.kind === 'through');
      checked++;
      if (hits.length > 0) bad.push(`${areas}か所・分岐の位置の並びを${shift}つずらしたもの（${hits[0]!.message}）`);
    }
  }
  // ランダムな回答から見つかった、8か所（1か所目から出るケーブルが多い）の図面。縦線が、2か所目の変圧器に食い込んでいた
  {
    const a: Answers = JSON.parse(String.raw`{"startMode":"blank-open","hasGenerator":"yes","hasAuxTr":"yes","hasMotor":"yes","siteName":"テスト","sourceType":"pole","boundaryPattern":"coincident","sectionalizer":"ugs","pasControl":"none","vctLocation":"indoor","vctCount":"2","cableInstallation":"overhead","areaCount":"8","areaForm":"room-cubicle","mainBreakerForm":"pole-top","transformerCount":"9","trUsage":"電灯・動力","trCapacityLight":3,"trCapacityPower":3,"trUsage__2":"動力","trCapacity__2":3,"trUsage__3":"電灯・動力","trCapacityLight__3":2,"trCapacityPower__3":2,"trUsage__4":"動力","trCapacity__4":1,"trUsage__5":"動力","trCapacity__5":2,"trUsage__6":"動力","trCapacity__6":1,"trUsage__7":"動力","trCapacity__7":3,"trUsage__8":"動力","trCapacity__8":2,"trUsage__9":"電灯・動力","trCapacityLight__9":1,"trCapacityPower__9":2,"hasCapacitor":"no","generatorCount":"2","generatorUsage":"normal","generatorCapacity":"テスト","generatorUsage__2":"normal","generatorCapacity__2":"テスト","motorCount":"12","motorCapacity":2,"motorCapacity__2":1,"motorCapacity__3":1,"motorCapacity__4":3,"motorCapacity__5":1,"motorCapacity__6":1,"motorCapacity__7":3,"motorCapacity__8":3,"motorCapacity__9":3,"motorCapacity__10":1,"motorCapacity__11":2,"motorCapacity__12":2,"areaForm__2":"apartment-pole","a2:areaIntake":"none","a2:transformerCount":"1","a2:trUsage":"電灯・動力","a2:trCapacityLight":2,"a2:trCapacityPower":1,"a2:hasCapacitor":"yes","a2:capacitorCount":"3","areaForm__3":"room-open","a3:areaIntake":"lbs-pf","a3:relayCount":"1","a3:transformerCount":"2","a3:trUsage":"電灯","a3:trCapacity":2,"a3:trUsage__2":"電灯・動力","a3:trCapacityLight__2":3,"a3:trCapacityPower__2":3,"a3:hasCapacitor":"yes","a3:capacitorCount":"9","areaForm__4":"room-cubicle","a4:areaIntake":"vcb","a4:transformerCount":"1","a4:trUsage":"電灯","a4:trCapacity":1,"a4:hasCapacitor":"no","areaForm__5":"apartment-pole","a5:areaIntake":"ds-vcb","a5:vtSetCount":"3","a5:ctSetCount":"1","a5:transformerCount":"2","a5:trUsage":"電灯","a5:trCapacity":3,"a5:trUsage__2":"動力","a5:trCapacity__2":2,"a5:hasCapacitor":"yes","a5:capacitorCount":"3","areaForm__6":"apartment-pole","a6:areaIntake":"ds-vcb","a6:vtSetCount":"2","a6:ctSetCount":"6","a6:transformerCount":"12","a6:trUsage":"動力","a6:trCapacity":1,"a6:trUsage__2":"動力","a6:trCapacity__2":3,"a6:trUsage__3":"動力","a6:trCapacity__3":3,"a6:trUsage__4":"電灯","a6:trCapacity__4":2,"a6:trUsage__5":"動力","a6:trCapacity__5":1,"a6:trUsage__6":"電灯・動力","a6:trCapacityLight__6":3,"a6:trCapacityPower__6":2,"a6:trUsage__7":"電灯・動力","a6:trCapacityLight__7":2,"a6:trCapacityPower__7":1,"a6:trUsage__8":"電灯・動力","a6:trCapacityLight__8":3,"a6:trCapacityPower__8":2,"a6:trUsage__9":"電灯","a6:trCapacity__9":2,"a6:trUsage__10":"電灯・動力","a6:trCapacityLight__10":3,"a6:trCapacityPower__10":3,"a6:trUsage__11":"動力","a6:trCapacity__11":3,"a6:trUsage__12":"電灯","a6:trCapacity__12":1,"a6:hasCapacitor":"yes","a6:capacitorCount":"4","areaForm__7":"room-open","a7:areaIntake":"lbs-pf","a7:relayCount":"8","a7:transformerCount":"3","a7:trUsage":"電灯","a7:trCapacity":1,"a7:trUsage__2":"電灯・動力","a7:trCapacityLight__2":2,"a7:trCapacityPower__2":3,"a7:trUsage__3":"電灯","a7:trCapacity__3":2,"a7:hasCapacitor":"no","areaForm__8":"cubicle","a8:areaIntake":"lbs","a8:relayCount":"1","a8:transformerCount":"12","a8:trUsage":"動力","a8:trCapacity":2,"a8:trUsage__2":"電灯","a8:trCapacity__2":3,"a8:trUsage__3":"動力","a8:trCapacity__3":1,"a8:trUsage__4":"電灯","a8:trCapacity__4":2,"a8:trUsage__5":"動力","a8:trCapacity__5":2,"a8:trUsage__6":"動力","a8:trCapacity__6":3,"a8:trUsage__7":"電灯・動力","a8:trCapacityLight__7":1,"a8:trCapacityPower__7":3,"a8:trUsage__8":"電灯・動力","a8:trCapacityLight__8":1,"a8:trCapacityPower__8":2,"a8:trUsage__9":"電灯","a8:trCapacity__9":2,"a8:trUsage__10":"電灯","a8:trCapacity__10":1,"a8:trUsage__11":"電灯","a8:trCapacity__11":1,"a8:trUsage__12":"動力","a8:trCapacity__12":2,"a8:hasCapacitor":"yes","a8:capacitorCount":"2","a2:linkTap":"tr-secondary","a3:linkTap":"tr-secondary","a4:linkTap":"ds-vcb","a5:linkTap":"tr-secondary","a6:linkTap":"tr-secondary","a7:linkTap":"ds-vcb","a8:linkTap":"bus"}`) as Answers;
    const hits = inspectDrawing(fromLayout(layout(buildComposition(a), a)), 'A4', 'portrait').filter((i) => i.kind === 'through');
    checked++;
    if (hits.length > 0) bad.push(`8か所の実例（${hits[0]!.message}）`);
  }
  if (bad.length > 0) fail(`ケーブルの端末を線が突き抜ける組み合わせが ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  console.log(`  エリア3か所・4か所で、分岐の位置の全部の組み合わせ（${checked}通り）：端末を突き抜ける線は ${bad.length}件`);
}

console.log('\n■ 複数エリア：ケーブルの線どうしが、記号のない所で交わらない（3か所）');
{
  // 上の位置から近いエリアへ、下の位置から遠いエリアへ出す組み合わせは、遠いケーブルを、間のエリアの下を通して、手前のすきまから上げる
  const TAPS = ['ds-source', 'ds-vcb', 'vcb-load', 'bus', 'tr-secondary'];
  let checked = 0;
  const bad: string[] = [];
  for (const form of ['pfs', 'cb']) {
    for (const t2 of TAPS) {
      for (const t3 of TAPS) {
        const a: Answers = { ...answersSpread, areaCount: '3', mainBreakerForm: form, 'a2:linkTap': t2, 'a3:linkTap': t3 };
        const crossings = layout(buildComposition(a), a).cableCrossings ?? 0;
        checked++;
        if (crossings > 0) bad.push(`${form}・${t2}／${t3}（${crossings}か所）`);
      }
    }
  }
  if (bad.length > 0) fail(`ケーブルの線が交わる組み合わせが ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  console.log(`  エリア3か所で、分岐の位置の全部の組み合わせ（${checked}通り）：ケーブルの線が交わる所は ${bad.length}件`);
}
