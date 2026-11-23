/**
 * 図面の検証（check-drawing）の26個目：定格電流の記載（第20弾・図面再現の診断から）。
 * 「変圧器の定格電流を記載する」を入れたときだけ、変圧器（一次／二次）・電動機・VCB に、容量と電圧から計算した電流を書く。
 * 数字は、有効数字4桁・小数1桁まで。V結線は三相として計算（小さいほうの容量 × √3）。VCB は、変圧器の一次電流＋母線から直接の電動機。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, formatAmps, ratedCurrentLines, transformerCurrents } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { fail } from './common.ts';

console.log('\n■ 定格電流の記載（変圧器・電動機・VCB）');
{
  const bad: string[] = [];
  const eq = (name: string, got: unknown, want: unknown) => {
    if (got !== want) bad.push(`${name}：${String(got)}（${String(want)} のはず）`);
  };
  // 数字の書き方：有効数字4桁・小数1桁まで
  eq('65.61', formatAmps(65.61), '65.6A');
  eq('9.46', formatAmps(9.46), '9.5A');
  eq('300.34', formatAmps(300.34), '300.3A');
  eq('1000.4', formatAmps(1000.4), '1000A');
  eq('2061.96', formatAmps(2061.96), '2062A');
  eq('999.97', formatAmps(999.97), '1000A');
  eq('0', formatAmps(0), '');
  eq('NaN', formatAmps(NaN), '');

  // 変圧器：750kVA・6600/210V（三相）→ 65.6A／2062A（図面1と同じ）
  const t = transformerCurrents({ trConnection: 'tr-3p-dy', trCapacity: 750, trVoltage: '6600/210V' });
  eq('三相 一次', formatAmps(t.primary), '65.6A');
  eq('三相 二次', formatAmps(t.secondary), '2062A');
  // 単相：容量 ÷ 電圧（二次は 210-105V の 210V）
  const s = transformerCurrents({ trConnection: 'tr-1p', trCapacity: 100, trVoltage: '6600/210-105V' });
  eq('単相 一次', formatAmps(s.primary), '15.2A');
  eq('単相 二次', formatAmps(s.secondary), '476.2A');
  // V結線：三相として計算。100kVA 2台 → 出力173.2kVA。電流は、1台の容量 ÷ 電圧
  const v = transformerCurrents({ trConnection: 'tr-vv', trCapacity: 100, trCapacity2: 100, trVoltage: '6600/210V' });
  eq('V結線 一次', formatAmps(v.primary), '15.2A');
  eq('V結線 二次', formatAmps(v.secondary), '476.2A');
  // 電灯・動力の共用V結線：小さいほうの容量で
  const m = transformerCurrents({ trConnection: 'tr-vv', trUsage: '電灯・動力', trCapacityLight: 100, trCapacityPower: 50, trVoltage: '6600/210V' });
  eq('共用V結線 一次', formatAmps(m.primary), '7.6A');
  eq('共用V結線 二次', formatAmps(m.secondary), '238.1A');
  eq('容量なし', formatAmps(transformerCurrents({ trConnection: 'tr-3p-dy', trVoltage: '6600/210V' }).primary), '');

  // 組み立て：入れていなければ、何も変わらない。入れると、変圧器・電動機・VCB に出る
  const base: Answers = {
    mainBreakerForm: 'cb', transformerCount: 2, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 750, trVoltage: '6600/210V',
    trCapacity__2: 300, trConnection__2: 'tr-3p-dy', trUsage__2: '動力', trVoltage__2: '6600/210V',
    hasCapacitor: 'yes', capacitorCount: 1,
    hasMotor: 'yes', motorCount: 2, motorCapacity: 55, motorRatedVoltage: '6600', motorSource: 'bus',
    motorCapacity__2: 22, motorRatedVoltage__2: '200', motorSource__2: 'secondary', motorSourceTr__2: '1',
  };
  const items = (extra: Answers) => {
    const raw: Answers = { ...base, ...extra };
    const eff = effectiveAnswers(dropHiddenChoices(raw));
    return { list: buildComposition(eff), eff };
  };
  const lbl = (list: ReturnType<typeof buildComposition>, role: string, unit?: number) => list.find((i) => i.role === role && (unit === undefined || (i.unit ?? 0) === unit))?.label.join('|');
  const off = items({});
  if (off.list.some((i) => i.label.some((l) => /\d+(\.\d)?A$/.test(l) && !/^(\d+V )?\d+A$/.test(l) && /\./.test(l)))) bad.push('チェックなしなのに、電流が書かれています');
  eq('チェックなし 変圧器', /A\/\d+A/.test(lbl(off.list, 'transformer', 0) ?? ''), false);
  const on = items({ showRatedCurrent: 'yes' });
  eq('変圧器1台目', /\|65\.6A\/2062A/.test(lbl(on.list, 'transformer', 0) ?? ''), true);
  eq('変圧器2台目', /\|26\.2A\/824\.8A/.test(lbl(on.list, 'transformer', 1) ?? ''), true);
  // 電動機：55kW・6600V・力率0.8・効率0.9 → 6.7A
  eq('電動機1台目', /\|6\.7A$/.test(lbl(on.list, 'motor', 0) ?? ''), true);
  // 力率・効率を入れると、それで計算する（55kW・6600V・力率0.9・効率0.95 → 5.6A）
  const pf = items({ showRatedCurrent: 'yes', motorPowerFactor: 0.9, motorEfficiency: 0.95 });
  eq('電動機 力率・効率', /\|5\.6A$/.test(lbl(pf.list, 'motor', 0) ?? ''), true);
  // VCB：変圧器の一次電流（65.6＋26.2）＋母線から直接の電動機（6.7）。二次側の電動機・コンデンサは入れない
  const rc = ratedCurrentLines(on.eff);
  const sum = transformerCurrents({ trConnection: 'tr-3p-dy', trCapacity: 750, trVoltage: '6600/210V' }).primary + transformerCurrents({ trConnection: 'tr-3p-dy', trCapacity: 300, trVoltage: '6600/210V' }).primary + (55 * 1000) / (Math.sqrt(3) * 6600 * 0.8 * 0.9);
  eq('VCBの合計', rc.vcb, formatAmps(sum));
  eq('VCBの文字', lbl(on.list, 'main-breaker')?.endsWith(`|${rc.vcb}`), true);
  // 容量が入っていない変圧器があるときは、VCBの合計は書かない
  eq('容量なし 合計', ratedCurrentLines(items({ showRatedCurrent: 'yes', trCapacity__2: undefined as unknown as number }).eff).vcb, '');

  // 図面：点検の問題が増えない
  const doc = fromLayout(layout(on.list, on.eff));
  const problems = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  const docOff = fromLayout(layout(off.list, off.eff));
  const problemsOff = inspectDrawing(docOff, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (problems.length > problemsOff.length) bad.push(`電流を書いた図面の点検の問題が、${problemsOff.length}件から ${problems.length}件に増えました`);
  if (bad.length > 0) fail(`定格電流の記載に問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
  else console.log('  変圧器 65.6A/2062A（V結線は三相・小さいほうの容量×√3）、電動機（力率0.8・効率0.9。入力で変更可）、VCB（変圧器の一次＋母線の電動機）。チェックなしなら、何も書かない');
}
