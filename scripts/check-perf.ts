/**
 * 大きな図面の速さの確認（時間に上限を決めて、遅くなったら止める）。
 *
 * 変圧器・コンデンサ・PCS が多い案件で、図面の組み立て・「結線を整える」・確認・1文字ごとの再計算が、
 * 決めた時間に収まっているか。台数が増えると、時間が台数の2乗で増える作りに戻っていないかも見る。
 * 上限は、測った値の約8倍（環境の遅い日があっても、止まらないように）。詳しい内訳は、scripts/bench-big.ts で見られる。
 *
 *   node --experimental-strip-types scripts/check-perf.ts
 */
import { fromLayout } from '../apps/web/src/editor/doc.ts';
import { chooseSheet, inspectDrawing, tidyDrawing } from '../apps/web/src/editor/inspect.ts';
import { GOLDEN_CASES } from './golden/cases.ts';
import { spreadUnits } from './check-drawing/common.ts';
import { buildComposition } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

const base = GOLDEN_CASES.find((c) => c.id === '15-tr8-pv')!.answers;
/** 台数を n にした回答（変圧器 n 台・コンデンサ n 組・PCS は各変圧器に2台ずつ） */
function bigAnswers(n: number): Record<string, unknown> {
  const a: Record<string, unknown> = { ...base, transformerCount: n, pcsCount: String(Math.min(100, n * 2)), hasCapacitor: 'yes', capacitorCount: Math.min(100, n), capacitorCapacity: '50kvar' };
  for (let i = 1; i <= 100; i++) delete a[`pcsToTr${i}`];
  for (let i = 1; i <= n && i <= 50; i++) a[`pcsToTr${i}`] = 2;
  return a;
}

/** 数回測って、いちばん速かったものを使う（たまたま重なった遅れで、止まらないように） */
function best(times: number, fn: () => void): number {
  let min = Infinity;
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min;
}

console.log('■ 大きな図面の速さ');
const LIMIT = { 20: { build: 400, tidy: 600, key: 400 }, 50: { build: 800, tidy: 1200, key: 800 }, 100: { build: 1500, tidy: 2000, key: 1500 } } as const;
const buildTimes: Record<number, number> = {};
for (const n of [20, 50, 100] as const) {
  const raw = bigAnswers(n);
  const answers = spreadUnits(raw as never);
  const build = best(3, () => {
    layout(buildComposition(answers), answers);
  });
  buildTimes[n] = build;
  const doc = fromLayout(layout(buildComposition(answers), answers));
  const { paper, orientation } = chooseSheet(doc, { site: 's', name: 'n', footer: 'f' });
  const tidy = best(3, () => {
    inspectDrawing(doc, paper, orientation);
    tidyDrawing(doc, paper, orientation);
  });
  // 入力欄に1文字入れるたびに、回答から構成・配置までをやり直す時間
  const key = best(3, () => {
    const a = spreadUnits({ ...raw, siteName: 'x' } as never);
    layout(buildComposition(a), a);
  });
  const lim = LIMIT[n];
  const line = `台数${String(n).padStart(3)}：組み立て＋配置 ${build.toFixed(0)}ms（上限 ${lim.build}）／確認＋結線を整える ${tidy.toFixed(0)}ms（上限 ${lim.tidy}）／1文字ごとの再計算 ${key.toFixed(0)}ms（上限 ${lim.key}）`;
  if (build > lim.build || tidy > lim.tidy || key > lim.key) fail(`時間が上限を超えました：${line}`);
  else console.log(`  ${line}`);
}
// 台数が2倍になったとき、時間が2倍より大きく（3.2倍を超えて）増えていないか（台数の2乗で増える作りに戻っていないか）
const ratio = buildTimes[100]! / Math.max(1, buildTimes[50]!);
if (ratio > 3.2) fail(`台数が50→100（2倍）で、組み立ての時間が ${ratio.toFixed(1)} 倍（3.2倍を超えた）になっています（台数の2乗で増えている疑い）`);
else console.log(`  台数が2倍（50→100）のとき、組み立ての時間は ${ratio.toFixed(1)} 倍（2倍に近いほど、台数に比例している）`);

if (failed) {
  console.error(`\n速さの確認で ${failed} 件の問題があります。`);
  process.exit(1);
}
console.log('  OK');
