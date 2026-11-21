/**
 * 調べるだけの道具（検査ではない）：図面の部品を手で消したとき、入力に反映されるかを、大量の図面で数える（第18弾 追加）。
 *
 * 流れ：でたらめに入力した案件から図面を作る → 部品（記号）を1つずつ消す → 書き戻す → 数える。
 *   反映された：入力が変わり、作り直した図面に、その部品が出ない（ほかの部品は変わらない）
 *   対応する入力が無い：書き戻しの対象にならなかった（入力の項目と1対1にならない部品）
 *   断られた：入力の項目はあるが、ほかの部品も変わってしまうので、書き戻さなかった
 * 2つ以上（複数回）消した場合も、同じように数える。
 *
 *   SWEEP_N=60 node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/sweep-writeback.ts
 */
import { addSymbol, docBounds, fromLayout, removeItem, replaceSymbol, sameName, tidyDoc, dedupeIds } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../apps/web/src/editor/doc.ts';
import { buildGenerated, writeBack } from '../apps/web/src/editor/writeback.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers, evaluate, missingRequiredFields } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';

const N = Number(process.env.SWEEP_N ?? 40);
const MULTI = Number(process.env.SWEEP_MULTI ?? 2);

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
import { enrich } from './sweep-enrich.ts';

const baseOf = (id: string) => (/^a\d+:/.test(id) ? '【2か所目以降】' : '') + sameName(id).replace(/^a\d+:/, '').replace(/-\d+$/, '');
const topSyms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');

type Cat = '反映された' | '対応する入力が無い' | '断られた' | '反映されたが図面に残った' | '落ちた';
const byRole: Record<string, Record<Cat, number>> = {};
const tally = (role: string, c: Cat) => {
  byRole[role] ??= { 反映された: 0, 対応する入力が無い: 0, 断られた: 0, 反映されたが図面に残った: 0, 落ちた: 0 };
  byRole[role]![c]++;
};
const multi: Record<string, number> = {};
const examples: Record<string, string> = {};

for (let id = 0; id < N; id++) {
  const area = [1, 2, 3][id % 3]!;
  const rnd = rng((id + 1) * 104729 + area * 17);
  let raw: Answers;
  let doc0: Doc;
  try {
    raw = answersOf(rnd, area);
    if (process.env.SWEEP_RICH) raw = enrich(raw, rnd, area);
    doc0 = tidyDoc(dedupeIds({ ...gen(raw), edited: true }));
    if (!doc0.base) doc0 = { ...doc0, base: gen(raw).base };
  } catch {
    continue;
  }
  const toEff = (a: Answers) => effectiveAnswers(a);
  // 1つずつ消す
  for (const s of topSyms(doc0)) {
    const role = baseOf(s.id);
    try {
      const d = removeItem(doc0, s.id);
      const r = writeBack(raw, { ...d, edited: true }, toEff);
      if (!r) {
        tally(role, '対応する入力が無い');
      } else if (r.applied.length > 0) {
        const g = buildGenerated(toEff(r.answers));
        // 途中の台を消すと、後ろの台の名前がつまるので、名前ではなく、同じ種類の記号の数が、1つ減ったかで見る
        const count = (d: Doc) => d.items.filter((i) => i.kind === 'symbol' && baseOf(i.id) === role).length;
        const total = (d: Doc) => d.items.filter((i) => i.kind === 'symbol').length;
        const still = count(g) >= count(doc0) && total(g) >= total(doc0);
        tally(role, still ? '反映されたが図面に残った' : '反映された');
      } else if (r.rejected.length > 0) {
        tally(role, '断られた');
        examples[`断られた:${role}`] ??= `種${id + 1}`;
      } else {
        tally(role, '対応する入力が無い');
      }
    } catch (e) {
      tally(role, '落ちた');
      examples[`落ちた:${role}`] ??= `種${id + 1}：${String((e as Error).message).slice(0, 60)}`;
    }
  }
  // 足す・差し替える（SWEEP_MODE=add / replace）
  if (process.env.SWEEP_MODE === 'add') {
    const TYPES = process.env.SWEEP_TYPES ? process.env.SWEEP_TYPES.split(',') : ['ds', 'vcb', 'lbs-pf', 'la', 'vt', 'ct', 'sc', 'sr', 'zct', 'pc', 'as', 'pas', 'relay-ocr', 'zpd', 'tr-3p-yd', 'generator', 'motor', 'vcs', 'cable-head', 'tr-blank'];
    for (const t of TYPES) {
      const key = `足す:${t}`;
      try {
        const b = docBounds(doc0);
        const d = addSymbol(doc0, t, b.x0 + rnd() * (b.x1 - b.x0), b.y0 + rnd() * (b.y1 - b.y0)).doc;
        const r = writeBack(raw, { ...d, edited: true }, toEff);
        const g = r ? buildGenerated(toEff(r.answers)) : null;
        const cnt = (dd: Doc) => dd.items.filter((i) => i.kind === 'symbol' && (i as DocSymbol).symbolId === t).length;
        if (r && r.applied.length > 0 && g && cnt(g) > cnt(buildGenerated(toEff(raw)))) tally(key, '反映された');
        else if (r && r.rejected.length > 0) tally(key, '断られた');
        else tally(key, '対応する入力が無い');
      } catch (e) {
        tally(key, '落ちた');
        examples[`落ちた:${key}`] ??= String((e as Error).message).slice(0, 60);
      }
    }
  }
  if (process.env.SWEEP_MODE === 'replace') {
    const TO = ['tr-3p-yd', 'tr-3p-dd', 'ds', 'vcb', 'lbs-pf', 'la'];
    for (const s of topSyms(doc0)) {
      const role = baseOf(s.id);
      const to = TO[Math.floor(rnd() * TO.length)]!;
      if (to === s.symbolId) continue;
      const key = `差替:${role}`;
      try {
        const d = replaceSymbol(doc0, s.id, to);
        const r = writeBack(raw, { ...d, edited: true }, toEff);
        if (r && r.applied.length > 0) tally(key, '反映された');
        else if (r && r.rejected.length > 0) tally(key, '断られた');
        else tally(key, '対応する入力が無い');
      } catch {
        tally(key, '落ちた');
      }
    }
  }
  // 2つ以上、続けて消す
  for (let k = 0; k < MULTI; k++) {
    const pool = topSyms(doc0).filter((x) => true);
    if (pool.length < 4) break;
    const n = 2 + (k % 2);
    let d = doc0;
    const removedNames: string[] = [];
    for (let j = 0; j < n; j++) {
      const cur = topSyms(d);
      const t = cur[Math.floor(rnd() * cur.length)]!;
      removedNames.push(baseOf(t.id));
      d = removeItem(d, t.id);
    }
    try {
      const r = writeBack(raw, { ...d, edited: true }, toEff);
      const key = `${n}つ消す`;
      multi[`${key}：入力が変わった`] = (multi[`${key}：入力が変わった`] ?? 0) + (r && r.applied.length > 0 ? 1 : 0);
      multi[`${key}：全体`] = (multi[`${key}：全体`] ?? 0) + 1;
    } catch (e) {
      multi['落ちた'] = (multi['落ちた'] ?? 0) + 1;
      examples[`落ちた:複数`] ??= `種${id + 1}：${String((e as Error).message).slice(0, 60)}`;
    }
  }
}

console.log('■ 図面の部品を1つ消したとき、入力に反映されるか（部品の種類ごと）');
const rows = Object.entries(byRole).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0));
let tot: Record<Cat, number> = { 反映された: 0, 対応する入力が無い: 0, 断られた: 0, 反映されたが図面に残った: 0, 落ちた: 0 };
for (const [role, c] of rows) {
  for (const k of Object.keys(c) as Cat[]) tot[k] += c[k];
  console.log(`  ${role.padEnd(28)} 反映 ${String(c.反映された).padStart(3)} ／ 入力に無い ${String(c.対応する入力が無い).padStart(3)} ／ 断られた ${String(c.断られた).padStart(3)} ／ 図面に残った ${String(c.反映されたが図面に残った).padStart(3)} ／ 落ちた ${c.落ちた}`);
}
console.log(`\n  合計：${JSON.stringify(tot)}`);
console.log(`  複数回：${JSON.stringify(multi)}`);
console.log(`  例：${JSON.stringify(examples)}`);
