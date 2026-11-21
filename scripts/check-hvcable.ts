/**
 * 高圧ケーブルの途中には、ZCT 以外を接続しない（第18弾 D）。
 *   1. 自動で作る図面は、入力をどう組み合わせても、ケーブルの2つの端末のあいだに、ZCT 以外が入らない（多数の回答で作って確かめる）
 *   2. 手で直すとき：ZCT 以外の記号を、ケーブルの線の上へ動かして離しても、線を割って入らない（ZCT は入る）／
 *      ケーブルの途中へ線をつなごうとすると断る／ZCT を、ZCT 以外に差し替えると断る
 *   3. すでに途中に入っている図面は、点検（結線を整える）で、印と説明が出る（動かさない）
 *   4. 低圧の（遮蔽層の無い）線は、対象にしない
 *
 *   node --experimental-strip-types scripts/check-hvcable.ts
 */
import { addSymbol, addWire, docBounds, dropRedundantStub, fromLayout, moveItem, portsOf, replaceSymbol } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../apps/web/src/editor/doc.ts';
import { cableViolations, hvStretches, isZctSymbol, newCableViolation } from '../apps/web/src/editor/hvCable.ts';
import { inspectDrawing } from '../apps/web/src/editor/inspect.ts';
import { cableInsertRefused, insertTarget } from '../apps/web/src/editor/rewire.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers, evaluate, missingRequiredFields } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { getSymbol } from '../packages/symbols/src/index.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gen = (a: Answers): Doc => {
  const e = effectiveAnswers(a);
  return fromLayout(layout(buildComposition(e), e));
};
function answersOf(rnd: () => number, area: number): Answers {
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
      const vals = opts.length ? opts.map((x) => String(x.value)) : ['1'];
      const num = vals.every((x) => /^\d+$/.test(x));
      const pool = num ? vals.filter((x) => +x >= 1 && +x <= 3) : vals;
      const from = pool.length > 0 ? pool : vals;
      v = from[Math.floor(rnd() * from.length)]!;
    } else v = 'テスト';
    a = dropHiddenChoices({ ...a, [f.key]: v } as Answers);
  }
  return a;
}

console.log('■ 高圧ケーブルの途中に、ZCT 以外を接続しない（第18弾）');
let failed = 0;
const fail = (m: string) => {
  console.error(`  NG: ${m}`);
  failed++;
};

// 1. 自動で作る図面
let drawings = 0;
let cables = 0;
let zcts = 0;
const bad = new Map<string, number>();
for (let id = 0; id < 240 * SCALE; id++) {
  const rnd = rng((id + 1) * 2654435 + 11);
  const area = [1, 2, 3][id % 3]!;
  let a: Answers;
  try {
    a = answersOf(rnd, area);
  } catch {
    continue;
  }
  const variants: Record<string, string>[] = [
    {},
    { cableInstallation: 'buried', mainGroundRelay: 'dgr', hasZpd: 'yes', mainZctPos: 'cable' },
    { cableInstallation: 'overhead', mainGroundRelay: 'gr', mainZctPos: 'cable', midSwitch: 'yes', midKind: 'pas', midPlace: 'pole', midCableInstallation: 'buried' },
  ];
  for (const v of variants) {
    let d: Doc;
    try {
      d = gen(dropHiddenChoices({ ...a, ...v } as Answers));
    } catch {
      continue;
    }
    drawings++;
    const sts = hvStretches(d);
    cables += sts.length;
    const sym = new Map(d.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((s) => [s.id, s]));
    for (const st of sts) for (const m of st.mid) if (isZctSymbol(sym.get(m)!.symbolId)) zcts++;
    for (const x of cableViolations(d)) bad.set(x.symbolId ?? '線', (bad.get(x.symbolId ?? '線') ?? 0) + 1);
  }
}
console.log(`  自動で作った図面 ${drawings}枚：高圧ケーブル ${cables}本・うちZCT入り ${zcts}本`);
if (bad.size > 0) fail(`自動で作った図面の、ケーブルの途中に、ZCT 以外が入っています：${[...bad.entries()].map(([k, n]) => `${k}×${n}`).join('、')}`);
if (cables < 50) fail(`高圧ケーブルが、ほとんど見つかりません（${cables}本）。見つけ方が壊れていないか確かめてください`);
if (zcts < 10) fail(`ケーブルの途中の ZCT が、ほとんど見つかりません（${zcts}本）`);

// 2・3. 手で直すとき／すでに入っている図面
{
  const a0 = dropHiddenChoices({ ...answersOf(rng(5), 1), cableInstallation: 'overhead', mainGroundRelay: 'dgr', hasZpd: 'yes', mainZctPos: 'cable', midSwitch: 'no' } as Answers);
  const d = gen(a0);
  const st = hvStretches(d).find((s) => s.mid.length > 0 && s.wires.length > 0);
  if (!st) {
    fail('ZCT の入った高圧ケーブルが見つかりませんでした');
  } else {
    const wires = d.items.filter((i): i is DocWire => i.kind === 'wire');
    const long = st.wires.map((w) => wires.find((x) => x.id === w)!).sort((p, q) => Math.hypot(q.x2 - q.x1, q.y2 - q.y1) - Math.hypot(p.x2 - p.x1, p.y2 - p.y1))[0]!;
    const mx = (long.x1 + long.x2) / 2;
    const my = (long.y1 + long.y2) / 2;
    // VCB を、ケーブルの線の上へ
    const v = addSymbol(d, 'vcb', 400, 400);
    const mid = (doc: Doc, id: string) => {
      const ps = portsOf(doc.items.find((i) => i.id === id) as DocSymbol).slice(0, 2);
      return { x: (ps[0]!.x + ps[1]!.x) / 2, y: (ps[0]!.y + ps[1]!.y) / 2 };
    };
    const vm = mid(v.doc, v.id);
    const dx = mx - vm.x;
    const dy = my - vm.y;
    if (insertTarget(v.doc, v.id, dx, dy) !== null) fail('VCB が、高圧ケーブルの線を割って入れてしまいます');
    if (!cableInsertRefused(v.doc, v.id, dx, dy)) fail('VCB を高圧ケーブルの線の上へ動かしても、断る判断が出ません');
    // ZCT は、ケーブルの線の上に置ける（線の上に乗せる記号なので、線は割らない。第20弾 項目2）
    const z = addSymbol(d, 'zct', 400, 400);
    const zow = getSymbol('zct').onWire!;
    const zs = z.doc.items.find((i) => i.id === z.id) as DocSymbol;
    const zdx = mx - (zs.x + zow.x);
    const zdy = my - (zs.y + getSymbol('zct').box.h / 2);
    if (insertTarget(z.doc, z.id, zdx, zdy) !== null) fail('線の上に乗せる記号の ZCT が、高圧ケーブルの線を割って入っています');
    if (cableInsertRefused(z.doc, z.id, zdx, zdy)) fail('ZCT を高圧ケーブルの線の上へ動かしたとき、断られています');
    if (newCableViolation(d, dropRedundantStub(moveItem(z.doc, z.id, zdx, zdy), [z.id]))) fail('ZCT を高圧ケーブルの線の上に置いたのに、断る対象になっています');
    // 線を、ケーブルの途中へ
    const w1 = addWire(d, mx + 60, my, mx, my, { assist: false });
    if (!newCableViolation(d, w1.doc)) fail('高圧ケーブルの途中へつなぐ線を、断れません');
    const b = docBounds(d);
    const w2 = addWire(d, b.x1 + 80, b.y0, b.x1 + 80, b.y0 + 40, { assist: false });
    if (newCableViolation(d, w2.doc)) fail('ケーブルと関係ない線まで、断っています');
    // ZCT を ZCT 以外に差し替える
    const zid = st.mid.find((m) => isZctSymbol((d.items.find((i) => i.id === m) as DocSymbol).symbolId));
    if (zid) {
      if (!newCableViolation(d, replaceSymbol(d, zid, 'ct'))) fail('ケーブルの途中の ZCT を、CT に差し替えるのを、断れません');
    }
    // すでに入っている図面：点検で、印と説明が出る（動かさない）
    const stuck = replaceSymbol(d, zid ?? st.mid[0]!, 'ct');
    const found = cableViolations(stuck);
    if (found.length === 0) fail('ケーブルの途中に CT が入っている図面を、見つけられません');
    const issues = inspectDrawing(stuck, 'A3', 'portrait').filter((i) => i.kind === 'cableMid');
    if (found.length > 0 && issues.length === 0) fail('点検（結線を整える）に、ケーブルの途中の問題が出ません');
    const pos = (doc: Doc) => doc.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((s) => `${s.id}@${s.x},${s.y}`).join(' ');
    if (pos(stuck) !== pos(replaceSymbol(d, zid ?? st.mid[0]!, 'ct'))) fail('点検が、図面を動かしています');
    // 低圧（遮蔽層の無い線）は対象外：ケーブルヘッドの無い線の途中は、何も断らない
    const plain = d.items.filter((i): i is DocWire => i.kind === 'wire' && !st.wires.includes(i.id) && !i.dashed && !i.fan && Math.hypot(i.x2 - i.x1, i.y2 - i.y1) > 60)[0];
    if (plain) {
      const px = (plain.x1 + plain.x2) / 2;
      const py = (plain.y1 + plain.y2) / 2;
      const w3 = addWire(d, px + 60, py, px, py, { assist: false });
      if (newCableViolation(d, w3.doc)) fail('ケーブルでない線（低圧・通常の電線）の途中まで、断っています');
    }
  }
}

if (failed === 0) console.log(`\n✓ 高圧ケーブルの途中に、ZCT 以外は入りません（自動の図面・手で足すとき・差し替え・点検）`);
else console.error(`\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
