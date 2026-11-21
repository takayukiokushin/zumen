/**
 * 「手で直す → 入力を変える → 図面を作り直す」を、何周も繰り返しても、手で動かした記号の位置が、失われない（第18弾 C-3）。
 * 1周ごとに、いまの図面の、手で動かした位置の記録と、作り直したあとの記録を比べる。
 * （入力を変えて、いったん消えた機器が、また現れるときに、前に動かした位置が、二重に動いて、ずれていた）
 * 乱数は決まった種から作る。回数は、環境変数 FUZZ_COUNT で増やせる。
 *
 *   node --experimental-strip-types scripts/check-edit-cycles.ts
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
const MAX_RATE = Number(process.env.EDIT_REPLAY_MAX ?? 4.5);

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


const CYC=Number(process.env.CYCLES??5);
let runs=0,lostRuns=0,lostN=0,tot=0,crash=0;
const ex:string[]=[];
for (let id=0; id<N; id++) {
  const area=[1,2,3][id%3]!;
  const rnd=rng((id+1)*104729+area*17);
  let a:Answers; let cur:Doc;
  try { a=answersOf(rnd,area); cur={...gen(a),edited:true}; } catch { continue; }
  const log:string[]=[];
  let lostHere=false;
  for (let c=0;c<CYC;c++){
    const mn:string[]=[];
    for (let j=0,k=1+Math.floor(rnd()*2);j<k;j++){const op=pick(MANUAL,rnd);try{cur=op.run(cur,rnd);mn.push(op.name);}catch{}}
    const iop=pick(INPUT,rnd);
    try{
      const a1=iop.run(a,rnd);
      const opened=tidyDoc(dedupeIds(cur));
      const prev=opened.base?opened:{...opened,base:cur.base};
      const g2=gen(a1);
      const out=rebuildWithOverrides(g2,prev).doc;
      const pm=collectOverrides(prev).moved, om=collectOverrides(out).moved;
      const names=new Set(syms(g2).map(s=>sameName(s.id)));
      for(const n of Object.keys(pm)){
        if(!names.has(n)||(!pm[n]!.dx&&!pm[n]!.dy))continue;
        tot++;
        const o=om[n];
        // 線の上に乗せる記号（VCT・CT・ZCT）は、乗っている線が横に動いたとき、その線の真上へついていく（横の動きは、数えない）
        const gs=syms(g2).find(x=>sameName(x.id)===n);
        const onWire=!!gs&&!!getSymbol(gs.symbolId).onWire;
        if(!o||(!onWire&&Math.abs(o.dx-pm[n]!.dx)>2)||Math.abs(o.dy-pm[n]!.dy)>2){lostN++;lostHere=true;if(ex.length<12)ex.push(`種${id+1} エリア${area} ${c+1}周目 ${n}：${pm[n]!.dx},${pm[n]!.dy} → ${o?o.dx+','+o.dy:'なし'}（${mn.join('→')}／${iop.name}）前の周：${log.slice(-2).join(' | ')}`);}
      }
      log.push(`${mn.join('→')}／${iop.name}`);
      a=a1; cur=out;
    }catch(e){crash++;break;}
  }
  runs++; if(lostHere)lostRuns++;
}
console.log('■ 手で直して・入力を変えて・作り直す、を繰り返しても、位置が失われない（第18弾）');
console.log(`  ${runs}件×${CYC}周：位置が失われた ${lostN}／${tot}（${lostRuns}件の試行）／落ちた ${crash}`);
for(const e of ex)console.log('   ',e);
if(lostN>0||crash>0){console.error(`\n✗ 位置が失われた ${lostN}件／落ちた ${crash}件`);process.exit(1);}
console.log('\n✓ 何周繰り返しても、手で動かした位置は、保たれます');
