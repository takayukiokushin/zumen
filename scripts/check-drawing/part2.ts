/**
 * 図面の検証（check-drawing）の2つ目：SC/SR・変圧器の下の線・PCS・責任分界点・表題・文字の位置・区分開閉器・引込ケーブル・継電器・結線を整える。
 * 共有するものは common.ts。scripts/check-drawing.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { readFileSync } from 'node:fs';
import { removeItem, removeItems, portsOf, fromLayout, moveItem, docBounds } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { buildComposition, indexedKey, pcsInputMode, visibleQuestions, withAutoValues, QUESTION_DEFAULTS } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { rotatedBox, LABEL_FONT, SHEET_MARGIN, SHEET_PAD, findLabelCollisions, layout, layoutTitle, renderSvg, sheetSize, textWidth } from '../../packages/layout/src/index.ts';
import { getSymbol as getSymbolDef } from '../../packages/symbols/src/index.ts';
import { insertTarget, moveWithInsert } from '../../apps/web/src/editor/rewire.ts';
import { inspectDrawing, nudgeSymbolLabel, tidyDrawing } from '../../apps/web/src/editor/inspect.ts';
import { fail, answers, spreadUnits } from './common.ts';

/* ---------- 14. 高圧進相設備（SC・SR）の図記号 ---------- */
console.log('\n■ 高圧コンデンサ（SC）と直列リアクトル（SR）の図記号');
{
  const sc = getSymbolDef('sc').shapes;
  const sr = getSymbolDef('sr').shapes;
  const box = sc.find((sh) => sh.k === 'rect');
  // SRの円は左下の4分の1が欠けているので、円ではなく円弧（path）で描いてある
  const arc = sr.find((sh) => sh.k === 'path');
  const arcR = arc?.k === 'path' ? Number(/A\s+([\d.]+)/.exec(arc.d)?.[1] ?? NaN) : NaN;
  if (!box || box.k !== 'rect') fail('SCに外枠の四角がありません');
  else if (!Number.isFinite(arcR)) fail('SRに円弧がありません');
  else {
    if (box.w !== box.h) fail(`SCの外枠が正方形ではありません：${box.w}×${box.h}`);
    else console.log(`  SCの外枠は正方形（${box.w}×${box.h}）`);

    if (Math.abs(arcR * 2 - box.w) > 0.01) {
      fail(`SCの正方形（${box.w}）とSRの円（直径 ${arcR * 2}）の大きさが違います`);
    } else {
      console.log(`  SRの円の直径もSCの正方形と同じ ${arcR * 2}（左下の4分の1は欠け）`);
    }

    // 上の縦線は外枠を貫いていること／下の縦線は外枠に届かないこと
    const verticals = sc.filter((sh) => sh.k === 'line' && sh.x1 === sh.x2);
    const top = verticals.find((v) => v.k === 'line' && v.y1 < box.y);
    const bottom = verticals.find((v) => v.k === 'line' && v.y1 >= box.y);
    if (!top || top.k !== 'line' || top.y2 <= box.y) fail('SCの上の縦線が外枠につながっていません');
    else console.log('  SCの上の縦線は外枠を貫いて極板まで届いています');
    if (!bottom || bottom.k !== 'line') fail('SCの下の縦線が見つかりません');
    else if (bottom.y2 >= box.y + box.h - 0.01) fail('SCの下の縦線が外枠に接しています（接してはいけません）');
    else console.log(`  SCの下の縦線は外枠に届いていません（すき間 ${(box.y + box.h - bottom.y2).toFixed(1)}）`);
  }
}

/* ---------- 15. 変圧器の下側の縦線 ---------- */
console.log('\n■ 変圧器の下側の縦線（つなぐものがあるときだけ出す）');
{
  const kinds = ['tr-1p', 'tr-1p-2w', 'tr-3p-yy', 'tr-3p-dd', 'tr-3p-yd', 'tr-3p-dy', 'tr-vv', 'tr-1p-parallel', 'tr-scott'];
  const common: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', transformerCount: 1, trCapacity: 100,
  };
  /** 変圧器の出口から下へ伸びる線の本数と、出口からのすき間 */
  const below = (raw: Answers, kind: string) => {
    const a = spreadUnits(raw);
    const r = layout(buildComposition(a), a);
    const tr = r.symbols.find((s) => s.symbolId === kind);
    if (!tr) return null;
    const out = getSymbolDef(kind).ports.find((p) => p.id === 'out')!;
    const ox = tr.x + out.x;
    const oy = tr.y + out.y;
    const lines = r.wires.filter(
      (w) => w.x1 === w.x2 && Math.abs(w.x1 - ox) < 1 && Math.min(w.y1, w.y2) >= oy - 1 && Math.max(w.y1, w.y2) > oy + 1,
    );
    const gap = lines.length ? Math.min(...lines.map((w) => Math.min(w.y1, w.y2))) - oy : 0;
    return { count: lines.length, gap };
  };

  let bad = 0;
  for (const kind of kinds) {
    const alone = below({ ...common, trConnection: kind }, kind);
    const withFeeder = below(
      { ...common, trConnection: kind, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: '2' },
      kind,
    );
    if (!alone || !withFeeder) { fail(`${kind} が図面に置かれませんでした`); bad++; continue; }
    if (alone.count !== 0) { fail(`${kind}：下に何も無いのに縦線が ${alone.count}本 出ています`); bad++; }
    if (withFeeder.count === 0) { fail(`${kind}：下に回線があるのに縦線が出ていません`); bad++; }
    else if (Math.abs(withFeeder.gap) > 0.01) { fail(`${kind}：縦線が出口から ${withFeeder.gap} 離れています`); bad++; }
  }
  if (bad === 0) console.log(`  ${kinds.length}種類すべて：つなぐものが無ければ出さず、あれば出口から途切れずにつながる`);
}

/* ---------- 16. PCS・発電機を、選んだ変圧器につなぐ ---------- */
console.log('\n■ PCS・発電機を、選んだ変圧器につなぐ');
{
  const common: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', trConnection: 'tr-3p-dy', trCapacity: 100,
  };
  /** 変圧器ごとに、下へ線が出ているか */
  const leads = (raw: Answers): boolean[] => {
    const a = spreadUnits(raw);
    const r = layout(buildComposition(a), a);
    return r.symbols
      .filter((s) => s.id === 'transformer' || s.id.startsWith('transformer-'))
      .map((t) => {
        const out = getSymbolDef(t.symbolId).ports.find((p) => p.id === 'out')!;
        const ox = t.x + out.x;
        const oy = t.y + out.y;
        return r.wires.some(
          (w) => w.x1 === w.x2 && Math.abs(w.x1 - ox) < 1 && Math.abs(Math.min(w.y1, w.y2) - oy) < 1,
        );
      });
  };
  const same = (got: boolean[], want: boolean[]) => JSON.stringify(got) === JSON.stringify(want);
  const pv = (extra: Answers): Answers => ({ ...common, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: '5', ...extra });
  const cases: [string, Answers, boolean[]][] = [
    ['変圧器1台・PCSあり（自動で1台目）', pv({ transformerCount: 1 }), [true]],
    ['変圧器3台・PCSなし', { ...common, transformerCount: 3 }, [false, false, false]],
    ['変圧器3台・どこにも入れない（全部1台目へ）', pv({ transformerCount: 3 }), [true, false, false]],
    ['変圧器3台・3台目へ5台', pv({ transformerCount: 3, pcsToTr3: 5 }), [false, false, true]],
    ['変圧器3台・1台目に2台／3台目に3台', pv({ transformerCount: 3, pcsToTr1: 2, pcsToTr3: 3 }), [true, false, true]],
    ['発電機をつながない', { ...common, transformerCount: 2, hasGenerator: 'yes', generatorCount: 1, generatorTransformer: 'none' }, [false, false]],
    ['発電機を2台目の変圧器へ', { ...common, transformerCount: 2, hasGenerator: 'yes', generatorCount: 1, generatorTransformer: '2' }, [false, true]],
    [
      '発電機2台を別々の変圧器へ',
      { ...common, transformerCount: 3, hasGenerator: 'yes', generatorCount: 2, generatorTransformer: '1', [indexedKey('generatorTransformer', 1)]: '3' },
      [true, false, true],
    ],
  ];
  for (const [name, a, want] of cases) {
    const got = leads(a);
    if (!same(got, want)) {
      fail(`${name}：線の出る変圧器が違います（期待 ${want.join('・')} ／ 実際 ${got.join('・')}）`);
    } else {
      console.log(`  ${name}：${got.map((v, i) => `${i + 1}台目${v ? '○' : '−'}`).join(' ')}`);
    }
  }

  // 2種類のPCSを1台の変圧器にまとめると、1つの枠に2行で書かれること
  {
    const a: Answers = {
      ...common, transformerCount: 2, hasPv: 'yes', pvGroupCount: '2',
      pcsCapacity: 50, pcsCount: '5', pcsToTr1: 2, pcsToTr2: 3,
      [indexedKey('pcsCapacity', 1)]: 5, [indexedKey('pcsCount', 1)]: '1', [indexedKey('pcsToTr1', 1)]: 1,
    };
    const boxes = buildComposition(spreadUnits(a)).filter((i) => i.role.startsWith('pcs-tr'));
    const first = boxes.find((i) => i.role === 'pcs-tr1');
    if (boxes.length !== 2) fail(`PCSの枠が ${boxes.length}個 です（2個のはず）`);
    else if (first?.label.join(' / ') !== '50kW×2台 / 5kW×1台') {
      fail(`1台目のPCSの枠の文字が「${first?.label.join(' / ')}」になっています`);
    } else {
      console.log(`  2種類をまとめた枠：1台目「${first.label.join(' / ')}」／2台目「${boxes.find((i) => i.role === 'pcs-tr2')?.label.join(' / ')}」`);
    }
  }

  // PCSのつなぎ先の入れ方：入力欄の少ないほうを、自動で出す。どちらの入れ方でも、図面は同じになる
  {
    const pv = { ...common, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50 } as Answers;
    const mode = (a: Answers) => pcsInputMode(withAutoValues({ ...QUESTION_DEFAULTS, ...a }));
    const cases: [string, Answers, string][] = [
      ['太陽光なし', { ...common, hasPv: 'no', transformerCount: 20 }, 'none'],
      ['変圧器1台', { ...pv, transformerCount: 1, pcsCount: '3' }, 'none'],
      ['変圧器20台・PCS2台（需要設備）', { ...pv, transformerCount: 20, pcsCount: '2' }, 'perPcs'],
      ['変圧器4台・PCS20台（発電所）', { ...pv, transformerCount: 4, pcsCount: '20' }, 'perTr'],
      ['変圧器5台・PCS5台（同数）', { ...pv, transformerCount: 5, pcsCount: '5' }, 'perPcs'],
      ['変圧器5台・PCS6台（PCSが1台多い）', { ...pv, transformerCount: 5, pcsCount: '6' }, 'perTr'],
      ['変圧器40台・PCS25台（変圧器が30台超）', { ...pv, transformerCount: 40, pcsCount: '25' }, 'perPcs'],
      ['変圧器40台・PCS35台（PCSも30台超）', { ...pv, transformerCount: 40, pcsCount: '35' }, 'perTr'],
      ['入れ方が決まっている案件（変圧器ごとの台数が入っている）は、そのまま', { ...pv, transformerCount: 5, pcsCount: '2', pcsToTr3: 1 }, 'perTr'],
      ['PCSごとの選択が入っている案件は、そのまま', { ...pv, transformerCount: 4, pcsCount: '9', pcsDest1: '2' }, 'perPcs'],
    ];
    let bad = 0;
    for (const [name, a, want] of cases) {
      const got = mode(a);
      if (got !== want) {
        fail(`PCSの入れ方（${name}）：${got}（${want}のはず）`);
        bad++;
      }
    }
    if (bad === 0) console.log(`  PCSの入れ方：${cases.length}通りで、入力欄の少ないほうが選ばれる（入れた答えがあるときは、その入れ方を続ける）`);

    // 変圧器20台・PCS2台：選んだ変圧器（3台目・15台目）の下にだけ、PCS・PVが描かれる
    const a20: Answers = { ...pv, transformerCount: 20, pcsCount: '2', pcsDest1: '3', pcsDest2: '15', pvKwPcs1: 100, pvKwPcs2: 60 };
    const comp = buildComposition(spreadUnits(a20));
    const boxes = comp.filter((i) => i.role.startsWith('pcs-tr')).map((i) => `${i.role}:${i.label.join('/')}`);
    const pvs = comp.filter((i) => i.role.startsWith('pv-tr')).map((i) => `${i.role}:${i.label.join(' ')}`);
    if (boxes.join(',') !== 'pcs-tr3:50kW×1台,pcs-tr15:50kW×1台') fail(`変圧器20台・PCS2台：PCSの枠が「${boxes.join(',')}」です`);
    else if (pvs.join(',') !== 'pv-tr3:PV 100kW,pv-tr15:PV 60kW') fail(`変圧器20台・PCS2台：PVの枠が「${pvs.join(',')}」です`);
    else console.log('  変圧器20台・PCS2台：選んだ3台目・15台目の変圧器の下にだけ、PCSとPV（100kW・60kW）が描かれる');

    // 選んでいないPCSは、1台目の変圧器。同じ変圧器につなぐPCSのPVは、足す
    const aSame: Answers = { ...pv, transformerCount: 6, pcsCount: '3', pcsDest1: '2', pcsDest2: '2', pvKwPcs1: 10, pvKwPcs2: 20 };
    const same = buildComposition(spreadUnits(aSame));
    const tr1 = same.find((i) => i.role === 'pcs-tr1')?.label.join('/');
    const tr2 = same.find((i) => i.role === 'pcs-tr2')?.label.join('/');
    const pv2 = same.find((i) => i.role === 'pv-tr2')?.label.join(' ');
    if (tr1 !== '50kW×1台' || tr2 !== '50kW×2台' || pv2 !== 'PV 30kW') fail(`同じ変圧器に2台：1台目「${tr1}」・2台目「${tr2}」・PV「${pv2}」`);
    else console.log('  選んでいないPCSは1台目の変圧器につながる／同じ変圧器の2台のPVは足して「30kW」と書く');

    // 同じつなぎ方なら、PCSごとに選んでも、変圧器ごとの台数で入れても、同じ図面になる
    const byPcs: Answers = { ...pv, transformerCount: 4, pcsCount: '6', pcsDest1: '1', pcsDest2: '1', pcsDest3: '2', pcsDest4: '2', pcsDest5: '3', pcsDest6: '4' };
    const byTr: Answers = { ...pv, transformerCount: 4, pcsCount: '6', pcsToTr1: 2, pcsToTr2: 2, pcsToTr3: 1, pcsToTr4: 1 };
    const sig = (a: Answers) => JSON.stringify(buildComposition(spreadUnits(a)).map((i) => [i.role, i.symbolId, i.label, i.lane]));
    if (sig(byPcs) !== sig(byTr)) fail('同じつなぎ方なのに、PCSごとに選んだときと、変圧器ごとの台数で入れたときで、図面の組み立てが違います');
    else console.log('  PCSごとに選んでも、変圧器ごとの台数で入れても、同じつなぎ方なら、同じ図面になる');

    // 変圧器100台目にも、PCSを描ける。図面に重なり・突き抜けなどが出ない
    const a100: Answers = { ...pv, transformerCount: 100, pcsCount: '1', pcsDest1: '100' };
    const sp100 = spreadUnits(a100);
    const d100 = fromLayout(layout(buildComposition(sp100), sp100));
    const has100 = buildComposition(sp100).some((i) => i.role === 'pcs-tr100');
    const probs = inspectDrawing(d100, 'A3', 'landscape').filter((x) => x.kind !== 'paper');
    if (!has100) fail('変圧器100台目の下に、PCSが描かれていません');
    else if (probs.length > 0) fail(`変圧器100台・100台目にPCS：図面に問題が ${probs.length}件（${probs[0]?.message}）`);
    else console.log('  変圧器100台のとき、100台目の変圧器の下にも、PCSを描ける（図面に、重なり・突き抜けはない）');

    // 入力欄の出し分け：選ぶ入れ方のときは、PCSごとの欄だけ。台数の入れ方のときは、変圧器ごとの欄だけ
    const shown = (a: Answers) => visibleQuestions(withAutoValues({ ...QUESTION_DEFAULTS, ...a })).map((q) => q.id).filter((id) => /^(pcsDest|pvKwPcs|pcsToTr|pvKw)\d+$/.test(id));
    const sPcs = shown({ ...pv, transformerCount: 20, pcsCount: '2' });
    const sTr = shown({ ...pv, transformerCount: 4, pcsCount: '20' });
    const okPcs = sPcs.join() === 'pcsDest1,pcsDest2,pvKwPcs1,pvKwPcs2';
    const okTr = sTr.join() === 'pcsToTr1,pcsToTr2,pcsToTr3,pcsToTr4,pvKw1,pvKw2,pvKw3,pvKw4';
    if (!okPcs) fail(`PCS2台のときに出る欄が「${sPcs.join()}」です`);
    else if (!okTr) fail(`PCS20台・変圧器4台のときに出る欄が「${sTr.join()}」です`);
    else console.log('  入力欄の出し分け：PCS2台・変圧器20台は「PCSごとに選ぶ」2欄＋PV2欄、PCS20台・変圧器4台は「変圧器ごとの台数」4欄＋PV4欄');
  }

  // 低圧開閉器（MCCB）は描かないこと
  {
    const a: Answers = { ...common, transformerCount: 2, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: '2' };
    const spread = spreadUnits(a);
    const mccb = layout(buildComposition(spread), spread).symbols.filter((s) => s.symbolId === 'mccb').length;
    if (mccb > 0) fail(`低圧開閉器（MCCB）が ${mccb}個 描かれています`);
    else console.log('  低圧開閉器（MCCB）は描かれません');
  }
}

/* ---------- 17. 結線方式が未入力の変圧器 ---------- */
console.log('\n■ 結線方式が未入力の変圧器');
{
  const a: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', transformerCount: 3, trCapacity: 100,
    trConnection: 'tr-3p-dy', [indexedKey('trConnection', 1)]: 'tr-1p',
    // 3台目は結線方式を入れない
  };
  const got = layout(buildComposition(a), a)
    .symbols.filter((s) => s.id === 'transformer' || s.id.startsWith('transformer-'))
    .map((s) => s.symbolId);
  const want = ['tr-3p-dy', 'tr-1p', 'tr-blank'];
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`未入力の変圧器の記号が違います（期待 ${want.join('・')} ／ 実際 ${got.join('・')}）`);
  } else {
    console.log(`  3台とも図面に出る：${got.join(' / ')}`);
  }
  // 中身が空であること（円以外の絵が入っていないこと）
  const blank = getSymbolDef('tr-blank').shapes.filter((sh) => sh.k !== 'circle' && sh.k !== 'line').length;
  if (blank > 0) fail(`結線方式が未入力の変圧器に、余計な絵が ${blank}個 入っています`);
  else console.log('  未入力のものは、円の中が空のまま');
}

/* ---------- 18. 3点不一致のときの、責任分界点 ---------- */
console.log('\n■ 3点不一致：責任分界点（主遮断装置の中央に横線）');
{
  const base = (over: Answers): Answers => ({
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy',
    ...over,
  });
  const cases: { name: string; a: Answers; expect: 'vcb' | 'lbs-pf' | null }[] = [
    { name: 'CB形・VCB', a: base({ mainBreakerForm: 'cb', boundaryPattern: 'split', boundarySafetyDevice: 'vcb' }), expect: 'vcb' },
    { name: 'PFS形・LBS', a: base({ mainBreakerForm: 'pfs', boundaryPattern: 'split', boundarySafetyDevice: 'lbs' }), expect: 'lbs-pf' },
    { name: '3点一致（横線は主遮断装置に引かない）', a: base({ mainBreakerForm: 'cb', boundaryPattern: 'coincident' }), expect: null },
    // 主遮断装置の形式が決まっていれば、答えは見ずに、そこから決まる
    { name: 'CB形（質問に答えていない）→VCB', a: base({ mainBreakerForm: 'cb', boundaryPattern: 'split' }), expect: 'vcb' },
    { name: 'PFS形（質問に答えていない）→LBS', a: base({ mainBreakerForm: 'pfs', boundaryPattern: 'split' }), expect: 'lbs-pf' },
    { name: 'CB形なのに以前「LBS」と答えていた→VCB（答えより主遮断装置を優先）', a: base({ mainBreakerForm: 'cb', boundaryPattern: 'split', boundarySafetyDevice: 'lbs' }), expect: 'vcb' },
    { name: 'PFS形なのに以前「VCB」と答えていた→LBS', a: base({ mainBreakerForm: 'pfs', boundaryPattern: 'split', boundarySafetyDevice: 'vcb' }), expect: 'lbs-pf' },
    // 主遮断装置が未入力のときだけ、質問の答えを見る
    { name: '主遮断装置が未入力・LBSと答えた', a: base({ boundaryPattern: 'split', boundarySafetyDevice: 'lbs' }), expect: 'lbs-pf' },
    { name: '主遮断装置が未入力・何も答えていない', a: base({ boundaryPattern: 'split' }), expect: null },
    { name: '主遮断装置が無い構成（電柱上）', a: base({ mainBreakerForm: 'pole-top', boundaryPattern: 'split', boundarySafetyDevice: 'lbs' }), expect: null },
  ];
  for (const c of cases) {
    const d = layout(buildComposition(c.a), c.a);
    const marks = d.symbols.filter((s) => s.symbolId === 'boundary-safety');
    const main = d.symbols.find((s) => s.role === 'main-breaker');
    if (c.expect === null) {
      if (marks.length > 0) fail(`${c.name}：横線が引かれています`);
      else console.log(`  ${c.name}：横線なし`);
      continue;
    }
    const m = marks[0];
    if (marks.length !== 1 || !m || !main) {
      fail(`${c.name}：横線が ${marks.length}本です（1本のはず）`);
      continue;
    }
    if (main.symbolId !== c.expect) fail(`${c.name}：主遮断装置が ${main.symbolId} です（期待 ${c.expect}）`);
    const mainDef = getSymbolDef(main.symbolId);
    const markDef = getSymbolDef(m.symbolId);
    // 主遮断装置の図記号の中央の高さに、主回路の縦線をまたいで引かれていること
    const lineY = m.y + markDef.box.h / 2;
    const centerY = main.y + mainDef.box.h / 2;
    const axisX = main.x + (mainDef.ports.find((p) => p.id === 'in')?.x ?? mainDef.box.w / 2);
    const x0 = m.x;
    const x1 = m.x + markDef.box.w;
    if (Math.abs(lineY - centerY) > 1) fail(`${c.name}：横線の高さが図記号の中央から ${(lineY - centerY).toFixed(1)} ずれています`);
    // 横線は、主遮断装置の図記号（箱）に重ならず、左の端のすぐ手前（2〜12）で止まる。左へは、文言の幅ぶん伸びている
    else if (!(x0 < axisX - 100 && x1 <= main.x - 2 && x1 >= main.x - 12)) fail(`${c.name}：横線が、図記号に重なっているか、手前で止まっていません（${x0}〜${x1}、図記号の左端 ${main.x}）`);
    else if (m.label.join('') !== '責任分界点') fail(`${c.name}：文言が「${m.label.join('')}」です`);
    else console.log(`  ${c.name}：${main.symbolId} の中央の高さ（y=${centerY}）で、図記号の手前（左）で止まる横線、「${m.label.join('')}」`);
    // 文言が横線の上・左端にあること（主回路の縦線から離れていて、重ならない）
    if (!(m.labelAt.y < lineY && m.labelAt.x <= axisX - 100 && m.labelAt.anchor === 'start')) fail(`${c.name}：文言の位置が線の左上ではありません`);
  }
}

/* 励磁突入電流抑制開閉器が付くVCBの、3点不一致：横線では並列の開閉器にかかるので、斜めの矢印で指す */
console.log('\n■ 責任分界点（励磁突入電流抑制開閉器つきのVCB）：矢印で指す');
{
  const a: Answers = {
    siteName: 'x', receivingVoltage: 6600, sourceType: 'pole', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy',
    mainBreakerForm: 'cb', boundaryPattern: 'split', hasInrush: 'yes', inrushRatedVoltage: '7200', inrushFuseCount: 3,
  };
  const d = layout(buildComposition(a), a);
  const arrow = d.symbols.find((s) => s.symbolId === 'boundary-safety-arrow');
  const vcb = d.symbols.find((s) => s.role === 'main-breaker');
  if (!arrow || !vcb) fail('矢印または主遮断装置が描かれていません');
  else if (d.symbols.some((s) => s.symbolId === 'boundary-safety')) fail('横線と矢印の両方が描かれています');
  else {
    const def = getSymbolDef('boundary-safety-arrow');
    const tipX = arrow.x + def.box.w;
    const tipY = arrow.y + def.box.h;
    const vcbDef = getSymbolDef(vcb.symbolId);
    const centerY = vcb.y + vcbDef.box.h / 2;
    const others = d.symbols.filter((s) => s !== arrow && s !== vcb);
    const overlaps = others.filter((s) => {
      const b = getSymbolDef(s.symbolId).box;
      const rb = rotatedBox(b, s.rotate);
      const r = { x0: s.x + rb.dx, y0: s.y + rb.dy, x1: s.x + rb.dx + rb.w, y1: s.y + rb.dy + rb.h };
      return arrow.x < r.x1 && tipX > r.x0 && arrow.y < r.y1 && tipY > r.y0;
    });
    if (Math.abs(tipY - centerY) > 1 || !(tipX <= vcb.x && tipX >= vcb.x - 8)) fail(`矢印の先が、VCBの左の端（中央の高さ）を指していません（先 ${tipX},${tipY}／VCB ${vcb.x},${centerY}）`);
    else if (!(arrow.x < tipX && arrow.y < tipY)) fail('矢印が、左上から右下へ向かう斜めになっていません');
    else if (overlaps.length > 0) fail(`矢印が、ほかの記号にかかっています（${overlaps.map((s) => s.id).join(',')}）`);
    else if (arrow.label.join('') !== '責任分界点') fail('矢印に、「責任分界点」の文字がありません');
    else if (findLabelCollisions(d).length > 0) fail('矢印の文字が、ほかの文字と重なっています');
    else console.log('  VCBの左へ、左上から斜めの矢印で指し、「責任分界点」の文字は矢印の上。ほかの記号・文字にかからない');
  }
}

/* ---------- 19. 表題の枠：幅の自動調整と2行化 ---------- */
console.log('\n■ 表題の枠（文字量に合わせた幅・長いときだけ2行・はみ出さない）');
{
  const NAME = 'キュービクル式高圧受電設備単線結線図';
  const unit = '一二三四五六七八九十';
  const papers: ['A4' | 'A3', 'portrait' | 'landscape'][] = [['A4', 'portrait'], ['A4', 'landscape'], ['A3', 'portrait'], ['A3', 'landscape']];
  let checked = 0;
  for (const [paper, orient] of papers) {
    const W = sheetSize(paper, orient).w;
    const maxBoxW = W - 24 * 2 - 120;
    let prevW = 0;
    let prevTwo = false;
    for (const n of [1, 4, 8, 12, 16, 20, 24, 30, 40, 70, 150]) {
      const site = unit.repeat(Math.ceil(n / 10)).slice(0, n);
      const t = layoutTitle({ site, name: NAME }, W, 24);
      const room = maxBoxW - 40;
      // 1. どんな長さでも、文字が枠の中に収まる
      for (const l of t.lines) {
        if (textWidth(l.text, l.size) > room + 0.01) fail(`${paper}${orient}・事業場名称${n}字：「${l.text.slice(0, 6)}…」が枠からはみ出します`);
      }
      if (t.boxW > maxBoxW + 0.01) fail(`${paper}${orient}・${n}字：枠が図枠の幅を超えています（${t.boxW}）`);
      // 2. 枠の幅は、文字量に合わせて広がる（短ければ狭く、長ければ広く）。同じ行数のあいだは逆戻りしない
      //    （1行から2行に切り替わる所だけは、1行ぶんの長さでなく長いほうの行の長さになるので、狭くなってよい）
      if (t.twoLines === prevTwo && t.boxW + 0.01 < prevW) fail(`${paper}${orient}・${n}字：文字が増えたのに枠が狭くなりました`);
      prevW = t.boxW;
      prevTwo = t.twoLines;
      // 3. 1行にして収まるときは1行、収まらないときだけ2行（上が事業場名称・下が図面名称）
      const oneW = textWidth(`${site}　${NAME}`, 14);
      const wantTwo = oneW > room;
      if (t.twoLines !== wantTwo) fail(`${paper}${orient}・${n}字：${wantTwo ? '2行' : '1行'}になるはずが${t.twoLines ? '2行' : '1行'}です`);
      if (t.twoLines && (t.lines[0]?.text !== site || t.lines[1]?.text !== NAME)) fail(`${paper}${orient}・${n}字：2行の分け方が違います`);
      checked++;
    }
  }
  console.log(`  ${checked}通り（用紙4種 × 事業場名称の長さ11段階）で、はみ出し・幅・行数が正しい`);
  // 短い名前は、枠が小さくなりすぎず、基準より狭い
  const short = layoutTitle({ site: '山田工場', name: NAME }, sheetSize('A4', 'portrait').w, 24);
  const long = layoutTitle({ site: unit.repeat(2), name: NAME }, sheetSize('A4', 'portrait').w, 24);
  if (!(short.boxW < long.boxW)) fail('短い名前の枠が、長い名前の枠より狭くなっていません');
  else console.log(`  短い名前の枠 ${Math.round(short.boxW)} ＜ 長い名前の枠 ${Math.round(long.boxW)}（上限 ${sheetSize('A4', 'portrait').w - 168}）`);
  // 事業場名称が空でも崩れない
  const none = layoutTitle({ site: '', name: NAME }, sheetSize('A4', 'portrait').w, 24);
  if (none.lines.length !== 1 || none.lines[0]?.text !== NAME) fail('事業場名称が空のとき、図面名称だけの1行になっていません');
  else console.log('  事業場名称が空のときは、図面名称だけを1行で書く');
}

/* ---------- 20. タイトルが2行のとき、図面を少し縮めて用紙に収める ---------- */
console.log('\n■ タイトルが2行のときの縮小（印刷・書き出し）');
{
  const NAME = 'キュービクル式高圧受電設備単線結線図';
  // どの用紙でも2行になるよう、とても長い事業場名称を使う（用紙が広いと、ふつうの長さは1行に収まるため）
  const LONG = '一二三四五六七八九十'.repeat(12);
  const d = layout(buildComposition(answers), answers); // いちばん込み入った構成
  const parse = (svg: string) => {
    const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(svg);
    return { ty: Number(m?.[2]), scale: Number(m?.[3]) };
  };
  const b = d.bounds;
  for (const [paper, orient] of [['A4', 'portrait'], ['A4', 'landscape'], ['A3', 'portrait'], ['A3', 'landscape']] as const) {
    const one = renderSvg(d, { site: '山田工場', name: NAME }, { paper, orientation: orient });
    const two = renderSvg(d, { site: LONG, name: NAME }, { paper, orientation: orient });
    const o = parse(one);
    const t = parse(two);
    const sh = sheetSize(paper, orient);
    // 1行のときは従来どおり（表題まわりの高さ44で計算した倍率と同じ）
    const areaW = sh.w - SHEET_MARGIN * 2 - SHEET_PAD * 2;
    const areaH44 = sh.h - SHEET_MARGIN * 2 - 44 - SHEET_PAD * 2 - 18;
    const old = Math.min(areaW / Math.max(b.x1 - b.x0, 1), areaH44 / Math.max(b.y1 - b.y0, 1), 1);
    if (Math.abs(o.scale - old) > 0.0006) fail(`${paper}${orient}：1行のときの倍率が従来と違います（${o.scale} ／ 従来 ${old.toFixed(4)}）`);
    // 2行のときは、同じか少しだけ小さい（大きくはならない）
    if (t.scale > o.scale + 0.0006) fail(`${paper}${orient}：2行のほうが図面が大きくなっています`);
    if (o.scale - t.scale > 0.05) fail(`${paper}${orient}：2行のとき縮みすぎです（${o.scale} → ${t.scale}）`);
    // 図面が表題の枠の下・図枠の内側に収まっている
    const top = t.ty + b.y0 * t.scale;
    const bottom = t.ty + b.y1 * t.scale;
    const tl2 = layoutTitle({ site: LONG, name: NAME }, sh.w, 24);
    if (!tl2.twoLines) fail(`${paper}${orient}：長い名前なのに2行になっていません`);
    const titleBottom = SHEET_MARGIN + 6 + tl2.boxH;
    const titleBottomAbs = SHEET_MARGIN + 6 + tl2.boxH;
    if (top < titleBottomAbs + 8) fail(`${paper}${orient}：2行のとき、図面が表題の枠に近すぎます（上端 ${top.toFixed(0)}、表題の下端 ${titleBottom}）`);
    if (bottom > sh.h - SHEET_MARGIN - SHEET_PAD) fail(`${paper}${orient}：2行のとき、図面が図枠の下にはみ出しています（${bottom.toFixed(0)}）`);
    console.log(`  ${paper}${orient === 'portrait' ? '縦' : '横'}：1行 ${o.scale.toFixed(3)} → 2行 ${t.scale.toFixed(3)}${o.scale - t.scale < 0.0006 ? '（余裕があるので縮まない）' : `（${((1 - t.scale / o.scale) * 100).toFixed(1)}%縮む）`}`);
  }
}

/* ---------- 21. 文字が、線・記号・ほかの文字に重ならない・近づかない ---------- */
console.log('\n■ 図面の文字（記号の横の文字）が、線・記号・ほかの文字から離れている');
{
  const configs: [string, Answers][] = [];
  for (const mainBreakerForm of ['cb', 'pfs', 'pole-top']) {
    for (const boundaryPattern of ['coincident', 'split']) {
      for (const hasPas of ['yes', 'no']) {
        for (const transformerCount of [1, 2, 3]) {
          configs.push([
            `${mainBreakerForm}・${boundaryPattern}・PAS${hasPas}・変圧器${transformerCount}台`,
            { ...answers, mainBreakerForm, boundaryPattern, boundarySafetyDevice: 'vcb', hasPas, transformerCount },
          ]);
        }
      }
    }
  }
  configs.push(['いちばん込み入った構成', answers]);
  configs.push(['オープンフレーム式', { ...answers, areaForm: 'room-open' }]);
  let bad = 0;
  for (const [name, a] of configs) {
    const found = findLabelCollisions(layout(buildComposition(a), a));
    if (found.length > 0) {
      bad++;
      fail(`${name}：${[...new Set(found)].slice(0, 3).join(' / ')}`);
    }
  }
  if (bad === 0) console.log(`  ${configs.length}通りの構成すべてで、文字が線・記号・ほかの文字に近づいていない（余白3以上）`);

  // 文字の大きさ：標準の大きさ（縮めない）で、紙の上で 2.5mm 以上であること
  const mm = LABEL_FONT * (210 / 760);
  if (mm < 2.5) fail(`文字が小さすぎます（縮めない場合で ${mm.toFixed(2)}mm）`);
  else console.log(`  文字の大きさ：縮めずに印刷して ${mm.toFixed(2)}mm（約${(mm / 0.3528).toFixed(1)}pt）`);
  // A4縦に実案件の構成を印刷したときも、2.3mm 以上であること
  const real = layout(buildComposition(answers), answers);
  const svg = renderSvg(real, { site: '山田工場', name: 'キュービクル式高圧受電設備単線結線図' }, { paper: 'A4', orientation: 'portrait' });
  const sc = Number(/scale\(([\d.]+)\)/.exec(svg)?.[1]);
  const eff = mm * sc;
  if (eff < 2.2) fail(`いちばん込み入った構成をA4縦に印刷すると、文字が ${eff.toFixed(2)}mm と小さすぎます`);
  else console.log(`  いちばん込み入った構成をA4縦に印刷：倍率 ${sc.toFixed(3)} → 文字 ${eff.toFixed(2)}mm`);
}

/* ---------- 22. PASの内部の縦線に、欠け（隙間）が無い ---------- */
console.log('\n■ PASの内部の縦線（枠の上端から開閉部まで・刃の下から出口まで）が途切れていない');
{
  let n = 0;
  for (const pasControl of ['none', 'gr', 'dgr']) {
    for (const pasBuiltinVt of ['yes', 'no']) {
      for (const pasBuiltinLa of ['yes', 'no']) {
        const a: Answers = { ...answers, hasPas: 'yes', pasControl, pasBuiltinVt, pasBuiltinLa };
        const d = layout(buildComposition(a), a);
        const pas = d.symbols.find((s) => s.symbolId.startsWith('pas'));
        if (!pas) { fail(`PASが図面に出ていません（制御${pasControl}・VT${pasBuiltinVt}・LA${pasBuiltinLa}）`); continue; }
        const pdef = getSymbolDef(pas.symbolId);
        const axis = pas.x + (pdef.ports[0]?.x ?? 0);
        // 主回路の位置にある縦線（記号の絵と、結線）を集める
        const segs: [number, number][] = [];
        for (const s of d.symbols) {
          for (const sh of getSymbolDef(s.symbolId).shapes) {
            if (sh.k === 'line' && Math.abs(sh.x1 - sh.x2) < 0.01 && Math.abs(s.x + sh.x1 - axis) < 0.6) {
              segs.push([s.y + Math.min(sh.y1, sh.y2), s.y + Math.max(sh.y1, sh.y2)]);
            }
          }
        }
        for (const w of d.wires) if (Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.x1 - axis) < 0.6) segs.push([Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)]);
        segs.sort((p, q) => p[0] - q[0]);
        const frame = pdef.shapes.find((sh) => sh.k === 'rect');
        if (!frame || frame.k !== 'rect') { fail('PASの枠が見つかりません'); continue; }
        const top = pas.y + frame.y;
        const bottom = pas.y + frame.y + frame.h;
        // 枠の上端から下端までの隙間を数える。刃が開いている所（横バーの下〜刃の支点）だけは本来の形
        const gaps: [number, number][] = [];
        let cur = -Infinity;
        for (const [a0, a1] of segs) {
          if (a0 > cur + 0.01 && cur >= top - 0.01 && a0 <= bottom + 0.01) gaps.push([cur - pas.y, a0 - pas.y]);
          cur = Math.max(cur, a1);
        }
        const bladeOpen = gaps.filter(([g0, g1]) => g0 >= 57.5 && g1 <= 84.5);
        const others = gaps.filter((g) => !bladeOpen.includes(g));
        const label = `制御${pasControl}・VT${pasBuiltinVt}・LA${pasBuiltinLa}`;
        if (others.length > 0) fail(`${label}：PASの縦線に欠けがあります（${others.map(([g0, g1]) => `y=${g0.toFixed(1)}〜${g1.toFixed(1)}`).join('、')}）`);
        if (bladeOpen.length !== 1) fail(`${label}：開閉部の隙間が ${bladeOpen.length}か所です（刃が開いている1か所のはず）`);
        n++;
      }
    }
  }
  console.log(`  ${n}通り（制御3種 × VT × LA）で、枠の上端から横バーまで・刃の下から出口まで、縦線がつながっている`);
}

/* ---------- 23. 区分開閉器（PAS／PGS／なし）と地上キャビネット ---------- */
console.log('\n■ 区分開閉器の場所に描くもの（PAS・PGS・地上キャビネットの断路器）');
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', boundaryPattern: 'coincident' };
  const at = (a: Answers) => {
    const d = layout(buildComposition(a), a);
    return {
      pas: d.symbols.find((s) => s.role === 'pas'),
      cab: d.symbols.find((s) => s.role === 'ground-cabinet'),
      incoming: d.symbols.find((s) => s.role === 'incoming-point'),
      cable: d.symbols.find((s) => s.role === 'cable-head' || s.role === 'cable-head-site'),
      d,
    };
  };
  const pas = at({ ...base, sectionalizer: 'pas' });
  if (!pas.pas || pas.pas.label[0] !== 'PAS' || pas.cab) fail('PASのとき、PASと書かれた区分開閉器が1つだけ描かれていません');
  else console.log(`  PAS：区分開閉器に「${pas.pas.label[0]}」と書く`);

  const pgs = at({ ...base, sectionalizer: 'pgs' });
  if (!pgs.pas || pgs.pas.label[0] !== 'PGS' || pgs.pas.symbolId !== pas.pas?.symbolId) fail('PGSのとき、PASと同じ図記号で「PGS」と書かれていません');
  else console.log(`  PGS：PASと同じ図記号（${pgs.pas.symbolId}）で、「${pgs.pas.label[0]}」と書く`);

  const cases: [string, Answers, string][] = [
    ['モールドディスコン', { ...base, sectionalizer: 'none', groundCabinet: 'yes', groundCabinetType: 'mold-discon' }, 'モールドディスコン'],
    ['T型シェルター', { ...base, sectionalizer: 'none', groundCabinet: 'yes', groundCabinetType: 't-shelter' }, 'T型シェルター'],
    ['三極連動', { ...base, sectionalizer: 'none', groundCabinet: 'yes', groundCabinetType: 'three-pole' }, '三極連動'],
  ];
  for (const [name, a, typeName] of cases) {
    const r = at(a);
    if (r.pas) fail(`${name}：区分開閉器なしなのに、PAS・PGSが描かれています`);
    else if (!r.cab) fail(`${name}：区分開閉器の場所に、断路器が描かれていません`);
    else if (r.cab.symbolId !== 'ds') fail(`${name}：描かれたのが断路器（ds）ではありません（${r.cab.symbolId}）`);
    else if (r.cab.label[0] !== '地上キャビネット' || r.cab.label[1] !== typeName) fail(`${name}：文字が「${r.cab.label.join(' / ')}」です`);
    else console.log(`  なし・${name}：断路器（DS）に「${r.cab.label.join('」「')}」と書く`);
    // PASが描かれる場所（引込点の下、ケーブル端末の上）に来ていること
    if (r.cab && r.incoming && !(r.cab.y > r.incoming.y)) fail(`${name}：断路器が引込点より下に描かれていません`);
    if (r.cab && r.cable && !(r.cab.y < r.cable.y)) fail(`${name}：断路器が、ケーブル端末より上に描かれていません`);
  }
  const none = at({ ...base, sectionalizer: 'none', groundCabinet: 'no' });
  if (none.pas || none.cab) fail('区分開閉器なし・キャビネットなしなのに、何かが描かれています');
  else console.log('  なし・地上キャビネットなし：何も描かない（縦線のまま）');

  const noType = at({ ...base, sectionalizer: 'none', groundCabinet: 'yes' });
  if (!noType.cab || noType.cab.label.join('') !== '地上キャビネット') fail('種類が未入力のとき、「地上キャビネット」だけを書く形になっていません');
  else console.log('  なし・種類が未入力：「地上キャビネット」とだけ書く');

  // 古い案件（hasPas だけ）も、同じように描かれる
  const legacyNo = at({ ...base, hasPas: 'no' });
  if (legacyNo.pas) fail('古い回答（PASなし）なのに、PASが描かれています');
  else console.log('  古い回答（PASの設置：なし）：PASは描かない');
  // 文字が線・記号にぶつからない
  for (const [name, r] of [['PGS', pgs], ['地上キャビネット', at(cases[0]![1])]] as const) {
    const found = findLabelCollisions(r.d);
    if (found.length) fail(`${name}：${[...new Set(found)].slice(0, 2).join(' / ')}`);
  }
}

/* ---------- 24. 引込ケーブルが「なし」のとき ---------- */
console.log('\n■ 引込ケーブル：埋設（点線）・架空（実線）・なし（ケーブル端末を描かない）');
{
  // 継電器（トリップコイルの点線）は、ケーブルの点線の数とは関係ないので、入れない
  const base: Answers = { ...answers, hasPas: 'yes', relayCount: '0' };
  const run = (cableInstallation: string) => {
    const a: Answers = { ...base, cableInstallation };
    const d = layout(buildComposition(a), a);
    const heads = d.symbols.filter((s) => s.symbolId === 'cable-head');
    const dashed = d.wires.filter((w) => w.dashed).length;
    const pas = d.symbols.find((s) => s.role === 'pas');
    const frame = d.frames[0];
    // 区分開閉器の出口（PASの下端）から受電設備の枠の上端まで、縦線が途切れずつながっているか
    const axis = 0;
    const segs = d.wires
      .filter((w) => Math.abs(w.x1 - axis) < 0.6 && Math.abs(w.x2 - axis) < 0.6)
      .map((w) => [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] as const)
      .sort((p, q) => p[0] - q[0]);
    return { d, heads, dashed, pas, frame, segs };
  };
  const buried = run('buried');
  const overhead = run('overhead');
  const none = run('none');
  if (buried.heads.length !== 2 || buried.dashed < 1) fail(`埋設：ケーブル端末が ${buried.heads.length}個、点線が ${buried.dashed}本です（端末2個・点線1本以上のはず）`);
  else console.log(`  埋設：ケーブル端末 2個、点線 ${buried.dashed}本`);
  if (overhead.heads.length !== 2 || overhead.dashed !== 0) fail(`架空：ケーブル端末が ${overhead.heads.length}個、点線が ${overhead.dashed}本です（端末2個・点線なしのはず）`);
  else console.log('  架空：ケーブル端末 2個、実線');
  if (none.heads.length !== 0) fail(`なし：ケーブル端末が ${none.heads.length}個 描かれています`);
  else if (none.dashed !== 0) fail(`なし：点線が ${none.dashed}本 描かれています`);
  else console.log('  なし：ケーブル端末も点線も描かない');
  // 「なし」のとき、区分開閉器の出口から次の機器まで、ふつうの線でつながっている
  const pas = none.pas;
  if (!pas) fail('なし：区分開閉器が描かれていません');
  else {
    const pdef = getSymbolDef(pas.symbolId);
    const exitY = pas.y + (pdef.ports.find((p) => p.id === 'out')?.y ?? pdef.box.h);
    const below = none.d.symbols.filter((s) => s.y > exitY - 1 && s.role !== 'pas' && s.parent === undefined).sort((p, q) => p.y - q.y)[0];
    if (!below) fail('なし：区分開閉器の下に、つながる機器がありません');
    else {
      const bdef = getSymbolDef(below.symbolId);
      const entryY = below.y + (bdef.ports.find((p) => p.id === 'in')?.y ?? 0);
      // 出口から入口までの区間を、縦線がすきまなくおおっているか
      let cur = exitY;
      for (const [a0, a1] of none.segs) {
        if (a1 < cur - 0.01) continue;
        if (a0 > cur + 0.01) break;
        cur = Math.max(cur, a1);
      }
      if (cur < entryY - 0.01) fail(`なし：区分開閉器（${pas.symbolId}）の出口と次の機器（${below.symbolId}）のあいだが、つながっていません（y=${cur.toFixed(1)}〜${entryY.toFixed(1)}）`);
      else console.log(`  なし：区分開閉器の下は、ふつうの線で ${below.symbolId} につながる（ケーブルを介さない）`);
    }
  }
  // 「なし」は、ケーブルの分だけ図面が短くなる
  const hOf = (r: { d: ReturnType<typeof layout> }) => r.d.bounds.y1 - r.d.bounds.y0;
  if (!(hOf(none) < hOf(buried))) fail(`なし：図面が短くなっていません（${hOf(none).toFixed(0)} ／ 埋設 ${hOf(buried).toFixed(0)}）`);
  else console.log(`  なし：図面の高さ ${hOf(none).toFixed(0)}（埋設 ${hOf(buried).toFixed(0)}）。ケーブルの間隔のぶん短い`);
  // 文字が線・記号に近づかない
  for (const [name, r] of [['埋設', buried], ['架空', overhead], ['なし', none]] as const) {
    const found = findLabelCollisions(r.d);
    if (found.length) fail(`${name}：${[...new Set(found)].slice(0, 2).join(' / ')}`);
  }
}

/* ---------- 25. 受電設備の枠（エリアの外枠）と、VCTの文字 ---------- */
console.log('\n■ 受電設備の枠は高圧マンション（電柱上構成）では描かない／VCTの図記号の右横に「VCT」と書く');
{
  const base: Answers = { ...answers, areaCount: 1 };
  const frames = (a: Answers) => layout(buildComposition(a), a).frames.length;
  const cases: [string, Answers, number][] = [
    ['キュービクル式', { ...base, areaForm: 'cubicle' }, 1],
    ['オープンフレーム式', { ...base, areaForm: 'room-open' }, 1],
    ['形態が未入力', { ...base, areaForm: undefined }, 1],
    ['高圧マンション（電柱上構成）', { ...base, areaForm: 'apartment-pole' }, 0],
    ['主遮断装置が「それ以外（電柱上構成）」', { ...base, areaForm: 'cubicle', mainBreakerForm: 'pole-top' }, 0],
  ];
  for (const [name, a, want] of cases) {
    const n = frames(a);
    if (n !== want) fail(`${name}：受電設備の枠が ${n}個です（${want}個のはず）`);
    else console.log(`  ${name}：受電設備の枠 ${want ? 'あり' : 'なし'}`);
  }
  // 枠が無いとき、図面の文字（エリアの名前）も出ない・ほかの記号はそのまま描かれる
  const apt = layout(buildComposition({ ...base, areaForm: 'apartment-pole' }), { ...base, areaForm: 'apartment-pole' });
  if (apt.symbols.length < 8) fail('高圧マンションのとき、ほかの記号まで消えています');
  const found = findLabelCollisions(apt);
  if (found.length) fail(`高圧マンション：${[...new Set(found)].slice(0, 2).join(' / ')}`);

  // VCT：すべてのVCTの右横に「VCT」と書く（電柱上・受電設備内の両方、2台でも）
  for (const [name, a] of [
    ['VCT 電柱上・1台', { ...base, vctLocation: 'pole', vctCount: 1 }],
    ['VCT 電柱上・2台', { ...base, vctLocation: 'pole', vctCount: 2 }],
    ['VCT 受電設備内・1台', { ...base, vctLocation: 'indoor', vctCount: 1 }],
    ['VCT 受電設備内・2台', { ...base, vctLocation: 'indoor', vctCount: 2 }],
  ] as [string, Answers][]) {
    const d = layout(buildComposition(a), a);
    const vcts = d.symbols.filter((s) => s.symbolId === 'vct');
    const want = Number(a.vctCount);
    const bad = vcts.filter((s) => s.label[0] !== 'VCT' || s.labelAt.anchor !== 'start' || s.labelAt.x < s.x + getSymbolDef('vct').box.w);
    if (vcts.length !== want) fail(`${name}：VCTの記号が ${vcts.length}個です（${want}個のはず）`);
    else if (bad.length) fail(`${name}：「VCT」の文字が、図記号の右横にありません`);
    else console.log(`  ${name}：図記号 ${want}個、すべての右横に「VCT」`);
    const cols = findLabelCollisions(d);
    if (cols.length) fail(`${name}：${[...new Set(cols)].slice(0, 2).join(' / ')}`);
  }
}

/* ---------- 26. 継電器・トリップコイル・補助変圧器 ---------- */
console.log('\n■ 継電器（OCR・UVR・OVR）・トリップコイル・補助変圧器');
{
  const base: Answers = {
    ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 400A', ctRatio: '300', transformerCount: 1,
    feederCount: 0, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no',
  };
  const multi: Answers = {
    ...base, vtSetCount: '2', vtPosition__2: 'secondary', vtCount__2: '2', vtConnection__2: 'v',
    relayCount: '4', relayType__2: 'UVR', relayAt__2: 'vt-2', relayType__3: 'OVR', relayAt__3: 'vt-2', relayTest__3: 'no', relayType__4: 'UFR', relayAt__4: 'none',
    hasInrush: 'yes', inrushRatedVoltage: '7200', inrushRatedCurrent: 200, inrushFuseCount: 3,
  };
  const battery: Answers = {
    ...base, hasBattery: 'yes', batteryCapacity: '2,000kW', batteryTransformer: '1', transformerCount: 2, trConnection__2: 'tr-3p-dy', trCapacity__2: 300,
    auxTrCount: '2', auxTrFrom: '1', auxTrCapacity: 150, auxTrVoltage: '550/220V', auxTrMccb: '400', auxTrFrom__2: '2', auxTrCapacity__2: 50, auxTrMccb__2: '100',
  };
  const twoAreas: Answers = {
    ...base, areaCount: 2, areaForm__2: 'room-open', areaPlacement__2: 'indoor',
    'a2:areaIntake': 'ds-vcb', 'a2:dsRating': '7200V 200A', 'a2:vcbRating': '7200V 200A', 'a2:ctRatio': '100', 'a2:linkTap': 'bus',
    'a2:linkCableInstallation': 'buried', 'a2:transformerCount': 1, 'a2:trConnection': 'tr-3p-dy', 'a2:trCapacity': 100, 'a2:trUsage': '動力', 'a2:relayTest': 'no',
  };
  const cases: [string, Answers][] = [
    ['標準のCB形（OCR＋試験端子＋トリップコイル）', base],
    ['試験端子なし', { ...base, relayTest: 'no' }],
    ['VT2組・UVR・OVR・名前だけの継電器・励突抑制開閉器', multi],
    ['蓄電所（補助変圧器2台）', battery],
    ['2か所（2か所目にもOCRとトリップコイル）', twoAreas],
    ['PFS形（継電器なし）', { ...answers, mainBreakerForm: 'pfs', hasSiteVt: 'no', hasSiteCt: 'no' }],
  ];
  for (const [name, a] of cases) {
    const d = layout(buildComposition(a), a);
    const issues = inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => i.kind === 'floating');
    const cols = findLabelCollisions(d);
    if (issues.length || cols.length) {
      fail(`${name}：${[issues.length ? `つながっていない線の端 ${issues.length}件` : '', cols.length ? `文字の重なり ${[...new Set(cols)].slice(0, 2).join(' / ')}` : ''].filter(Boolean).join('／')}`);
    } else console.log(`  ${name}：線の端・文字の重なりなし`);
  }

  // トリップコイル：VCBの横にあり、点線でVCBと連動し、OCRの上の端子へ線がつながる
  {
    const d = layout(buildComposition(base), base);
    const sym = (role: string) => d.symbols.find((s) => s.role === role);
    const coil = sym('trip-coil');
    const ocr = sym('relay');
    const vcb = sym('main-breaker');
    if (!coil || !ocr || !vcb) fail('トリップコイル・OCR・VCBが描かれていません');
    else {
      const top = getSymbolDef('relay-ocr').ports.find((p) => p.id === 'top')!;
      const reaches = d.wires.some((w) => Math.abs(w.x2 - (ocr.x + top.x)) < 0.6 && Math.abs(w.y2 - (ocr.y + top.y)) < 0.6 && w.x1 === w.x2);
      const dashed = d.wires.some((w) => w.dashed && Math.abs(w.y1 - w.y2) < 0.1 && w.x2 <= coil.x + 0.6 && w.x1 >= vcb.x - 1);
      if (!reaches) fail('トリップコイルから、OCRの上の端子への線がありません');
      else if (!dashed) fail('VCBとトリップコイルの連動の点線がありません');
      else if (coil.y > ocr.y) fail('トリップコイルが、OCRより下にあります');
      else console.log('  トリップコイル：VCBと点線で連動し、OCRの上の端子へ線がつながる');
    }
  }

  // トリップコイルからOCRへの線は、曲がらず、1本の縦の直線になる（すべての構成で）。
  // 音声入力の例（試験端子つき・CT2台）は、これまで、線が途中でカクッと折れていた構成なので、加える
  const voiceSample = (() => {
    const t = readFileSync(new URL('../../docs/voice-samples/sample-1-claude-output.txt', import.meta.url), 'utf8');
    return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).answers as Answers;
  })();
  const straightCases: [string, Answers][] = [...cases, ['音声入力の例1（試験端子つき・CT2台）', { receivingVoltage: 6600, ...voiceSample } as Answers]];
  for (const [name, a] of straightCases) {
    const d = layout(buildComposition(a), a);
    const coils = d.symbols.filter((s) => s.role.endsWith('trip-coil'));
    if (coils.length === 0) continue;
    const coilDef = getSymbolDef(coils[0]!.symbolId);
    const bPort = coilDef.ports.find((p) => p.id === 'b')!;
    for (const coil of coils) {
      const startX = coil.x + bPort.x;
      const startY = coil.y + bPort.y;
      // コイルの下端から出る線をたどる：横に曲がる線（途中で x が変わる線）があってはならない
      const out = d.wires.filter((w) => Math.abs(w.x1 - startX) < 0.6 && Math.abs(w.y1 - startY) < 0.6 && !w.dashed);
      // 1本の縦の線が、そのままOCRの上の端子まで届いている（途中で横に曲がって、別の線につながっていない）
      const ocrTop = getSymbolDef('relay-ocr').ports.find((p) => p.id === 'top')!;
      const straight =
        out.length === 1 &&
        Math.abs(out[0]!.x1 - out[0]!.x2) < 0.6 &&
        out[0]!.y2 > out[0]!.y1 &&
        d.symbols.some((o) => o.symbolId === 'relay-ocr' && Math.abs(o.x + ocrTop.x - out[0]!.x2) < 0.6 && Math.abs(o.y + ocrTop.y - out[0]!.y2) < 0.6);
      if (!straight) fail(`${name}：トリップコイルからOCRへの線が、まっすぐではありません（${out.length}本・${out.map((w) => `(${Math.round(w.x1)},${Math.round(w.y1)})→(${Math.round(w.x2)},${Math.round(w.y2)})`).join(' ')}）`);
    }
    console.log(`  ${name}：トリップコイル ${coils.length}個、OCRへの線はすべてまっすぐ`);
  }

  // 名前だけの継電器：OCRの真上に、隙間を空けて置く。線はつながない
  {
    const d = layout(buildComposition(multi), multi);
    const note = d.symbols.find((s) => s.role === 'relay-note');
    const ocr = d.symbols.find((s) => s.id === 'relay-1');
    if (!note || !ocr) fail('名前だけの継電器・OCRが描かれていません');
    else {
      const h = getSymbolDef(note.symbolId).box.h;
      const gap = ocr.y - (note.y + h);
      const touched = d.wires.filter((w) => [[w.x1, w.y1], [w.x2, w.y2]].some(([x, y]) => x! >= note.x - 1 && x! <= note.x + getSymbolDef(note.symbolId).box.w + 1 && y! >= note.y - 1 && y! <= note.y + h + 1));
      if (gap < 10) fail(`名前だけの継電器が、OCRに近すぎます（隙間 ${Math.round(gap)}）`);
      else if (touched.length) fail('名前だけの継電器に、線がつながっています');
      else console.log(`  名前だけの継電器：OCRの上、隙間 ${Math.round(gap)}、線はつながない`);
    }
  }

  // VTにつく継電器：VT → 試験端子（VTごとに1つ）→ UVR・OVR。UVRとOVRは試験端子の二次側から並列で、
  // OVRはUVRの下に上下に並ぶ。VTの文字は、線の下へ動く。どの継電器も、線でつながっている
  {
    const d = layout(buildComposition(multi), multi);
    const sym = (id: string) => d.symbols.find((s) => s.id === id);
    const vt = sym('site-vt-2');
    const tt = sym('relay-tt-2');
    const uvr = sym('relay-2');
    const ovr = sym('relay-3');
    if (!vt || !tt || !uvr || !ovr) fail('VTにつく継電器が描かれていません');
    else {
      const midY = (s: typeof vt) => s.y + getSymbolDef(s.symbolId).box.h / 2;
      const firstRow = [tt, uvr].every((s) => Math.abs(midY(s) - midY(vt)) < 1) && vt.x < tt.x && tt.x < uvr.x;
      const stacked = ovr.y > uvr.y + getSymbolDef(uvr.symbolId).box.h && Math.abs(ovr.x - uvr.x) < 1;
      const labelBelow = vt.labelAt.y > vt.y + getSymbolDef('vt').box.h;
      const entryOf = (s: typeof vt) => {
        const def = getSymbolDef(s.symbolId);
        const q = def.ports.find((p) => p.dir === 'left') ?? def.ports[0]!;
        return { x: s.x + q.x, y: s.y + q.y };
      };
      const e = entryOf(ovr);
      const reached = d.wires.some((w) => (Math.abs(w.x2 - e.x) < 0.5 && Math.abs(w.y2 - e.y) < 0.5) || (Math.abs(w.x1 - e.x) < 0.5 && Math.abs(w.y1 - e.y) < 0.5));
      if (!firstRow) fail('VT→試験端子→UVRが、右へ1列に並んでいません');
      else if (!stacked) fail('OVRが、UVRの下に（上下に並ぶように）置かれていません');
      else if (!reached) fail('OVRに、線がつながっていません（空中に浮いています）');
      else if (!labelBelow) fail('VTの文字が、継電器につなぐ線の下に動いていません');
      else console.log('  VTにつく継電器：VT→試験端子→UVR・OVR（並列）。UVRの下にOVRが上下に並び、線でつながる。VTの文字は線の下');
    }
  }

  // 補助変圧器：変圧器の低圧側から、MCCB → 補助変圧器。2本の列が、それぞれの変圧器の下にある
  {
    const d = layout(buildComposition(battery), battery);
    const mc = d.symbols.filter((s) => s.role === 'aux-mccb');
    const tr = d.symbols.filter((s) => s.role === 'aux-tr');
    const main = d.symbols.filter((s) => s.role === 'transformer');
    if (mc.length !== 2 || tr.length !== 2) fail(`補助変圧器盤のMCCB・補助変圧器が 2台ずつではありません（${mc.length}・${tr.length}）`);
    else if (!(mc.every((m, i) => tr[i] && m.y < tr[i]!.y) && mc.every((m) => main.every((t) => m.y > t.y)))) fail('補助変圧器が、MCCBの下、変圧器の下に並んでいません');
    else console.log('  補助変圧器：変圧器の低圧側から、MCCB → 補助変圧器の順に下へ');
  }
}

/* ---------- 26b. 変圧器の二次側から送り出す（第13弾 項目55 修正19・段階1） ---------- */
console.log('\n■ 変圧器の二次側から送り出す（何台目か＋開閉器1つ＋ケーブル1本）');
{
  const mk = (extra: Answers): Answers =>
    withAutoValues({
      ...answers, mainBreakerForm: 'cb', transformerCount: 2, hasPv: 'no', hasCapacitor: 'no', hasBattery: 'no', hasGenerator: 'no',
      areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:linkTap': 'tr-secondary', ...extra,
    } as Answers);
  const trOutOf = (d: ReturnType<typeof layout>, n: number) => {
    const tr = d.symbols.find((x) => x.role === `transformer`)!;
    void tr;
    const t = d.symbols.filter((x) => x.role === 'transformer' || /^transformer(-\d+)?$/.test(x.role))[n]!;
    const def = getSymbolDef(t.symbolId);
    const out = def.ports.find((q) => q.id === 'out')!;
    return { x: t.x + out.x, y: t.y + out.y };
  };
  const draw = (extra: Answers) => { const a = mk(extra); return layout(buildComposition(a), a); };
  // 1台目・2台目：線の出る位置（x）が、変圧器ごとに違う。出口から、まっすぐ下へ（低圧の回線が無いときは、線を足す）。開閉器・ケーブルの端末は、これまでの送り出しと同じ
  const d1 = draw({ 'a2:linkSourceTr': '1', 'a2:linkCable': 'yes' });
  const d2 = draw({ 'a2:linkSourceTr': '2', 'a2:linkCable': 'yes', 'a2:linkSwitch': 'vcb' });
  const o1 = trOutOf(d1, 0);
  const o2 = trOutOf(d2, 1);
  const hasFeed = (d: ReturnType<typeof layout>, o: { x: number; y: number }) => d.wires.some((w) => Math.abs(w.x1 - o.x) < 0.5 && Math.abs(w.x2 - o.x) < 0.5 && Math.min(w.y1, w.y2) <= o.y + 0.5 && Math.max(w.y1, w.y2) >= o.y + 7.5);
  if (!hasFeed(d1, o1)) fail('1台目の変圧器の出口から、送り出しの線が出ていません');
  else if (!hasFeed(d2, o2)) fail('2台目の変圧器の出口から、送り出しの線が出ていません');
  else if (Math.abs(o1.x - o2.x) < 20) fail('1台目と2台目の、出口の位置が、同じです（試験の前提が違います）');
  else if (!d2.symbols.some((x) => x.symbolId === 'vcb' && /sendout/.test(x.role))) fail('送り出しの開閉器（VCB）が描かれていません');
  else if (d2.symbols.filter((x) => x.symbolId === 'cable-head' && x.role.startsWith('cable-head-source')).length === 0 && !d2.symbols.some((x) => x.symbolId === 'cable-head')) fail('送り出しのケーブルの端末が描かれていません');
  else console.log('  変圧器の出口（1台目・2台目）から、送り出しの線が出る。開閉器・ケーブルの端末は、これまでの送り出しと同じ並び');
  // 台数より大きい番号は、最後の台に寄せる
  const d9 = draw({ 'a2:linkSourceTr': '8', 'a2:linkCable': 'yes' });
  if (!hasFeed(d9, trOutOf(d9, 1))) fail('台数より大きい番号を選んだとき、最後の台から出ていません');
  // 三巻線変圧器は、二次側の出口が決まっていないので、高圧母線から出す（出口からの線は無い）
  const d3 = draw({ 'a2:linkSourceTr': '1', trConnection: 'tr-3w-yyd', 'a2:linkCable': 'yes' });
  if (d3.symbols.length === 0) fail('三巻線変圧器のとき、図面が描けていません');
  else console.log('  台数より大きい番号は最後の台に寄せる。三巻線変圧器は、高圧母線から出す');
}

/* ---------- 27. 記号を消したあと、「結線を整える」で途切れた線をつなぎ直す ---------- */
console.log('\n■ 記号を消したあとの「結線を整える」（途切れた線のつなぎ直し）');
{
  const a: Answers = {
    ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 400A', ctRatio: '300', transformerCount: 1,
    feederCount: 0, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no', hasZpd: 'yes',
  };
  const base = fromLayout(layout(buildComposition(a), a));
  const floating = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => i.kind === 'floating').length;
  // 主回路の途中の機器（上と下に線がある）や、分岐の途中の機器を消しても、線が途切れたまま残らない
  // 行き止まりになる機器（枝の先・末端）を消したときは、その線も一緒に消える
  for (const id of ['vct-indoor-1', 'ds', 'ds-vt-pf', 'ds-vt', 'main-breaker', 'ct', 'relay-tt', 'relay', 'trip-coil', 'zpd', 'transformer', 'cable-head-site']) {
    const cut = removeItem(base, id);
    const broken = floating(cut);
    const r = tidyDrawing(cut, 'A3', 'landscape');
    const left = r.issues.filter((i) => i.kind === 'floating').length;
    // 消すと同時に、上下の線は自動で1本につなぐ（第13弾 項目55 修正18／B-10）ので、消した直後に、途切れた線は残らない。整えても、残らない
    if (broken > 0) fail(`${id}：消した直後に、途切れた線が ${broken}か所 残っています（自動でつなぐか、行き止まりの線は消えるはずです）`);
    else if (left > 0) fail(`${id}：消したあと、整えても、つながっていない線が ${left}件 残りました`);
    else console.log(`  ${id} を消す：途切れ ${broken}か所（自動でつなぐ／行き止まりの線は消える）→ 整えても 0か所`);
    // もとの図面は書き換えない（元に戻せるように、新しい図面を返す）
    if (JSON.stringify(base) === JSON.stringify(cut)) fail(`${id}：消しても図面が変わっていません`);
  }
  // あとから動かしやすく（第13弾 項目55 修正18／B-10）：消したら、上下の線を1本の直線につなぐ／線の上に離したら、線を割って入れる／余計な線を残さない
  {
    const wiresOnly = (d: Doc) => d.items.filter((it): it is DocWire => it.kind === 'wire');
    const straight = (w: DocWire) => Math.abs(w.x1 - w.x2) < 0.5 || Math.abs(w.y1 - w.y2) < 0.5;
    // 消しても、斜めの線はできない
    for (const id of ['vct-indoor-1', 'ds', 'main-breaker', 'ct', 'transformer']) {
      if (wiresOnly(removeItem(base, id)).some((w) => !straight(w))) fail(`${id}を消したら、斜めの線ができました`);
    }
    // VCB（main-breaker）を消すと、上（ds-vt の分岐の下）から、下（ct）まで、1本の直線につながる
    const cutV = removeItem(base, 'main-breaker');
    const toCt = wiresOnly(cutV).filter((w) => w.at2?.item === 'ct' || w.at1?.item === 'ct').filter((w) => w.at1?.port === 'in' || w.at2?.port === 'in');
    const above = wiresOnly(base).find((w) => w.at2?.item === 'main-breaker')!;
    const top = Math.min(above.y1, above.y2);
    const ctWire = toCt[0];
    if (toCt.length !== 1 || !ctWire || Math.min(ctWire.y1, ctWire.y2) !== top || wiresOnly(cutV).length !== wiresOnly(base).length - 1 - 0 && wiresOnly(cutV).filter((w) => w.orphan).length > 0) {
      fail('VCBを消したのに、上下の線が、1本の直線につながっていません');
    } else console.log('  VCBを消す：上下の線が、1本の直線につながる（線は1本減る。斜めの線はできない）');
    // 選んだ線も一緒に消すときは、つなぎ直さない（利用者が消すと決めた線）
    const picked = removeItems(base, ['main-breaker', above.id]);
    if (wiresOnly(picked).some((w) => w.id === above.id)) fail('選んだ線を、一緒に消したのに、残っています');
    // 線の上に離す：VCT（1台目）を、VCBの上の線の上へ動かす
    const v = base.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'vct-indoor-1')!;
    const vp = portsOf(v);
    const dx = above.x1 - (vp[0]!.x + vp[1]!.x) / 2 + 3;
    const dy = (above.y1 + above.y2) / 2 - (vp[0]!.y + vp[1]!.y) / 2;
    const plain = (d: Doc) => moveItem(d, 'vct-indoor-1', dx, dy);
    const tgt = insertTarget(base, 'vct-indoor-1', dx, dy);
    if (tgt?.wire !== above.id) fail(`線の上に離したのに、入る線が見つかりません（${tgt?.wire}）`);
    const ins = nudgeSymbolLabel(moveWithInsert(base, ['vct-indoor-1'], dx, dy, plain), 'vct-indoor-1');
    const vw = wiresOnly(ins).filter((w) => w.at1?.item === 'vct-indoor-1' || w.at2?.item === 'vct-indoor-1');
    const issues = inspectDrawing(ins, 'A3', 'landscape').filter((i) => ['floating', 'through', 'skew', 'overlap'].includes(i.kind));
    const vNow = ins.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'vct-indoor-1')!;
    const mbNow = ins.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'main-breaker')!;
    const mbOld = base.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'main-breaker')!;
    const bridged = wiresOnly(ins).some((w) => (w.at1?.item === 'cable-head-site' && w.at2?.item === 'vct-indoor-2') || (w.at2?.item === 'cable-head-site' && w.at1?.item === 'vct-indoor-2'));
    if (vw.length !== 2) fail(`線に入れたVCTに、線が ${vw.length}本つながっています（2本のはず）`);
    else if (!(vNow.y < mbNow.y && vNow.y > mbOld.y - 40) || mbNow.y < mbOld.y) fail('VCTが、VCBの上の線の間に入っていません');
    else if (!bridged) fail('動かす前の場所の、上下の線が、つながっていません');
    else if (issues.length > 0) fail(`線に入れたあと、図面の点検で問題が出ました（${issues.map((i) => i.message.slice(0, 16)).join(' / ')}）`);
    else console.log('  VCTを、別の線の上で離す：線が割れて入る（元の場所は、1本につながる。場所が足りなければ、下を動かして空ける）');
    // くっつけないとき：Alt を押しながら離したとき／線から離れた場所
    const same = (x: Doc, y: Doc) => JSON.stringify(x) === JSON.stringify(y);
    if (!same(moveWithInsert(base, ['vct-indoor-1'], dx, dy, plain, true), plain(base))) fail('Altを押しながら離したのに、線に入っています');
    const farDx = 160;
    if (!same(moveWithInsert(base, ['vct-indoor-1'], farDx, 0, (d) => moveItem(d, 'vct-indoor-1', farDx, 0)), moveItem(base, 'vct-indoor-1', farDx, 0))) fail('線から離れた場所に離したのに、線に入っています');
    if (insertTarget(base, 'vct-indoor-1', farDx, 0) !== null) fail('線から離れた場所で、入る線が見つかっています');
    // 動かす先が、その記号のつながっている線のとき（少しだけ動かす）は、これまでどおり
    const own = wiresOnly(base).find((w) => w.at1?.item === 'vct-indoor-1' || w.at2?.item === 'vct-indoor-1')!;
    if (insertTarget(base, 'vct-indoor-1', 0, 4)?.wire === own.id) fail('つながっている自分の線に、入ろうとしています');
  }
  // 複数の記号を消しても、主回路の線は途切れず、行き止まりの線だけが消える
  {
    const cut = ['zpd', 'relay', 'ds-vt', 'main-breaker'].reduce((d, id) => removeItem(d, id), base);
    const r = tidyDrawing(cut, 'A3', 'landscape');
    const ds = base.items.find((it) => it.kind === 'symbol' && it.id === 'ds');
    const ct = base.items.find((it) => it.kind === 'symbol' && it.id === 'ct');
    if (ds?.kind !== 'symbol' || ct?.kind !== 'symbol') fail('DS・CTが見つかりません');
    else {
      const nds = r.doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'ds');
      const nct = r.doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'ct');
      const top = (nds ?? ds).y + getSymbolDef('ds').box.h;
      const bottom = (nct ?? ct).y;
      // DSの出口からCTの入口まで、縦の線が途切れなく続いている
      const spans = r.doc.items
        .filter((it): it is DocWire => it.kind === 'wire' && Math.abs(it.x1) < 0.6 && Math.abs(it.x2) < 0.6)
        .map((w) => [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] as const)
        .sort((p, q) => p[0] - q[0]);
      let reach = top;
      for (const [a, b] of spans) if (a <= reach + 1) reach = Math.max(reach, b);
      if (reach < bottom - 1) fail(`複数の記号を消したあと、DSからCTまでの主回路が途切れています（${Math.round(reach)} < ${Math.round(bottom)}）`);
      else if (r.issues.some((i) => i.kind === 'floating')) fail('複数の記号を消したあと、つながっていない線が残っています');
      else console.log(`  4つの記号を消しても、主回路は途切れず、行き止まりの線 ${r.fixed.stray}本が消える`);
    }
    // 消した記号につながっていない線（手で引いた線）は、消さない
    const hand: DocWire = { kind: 'wire', id: 'hand-1', x1: 500, y1: 100, x2: 500, y2: 150 };
    const kept = tidyDrawing({ ...cut, items: [...cut.items, hand] }, 'A3', 'landscape');
    if (!kept.doc.items.some((it) => it.id === 'hand-1')) fail('手で引いた線まで消えています');
    else console.log('  手で引いた（消した記号につながっていない）線は、消さない');
  }
  // つなぎ直した線は、前後の記号のつなぎ先を引き継ぐ（記号を動かしても、線がついてくる）
  {
    const ct = base.items.find((it) => it.kind === 'symbol' && it.id === 'ct');
    const ctBottom = ct?.kind === 'symbol' ? ct.y + getSymbolDef('ct').box.h : Infinity;
    const r = tidyDrawing(removeItem(base, 'ct'), 'A3', 'landscape');
    const wire = r.doc.items.find((it): it is DocWire => it.kind === 'wire' && !it.dashed && it.at1?.item === 'main-breaker');
    if (!wire) fail('CTを消したあと、VCBの出口から下へ、1本の線がつながっていません');
    else if (wire.y2 <= wire.y1 + 1 || ctBottom === Infinity) fail('つなぎ直した線が、VCBの出口から下へ伸びていません');
    else console.log('  つなぎ直した線は、VCBの出口につながったまま、下へ伸びる');
  }
  // つなぐ相手が一つに決まらないときは、勝手につながず、印を出して確認してもらう
  {
    const wire = (id: string, y1: number, y2: number): DocWire => ({ kind: 'wire', id, x1: 0, y1, x2: 0, y2 });
    const doc: Doc = { items: [wire('w-a', 0, 50), wire('w-b', 150, 100), wire('w-c', 250, 200)] };
    const r = tidyDrawing(doc, 'A3', 'landscape');
    const wires = r.doc.items.filter((it) => it.kind === 'wire');
    const unsure = r.issues.filter((i) => i.kind === 'floating' && i.message.includes('2か所以上'));
    if (wires.length !== 3) fail(`相手が一つに決まらないのに、線をつないでしまいました（線 ${wires.length}本）`);
    else if (unsure.length === 0) fail('相手が一つに決まらないときの、確認の印が出ていません');
    else console.log(`  相手が一つに決まらないとき：つながずに、${unsure.length}か所に確認の印`);
    // 相手がちょうど1つなら、つなぐ
    const ok2 = tidyDrawing({ items: [wire('w-a', 0, 50), wire('w-b', 150, 100)] }, 'A3', 'landscape');
    if (ok2.doc.items.filter((it) => it.kind === 'wire').length !== 1) fail('向かい合う2本（相手が1つ）が、1本につながっていません');
    else console.log('  向かい合う2本（相手が1つ）は、1本につながる');
  }
  // LBS → VCS → SR → SC と並んだ列で、VCS を消したとき、LBS と SR を、まっすぐな線でつなぐ
  // （線まで消した場合も、片側の線だけ消した場合も）。つなぐ相手が横にずれているときは、つながずに、場所を知らせる
  {
    const ac: Answers = {
      ...answers, transformerCount: 2, feederCount: 0, hasCapacitor: 'yes', capacitorCount: 2,
      capHasPc: 'yes', capHasLbs: 'yes', capHasVcs: 'yes', hasReactor: 'yes', hasPv: 'no', hasGenerator: 'no',
    };
    const col = fromLayout(layout(buildComposition(ac), ac));
    const wiresOf = (d: Doc, id: string) =>
      d.items.filter((w): w is DocWire => w.kind === 'wire' && (w.at1?.item === id || w.at2?.item === id));
    const joined = (d: Doc, up: string, down: string) =>
      d.items.some((w) => w.kind === 'wire' && [w.at1?.item, w.at2?.item].includes(up) && [w.at1?.item, w.at2?.item].includes(down) && (w.x1 === w.x2));
    if (!col.items.some((i) => i.id === 'cap-vcs-1' && i.kind === 'symbol')) fail('試験の前提：コンデンサの列に VCS がありません');
    else {
      const vcsWires = wiresOf(col, 'cap-vcs-1');
      const drop = (d: Doc, ids: string[]): Doc => ({ ...d, items: d.items.filter((i) => !ids.includes(i.id)) });
      const lower = [...vcsWires].sort((p, q) => Math.max(q.y1, q.y2) - Math.max(p.y1, p.y2))[0]!;
      const cases: [string, Doc][] = [
        ['VCSだけ消す', removeItem(col, 'cap-vcs-1')],
        ['VCSと、その両側の線を消す', drop(removeItem(col, 'cap-vcs-1'), vcsWires.map((w) => w.id))],
        ['VCSと、下側の線だけ消す', drop(removeItem(col, 'cap-vcs-1'), [lower.id])],
      ];
      for (const [name, cut] of cases) {
        const r = tidyDrawing(cut, 'A3', 'landscape');
        const left = r.issues.filter((i) => i.kind === 'floating').length;
        if (!joined(r.doc, 'cap-lbs-1', 'reactor-1')) fail(`${name}：LBS と SR が、まっすぐな線でつながっていません`);
        else if (left > 0) fail(`${name}：つながっていない所が ${left}件 残りました`);
        else if (r.doc.items.filter((i) => i.kind === 'wire' && i.at1 && i.at2).some((w) => w.kind === 'wire' && w.x1 !== w.x2 && w.y1 !== w.y2)) fail(`${name}：斜めの線ができました`);
        else console.log(`  ${name}：LBS と SR が、まっすぐ1本でつながる`);
      }
      // 横にずれていて、まっすぐには、つなげないとき：勝手につながず、場所を知らせる
      const off = removeItem(moveItem(col, 'reactor-1', 30, 0), 'cap-vcs-1');
      const r = tidyDrawing(off, 'A3', 'landscape');
      const notes = r.issues.filter((i) => i.kind === 'floating' && i.message.includes('ずれて'));
      if (joined(r.doc, 'cap-lbs-1', 'reactor-1')) fail('横にずれているのに、斜めの線でつないでしまいました');
      else if (notes.length === 0) fail('横にずれてつなげないとき、場所の知らせが出ていません');
      else console.log(`  横にずれているとき：つながずに、${notes.length}か所に「ずれている」と知らせる`);
      // 手で位置を揃えれば（SRを元の位置へ戻す）、もう一度の「整える」でつながる
      const r2 = tidyDrawing(moveItem(r.doc, 'reactor-1', -30, 0), 'A3', 'landscape');
      if (!joined(r2.doc, 'cap-lbs-1', 'reactor-1')) fail('位置を揃えたのに、LBS と SR がつながっていません');
      else console.log('  位置を揃えて、もう一度整えると、LBS と SR がつながる');
    }
    // もともと線のない（つなぐつもりのない）接続点を、勝手につながない：消していない図面は、整えても、線の本数が増えない
    const n0 = col.items.filter((i) => i.kind === 'wire').length;
    const keep = tidyDrawing(col, 'A3', 'landscape');
    const n1 = keep.doc.items.filter((i) => i.kind === 'wire').length;
    if (n1 > n0) fail(`何も消していない図面で、線が ${n1 - n0}本 増えました`);
    else console.log('  何も消していない図面は、整えても、線が増えない');
  }
}

/* ---------- 28. 記号を消したあと、「結線を整える」で余白を詰める ---------- */
console.log('\n■ 記号を消したあとの「結線を整える」（余白を詰める）');
{
  const a: Answers = {
    ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 400A', ctRatio: '300', transformerCount: 1,
    feederCount: 0, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no',
  };
  const base = fromLayout(layout(buildComposition(a), a));
  const height = (d: Doc) => {
    const b = docBounds(d);
    return b.y1 - b.y0;
  };
  // 主回路の途中の機器を消すと、そのぶん図面が縮む。線・文字の問題は出ない
  // （VCBは、トリップコイルが同じ高さに残るので、トリップコイルも一緒に消して試す）
  for (const id of ['vct-indoor-1', 'ds', 'main-breaker', 'ct']) {
    const cut = id === 'main-breaker' ? removeItem(removeItem(base, id), 'trip-coil') : removeItem(base, id);
    const r = tidyDrawing(cut, 'A3', 'landscape');
    const h0 = height(cut);
    const h1 = height(r.doc);
    const bad = r.issues.filter((i) => ['floating', 'through', 'overlap', 'skew'].includes(i.kind));
    if (r.fixed.gap < 1) fail(`${id}：消した跡の余白が詰まっていません`);
    else if (h1 > h0 - 20) fail(`${id}：図面の高さが縮んでいません（${Math.round(h0)} → ${Math.round(h1)}）`);
    else if (bad.length) fail(`${id}：詰めたあとに問題が出ました（${bad.map((i) => i.message).slice(0, 2).join(' / ')}）`);
    else if (r.doc.vacated) fail(`${id}：詰めたあとも、消した範囲の記録が残っています`);
    else console.log(`  ${id} を消す：高さ ${Math.round(h0)} → ${Math.round(h1)}（${Math.round(h0 - h1)} 縮む）`);
  }
  // 記号どうしの間隔は、自動レイアウトの主回路の間隔（16）まで詰める。それより狭くはしない
  {
    const r = tidyDrawing(removeItem(base, 'ds'), 'A3', 'landscape');
    const sym = (id: string) => r.doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === id);
    const up = sym('vct-indoor-2');
    const down = sym('ds-vt-pf');
    if (!up || !down) fail('DSの上下の記号が見つかりません');
    else {
      const rb = rotatedBox(getSymbolDef(down.symbolId).box, down.rotate);
      const gap = down.y + rb.dy - (up.y + getSymbolDef('vct').box.h);
      if (gap < 16 - 0.5) fail(`詰めすぎです（上の記号の下端から下の記号の上端まで ${Math.round(gap)}）`);
      else console.log(`  詰めたあとの間隔：上の記号の下端から、下の記号の上端まで ${Math.round(gap)}`);
    }
  }
  // 全体の間隔を整える：長すぎる帯は縮め、狭すぎる帯は広げる。自動で作った図面は、そのまま
  {
    /** 指定の高さより下のものを、まとめて dy だけ動かす（手で動かして間隔が変わった図面を作る。縦線は伸び縮みする） */
    const slide = (d: Doc, from: number, dy: number): Doc => ({
      ...d,
      items: d.items.map((it) => {
        if (it.kind === 'wire') return { ...it, y1: it.y1 >= from ? it.y1 + dy : it.y1, y2: it.y2 >= from ? it.y2 + dy : it.y2, at1: undefined, at2: undefined };
        return it.y >= from ? { ...it, y: it.y + dy } : it;
      }) as Doc['items'],
    });
    const posOf = (d: Doc) => d.items.filter((it): it is DocSymbol => it.kind === 'symbol').map((it) => `${it.id}:${Math.round(it.y)}`).join(',');
    const clean = tidyDrawing(base, 'A3', 'landscape');
    if (posOf(clean.doc) !== posOf(base)) fail('自動で作った図面が、「結線を整える」で動いてしまいました（間隔の整え直しが、強すぎます）');
    else console.log('  自動で作った図面は、「結線を整える」を押しても、間隔が動かない');
    for (const n of [1, 2, 3]) {
      const t = readFileSync(new URL(`../../docs/voice-samples/sample-${n}-claude-output.txt`, import.meta.url), 'utf8');
      const sa: Answers = { receivingVoltage: 6600, siteName: 'x', ...JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).answers };
      const sd = fromLayout(layout(buildComposition(sa), sa));
      const sr = tidyDrawing(sd, 'A3', 'landscape');
      if (posOf(sr.doc) !== posOf(sd) || sr.fixed.gap !== 0) fail(`音声入力の例 ${n} の図面が、「結線を整える」で動いてしまいました`);
    }
    const ds = base.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'ds');
    if (!ds) fail('DSが見つかりません');
    else {
      const long = slide(base, ds.y, 120);
      const r1 = tidyDrawing(long, 'A3', 'landscape');
      const bad1 = r1.issues.filter((i) => ['floating', 'through', 'overlap', 'skew'].includes(i.kind));
      if (!(height(r1.doc) < height(long) - 60) || r1.fixed.gap < 1) fail(`間延びした図面が縮んでいません（${Math.round(height(long))} → ${Math.round(height(r1.doc))}）`);
      else if (bad1.length) fail(`縮めたあとに問題が出ました（${bad1.map((i) => i.message).slice(0, 2).join(' / ')}）`);
      else console.log(`  間延びした図面（DSの上に 120 の隙間）：高さ ${Math.round(height(long))} → ${Math.round(height(r1.doc))}`);
      const tight = slide(base, ds.y, -14);
      const r2 = tidyDrawing(tight, 'A3', 'landscape');
      const upper = r2.doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'vct-indoor-2');
      const dsAfter = r2.doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === 'ds');
      const gapNow = upper && dsAfter ? dsAfter.y + rotatedBox(getSymbolDef(dsAfter.symbolId).box, dsAfter.rotate).dy - (upper.y + getSymbolDef('vct').box.h) : -1;
      const bad2 = r2.issues.filter((i) => ['floating', 'through', 'overlap', 'skew'].includes(i.kind));
      if (gapNow < 11.5) fail(`詰まりすぎた間隔が広がっていません（${Math.round(gapNow)}）`);
      else if (bad2.length) fail(`広げたあとに問題が出ました（${bad2.map((i) => i.message).slice(0, 2).join(' / ')}）`);
      else console.log(`  詰まりすぎた間隔（2）：${Math.round(gapNow)} に広がる`);
      const again = tidyDrawing(r1.doc, 'A3', 'landscape');
      if (posOf(again.doc) !== posOf(r1.doc)) fail('整えたあとに、もう一度押すと、さらに動きます');
    }
  }
  // 横に並んだ変圧器の1台を消したときは、同じ高さに、ほかの変圧器が残っているので、動かさない
  {
    const three: Answers = { ...a, transformerCount: 3, trConnection__2: 'tr-3p-dy', trConnection__3: 'tr-3p-dy' };
    const d3 = fromLayout(layout(buildComposition(three), three));
    const cut = removeItem(d3, 'transformer-2');
    const r = tidyDrawing(cut, 'A3', 'landscape');
    if (r.fixed.gap !== 0) fail('横に並んだ変圧器の1台を消したら、図面を詰めてしまいました');
    else console.log('  横に並んだ変圧器の1台を消しても、ほかの変圧器があるので、動かさない');
  }
}

/* ---------- 29. LBSを動かしても、記号の真ん中に縦の線が出ない ---------- */
console.log('\n■ 記号を動かしても、折り返した線が記号の真ん中を貫かない（LBSなど）');
{
  const cases: [string, Answers][] = [
    ['PFS形のLBS', { ...answers, mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3, transformerCount: 1, feederCount: 0 }],
    ['励突抑制開閉器', { ...answers, mainBreakerForm: 'cb', hasInrush: 'yes', inrushRatedVoltage: '7200', inrushFuseCount: 3, transformerCount: 1, feederCount: 0 }],
  ];
  /** 縦の線が、LBSの図記号の真ん中（上と下の端から20より内側）を通っているか */
  const through = (d: Doc, id: string): boolean => {
    const s = d.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === id);
    if (!s) return false;
    const def = getSymbolDef(s.symbolId);
    const cx = s.x + def.ports[0]!.x;
    return d.items.some((it) => {
      if (it.kind !== 'wire' || it.x1 !== it.x2 || Math.abs(it.x1 - cx) > 1.5) return false;
      const lo = Math.max(Math.min(it.y1, it.y2), s.y + 20);
      const hi = Math.min(Math.max(it.y1, it.y2), s.y + def.box.h - 20);
      return hi - lo > 8;
    });
  };
  for (const [name, a] of cases) {
    const d0 = fromLayout(layout(buildComposition(a), a));
    const lbs = d0.items.find((it): it is DocSymbol => it.kind === 'symbol' && /^lbs/.test(it.symbolId) && (it.id === 'main-breaker' || it.id === 'inrush-lbs'));
    if (!lbs) {
      fail(`${name}：LBSが見つかりません`);
      continue;
    }
    if (through(d0, lbs.id)) fail(`${name}：動かす前から、LBSの真ん中に縦の線があります`);
    let bad = 0;
    for (const dy of [20, 40, 60, 80, -40, -80]) {
      if (through(moveItem(d0, lbs.id, 0, dy), lbs.id)) bad++;
    }
    // 隣の記号を動かして、LBSの上や下をまたいだときも同じ
    for (const other of d0.items.filter((it): it is DocSymbol => it.kind === 'symbol' && it.id !== lbs.id)) {
      for (const dy of [60, -60]) if (through(moveItem(d0, other.id, 0, dy), lbs.id)) bad++;
    }
    // 元の位置へ戻せば、線も元どおりになる
    const back = moveItem(moveItem(d0, lbs.id, 0, 80), lbs.id, 0, -80);
    const lengths = (d: Doc) => d.items.filter((it): it is DocWire => it.kind === 'wire').map((w) => Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))).join(',');
    if (bad > 0) fail(`${name}：動かしたとき、LBSの真ん中に縦の線が出る動かし方が ${bad}通りあります`);
    else if (lengths(back) !== lengths(d0)) fail(`${name}：80下げて80戻したのに、線が元どおりになっていません`);
    else console.log(`  ${name}：上下に動かしても（隣を動かしても）、真ん中に縦の線は出ない。戻すと線も元どおり`);
  }
  // 生成した図面の線は、1本も消えない（折り返しの判定が、正しい線を消していない）
  const a = cases[0]![1];
  const lay = layout(buildComposition(a), a);
  const doc = fromLayout(lay);
  const wires = doc.items.filter((it): it is DocWire => it.kind === 'wire');
  const lost = wires.filter((w, i) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 0.5 && lay.wires[i] && Math.hypot(lay.wires[i]!.x2 - lay.wires[i]!.x1, lay.wires[i]!.y2 - lay.wires[i]!.y1) >= 0.5);
  if (lost.length) fail(`取り込んだだけで、${lost.length}本の線が消えています`);
  else console.log('  取り込んだだけでは、線は1本も消えない');
}
