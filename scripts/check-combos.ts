/**
 * 図面の組み合わせ検査：複数エリア（1〜5か所）× 特殊設備（なし／太陽光／発電機／蓄電池／補助変圧器／電動機／全部）× 主遮断装置（PFS形／CB形）
 * の図面を、答えをでたらめに埋めて作り、問題が出ないかを調べる（全体デバッグ 直し9）。
 *
 *   ・落ちない
 *   ・線が記号（CH・変圧器など）を突き抜けない／文字が記号に重ならない／斜めの線・浮いた線・狭すぎるすきまが無い
 *   ・文字が、線・記号・枠の線・ほかの文字に近すぎない
 *   ・エリアをつなぐケーブルの線が、記号のない所で交わらない（エリア1〜3か所。4か所以上は、3本以上がからむ組み合わせで残ることがあるので、数だけ知らせる）
 *
 * 乱数は決まった種から作るので、毎回同じ試行になる。回数は、環境変数 FUZZ_COUNT で増やせる（`pnpm fuzz` は 10倍）。
 *
 *   node --experimental-strip-types scripts/check-combos.ts
 */
import { fromLayout } from '../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../apps/web/src/editor/inspect.ts';
import { buildComposition, dropHiddenChoices, evaluate, missingRequiredFields } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { findLabelCollisions, layout } from '../packages/layout/src/index.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
const SEEDS = Array.from({ length: SCALE }, (_, i) => i + 1);
const SPECIAL: string[][] = [[], ['hasPv'], ['hasGenerator'], ['hasBattery'], ['hasMotor'], ['hasAuxTr'], ['hasGenerator', 'hasPv', 'hasBattery', 'hasAuxTr', 'hasMotor']];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

console.log('■ 図面の組み合わせ（複数エリア × 特殊設備 × 主遮断装置）');
let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

let total = 0;
let id = 0;
const crossingsByArea = new Map<number, number>();
const t0 = Date.now();
for (const area of [1, 2, 3, 4, 5]) {
  for (const sp of SPECIAL) {
    for (const form of ['pfs', 'cb']) {
      for (const seed of SEEDS) {
        const rnd = rng(seed * 7919 + area * 31 + id++);
        let a: Answers = { startMode: 'blank-open', mainBreakerForm: form, areaCount: String(area) } as Answers;
        for (const k of sp) a = { ...a, [k]: 'yes' };
        // 必須の質問を、順に、でたらめに答えていく（エリア数・主遮断装置は決めた値）
        for (let step = 0; step < 800; step++) {
          const miss = missingRequiredFields(a);
          if (miss.length === 0) break;
          const f = miss[0]!;
          const q = f.question;
          let v: string | number;
          if (f.key === 'areaCount') v = String(area);
          else if (f.key === 'mainBreakerForm') v = form;
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
        const name = `エリア${area}か所・${sp.length ? sp.join('+') : '特殊設備なし'}・${form}・種${seed}`;
        try {
          const L = layout(buildComposition(a), a);
          total++;
          const bad = inspectDrawing(fromLayout(L), 'A4', 'portrait').filter((i) => i.kind !== 'paper');
          if (bad.length > 0) fail(`${name}：${bad[0]!.message}（ほか${bad.length - 1}件）`);
          const near = findLabelCollisions(L);
          if (near.length > 0) fail(`${name}：${near[0]}（ほか${near.length - 1}件）`);
          const cx = L.cableCrossings ?? 0;
          crossingsByArea.set(area, (crossingsByArea.get(area) ?? 0) + cx);
          if (area <= 3 && cx > 0) fail(`${name}：ケーブルの線が、記号のない所で ${cx}か所、交わっています`);
        } catch (e) {
          fail(`${name}：図面を作る途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 80)}）`);
        }
      }
    }
  }
}
console.log(`  ${total}通りを調べた（${Math.round((Date.now() - t0) / 100) / 10}秒）（突き抜け・重なり・近すぎ・斜め・浮き・狭いすきま。問題があれば、上に「NG」で出る）`);
console.log(`  ケーブルの線の交わり（エリア4・5か所は、3本以上がからむ組み合わせで残ることがある）：${[...crossingsByArea.entries()].map(([k, v]) => `${k}か所 ${v}`).join('／')}`);

console.log(failed === 0 ? '\n✓ 図面の組み合わせは、問題ありませんでした' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
