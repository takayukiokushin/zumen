/**
 * 調べるだけの道具（検査ではない）：図面で部品を消す（1〜3個）→ 入力に反映 → 入力画面から、さらに直す → 作り直す、の一連の流れで、矛盾が出ないかを数える。
 *   ・もう一度反映しようとしても、何も起きない（二重に反映しない）
 *   ・入力を直して作り直したあとも、反映した内容が、元に戻らない（消した部品が、復活しない）
 *   ・作り直したあとの図面に、「線が浮く・斜め・突き抜け・重なり」が、増えない
 *   SWEEP_N=60 node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/sweep-roundtrip.ts
 */
import { addSymbol, dedupeIds, docBounds, fromLayout, removeItem, replaceSymbol, sameName, setLabel, tidyDoc } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../apps/web/src/editor/inspect.ts';
import { rebuildWithOverrides } from '../apps/web/src/editor/overrides.ts';
import { buildGenerated, writeBack } from '../apps/web/src/editor/writeback.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers, evaluate, missingRequiredFields, QUESTIONS } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { enrich } from './sweep-enrich.ts';

const N = Number(process.env.SWEEP_N ?? 40);
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
type Rnd = () => number;
const gen = (a: Answers): Doc => {
  const e = effectiveAnswers(a);
  return fromLayout(layout(buildComposition(e), e));
};
const KINDS = ['floating', 'skew', 'through', 'stray', 'overlap'];
const defects = (d: Doc): number => inspectDrawing(d, 'A3', 'portrait').filter((i) => KINDS.includes(i.kind)).length;
function answersOf(rnd: Rnd, area: number): Answers {
  let a = { startMode: 'blank-open', areaCount: String(area) } as Answers;
  for (let step = 0; step < 900; step++) {
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
const ADD_TYPES = ['ds', 'vcb', 'lbs-pf', 'la', 'vt', 'ct', 'sc', 'sr', 'zpd', 'pc', 'as', 'vcs', 'tr-3p-yd', 'motor'];
const SW_TYPES = ['ds', 'vcb', 'lbs-pf', 'lbs', 'vcs', 'as'];
const TR_TYPES = ['tr-3p-yd', 'tr-3p-dd', 'tr-3p-dy', 'tr-3p-yy'];
const SELECTS = QUESTIONS.filter((q) => q.type === 'select' && (q.options?.length ?? 0) >= 2 && !q.noAi);

export interface RoundtripStats { runs: number; reflected: number; notIdempotent: number; resurrected: number; worse: number; crash: number }

/** n 案件で、一連の流れを試す。rich：ケーブル・開閉器・電動機・エリア間の接続を多く付けた案件にする */
export function run(n: number, rich: boolean, mixed = false): { stats: RoundtripStats; examples: string[] } {
  const stats: RoundtripStats = { runs: 0, reflected: 0, notIdempotent: 0, resurrected: 0, worse: 0, crash: 0 };
  const examples: string[] = [];
  const note = (s: string) => {
    if (examples.length < 12) examples.push(s);
  };

  for (let id = 0; id < n; id++) {
    const area = [1, 2, 3][id % 3]!;
    const rnd = rng((id + 1) * 7919 + area * 131);
    try {
      let raw = answersOf(rnd, area);
      if (rich) raw = enrich(raw, rnd, area);
      const toEff = (a: Answers) => effectiveAnswers(a);
      let doc: Doc = tidyDoc(dedupeIds({ ...gen(raw), edited: true }));
      if (!doc.base) doc = { ...doc, base: gen(raw).base };
      // 1〜3個、続けて、消す・足す・差し替える
      const k = 1 + Math.floor(rnd() * 3);
      const removed: string[] = [];
      for (let j = 0; j < k; j++) {
        const syms = doc.items.filter((i): i is DocSymbol => i.kind === 'symbol' && !i.parent);
        if (syms.length < 6) break;
        const t = syms[Math.floor(rnd() * syms.length)]!;
        const roll = mixed ? rnd() : 0;
        if (roll < 0.5) {
          removed.push(`消:${sameName(t.id)}`);
          doc = removeItem(doc, t.id);
        } else if (roll < 0.62 && t.label.length > 0) {
          // 文字の1行を書き換える（変圧器の文字・答えそのままの行は入力に書き戻る。それ以外は、図面にだけ残る）
          const at = Math.floor(rnd() * t.label.length);
          const lines = t.label.map((l, i) => (i === at ? `${l}改${Math.floor(rnd() * 90) + 10}` : l));
          doc = setLabel(doc, t.id, lines);
          removed.push(`文字:${sameName(t.id)}`);
        } else if (roll < 0.8) {
          const type = ADD_TYPES[Math.floor(rnd() * ADD_TYPES.length)]!;
          const b = docBounds(doc);
          try {
            doc = addSymbol(doc, type, b.x0 + rnd() * (b.x1 - b.x0), b.y0 + rnd() * (b.y1 - b.y0)).doc;
            removed.push(`足:${type}`);
          } catch {
            /* この種類は足せない */
          }
        } else {
          const pool = SW_TYPES.includes(t.symbolId) ? SW_TYPES : TR_TYPES.includes(t.symbolId) ? TR_TYPES : null;
          if (!pool) continue;
          const to = pool[Math.floor(rnd() * pool.length)]!;
          if (to === t.symbolId) continue;
          try {
            doc = replaceSymbol(doc, t.id, to);
            removed.push(`替:${sameName(t.id)}→${to}`);
          } catch {
            /* 差し替えられない */
          }
        }
      }
      if (removed.length === 0) continue;
      stats.runs++;
      const r1 = writeBack(raw, { ...doc, edited: true }, toEff);
      if (!r1 || r1.applied.length === 0) continue;
      stats.reflected++;
      // 二重に反映しない
      const again = writeBack(r1.answers, r1.doc, toEff);
      if (again && again.applied.length > 0) {
        stats.notIdempotent++;
        note(`二重：種${id + 1}（消した：${removed.join('・')}）→ もう一度：${again.applied.map((a) => a.question).join('・')}`);
        if (process.env.SWEEP_DEBUG) console.log(JSON.stringify({ id: id + 1, raw: Object.fromEntries(Object.entries(raw).filter(([k]) => /vt|intake|mainBreakerForm|areaCount|sectionalizer/i.test(k))), first: r1.applied.map((a) => `${a.question}:${a.from}→${a.to}`) }));
      }
      // 入力を、さらに直す（選択式の質問を1つ、別の選択肢にする）
      const q = SELECTS[Math.floor(rnd() * SELECTS.length)]!;
      const cur = String(r1.answers[q.id] ?? '');
      const alt = (q.options ?? []).map((o) => String(o.value)).filter((v) => v !== cur);
      const a2 = dropHiddenChoices({ ...r1.answers, [q.id]: alt[Math.floor(rnd() * alt.length)] ?? cur } as Answers);
      const g2 = gen(a2);
      const rebuilt = rebuildWithOverrides(g2, r1.doc).doc;
      // 消した部品が、復活しない（反映した答えのまま）
      const back = writeBack(a2, { ...rebuilt, edited: true }, toEff);
      // すでに反映した内容（同じ質問・同じ台・同じエリア）が、もう一度反映されたら、不具合。
      // 先に書き戻せなかった別の変更が、入力を直したあとで、新しく通るのは、不具合ではない
      const done = new Set(r1.applied.map((a) => `${a.question}|${a.unit}|${a.area}`));
      const again2 = back ? back.applied.filter((a) => done.has(`${a.question}|${a.unit}|${a.area}`)) : [];
      if (back && again2.length > 0) {
        stats.resurrected++;
        note(`二重（入力変更後）：種${id + 1}（消した：${removed.join('・')}／変えた：${q.id}）→ ${back.applied.map((a) => a.question).join('・')}`);
        if (process.env.SWEEP_DEBUG) console.log(JSON.stringify({ id: id + 1, removed, first: r1.applied.map((a) => `${a.question}:${a.from}→${a.to}`), back: back.applied.map((a) => `${a.question}(${a.unit}/${a.area}):${a.from}→${a.to}`), q: q.id, from: cur, to: a2[q.id] }));
      }
      // 図面の欠陥が、増えない
      const worse = defects(rebuilt) > defects(r1.doc) + defects(g2);
      if (worse) {
        stats.worse++;
        note(`欠陥が増えた：種${id + 1}（消した：${removed.join('・')}／変えた：${q.id}）`);
      }
    } catch (e) {
      stats.crash++;
      note(`落ちた：種${id + 1}：${String((e as Error).message).slice(0, 80)}`);
    }
  }
  return { stats, examples };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const r = run(N, !!process.env.SWEEP_RICH, !!process.env.SWEEP_MIXED);
  console.log('■ 消す → 入力に反映 → 入力を直す → 作り直す（一連の流れ）');
  console.log(`  ${JSON.stringify(r.stats)}`);
  for (const e of r.examples) console.log(`  ${e}`);
}
