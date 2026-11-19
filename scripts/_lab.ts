/**
 * 「図面のタブで手で直したあと、入力画面で変えて、図面を作り直しても、崩れない」ことの、大量の検証（第18弾）。
 *
 * 流れ：入力を一通り答えた図面を作る → 図面のタブで、手で直す（1〜3回。縮小・拡大・記号を動かす・まとめて動かす・足す・消す・差し替える・
 * 線の端を動かす・線の種類を変える・線を足す・結線を整える）→ 入力画面で変える（選択・機器・台数・主遮断装置・区分開閉器・途中の開閉器、
 * または、何も変えない）→ 図面を作り直して、手で直した内容を重ねる。
 * 重ねたあとの図面に、「線が浮く」「斜めになる」「記号を突き抜ける」「つながない線が増える」「記号が重なる」が、増えていないこと。
 *   ・増えたかどうかは、「開き直したとき（画面は、図面を開くたびに、一度整える）の図面」と比べる
 *   ・手で動かした記号の位置が、そのまま保たれていること
 * 乱数は決まった種から作るので、毎回同じ試行になる。回数は、環境変数 FUZZ_COUNT で増やせる（`pnpm fuzz` は 10倍）。
 *
 *   node --experimental-strip-types scripts/check-edit-replay.ts
 */
import { addSymbol, addWire, dedupeIds, docBounds, fromLayout, moveItem, moveItems, moveWireEnd, removeItem, replaceSymbol, sameName, setWireKind, tidyDoc } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../apps/web/src/editor/doc.ts';
import { inspectDrawing, tidyDrawing } from '../apps/web/src/editor/inspect.ts';
import { SHRINK, scaleLayout } from '../apps/web/src/editor/layoutScale.ts';
import { collectOverrides, rebuildWithOverrides } from '../apps/web/src/editor/overrides.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers, evaluate, missingRequiredFields, visibleQuestions, withAutoValues } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { getSymbol } from '../packages/symbols/src/index.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
const N = 240 * SCALE;
/** 崩れた試行の割合の上限（％）。直すたびに、下げていく */
const MAX_RATE = Number(process.env.EDIT_REPLAY_MAX ?? 4);

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

const SYMS = ['ds', 'vcb', 'lbs-pf', 'la', 'vt', 'ct', 'sc', 'sr', 'zct', 'pc', 'as', 'pas', 'relay-ocr', 'zpd'].filter((x) => {
  try {
    return !!getSymbol(x);
  } catch {
    return false;
  }
});
const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol' && !i.parent);
const wiresOf = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
const step4 = (v: number) => Math.round(v / 4) * 4;
const pick = <T>(list: T[], rnd: Rnd): T => list[Math.floor(rnd() * list.length)]!;

const MANUAL: { name: string; run: (d: Doc, r: Rnd) => Doc }[] = [
  { name: '縮小', run: (d) => { const x = scaleLayout(d, SHRINK); return x.changed ? x.doc : d; } },
  { name: '拡大', run: (d) => { const x = scaleLayout(d, 1 / SHRINK); return x.changed ? x.doc : d; } },
  { name: '記号を動かす', run: (d, r) => { const s = syms(d); return s.length ? moveItem(d, pick(s, r).id, step4((r() - 0.5) * 80), step4((r() - 0.5) * 60)) : d; } },
  { name: 'まとめて動かす', run: (d, r) => { const s = syms(d); if (s.length < 2) return d; const i = Math.floor(r() * (s.length - 1)); return moveItems(d, s.slice(i, i + 2).map((x) => x.id), step4((r() - 0.5) * 40), step4((r() - 0.5) * 40)); } },
  { name: '記号を足す', run: (d, r) => { const b = docBounds(d); return addSymbol(d, pick(SYMS, r), b.x0 + r() * (b.x1 - b.x0), b.y0 + r() * (b.y1 - b.y0)).doc; } },
  { name: '記号を消す', run: (d, r) => { const s = syms(d); return s.length < 4 ? d : removeItem(d, pick(s, r).id); } },
  { name: '記号を差し替える', run: (d, r) => { const s = syms(d); if (!s.length) return d; try { return replaceSymbol(d, pick(s, r).id, pick(SYMS, r)); } catch { return d; } } },
  { name: '線の端を動かす', run: (d, r) => { const w = wiresOf(d); return w.length ? moveWireEnd(d, pick(w, r).id, r() < 0.5 ? 1 : 2, step4((r() - 0.5) * 40), step4((r() - 0.5) * 40)) : d; } },
  { name: '線の種類を変える', run: (d, r) => { const w = wiresOf(d); if (!w.length) return d; const t = pick(w, r); return setWireKind(d, [t.id], !t.dashed); } },
  { name: '線を足す', run: (d, r) => { const b = docBounds(d); const x = b.x0 + r() * (b.x1 - b.x0); const y = b.y0 + r() * (b.y1 - b.y0); return addWire(d, x, y, x + Math.round((r() - 0.5) * 100), y).doc; } },
  { name: '結線を整える', run: (d) => { try { return tidyDrawing(d, 'A3', 'portrait').doc; } catch { return d; } } },
];

const EQUIP = ['hasCapacitor', 'hasPv', 'hasGenerator', 'hasBattery', 'hasAuxTr', 'hasMotor', 'hasLa', 'hasZpd', 'hasGc'];
const INPUT: { name: string; run: (a: Answers, r: Rnd) => Answers }[] = [
  { name: '同じ入力', run: (a) => a },
  {
    name: '選択を変える',
    run: (a, r) => {
      const ctx = withAutoValues(a);
      const qs = visibleQuestions(ctx, {}).filter((q) => q.type === 'select' && (q.options?.length ?? 0) > 1 && !['areaCount', 'mainBreakerForm'].includes(q.id));
      if (!qs.length) return a;
      const q = pick(qs, r);
      const o = (q.options ?? []).filter((x) => evaluate(x.showIf, ctx));
      return o.length ? dropHiddenChoices({ ...a, [q.id]: pick(o, r).value } as Answers) : a;
    },
  },
  { name: '機器を足す', run: (a, r) => dropHiddenChoices({ ...a, [pick(EQUIP, r)]: 'yes' } as Answers) },
  { name: '機器を消す', run: (a, r) => dropHiddenChoices({ ...a, [pick(EQUIP, r)]: 'no' } as Answers) },
  { name: '台数を変える', run: (a, r) => dropHiddenChoices({ ...a, [pick(['transformerCount', 'capacitorCount', 'relayCount', 'vtSetCount', 'ctSetCount', 'feederCount'], r)]: String(Math.floor(r() * 4)) } as Answers) },
  { name: '主遮断装置を替える', run: (a) => dropHiddenChoices({ ...a, mainBreakerForm: a.mainBreakerForm === 'cb' ? 'pfs' : 'cb' } as Answers) },
  { name: '区分開閉器を替える', run: (a, r) => dropHiddenChoices({ ...a, sectionalizer: pick(['pas', 'pgs', 'ugs', 'none'], r) } as Answers) },
  { name: '途中の開閉器', run: (a, r) => dropHiddenChoices({ ...a, midSwitch: 'yes', midKind: pick(['pas', 'pgs', 'as'], r), midPlace: 'pole' } as Answers) },
];


const seen=new Map<string,Set<string>>();
for (let id=0; id<400; id++){
  const area=[1,2,3][id%3]!; const rnd=rng((id+1)*911+area);
  let a:Answers; try{a=answersOf(rnd,area);}catch{continue;}
  for(const extra of [{cableInstallation:'buried'},{cableInstallation:'overhead',midSwitch:'yes',midKind:'pas',midPlace:'pole',midCableInstallation:'buried'},{hasMotor:'yes'}]){
    let d:Doc; try{d=gen(dropHiddenChoices({...a,...extra} as Answers));}catch{continue;}
    for(const x of syms(d)) if(x.symbolId==='cable-head'){const k=x.id.replace(/^a\d+:/,'').replace(/-\d+$/,'');const set=seen.get(k)??new Set();set.add(JSON.stringify(x.label));seen.set(k,set);}
  }
}
for(const [k,v] of seen) console.log(k, [...v].slice(0,4).join(' | '));
