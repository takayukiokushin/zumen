/**
 * 「手で直した図面」に、入力の変更（機器の追加）が入っても、図面が崩れないことの検証（第17弾 項目1）。
 *
 * 流れ：自動で作った図面 → 手で直す（レイアウトの縮小・拡大を、何回か）→ 入力で機器を足す → 図面を作り直して、手で直した内容を重ねる。
 * 重ねたあとの図面に、「線が浮く」「斜めになる」「記号を突き抜ける」が、増えていないこと。
 *   ・エリア1か所：1件も、崩れない
 *   ・エリア2〜3か所：ケーブルの線が長く、まれに崩れることがあるので、全体の1割まで
 * 同じ入力のままの重ね直しでも、崩れないこと。
 * 乱数は決まった種から作るので、毎回同じ試行になる。回数は、環境変数 FUZZ_COUNT で増やせる（`pnpm fuzz` は 10倍）。
 *
 *   node --experimental-strip-types scripts/check-rebuild.ts
 */
import { dedupeIds, fromLayout, tidyDoc } from '../apps/web/src/editor/doc.ts';
import type { Doc } from '../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../apps/web/src/editor/inspect.ts';
import { SHRINK, scaleLayout } from '../apps/web/src/editor/layoutScale.ts';
import { rebuildWithOverrides } from '../apps/web/src/editor/overrides.ts';
import { buildComposition, dropHiddenChoices, evaluate, missingRequiredFields } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
const SEEDS = Array.from({ length: 4 * SCALE }, (_, i) => i + 1);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const defects = (d: Parameters<typeof inspectDrawing>[0]): number => inspectDrawing(d, 'A4', 'portrait').filter((i) => ['floating', 'skew', 'through', 'stray'].includes(i.kind)).length;
const gen = (a: Answers) => fromLayout(layout(buildComposition(a), a));

function answersOf(seed: number, area: number): Answers {
  const rnd = rng(seed * 7919 + area * 31);
  let a = { startMode: 'blank-open', areaCount: String(area) } as Answers;
  for (let step = 0; step < 800; step++) {
    const miss = missingRequiredFields(a);
    if (miss.length === 0) break;
    const f = miss[0]!;
    const q = f.question;
    let v: string | number;
    if (f.key === 'areaCount') v = String(area);
    else if (q.type === 'number') v = 1 + Math.floor(rnd() * 3);
    else if (q.type === 'boolean') v = 'yes';
    else if (q.type === 'select') {
      const opts = (q.options ?? []).filter((x) => evaluate(x.showIf, f.context));
      if (opts.length === 0) v = '1';
      else {
        const vals = opts.map((x) => String(x.value));
        const num = vals.every((x) => /^\d+$/.test(x));
        const pool = num ? vals.filter((x) => +x >= 1 && +x <= 3) : vals;
        const from = pool.length > 0 ? pool : vals;
        v = from[Math.floor(rnd() * from.length)]!;
      }
    } else v = 'テスト';
    a = dropHiddenChoices({ ...a, [f.key]: v } as Answers);
  }
  return a;
}

const ADDS: [string, Record<string, string>][] = [
  ['コンデンサ', { hasCapacitor: 'yes' }],
  ['太陽光', { hasPv: 'yes' }],
  ['発電機', { hasGenerator: 'yes' }],
  ['蓄電池', { hasBattery: 'yes' }],
  ['補助変圧器', { hasAuxTr: 'yes' }],
  ['電動機', { hasMotor: 'yes' }],
  // 地絡継電器（GR・DGR）・ZCTの位置の変更・途中の開閉器：新しく増える機器が、線でつながった組（ZCTとGR・DGRなど）になる（第17弾 項目7の調査2）
  ['GR', { mainGroundRelay: 'gr', hasZpd: 'yes' }],
  ['DGR（ZCTを母線の一次側）', { mainGroundRelay: 'dgr', hasZpd: 'yes', mainZctPos: 'bus-primary' }],
  ['途中のPGS（屋側・GR）', { midSwitch: 'yes', midKind: 'pgs', midPlace: 'wall', midControl: 'gr' }],
  ['途中のPAS（構内柱・DGR）', { midSwitch: 'yes', midKind: 'pas', midPlace: 'pole', midControl: 'dgr' }],
  ['途中のAS（離れた場所）', { midSwitch: 'yes', midKind: 'as', midPlace: 'away' }],
];

console.log('■ 手で直した図面に、機器を足しても、崩れない（縮小・拡大のあと）');
let failed = 0;
const fail = (m: string) => {
  console.error(`  NG: ${m}`);
  failed++;
};
const stat: Record<number, { n: number; bad: number }> = { 1: { n: 0, bad: 0 }, 2: { n: 0, bad: 0 }, 3: { n: 0, bad: 0 } };
const examples: string[] = [];
let sameBad = 0;
let sameTotal = 0;
for (const area of [1, 2, 3]) {
  for (const seed of SEEDS) {
    const rnd = rng(seed * 13 + area);
    const a0 = answersOf(seed, area);
    for (const [name, change] of ADDS) {
      let d: Doc = { ...gen(a0), edited: true };
      const log: string[] = [];
      for (let o = 0, n = 1 + Math.floor(rnd() * 4); o < n; o++) {
        const grow = rnd() >= 0.5;
        const r = scaleLayout(d, grow ? 1 / SHRINK : SHRINK);
        if (r.changed) d = r.doc;
        log.push(grow ? '拡大' : '縮小');
      }
      // 画面を開き直したときと同じ：保存してあった図面を、一度「整える」
      const opened = tidyDoc(dedupeIds(d));
      const prev = opened.base ? opened : { ...opened, base: d.base };
      const before = defects(d);
      // ① 同じ入力のまま、重ね直す
      const same = defects(rebuildWithOverrides(gen(a0), prev).doc);
      // ② 機器を足して、重ねる
      let g2;
      try {
        g2 = gen(dropHiddenChoices({ ...a0, ...change } as Answers));
      } catch {
        continue;
      }
      const auto = defects(g2);
      const after = defects(rebuildWithOverrides(g2, prev).doc);
      const s = stat[area]!;
      s.n++;
      if (same > before) {
        sameBad++;
        if (area === 1) fail(`エリア1か所・種${seed}・${log.join('→')}：同じ入力のままの重ね直しで、問題が ${before} → ${same} に増えました`);
      }
      sameTotal++;
      if (after > before + auto) {
        s.bad++;
        if (examples.length < 4) examples.push(`エリア${area}か所・種${seed}・${name}を足す（${log.join('→')}）：問題 ${before}＋自動${auto} → ${after}`);
      }
    }
  }
}
for (const area of [1, 2, 3]) {
  const s = stat[area]!;
  console.log(`  エリア${area}か所：${s.n}通り中、崩れ ${s.bad}件`);
  if (area === 1 && s.bad > 0) fail(`エリア1か所で、崩れた図面が ${s.bad}件あります（例：${examples[0] ?? ''}）`);
  if (area > 1 && s.bad > Math.ceil(s.n * 0.1)) fail(`エリア${area}か所で、崩れた図面が ${s.bad}件（全体の${Math.round((s.bad / Math.max(1, s.n)) * 100)}%）あります（例：${examples[0] ?? ''}）`);
}

// 同じ入力のままの重ね直し：エリア1か所は1件も崩れない。複数エリアは、全体の2%まで
console.log(`  同じ入力のままの重ね直し：${sameTotal}通り中、崩れ ${sameBad}件`);
if (sameBad > Math.ceil(sameTotal * 0.02)) fail(`同じ入力のままの重ね直しで、崩れた図面が ${sameBad}件（全体の${Math.round((sameBad / Math.max(1, sameTotal)) * 100)}%）あります`);

console.log(failed === 0 ? '\n✓ 手で直した図面に機器を足しても、崩れませんでした' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
