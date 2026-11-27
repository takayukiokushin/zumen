/**
 * 図面の検証（check-drawing）の34個目：「レイアウトを縮小」を繰り返し押しても、記号・文字が、新しく重なったり、近づきすぎたりしない
 * （第21弾 項目18の6。文字が長い図面（小数の容量・長い設置場所の名前・複数の組）で、縮小の途中に、PCSの文字が変圧器の文字に重なった。
 * 774通りの組み合わせのうち 144通りで起きていた。いまは 0通り）。
 */
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import type { Doc } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { SHRINK, scaleLayout } from '../../apps/web/src/editor/layoutScale.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ レイアウトを縮小：文字が長い図面でも、押すたびに、重なりが増えない');
{
  const trouble = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'gap'].includes(i.kind)).length;
  // 文字を長くする設備（小数の容量・複数の組・長い設置場所の名前）
  const SPECIAL: Partial<Answers>[] = [
    { hasPv: 'yes', pvGroupCount: '2', pcsCapacity: '12.499', pcsCount: '3', pcsCapacity__2: '33.3', pcsCount__2: '3' },
    { hasGenerator: 'yes', generatorCount: '3', generatorTransformer: '1', generatorPlace: '第二工場 北側 非常用発電機室 地下1階', generatorCapacity: '1000', generatorRatedVoltage: '6600V' },
    { hasBattery: 'yes', batteryPcsGroupCount: '2', batteryPcsKw: '12.5', batteryPcsUnits: '3', batteryPcsKw__2: '7.25', batteryPcsUnits__2: '4', batteryUnitCount: 2, batteryUnitRating: '500kWh 長い名前の蓄電池' },
    { hasMotor: 'yes', motorCount: '3', motorPlace: '屋上 冷却塔ファン用 電動機置場' },
    { hasAuxTr: 'yes' },
  ];
  // 以前、重なった組み合わせ（エリア1・遮断器・変圧器1台・太陽光＋発電機＋電動機）を必ず入れ、あとは数を絞って、決まった間隔で選ぶ
  const cases: { area: number; form: string; trN: number; mask: number }[] = [{ area: 1, form: 'cb', trN: 1, mask: 38 }];
  let n = 0;
  for (const area of [1, 2, 3]) for (const form of ['cb', 'pfs']) for (const trN of [1, 2, 3]) for (let mask = 1; mask < 1 << SPECIAL.length; mask++) {
    if (n++ % 11 === 0) cases.push({ area, form, trN, mask });
  }
  let total = 0;
  let steps = 0;
  const bad: string[] = [];
  for (const c of cases) {
    let a: Answers = {
      ...answersSpread,
      mainBreakerForm: c.form,
      areaCount: c.area,
      transformerCount: c.trN,
      'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried',
      'a3:areaIntake': 'ds-vcb', 'a3:trCapacity': 100, 'a3:linkTap': 'bus', 'a3:linkCableInstallation': 'buried',
    } as Answers;
    SPECIAL.forEach((s, i) => { if (c.mask & (1 << i)) a = { ...a, ...s } as Answers; });
    let cur: Doc;
    try { cur = fromLayout(layout(buildComposition(a), a), 'ls'); } catch { continue; }
    const base = trouble(cur);
    total++;
    for (let k = 1; k <= 40; k++) {
      const r = scaleLayout(cur, SHRINK);
      if (!r.changed) break;
      steps++;
      const t = trouble(r.doc);
      if (t > base) {
        bad.push(`エリア${c.area}・${c.form}・変圧器${c.trN}台・設備${c.mask}・${k}回目：${base}→${t}件`);
        break;
      }
      cur = r.doc;
    }
  }
  if (bad.length > 0) fail(`縮小の途中で、重なりなどが増える図面が ${bad.length}/${total} 通りあります（例：${bad.slice(0, 2).join(' ／ ')}）`);
  else console.log(`  ${total}通りの図面を、最大40回ずつ（のべ${steps}回）縮めても、重なりなどは、増えなかった`);
}
