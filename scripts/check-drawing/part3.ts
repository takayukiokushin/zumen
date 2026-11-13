/**
 * 図面の検証（check-drawing）の3つ目：PASを動かす・ZPD・PV・送り出し・OVGR/DGR・客柱・外箱・縮小拡大・線を引く・範囲選択・3か所以上のエリア・手で直した内容。
 * 共有するものは common.ts。scripts/check-drawing.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { removeItem, addWire, fromLayout, moveItem, docBounds, addText, moveItems, removeItems, itemsInRange, itemBounds, setWireKind, addSymbol, setItemRect, resizeInfoOf } from '../../apps/web/src/editor/doc.ts';
import { rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { rotatedBox, findLabelCollisions, labelRect, layout } from '../../packages/layout/src/index.ts';
import { getSymbol as getSymbolDef } from '../../packages/symbols/src/index.ts';
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { SHRINK, scaleLayout } from '../../apps/web/src/editor/layoutScale.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { portAbs, portX, portY, fail, answers, wires, worstGap } from './common.ts';
import type { PlacedSymbolLike } from './common.ts';
import { base } from './part1.ts';

/* ---------- 30. PASを動かすと、中の部品・枝線・GR/DGRも一緒に動く ---------- */
console.log('\n■ PASを動かしたとき（内蔵品・中の枝線・GR/DGRが一緒に動く）');
{
  const cases: [string, Answers][] = [
    ['DGR（VT・LA内蔵）', { ...answers, mainBreakerForm: 'cb', transformerCount: 1, feederCount: 0, pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' }],
    ['GR（LA内蔵）', { ...answers, mainBreakerForm: 'cb', transformerCount: 1, feederCount: 0, pasControl: 'gr', pasBuiltinVt: 'no', pasBuiltinLa: 'yes' }],
  ];
  for (const [name, a] of cases) {
    const d0 = fromLayout(layout(buildComposition(a), a));
    const find = (d: Doc, id: string) => d.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === id);
    const pas = find(d0, 'pas');
    const relay = d0.items.find((it): it is DocSymbol => it.kind === 'symbol' && /^relay-(gr|dgr)$/.test(it.symbolId));
    const kids = d0.items.filter((it): it is DocSymbol => it.kind === 'symbol' && it.parent === 'pas');
    if (!pas || !relay || kids.length === 0) {
      fail(`${name}：PAS・GR/DGR・内蔵品が見つかりません`);
      continue;
    }
    const box = rotatedBox(getSymbolDef(pas.symbolId).box, pas.rotate);
    const inBox = (x: number, y: number) => x >= pas.x + box.dx - 0.5 && x <= pas.x + box.dx + box.w + 0.5 && y >= pas.y + box.dy - 0.5 && y <= pas.y + box.dy + box.h + 0.5;
    // PASの枠の中に端がある、つなぎ先の無い線（内蔵品への枝線）
    const innerWires = wires(d0).filter((w) => (!w.at1 && inBox(w.x1, w.y1)) || (!w.at2 && inBox(w.x2, w.y2)));
    // 内蔵品からGR/DGRへ向かう線（GR/DGRにつながっている線と、その手前の線）
    const toRelay = wires(d0).filter((w) => w.at1?.item === relay.id || w.at2?.item === relay.id || (w.x1 > pas.x + box.dx + box.w && w.x2 > pas.x + box.dx + box.w && w.x1 < relay.x && w.x2 < relay.x && Math.min(w.y1, w.y2) >= pas.y && Math.max(w.y1, w.y2) <= pas.y + box.dy + box.h && !w.at1 && !w.at2));
    let bad = '';
    for (const [dx, dy] of [[30, -20], [-40, 60], [0, 24]] as const) {
      const m = moveItem(d0, pas.id, dx, dy);
      for (const o of [pas, relay, ...kids]) {
        const n = find(m, o.id)!;
        if (n.x - o.x !== dx || n.y - o.y !== dy || n.rotate !== o.rotate) bad ||= `${o.id} が (${dx},${dy}) どおりに動いていません`;
      }
      for (const w of [...innerWires, ...toRelay]) {
        const n = m.items.find((it): it is DocWire => it.kind === 'wire' && it.id === w.id)!;
        const moved = [n.x1 - w.x1, n.y1 - w.y1, n.x2 - w.x2, n.y2 - w.y2];
        if (moved.some((v, i) => Math.abs(v - (i % 2 === 0 ? dx : dy)) > 0.01)) bad ||= `線 ${w.id} が一緒に動いていません`;
      }
      // PASの中の枝線と、GR/DGRへの線は、斜めにならない（PASの上下の主回路の線は、横に動かすと斜めになるが、これは前から）
      for (const w of [...innerWires, ...toRelay]) {
        const n = m.items.find((it): it is DocWire => it.kind === 'wire' && it.id === w.id)!;
        if (n.x1 !== n.x2 && n.y1 !== n.y2) bad ||= `線 ${w.id} が斜めになりました`;
      }
      // 内蔵品だけを動かしたときは、その部品だけ
    }
    const one = moveItem(d0, kids[0]!.id, 0, 10);
    if ([pas, relay, ...kids.slice(1)].some((o) => find(one, o.id)!.y !== o.y)) bad ||= `${kids[0]!.id} だけを動かしたのに、ほかも動きました`;
    if (innerWires.length === 0 || toRelay.length === 0) bad ||= `試験の前提が違います（中の枝線 ${innerWires.length}本・GR/DGRへの線 ${toRelay.length}本）`;
    if (bad) fail(`${name}：${bad}`);
    else console.log(`  ${name}：PASを動かすと、内蔵品 ${kids.length}個・中の枝線 ${innerWires.length}本・GR/DGRとそこへの線 ${toRelay.length}本が、同じだけ動く。内蔵品だけを動かすと、その部品だけ動く`);
  }
}

/* ---------- 30b. DGRのとき、PAS・PGSの中にZPDが入る（枠の大きさは変えない） ---------- */
console.log('\n■ PAS・PGSの中のZPD（DGRのとき）');
{
  const mk = (extra: Partial<Answers>): Answers => ({
    ...answers, mainBreakerForm: 'cb', transformerCount: 1, feederCount: 0, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no', ...extra,
  });
  const cases: [string, Answers, boolean][] = [
    ['PAS・DGR・VT・LA内蔵', mk({ pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' }), true],
    ['PAS・DGR・VTのみ', mk({ pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'no' }), true],
    ['PAS・DGR・内蔵なし', mk({ pasControl: 'dgr', pasBuiltinVt: 'no', pasBuiltinLa: 'no' }), true],
    ['PGS・DGR・VT・LA内蔵', mk({ sectionalizer: 'pgs', pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' }), true],
    ['PGS・DGR・内蔵なし', mk({ sectionalizer: 'pgs', pasControl: 'dgr', pasBuiltinVt: 'no', pasBuiltinLa: 'no' }), true],
    ['PAS・GR', mk({ pasControl: 'gr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' }), false],
    ['PAS・SOGなし', mk({ pasControl: 'none', pasBuiltinVt: 'no', pasBuiltinLa: 'no' }), false],
  ];
  for (const [name, a, want] of cases) {
    const d = fromLayout(layout(buildComposition(a), a));
    const syms = d.items.filter((it): it is DocSymbol => it.kind === 'symbol');
    const pas = syms.find((s) => s.id === 'pas')!;
    const zpd = syms.find((s) => s.parent === 'pas' && s.symbolId.startsWith('zpd-pas'));
    if (!want) {
      if (zpd) fail(`${name}：ZPDが入っています`);
      else console.log(`  ${name}：ZPDは入らない`);
      continue;
    }
    if (!zpd) {
      fail(`${name}：PASの中にZPDが入っていません`);
      continue;
    }
    // 枠の大きさは変えない（内蔵品があるときは pas-builtin の 96×172、無いときは pas・ugs・pgs の 86×148）
    const pb = getSymbolDef(pas.symbolId).box;
    const sizeOk = pas.symbolId === 'pas-builtin' ? pb.w === 96 && pb.h === 172 : pb.w === 86 && pb.h === 148;
    const zx0 = zpd.x + 1; const zx1 = zpd.x + 37; const zy0 = zpd.y + 6; const zy1 = zpd.y + 22;
    // 枠の下の線（PASの枠の下端）：LAの接地記号が出る高さと同じ。LAが無いときも、PASの記号から求める
    const frameBottom = pas.y + (pas.symbolId === 'pas-builtin' ? 148 : 136);
    const frameRight = pas.x + (pas.symbolId === 'pas-builtin' ? 6 + 74 + 10 : 6 + 74);
    const others = syms.filter((s) => s.parent === 'pas' && s.id !== zpd.id);
    const hit = others.filter((o) => {
      const b = getSymbolDef(o.symbolId).box;
      // 記号の絵が占める範囲（接地記号が枠の外へ出る部分は、別に見る）
      return zx0 < o.x + b.w && zx1 > o.x && zy0 < o.y + b.h && zy1 > o.y && !(o.symbolId === 'zct');
    });
    const withLa = syms.some((s) => s.parent === 'pas' && s.symbolId === 'la');
    const earthY = zpd.y + 32; // 接地記号の1本目
    const vt = others.find((o) => o.symbolId === 'vt');
    const la = others.find((o) => o.symbolId === 'la');
    const problems: string[] = [];
    if (!sizeOk) problems.push(`PASの大きさが変わっています（${pb.w}×${pb.h}）`);
    if (zy1 > frameBottom || zx1 > frameRight) problems.push('ZPDの枠が、PASの枠から、はみ出しています');
    if (withLa) {
      // LAも入るとき：接地記号はLAの1つだけ。ZPDは、縦線を枠の下の線まで伸ばす（はみ出さない）
      if (zpd.symbolId !== 'zpd-pas-boxed') problems.push('LAがあるのに、ZPDの接地記号が残っています');
      const stemEnd = zpd.y + 28;
      if (Math.abs(stemEnd - frameBottom) > 0.01) problems.push(`ZPDの縦線が、枠の下の線まで届いていません（線の端 ${stemEnd}、枠の下 ${frameBottom}）`);
      const earths = d.items.filter((it) => it.kind === 'symbol' && it.parent === 'pas' && ['la', 'zpd-pas'].includes(it.symbolId)).length;
      if (earths !== 1) problems.push(`外箱の接地記号が ${earths}個あります（最大1つ）`);
    } else {
      if (zpd.symbolId !== 'zpd-pas') problems.push('LAが無いのに、ZPDの接地記号が無くなっています');
      if (earthY < frameBottom + 3) problems.push(`接地記号が、枠の外に出ていません（枠の下 ${frameBottom}、接地 ${earthY}）`);
    }
    if (vt && zy0 < vt.y + 30) problems.push('ZPDが、VTの下に入っていません');
    if (la && zx0 < la.x + 41) problems.push('ZPDが、LAの右横に入っていません');
    if (hit.length) problems.push(`ZPDが、${hit.map((o) => o.symbolId).join('・')} と重なっています`);
    // DGRまで線がつながっている
    const dgr = syms.find((s) => s.symbolId === 'relay-dgr')!;
    const w = d.items.filter((it): it is DocWire => it.kind === 'wire');
    const viaZpd = w.some((x) => x.at1?.item === zpd.id || x.at2?.item === zpd.id);
    if (!viaZpd) problems.push('ZPDの出口に線がありません');
    if (!w.some((x) => x.at1?.item === dgr.id || x.at2?.item === dgr.id)) problems.push('DGRに線がつながっていません');
    // 蓄電池ユニットの上の縦棒（接続点）は、長方形（x＝4〜92）の真ん中に通っている（第13弾 項目44）
    {
      const bd = getSymbolDef('battery-unit');
      const bp = bd.ports.find((q) => q.id === 'out')!;
      const br = bd.shapes.find((sh) => sh.k === 'rect') as { x: number; w: number } | undefined;
      if (!br || Math.abs(bp.x - (br.x + br.w / 2)) > 0.01) problems.push(`蓄電池ユニットの縦棒が、長方形の真ん中にありません（接続点 x＝${bp.x}）`);
    }
    // 編集画面でPCSを足したときも、文字の初めの位置は同じ（四角の真横・上の辺）
    {
      const added = addSymbol({ items: [] } as Doc, 'pcs', 100, 100);
      const ps = added.doc.items.find((it): it is DocSymbol => it.kind === 'symbol')!;
      if (Math.abs(ps.labelDx - (47 + 10)) > 0.5 || Math.abs(ps.labelDy - (10 + 8.5)) > 0.5) problems.push(`編集画面で足したPCSの文字の位置が違います（${ps.labelDx}, ${ps.labelDy}）`);
    }
    const issues = inspectDrawing(d, 'A3', 'landscape').filter((i) => ['floating', 'through', 'skew', 'overlap'].includes(i.kind));
    if (issues.length) problems.push(`図面の点検で問題：${issues.map((i) => i.message.slice(0, 18)).join(' / ')}`);
    if (problems.length) fail(`${name}：${problems.join('、')}`);
    else console.log(`  ${name}：ZPDが、VTの下・LAの右横に入る。${withLa ? '接地記号はLAの1つだけ（ZPDの縦線は枠まで伸びる）' : '接地記号は枠の外'}。PASの大きさは そのまま`);
  }
}

/* ---------- 30c. 太陽光：PCSの枠ごとに、真下にPVの図記号を1つ ---------- */
console.log('\n■ PCSの真下のPV（枠ごとに1つ）');
{
  for (const [name, extra] of [
    ['PCS 4台を2つの変圧器に（2枠）', { pcsCount: '4', pcsToTr1: 2, pcsToTr2: 2 }],
    ['PCS 1台（1枠）', { pcsCount: '1', pcsToTr1: 1, pcsToTr2: 0 }],
    ['PCS 10台を1つの変圧器に（1枠）', { pcsCount: '10', pcsToTr1: 10, pcsToTr2: 0 }],
  ] as const) {
    const a: Answers = { ...answers, transformerCount: 3, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, hasGenerator: 'no', hasCapacitor: 'no', ...extra };
    const d = fromLayout(layout(buildComposition(a), a));
    const syms = d.items.filter((it): it is DocSymbol => it.kind === 'symbol');
    const wiresAll = d.items.filter((it): it is DocWire => it.kind === 'wire');
    const pcs = syms.filter((x) => x.symbolId === 'pcs');
    const pv = syms.filter((x) => x.symbolId === 'pv');
    const problems: string[] = [];
    if (pcs.length === 0) problems.push('PCSが描かれていません（試験の前提が違います）');
    if (pv.length !== pcs.length) problems.push(`PCSの枠 ${pcs.length}つに対して、PVが ${pv.length}個です`);
    for (const p of pcs) {
      const below = pv.filter((v) => Math.abs((v.x + 29) - (p.x + 28)) < 0.5 && v.y > p.y);
      if (below.length !== 1) { problems.push(`${p.id} の真下のPVが ${below.length}個です`); continue; }
      const v = below[0]!;
      // PCSの出口から、PVの入口まで、縦の線でつながっている
      const linked = wiresAll.some((w) => w.x1 === w.x2 && Math.abs(w.x1 - (p.x + 28)) < 0.5 && Math.abs(Math.min(w.y1, w.y2) - (p.y + 38)) < 0.5 && Math.abs(Math.max(w.y1, w.y2) - v.y) < 0.5);
      if (!linked) problems.push(`${p.id} と ${v.id} が、線でつながっていません`);
      if (v.label.join('|') !== 'PV') problems.push(`PVの文字が違います（${v.label.join('|')}）`);
      // PCSの文字は、四角（x＝9〜47、上の辺 y＝10）の真横に、四角の上の辺へ文字の上端をそろえて置く（第13弾 項目43）
      const lr = labelRect({ x: p.x + p.labelDx, y: p.y + p.labelDy, anchor: p.labelAnchor }, p.label);
      if (Math.abs(lr.y0 - (p.y + 10)) > 0.5) problems.push(`${p.id} の文字の上端が、四角の上の辺とそろっていません（差 ${(lr.y0 - (p.y + 10)).toFixed(1)}）`);
      if (lr.x0 < p.x + 47 || lr.x0 > p.x + 47 + 20) problems.push(`${p.id} の文字が、四角の真横にありません（四角の右端から ${(lr.x0 - (p.x + 47)).toFixed(1)}）`);
    }
    const issues = inspectDrawing(d, 'A3', 'landscape').filter((i) => ['floating', 'through', 'skew', 'overlap'].includes(i.kind));
    if (issues.length) problems.push(`図面の点検で問題：${issues.map((i) => i.message.slice(0, 18)).join(' / ')}`);
    if (problems.length) fail(`${name}：${problems.join('、')}`);
    else console.log(`  ${name}：PCS ${pcs.length}枠に、真下のPVが1つずつ（線でつながる）`);
  }
  // PVの容量（kW）は任意。入れたものだけ、PVの下に「100kW」と書く（空欄なら「PV」だけ）
  {
    const a: Answers = { ...answers, transformerCount: 3, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: '4', pcsToTr1: 2, pcsToTr2: 2, hasGenerator: 'no', hasCapacitor: 'no', pvKw1: '100', pvKw2: '75kW' };
    const pvs = layout(buildComposition(a), a).symbols.filter((x) => x.symbolId === 'pv').map((x) => x.label.join('|'));
    const b: Answers = { ...a, pvKw1: undefined as never, pvKw2: '' };
    const pvs2 = layout(buildComposition(b), b).symbols.filter((x) => x.symbolId === 'pv').map((x) => x.label.join('|'));
    if (pvs.join(',') !== 'PV|100kW,PV|75kW') fail(`PVの容量の文字が違います（${pvs.join(' / ')}）`);
    else if (pvs2.join(',') !== 'PV,PV') fail(`PVの容量が空欄のとき、「PV」だけになっていません（${pvs2.join(' / ')}）`);
    else console.log(`  PVの容量（任意）：入れると「${pvs.join('」「')}」、空欄なら「PV」だけ`);
    const d = fromLayout(layout(buildComposition(a), a));
    const issues = inspectDrawing(d, 'A3', 'landscape').filter((i) => ['floating', 'through', 'skew', 'overlap'].includes(i.kind));
    if (issues.length) fail(`PVの容量を入れたとき、図面の点検で問題：${issues.map((i) => i.message.slice(0, 18)).join(' / ')}`);
  }
}

/* ---------- 31. キュービクルの外枠も動かせる ---------- */
console.log('\n■ 外枠（キュービクルの枠）を動かす');
{
  const frame = base.items.find((it) => it.kind === 'frame');
  if (!frame || frame.kind !== 'frame') fail('外枠が見つかりません');
  else {
    const moved = moveItem(base, frame.id, 20, -12);
    const f2 = moved.items.find((it) => it.id === frame.id);
    const others = (d: Doc) => JSON.stringify(d.items.filter((it) => it.id !== frame.id));
    if (f2?.kind !== 'frame' || f2.x !== frame.x + 20 || f2.y !== frame.y - 12 || f2.w !== frame.w) fail('外枠が、動かした分だけ動いていません（幅は変えない）');
    else if (others(moved) !== others(base)) fail('外枠を動かしたら、ほかの記号や線も動きました');
    else console.log('  外枠は、動かした分だけ動き、大きさ・ほかの記号・線は変わらない');
    // 動かしたあとも、結線に問題は出ない
    if (worstGap(moved) !== 0) fail('外枠を動かしたあと、線にずれが出ました');
  }
}

/* ---------- 2か所目のPAS・AS ---------- */
console.log('\n■ 2か所目以降のPAS・AS（受電側）');
{
  const base2: Answers = { ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus' };
  const draw = (extra: Answers) => layout(buildComposition({ ...base2, ...extra }), { ...base2, ...extra });
  const dPlain = draw({});
  const dBoth = draw({ 'a2:areaPas': 'yes', 'a2:areaAs': 'yes' });
  const pas = dBoth.symbols.find((s) => s.id === 'a2:area-pas');
  const asw = dBoth.symbols.find((s) => s.id === 'a2:area-as');
  const ds = dBoth.symbols.find((s) => s.id === 'a2:ds');
  if (dPlain.symbols.some((s) => /area-(pas|as)/.test(s.id))) fail('「ない」のときに、PAS・ASが描かれています');
  else if (!pas || !asw || !ds) fail('2か所目のPAS・ASが描かれていません');
  else if (!(pas.y < asw.y && asw.y < ds.y && Math.abs(pas.x + getSymbolDef('pas').ports[0]!.x - (asw.x + getSymbolDef('as').ports[0]!.x)) < 1)) fail('PAS → AS → DS が、同じ縦の線に、この順で並んでいません');
  else if (findLabelCollisions(dBoth).length > 0) fail('PAS・ASを入れたら、文字が重なりました');
  else if (!dBoth.texts?.length && !pas.label.includes('PAS')) fail('PASの文字が書かれていません');
  else if (!asw.label.includes('AS')) fail('ASの文字が書かれていません');
  else console.log('  PAS → AS → DS が、同じ縦の線に並び、文字（PAS・AS）が書かれ、重ならない');
}

/* ---------- 1か所目から送り出す線の途中の開閉器 ---------- */
console.log('\n■ 送り出しの開閉器（1か所目 → 2か所目の線の途中）');
{
  const base2: Answers = { ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried', 'a2:linkCableCrossSection': '38', 'a2:linkCableLength': 30 };
  const draw = (extra: Answers) => layout(buildComposition({ ...base2, ...extra }), { ...base2, ...extra });
  for (const [kind, ids] of [['ds', ['a2:sendout-ds']], ['vcb', ['a2:sendout-vcb']], ['ds-vcb', ['a2:sendout-ds', 'a2:sendout-vcb']], ['lbs', ['a2:sendout-lbs']]] as const) {
    const d = draw({ 'a2:linkSwitch': kind, 'a2:linkFuseCurrent': '30' });
    const syms = ids.map((id) => d.symbols.find((s) => s.id === id));
    if (syms.some((s) => !s)) { fail(`${kind}：送り出しの開閉器が描かれていません`); continue; }
    const ss = syms as PlacedSymbolLike[];
    // 縦向き（ふつうの向き）に、同じ縦線の上に、上から順に並ぶ（入口と出口が、線でつながっている）
    const level = ss.every((s) => s.rotate === 0 && Math.abs(portX(s, 'in') - portX(ss[0]!, 'in')) < 0.5 && Math.abs(portX(s, 'out') - portX(ss[0]!, 'in')) < 0.5);
    const ordered = ss.every((s, i) => i === 0 || portY(ss[i - 1]!, 'out') < portY(s, 'in'));
    const wireAt = (x: number, y: number) => d.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
    // 最初の開閉器の入口は、母線から出て、90度曲がってきた線につながり、最後の出口は、ケーブルの端末につながる
    const joined = wireAt(portX(ss[0]!, 'in'), portY(ss[0]!, 'in')) && wireAt(portX(ss.at(-1)!, 'out'), portY(ss.at(-1)!, 'out')) && ss.every((s, i) => i === 0 || wireAt(portX(s, 'in'), portY(s, 'in')));
    if (!level || !ordered) fail(`${kind}：送り出しの開閉器が、縦に、上から順に並んでいません`);
    else if (!joined) fail(`${kind}：送り出しの開閉器の入口・出口に、線がつながっていません`);
    else if (findLabelCollisions(d).length > 0) fail(`${kind}：送り出しの開閉器を入れたら、文字が重なりました`);
    else console.log(`  ${kind}：母線から横に出て、90度曲がって、下向きに並び、前後が線でつながる。文字は重ならない`);
  }
  if (draw({ 'a2:linkSwitch': 'lbs', 'a2:linkFuseCurrent': '30' }).symbols.find((s) => s.id === 'a2:sendout-lbs')?.label.join('|') !== 'LBS|PF 30A') fail('LBSの文字が「LBS／PF 30A」になっていません');
  if (draw({}).symbols.some((s) => /^(a\d+:)?sendout/.test(s.id))) fail('「なし」のとき、送り出しの開閉器が描かれています');
}

/* ---------- ケーブルでつなぐとき：送り出し側にも、ケーブルの端末（三角は、必ず下向き） ---------- */
console.log('\n■ 送り出し側のケーブルの端末（分岐する位置・開閉器の有無に関わらず、必ず下向き）');
{
  const base2: Answers = { ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried' };
  const taps = ['ds-source', 'ds-vcb', 'vcb-load', 'bus'] as const;
  const switches: [string, Answers][] = [['開閉器なし', {}], ['DS＋VCBあり', { 'a2:linkSwitch': 'ds-vcb' }], ['VCBのみ', { 'a2:linkSwitch': 'vcb' }]];
  let n = 0;
  for (const tap of taps) {
    for (const [swName, sw] of switches) {
      const name = `分岐「${tap}」・${swName}`;
      const a = { ...base2, ...sw, 'a2:linkTap': tap };
      const d = layout(buildComposition(a), a);
      const head = d.symbols.find((s) => s.id === 'cable-head-send');
      if (!head) { fail(`${name}：送り出し側に、ケーブルの端末が描かれていません`); continue; }
      const [inP, outP] = [portAbs(head, 'in'), portAbs(head, 'out')];
      const wireAt = (x: number, y: number) => d.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
      // 三角の頂点（出口側）が下を向く：ふつうの向き（回さない）で、入口の真下に出口がある。入口・出口の両方に線がつながっている
      const down = head.rotate === 0 && Math.abs(inP.x - outP.x) < 0.5 && inP.y < outP.y;
      if (!down) fail(`${name}：ケーブルの端末が、下向きになっていません（回転 ${head.rotate}°）`);
      else if (!wireAt(inP.x, inP.y) || !wireAt(outP.x, outP.y)) fail(`${name}：送り出し側のケーブルの端末に、線がつながっていません`);
      else if (findLabelCollisions(d).length > 0) fail(`${name}：文字が重なりました`);
      else if (inspectDrawing(fromLayout(d), 'A3', 'portrait').some((i) => i.kind === 'overlap' || i.kind === 'floating' || i.kind === 'through')) fail(`${name}：図面の点検で、重なり・つながっていない線が見つかりました`);
      else n++;
    }
  }
  if (n === taps.length * switches.length) console.log(`  分岐の位置4つ × 開閉器3通り（${n}通り）すべて、端末は下向きで、前後が線でつながり、重ならない`);
  // 3か所：ケーブルの数（2本）だけ、端末が描かれ、どれも下向きで、線が交わらず、重ならない
  const cross = (d: ReturnType<typeof layout>) => {
    // 縦線と横線が、どちらの途中でも交わるもの（端点で接するものは、つなぎ目なので除く）
    const hs = d.wires.filter((w) => Math.abs(w.y1 - w.y2) < 0.01 && Math.abs(w.x1 - w.x2) > 0.5);
    const vs = d.wires.filter((w) => Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.y1 - w.y2) > 0.5);
    // 1か所目のエリアの中の線（枠の右端より左）は、このテストの対象外。エリアの間（すきま）を通る線どうしの交わりを数える
    const area1Right = Math.max(...d.symbols.filter((x) => !/^a\d+:/.test(x.id) && !/^(cable-head-send|a\d+:sendout)/.test(x.id)).map((x) => x.x + getSymbolDef(x.symbolId).box.w));
    let n = 0;
    for (const h of hs) for (const v of vs) {
      const [hx0, hx1] = [Math.min(h.x1, h.x2), Math.max(h.x1, h.x2)];
      const [vy0, vy1] = [Math.min(v.y1, v.y2), Math.max(v.y1, v.y2)];
      if (v.x1 <= area1Right) continue;
      if (v.x1 > hx0 + 0.5 && v.x1 < hx1 - 0.5 && h.y1 > vy0 + 0.5 && h.y1 < vy1 - 0.5) n++;
    }
    return n;
  };
  const a3base: Answers = { ...base2, areaCount: 3, 'a3:areaIntake': 'ds-vcb', 'a3:trCapacity': 100, 'a3:linkTap': 'bus', 'a3:linkCableInstallation': 'buried', 'a3:linkFrom': 1 };
  const cases3: [string, Answers][] = [
    ['同じ位置（高圧母線）から2本', {}],
    ['同じ位置（VCBの負荷側）から2本', { 'a2:linkTap': 'vcb-load', 'a3:linkTap': 'vcb-load' }],
    ['位置が違う2本（上の位置から、遠いエリアへ）', { 'a2:linkTap': 'vcb-load', 'a3:linkTap': 'ds-vcb' }],
    ['同じ位置から2本・送り出しの開閉器あり', { 'a2:linkSwitch': 'ds-vcb' }],
    ['2本目は、2か所目から', { 'a3:linkFrom': 2 }],
  ];
  for (const [name, extra] of cases3) {
    const a = { ...a3base, ...extra };
    const d3 = layout(buildComposition(a), a);
    const heads3 = d3.symbols.filter((s) => /cable-head-send/.test(s.id));
    const fromFirst = a['a3:linkFrom'] === 2 ? 1 : 2;
    const wantHeads = a['a3:linkFrom'] === 2 ? 2 : 2;
    void fromFirst;
    const down = heads3.every((h) => h.rotate === 0 && Math.abs(portAbs(h, 'in').x - portAbs(h, 'out').x) < 0.5 && portAbs(h, 'in').y < portAbs(h, 'out').y);
    const ids = new Set(heads3.map((h) => h.id));
    const wireAt = (x: number, y: number) => d3.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
    const joined = heads3.every((h) => wireAt(portAbs(h, 'in').x, portAbs(h, 'in').y) && wireAt(portAbs(h, 'out').x, portAbs(h, 'out').y));
    const crossings = cross(d3);
    const iss = inspectDrawing(fromLayout(d3), 'A3', 'landscape').filter((i) => i.kind === 'overlap' || i.kind === 'floating' || i.kind === 'through');
    if (heads3.length !== wantHeads || ids.size !== heads3.length) fail(`${name}：ケーブルは${wantHeads}本なのに、端末が${heads3.length}個（重複なしで ${ids.size}個）です`);
    else if (!down) fail(`${name}：端末が、すべて下向きになっていません`);
    else if (!joined) fail(`${name}：端末の前後が、線でつながっていません`);
    else if (crossings > 0) fail(`${name}：線が、途中で交わっています（${crossings}か所）`);
    else if (findLabelCollisions(d3).length > 0) fail(`${name}：文字が重なりました`);
    else if (iss.length > 0) fail(`${name}：図面の点検で、重なり・つながっていない線が見つかりました（${iss.map((i) => i.message).join(' / ')}）`);
    else console.log(`  ${name}：ケーブル${wantHeads}本に、端末${heads3.length}個。すべて下向き・線は交わらず・重ならない`);
  }
  // 4か所（同じ位置から3本）
  {
    const a4: Answers = { ...a3base, areaCount: 4, 'a4:areaIntake': 'ds-vcb', 'a4:trCapacity': 100, 'a4:linkTap': 'bus', 'a4:linkCableInstallation': 'buried', 'a4:linkFrom': 1 };
    const d4 = layout(buildComposition(a4), a4);
    const h4 = d4.symbols.filter((s) => /cable-head-send/.test(s.id));
    if (h4.length !== 3) fail(`4か所（同じ位置から3本）：端末が3個ではありません（${h4.length}個）`);
    else if (cross(d4) > 0) fail(`4か所：線が、途中で交わっています（${cross(d4)}か所）`);
    else if (inspectDrawing(fromLayout(d4), 'A3', 'landscape').some((i) => i.kind === 'overlap' || i.kind === 'floating' || i.kind === 'through')) fail('4か所：図面の点検で、問題が見つかりました');
    else console.log('  4か所（同じ位置から3本）：端末3個。線は交わらず、重ならない');
  }
  // 送り先名称（回路名称）：送り出し側の端末の近くに、名称だけを書く。太さ・長さは、受け側のみ
  {
    const named: Answers = { ...a3base, 'a2:linkName': '第2変電所', 'a3:linkName': '○○工場 受変電室（出先）', 'a2:linkCableCrossSection': '38', 'a2:linkCableLength': 30 };
    const dn = layout(buildComposition(named), named);
    const h2 = dn.symbols.find((x) => x.id === 'cable-head-send');
    const h3 = dn.symbols.find((x) => x.id === 'cable-head-send-3');
    if (!h2 || !h3) fail('送り先名称：端末が2個描かれていません');
    else if (h2.label.join('') !== '第2変電所' || h3.label.join('') !== '○○工場 受変電室（出先）') fail(`送り先名称が、端末の文字になっていません（${h2.label.join('/')}・${h3.label.join('/')}）`);
    else if (h2.label.length !== 1) fail('送り先名称が、1行になっていません');
    else if (dn.texts?.some((t) => t.lines.some((l) => l.includes('第2変電所') || l.includes('○○工場')))) fail('送り先名称が、受け側の文字にも書かれています（送り出し側のみのはず）');
    else if (!dn.texts?.some((t) => t.lines.some((l) => /38mm2/.test(l)))) fail('太さ・長さの文字が、受け側から消えています');
    else if (findLabelCollisions(dn).length > 0) fail('送り先名称を入れたら、文字が重なりました');
    else if (cross(dn) > 0) fail('送り先名称を入れたら、線が交わりました');
    else if (inspectDrawing(fromLayout(dn), 'A3', 'landscape').some((i) => i.kind === 'overlap' || i.kind === 'floating' || i.kind === 'through')) fail('送り先名称を入れたら、図面の点検で問題が見つかりました');
    else console.log('  送り先名称：送り出し側の端末の近くに、名称だけを1行で書く（太さ・長さは、受け側のみ）。長い名称でも、重ならない');
    // 空白のとき・ふつうの線のとき・空白だけのとき：何も書かない
    for (const [nm, extra] of [['空白', { 'a2:linkName': '' }], ['空白だけ', { 'a2:linkName': '   ' }], ['ふつうの線', { 'a2:linkName': 'テスト', 'a2:linkCable': 'no' }]] as [string, Answers][]) {
      const a = { ...a3base, ...extra };
      const d = layout(buildComposition(a), a);
      const h = d.symbols.find((x) => x.id === 'cable-head-send');
      if (h && h.label.length > 0) fail(`送り先名称が${nm}のとき、端末に文字が書かれています（${h.label.join('/')}）`);
    }
    console.log('  送り先名称が空白・空白だけ・ふつうの線のとき：何も書かない');
  }
  // ふつうの線でつなぐとき：端末は描かない
  const aw: Answers = { ...base2, 'a2:linkCable': 'no' };
  if (layout(buildComposition(aw), aw).symbols.some((s) => /cable-head-send/.test(s.id))) fail('ケーブルでつながないのに、送り出し側に端末が描かれています');
  else console.log('  ケーブルでつながないとき：端末は描かない');
}

/* ---------- OVGR（ZPDの左）・DGR（ZCTの横） ---------- */
console.log('\n■ OVGR・DGRの記号');
{
  const a: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasOvgr: 'yes', mainGroundRelay: 'dgr', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  const d = layout(buildComposition(a), a);
  const sym = (role: string) => d.symbols.find((s) => s.role === role);
  const zct = sym('main-zct');
  const dgr = sym('main-ground-relay');
  const zpd = sym('zpd');
  const ovgr = sym('ovgr');
  if (!zct || !dgr || !zpd || !ovgr) fail('ZCT・DGR・ZPD・OVGRのどれかが描かれていません');
  else {
    const zctSec = portAbs(zct, 'sec');
    const dgrEntry = (() => {
      const def = getSymbolDef(dgr.symbolId);
      const p = def.ports.find((q) => q.id === 'in' || q.dir === 'left') ?? def.ports[0]!;
      return { x: dgr.x + p.x, y: dgr.y + p.y };
    })();
    const wireAt = (x: number, y: number) => d.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
    const beside = dgr.x > zct.x && Math.abs((dgr.y + getSymbolDef(dgr.symbolId).box.h / 2) - zctSec.y) < 14;
    const zpdAbs = zpd.x + getSymbolDef('zpd').box.w;
    // ZPDとDGRの間に、線を引かない：ZPD（左）からDGR（右）へ届く横線が無い
    const crossLink = d.wires.some((w) => w.y1 === w.y2 && Math.min(w.x1, w.x2) <= zpd.x + getSymbolDef('zpd').box.w && Math.max(w.x1, w.x2) >= dgr.x && Math.abs(w.y1 - zctSec.y) < 14);
    if (!beside) fail('DGRが、ZCTの横（右）に描かれていません');
    else if (!wireAt(zctSec.x, zctSec.y) || !wireAt(dgrEntry.x, dgrEntry.y)) fail('ZCTとDGRが、線でつながっていません');
    else if (crossLink) fail('ZPDとDGRの間に、線が引かれています');
    else if (!(ovgr.x + getSymbolDef('relay-ovgr').box.w <= zpd.x + 2)) fail(`OVGRが、ZPDの左側にありません（OVGR ${ovgr.x}／ZPD ${zpd.x}）`);
    else if (findLabelCollisions(d).length > 0) fail('OVGR・DGRを入れたら、文字が重なりました');
    else if (inspectDrawing(fromLayout(d), 'A3', 'landscape').length > 0) fail('編集用に取り込むと、問題が出ます');
    else console.log(`  ZCT（ケーブルに付く）の横にDGR、ZPDの左にOVGR。ZPDとDGRは線でつながない。文字の重なりなし`);
    void zpdAbs;
  }
  // DGRなし・OVGRなしのときは、ZPDだけ
  const plain = layout(buildComposition({ ...a, hasOvgr: 'no', mainGroundRelay: 'none' }), { ...a, hasOvgr: 'no', mainGroundRelay: 'none' });
  if (plain.symbols.some((s) => /ovgr|main-zct|main-ground-relay/.test(s.id))) fail('「なし」のとき、OVGR・DGR・ZCTが描かれています');
  else console.log('  「なし」のとき：ZPDだけが描かれる');
}

/* ---------- DGRの遮断：TCは、開閉器ごとに1つ。主遮断装置にも、送り出しの開閉器にも ---------- */
console.log('\n■ DGRの遮断（TC）');
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  const wireAtP = (d: ReturnType<typeof layout>, x: number, y: number) => d.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
  // 主遮断装置（VCB・LBS）：DGRの右の端子から、TCの上の端子へ。TCは1つ（OCRとも共有）
  for (const [name, extra] of [['VCB（OCRとTCを共有）', {}], ['VCB（DGRだけ）', { relayCount: '0' }], ['LBS', { mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3 }]] as [string, Answers][]) {
    const a: Answers = { ...base, mainGroundRelay: 'dgr', ...extra };
    const d = layout(buildComposition(a), a);
    const coils = d.symbols.filter((s) => s.symbolId === 'trip-coil');
    const dgrS = d.symbols.find((s) => s.role === 'main-ground-relay');
    if (coils.length !== 1 || !dgrS) { fail(`${name}：TCが ${coils.length}個、またはDGRがありません（TCは1つのはず）`); continue; }
    const tc = coils[0]!;
    const tcTop = portAbs(tc, 't');
    const dgrR = portAbs(dgrS, 'r');
    const dashedToBreaker = d.wires.some((w) => w.dashed && Math.abs(w.x2 - portAbs(tc, 'l').x) < 0.5 && Math.abs(w.y2 - portAbs(tc, 'l').y) < 0.5);
    if (!wireAtP(d, tcTop.x, tcTop.y) || !wireAtP(d, dgrR.x, dgrR.y)) fail(`${name}：DGRとTCが、線でつながっていません`);
    else if (!dashedToBreaker) fail(`${name}：TCと開閉器が、点線でつながっていません`);
    else if (findLabelCollisions(d).length > 0) fail(`${name}：文字が重なっています`);
    else if (inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0) fail(`${name}：編集用に取り込むと、問題が出ます`);
    else console.log(`  ${name}：DGR → TC（1つ）→ 開閉器（点線）。線・文字が重ならない`);
  }
  // 送り出しの開閉器：ZCT（ケーブルに横向き）→ DGR（上）、TCは開閉器の上。TCから開閉器へ点線
  for (const [name, sw] of [['VCB', 'vcb'], ['DS＋VCB', 'ds-vcb'], ['LBS', 'lbs']] as const) {
    const a: Answers = { ...base, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkSwitch': sw, 'a2:linkGroundRelay': 'dgr' };
    const d = layout(buildComposition(a), a);
    const z = d.symbols.find((s) => s.id === 'a2:sendout-zct');
    const r = d.symbols.find((s) => s.id === 'a2:sendout-ground-relay');
    const t = d.symbols.find((s) => s.id === 'a2:sendout-trip-coil');
    const brk = d.symbols.find((s) => s.id === (sw === 'lbs' ? 'a2:sendout-lbs' : 'a2:sendout-vcb'));
    if (!z || !r || !t || !brk) { fail(`送り出し（${name}）：ZCT・DGR・TC・開閉器のどれかが描かれていません`); continue; }
    const tcL = portAbs(t, 'l');
    const brkOut = portAbs(brk, 'out');
    // 開閉器の出口から、TCの左の端子へ、点線（同じ高さ）。TCの下の端子から、真下のDGRの上の端子へ
    // 点線は、開閉器の真ん中の高さ。左の端は、主回路の縦線か、可動刃に触れた点（縦線より右）
    const dashed = d.wires.some((w) => w.dashed && w.y1 === w.y2 && Math.abs(w.y1 - tcL.y) < 0.5 && w.x1 >= brkOut.x - 0.5 && w.x1 < tcL.x && Math.abs(w.x2 - tcL.x) < 0.5);
    const zIn = portAbs(z, 'in');
    const zSec = portAbs(z, 'sec');
    const rl = (() => { const def = getSymbolDef(r.symbolId); const p = def.ports.find((q) => q.id === 'l')!; return { x: r.x + p.x, y: r.y + p.y }; })();
    const rt = portAbs(r, 'top');
    const tb = portAbs(t, 'b');
    // 縦の並び：開閉器 → ZCT（開閉器の下）。DGRはZCTの横（右）、TCは開閉器の横（右）
    const above = brkOut.y < zIn.y && Math.abs(zIn.x - brkOut.x) < 0.5 && r.x > zSec.x && t.x > brk.x + getSymbolDef(brk.symbolId).box.w && t.y < r.y;
    if (!above) fail(`送り出し（${name}）：ZCTが開閉器の下、DGRがZCTの横、TCが開閉器の横になっていません`);
    else if (!dashed) fail(`送り出し（${name}）：開閉器の出口からTCへ、点線が引かれていません`);
    else if (!wireAtP(d, zSec.x, zSec.y) || !wireAtP(d, rl.x, rl.y) || !wireAtP(d, rt.x, rt.y) || !wireAtP(d, tb.x, tb.y)) fail(`送り出し（${name}）：ZCT・DGR・TCの線がつながっていません`);
    else if (findLabelCollisions(d).length > 0) fail(`送り出し（${name}）：文字が重なっています`);
    else if (inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0) fail(`送り出し（${name}）：編集用に取り込むと、問題が出ます`);
    else console.log(`  送り出し（${name}）：下向きに 開閉器 → ZCT、DGRはZCTの横、TCは開閉器の横（点線）。線・文字が重ならない`);
  }
}

/* ---------- DGRのZCTの取り付け位置（高圧ケーブル／開閉器の一次側／二次側）---------- */
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy', mainGroundRelay: 'dgr' };
  const wireAtP = (d: ReturnType<typeof layout>, x: number, y: number) => d.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
  const problems = (d: ReturnType<typeof layout>) => findLabelCollisions(d).length > 0 ? '文字が重なっています' : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
  const posName: Record<string, string> = { cable: '高圧ケーブル', 'bus-primary': '開閉器の一次側', 'bus-secondary': '開閉器の二次側' };
  for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
    for (const [name, extra] of [['VCB（OCRあり）', {}], ['VCB（DGRだけ）', { relayCount: '0' }], ['LBS', { mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3 }]] as [string, Answers][]) {
      const a: Answers = { ...base, mainZctPos: pos, ...extra };
      const d = layout(buildComposition(a), a);
      const tcs = d.symbols.filter((s) => s.symbolId === 'trip-coil');
      const z = d.symbols.find((s) => s.role === 'main-zct');
      const r = d.symbols.find((s) => s.role === 'main-ground-relay');
      const brk = d.symbols.find((s) => s.role === 'main-breaker');
      const label = `主遮断装置・ZCT=${posName[pos]}・${name}`;
      if (tcs.length !== 1 || !z || !r || !brk) { fail(`${label}：TC（${tcs.length}個）・ZCT・DGR・開閉器のどれかが足りません`); continue; }
      const zSec = portAbs(z, 'sec');
      const rl = portAbs(r, 'l');
      const cableSide = pos === 'cable';
      const ordered = cableSide ? true : pos === 'bus-primary' ? z.y < brk.y : z.y > brk.y;
      const bad = !ordered ? 'ZCTの上下の位置が違います' : !wireAtP(d, zSec.x, zSec.y) || !wireAtP(d, rl.x, rl.y) ? 'ZCTとDGRが、線でつながっていません' : problems(d);
      if (bad) fail(`${label}：${bad}`);
      else console.log(`  ${label}：ZCT＋DGR、TCは1つ。線・文字が重ならない`);
    }
  }
  for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
    for (const [name, sw] of [['VCB', 'vcb'], ['DS＋VCB', 'ds-vcb'], ['LBS', 'lbs']] as const) {
      const a: Answers = { ...base, mainGroundRelay: 'none', areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkSwitch': sw, 'a2:linkGroundRelay': 'dgr', 'a2:linkZctPos': pos };
      const d = layout(buildComposition(a), a);
      const z = d.symbols.find((s) => s.id === 'a2:sendout-zct');
      const r = d.symbols.find((s) => s.id === 'a2:sendout-ground-relay');
      const t = d.symbols.find((s) => s.id === 'a2:sendout-trip-coil');
      const brk = d.symbols.find((s) => s.id === (sw === 'lbs' ? 'a2:sendout-lbs' : 'a2:sendout-vcb'));
      const label = `送り出し（${name}）・ZCT=${posName[pos]}`;
      if (!z || !r || !t || !brk) { fail(`${label}：ZCT・DGR・TC・開閉器のどれかが描かれていません`); continue; }
      const zSec = portAbs(z, 'sec');
      const rl = portAbs(r, 'l');
      const ordered = pos === 'bus-primary' ? z.y < brk.y : z.y > brk.y;
      const bad = !ordered ? 'ZCTの上下の位置が違います' : !wireAtP(d, zSec.x, zSec.y) || !wireAtP(d, rl.x, rl.y) ? 'ZCTとDGRが、線でつながっていません' : problems(d);
      if (bad) fail(`${label}：${bad}`);
      else console.log(`  ${label}：ZCT＋DGR＋TC。線・文字が重ならない`);
    }
  }
}

/* ---------- VTと継電器が重なるとき：VT（とUVR・OVR）を左へ。OCRは右のまま ---------- */
{
  const lbs: Answers = { ...answers, mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3, hasLa: 'no', hasZpd: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy', hasSiteCt: 'yes', hasSiteVt: 'yes', relayCount: '1', relayType: 'OCR' };
  const cases: [string, Answers][] = [
    ['LBS：VT＋OCR', {}],
    ['LBS：VT＋OCR＋UVR・OVR', { relayCount: '3', relayType__2: 'UVR', relayAt__2: 'vt-1', relayType__3: 'OVR', relayAt__3: 'vt-1', relayTest__3: 'no' }],
    ['LBS：VT＋OCR＋DGR', { hasZpd: 'yes', mainGroundRelay: 'dgr' }],
    ['CB形（VTを二次側）：VT＋OCR', { mainBreakerForm: 'cb', vtPosition: 'secondary' }],
    ['CB形（VTを二次側）：VT＋OCR＋UVR', { mainBreakerForm: 'cb', vtPosition: 'secondary', relayCount: '2', relayType__2: 'UVR', relayAt__2: 'vt-1' }],
  ];
  for (const [name, extra] of cases) {
    const a: Answers = { ...lbs, ...extra };
    const d = layout(buildComposition(a), a);
    const spine = d.symbols.find((s) => s.role === 'main-breaker')!.x + 24;
    const mid = (s: typeof d.symbols[number]) => s.x + getSymbolDef(s.symbolId).box.w / 2;
    const ocr = d.symbols.find((s) => s.symbolId === 'relay-ocr');
    const vt = d.symbols.find((s) => s.role === 'site-vt');
    const uv = d.symbols.filter((s) => ['relay-uvr', 'relay-ovr'].includes(s.symbolId));
    const bad = !ocr || !vt ? 'OCRまたはVTがありません'
      : mid(ocr) <= spine ? 'OCRが右にありません'
      : mid(vt) >= spine ? 'VTが主回路の左にありません'
      : uv.some((r) => mid(r) >= spine) ? 'UVR・OVRが、VTと一緒に左にありません'
      : findLabelCollisions(d).length > 0 ? '文字が重なっています'
      : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
    if (bad) fail(`${name}：${bad}`);
    else console.log(`  ${name}：OCRは右、VT${uv.length ? '・UVR・OVR' : ''}は左。重ならない`);
  }
  // 重ならない構成（CB形のVT一次側）は、これまでどおり、VTは右
  const cb: Answers = { ...lbs, mainBreakerForm: 'cb' };
  const dcb = layout(buildComposition(cb), cb);
  const vtcb = dcb.symbols.find((s) => s.role === 'ds-vt');
  const spcb = dcb.symbols.find((s) => s.role === 'main-breaker')!.x + 24;
  if (!vtcb || vtcb.x + getSymbolDef('vt').box.w / 2 <= spcb) fail('重ならない構成（CB形・VTが一次側）で、VTが左に動いています');
  else console.log('  CB形（VTが一次側）：重ならないので、VTは右のまま');
}

/* ---------- 引込元の記号：客柱は丸だけ、電柱は引下線つき ---------- */
console.log('\n■ 客柱・電柱の記号');
{
  const cust = getSymbolDef('pole-customer');
  const util = getSymbolDef('pole-utility');
  const lowest = (d: typeof cust) => Math.max(...d.shapes.flatMap((sh) => (sh.k === 'line' ? [sh.y1, sh.y2] : sh.k === 'circle' ? [sh.cy + sh.r] : [0])));
  if (cust.ports.length !== 0) fail('客柱に、つなぐ点（接続点）が残っています');
  else if (lowest(cust) > 30.5) fail('客柱に、丸の下へ伸びる線（引下線）が残っています');
  else if (cust.box.h > 34) fail('客柱の大きさが、丸だけになっていません');
  else if (!cust.shapes.some((sh) => sh.k === 'circle') || !cust.shapes.some((sh) => sh.k === 'line')) fail('客柱に、丸と左半分の塗りがありません');
  else if (addSymbol({ items: [] } as unknown as Doc, 'pole-customer', 0, 0).doc.items.some((i) => i.kind === 'symbol' && i.label.some((l) => l.trim() !== ''))) fail('客柱に、最初から文字（中電柱・客柱など）が入っています。基本は空白です');
  else console.log('  客柱：円の左半分を塗った丸だけ（引下線・接続点なし）。名称は最初は空白');
  if (util.ports.length !== 1 || lowest(util) < 47.5) fail('電柱の引下線が変わっています');
  else console.log('  電柱：これまでどおり（引下線あり）');
}

/* ---------- 外箱・エリアの区分枠：端・角をつかんで、幅・高さを変えられる ---------- */
console.log('\n■ 外箱・区分枠の大きさ（端・角をつかんで変える）');
{
  const box0 = addSymbol({ items: [] } as unknown as Doc, 'enclosure-cubicle', 50, 50);
  const area0 = addSymbol({ items: [] } as unknown as Doc, 'substation-area', 50, 50);
  const getS = (d: Doc, id: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === id)!;
  const infoOf = (d: Doc, id: string) => resizeInfoOf(getS(d, id))!;
  const defBox = getSymbolDef('enclosure-cubicle').box;
  const defArea = getSymbolDef('substation-area').box;
  const b0 = infoOf(box0.doc, box0.id);
  const a0 = infoOf(area0.doc, area0.id);
  // 外箱：幅だけ変えられる（高さの向きは、つかめない）
  if (!b0.w2 || b0.h2) fail('外箱：幅だけが変えられる記号のはずです');
  else console.log('  外箱：幅だけ変えられる（つかめるのは、左右の端）');
  if (!a0.w2 || !a0.h2) fail('区分枠：幅も高さも変えられる記号のはずです');
  else console.log('  区分枠：幅も高さも変えられる（左右・上下の端と、4つの角）');
  // 右端をつかんで広げる：左上は動かない
  const right = setItemRect(box0.doc, box0.id, { x: b0.x, y: b0.y, w: 300, h: 999 });
  const rInfo = infoOf(right, box0.id);
  if (rInfo.w !== 300 || rInfo.h !== defBox.h || rInfo.x !== b0.x || rInfo.y !== b0.y) fail(`外箱：右端をつかんで幅300にしたとき、左上・高さが変わりました（${JSON.stringify(rInfo)}）`);
  else console.log('  右端をつかんで広げる：幅だけ変わり、左上は動かない');
  // 左端をつかんで広げる：右端が動かない（左上の位置が左へずれる）
  const leftRect = { x: b0.x - (300 - b0.w), y: b0.y, w: 300, h: b0.h };
  const left = infoOf(setItemRect(box0.doc, box0.id, leftRect), box0.id);
  if (left.x + left.w !== b0.x + b0.w || left.w !== 300) fail('外箱：左端をつかんで広げたとき、右端が動きました');
  else console.log('  左端をつかんで広げる：右端は動かない');
  // 範囲の外は、範囲に収まる
  const r = getSymbolDef('enclosure-cubicle').resizable!.w!;
  const tiny = infoOf(setItemRect(box0.doc, box0.id, { x: b0.x, y: b0.y, w: 1, h: b0.h }), box0.id);
  const huge = infoOf(setItemRect(box0.doc, box0.id, { x: b0.x, y: b0.y, w: 99999, h: b0.h }), box0.id);
  if (tiny.w !== r.min || huge.w !== r.max) fail(`外箱：範囲の外の値が収まりません（${tiny.w}／${huge.w}）`);
  else console.log(`  外箱：幅は ${r.min}〜${r.max} に収まる`);
  // 角をつかむ：幅と高さが同時に変わる
  const corner = setItemRect(area0.doc, area0.id, { x: a0.x, y: a0.y, w: 400, h: 250 });
  const ab = itemBounds(getS(corner, area0.id));
  if (ab.x1 - ab.x0 !== 400 || ab.y1 - ab.y0 !== 250) fail(`区分枠：角をつかんで 400×250 にできません（${ab.x1 - ab.x0}×${ab.y1 - ab.y0}）`);
  else console.log('  角をつかんで広げる：幅400・高さ250が同時に変わる');
  // 左上の角：反対側（右下）の角が動かない
  const tl = infoOf(setItemRect(area0.doc, area0.id, { x: a0.x - 100, y: a0.y - 60, w: a0.w + 100, h: a0.h + 60 }), area0.id);
  if (tl.x + tl.w !== a0.x + a0.w || tl.y + tl.h !== a0.y + a0.h) fail('区分枠：左上の角をつかんだとき、右下の角が動きました');
  else console.log('  左上の角をつかんで広げる：右下の角は動かない');
  // もとの大きさに戻せば、大きさの値を持たない
  const back = getS(setItemRect(corner, area0.id, { x: a0.x, y: a0.y, w: defArea.w, h: defArea.h }), area0.id);
  if (back.w !== undefined || back.h !== undefined) fail('区分枠：もとの大きさに戻しても、大きさの値が残っています');
  else console.log('  もとの大きさに戻すと、大きさの値は残らない');
  // 大きさを変えられない記号・回した記号は、つかめない
  const pas0 = addSymbol({ items: [] } as unknown as Doc, 'pas', 0, 0);
  if (resizeInfoOf(getS(pas0.doc, pas0.id))) fail('PASが、大きさを変えられる記号になっています');
  const turned: DocSymbol = { ...getS(box0.doc, box0.id), rotate: 90 };
  if (resizeInfoOf(turned)) fail('回した外箱が、つかんで大きさを変えられる扱いになっています（回していないものだけのはず）');
  else console.log('  変えられない記号・回した記号は、つかめない');
  // 手で直した内容として保存され、作り直しても残る
  const gen7 = (a: Answers, tag: string) => fromLayout(layout(buildComposition(a), a), tag);
  const g7 = gen7({ ...answers, mainBreakerForm: 'cb' } as Answers, 'sz1');
  const withBox = addSymbol(g7, 'enclosure-cubicle', 400, 500);
  const wi = infoOf(withBox.doc, withBox.id);
  const resized: Doc = { ...setItemRect(withBox.doc, withBox.id, { x: wi.x, y: wi.y, w: 320, h: wi.h }), edited: true };
  const g8 = gen7({ ...answers, mainBreakerForm: 'cb' } as Answers, 'sz2');
  const rebuilt = rebuildWithOverrides(g8, resized).doc;
  const kept = rebuilt.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.symbolId === 'enclosure-cubicle' && !g8.items.some((g) => g.id === i.id));
  if (!kept || kept.w !== 320) fail(`外箱：手で変えた幅が、作り直したあとに残っていません（${kept?.w}）`);
  else console.log('  手で変えた幅は、入力内容を変えて図面を作り直しても、残る');
  // 印刷・PDFの図にも、変えた大きさで出る
  const svgOut = buildSheetSvg(right, { site: '確認', name: '確認' } as never);
  if (!svgOut.includes('300')) fail('印刷用の図に、変えた幅が出ていません');
  else console.log('  印刷用の図にも、変えた幅で出る');
}

/* ---------- 自動で作る枠（キュービクルなどの外枠）：端をつかんで幅を変えられる ---------- */
console.log('\n■ 自動で作る枠の幅');
{
  const a: Answers = { ...answers, mainBreakerForm: 'cb' };
  const gen11 = (x: Answers, tag: string) => fromLayout(layout(buildComposition(x), x), tag);
  const g0 = gen11(a, 'fr1');
  const framesOf = (d: Doc) => d.items.filter((i): i is Extract<Doc['items'][number], { kind: 'frame' }> => i.kind === 'frame');
  const f0 = framesOf(g0)[0];
  if (!f0) fail('自動で作った図面に、枠がありません');
  else {
    const info = resizeInfoOf(f0)!;
    if (!info.w2 || info.h2) fail('自動で作る枠：幅だけ変えられるはずです');
    else console.log('  自動で作る枠：幅だけ変えられる（つかめるのは、左右の端）');
    // 右端：左端は動かない
    const r = framesOf(setItemRect(g0, f0.id, { x: f0.x, y: f0.y, w: f0.w + 100, h: 26 }))[0]!;
    if (r.x !== f0.x || r.w !== f0.w + 100) fail('右端をつかんで広げたとき、左端が動きました');
    else console.log('  右端をつかんで広げる：左端は動かない');
    // 左端：右端は動かない
    const l = framesOf(setItemRect(g0, f0.id, { x: f0.x - 60, y: f0.y, w: f0.w + 60, h: 26 }))[0]!;
    if (l.x + l.w !== f0.x + f0.w) fail('左端をつかんで広げたとき、右端が動きました');
    else console.log('  左端をつかんで広げる：右端は動かない');
    const tiny = framesOf(setItemRect(g0, f0.id, { x: f0.x, y: f0.y, w: 1, h: 26 }))[0]!;
    const huge = framesOf(setItemRect(g0, f0.id, { x: f0.x, y: f0.y, w: 99999, h: 26 }))[0]!;
    if (tiny.w !== 60 || huge.w !== 1200) fail(`枠の幅が、範囲に収まりません（${tiny.w}／${huge.w}）`);
    else console.log('  枠の幅は 60〜1200 に収まる');
    // 手で広げた幅と、動かした位置は、入力内容が変わって図面を作り直しても、残る
    const edited: Doc = { ...setItemRect(moveItem(g0, f0.id, 0, 12), f0.id, { x: f0.x - 50, y: f0.y + 12, w: f0.w + 150, h: 26 }), edited: true };
    const g1 = gen11({ ...a, transformerCount: 2 }, 'fr2');
    const g1f = framesOf(g1)[0]!;
    const rb = framesOf(rebuildWithOverrides(g1, edited).doc)[0]!;
    if (rb.w !== g1f.w + 150 || rb.x !== g1f.x - 50 || rb.y !== g1f.y + 12) fail(`手で変えた枠が、作り直したあとに残っていません（幅 ${rb.w}／期待 ${g1f.w + 150}、x ${rb.x}／期待 ${g1f.x - 50}、y ${rb.y}／期待 ${g1f.y + 12}）`);
    else console.log('  手で変えた枠の幅・位置は、入力内容を変えて図面を作り直しても、残る');
    // 手を入れていない枠は、作り直すと自動のとおり（記録を持たない）
    const untouched = rebuildWithOverrides(g1, { ...g0, edited: true });
    if (untouched.doc.overrides?.frames) fail('枠に手を入れていないのに、枠の記録が残っています');
    else console.log('  手を入れていない枠は、記録を持たない');
    // 印刷・PDFの図にも、広げた幅で出る
    const t11 = { site: '確認', name: '確認' } as never;
    const svgOut = buildSheetSvg(setItemRect(g0, f0.id, { x: f0.x, y: f0.y, w: f0.w + 80, h: 26 }), t11);
    const svgBase = buildSheetSvg(g0, t11);
    const pathOf = (svg: string) => svg.match(/<path d="M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+) M /);
    const mOut = pathOf(svgOut);
    if (svgOut === svgBase || !mOut || Math.abs(Number(mOut[3]) - (f0.x + f0.w + 80)) > 0.6) fail(`印刷用の図に、広げた枠の右端（${f0.x + f0.w + 80}）が出ていません（${mOut?.[3]}）`);
    else console.log('  印刷用の図にも、広げた幅で出る');
  }
}

/* ---------- PGS：開閉器・遮断器の分類にある。形はPASと同じ ---------- */
console.log('\n■ PGS（編集画面の記号）');
{
  const pas = getSymbolDef('pas');
  const pgs = getSymbolDef('pgs');
  const same = (k: 'shapes' | 'ports' | 'slots' | 'box' | 'fields') => JSON.stringify(pas[k]) === JSON.stringify(pgs[k]);
  if (pgs.abbr !== 'PGS') fail('PGSの記号の名前が「PGS」ではありません');
  else if (pgs.category !== 'switchgear') fail('PGSが、開閉器・遮断器の分類に入っていません');
  else if (!(['shapes', 'ports', 'slots', 'box', 'fields'] as const).every(same)) fail('PGSの形・接続点・内蔵の置き場・大きさ・入力欄が、PASと違います');
  else if (!pgs.labelLines?.[0]?.includes('PGS') && pgs.labelLines?.[0] !== '{abbr}') console.log('  （文字の雛形：' + pgs.labelLines?.join('/') + '）');
  else console.log('  PGS：開閉器・遮断器の分類／形・接続点・内蔵の置き場・入力欄はPASと同じ');
  const d1 = addSymbol({ items: [] } as unknown as Doc, 'pgs', 0, 0).doc;
  const lab = d1.items.find((i): i is DocSymbol => i.kind === 'symbol')!.label;
  if (lab[0] !== 'PGS') fail(`PGSを足した直後の1行目が「${lab[0]}」です（PGSのはず）`);
  else console.log(`  PGSを足すと、図面に「${lab.join(' / ')}」と書かれる`);
  // PASからPGSへ差し替えても、内蔵品（ZCT・VT・LA）の置き場が合う
  const slotIds = (d: typeof pas) => (d.slots ?? []).map((q) => q.id).join(',');
  if (slotIds(pas) !== slotIds(pgs)) fail('PASとPGSで、内蔵品の置き場が違います');
}

/* ---------- 上向きのケーブルヘッド（CH） ---------- */
console.log('\n■ 上向きのCH');
{
  const down = getSymbolDef('cable-head');
  const up = getSymbolDef('cable-head-up');
  const tri = (d: typeof up) => d.shapes.find((sh) => sh.k === 'poly') as { pts?: number[]; points?: number[] } | undefined;
  const pts = (d: typeof up) => { const t = tri(d); return (t?.pts ?? t?.points ?? []) as number[]; };
  const ys = (d: typeof up) => pts(d).filter((_, i) => i % 2 === 1);
  const xs = (d: typeof up) => pts(d).filter((_, i) => i % 2 === 0);
  const apexY = (d: typeof up) => ys(d)[xs(d).findIndex((x) => x === 12)];
  if (up.category !== 'incoming') fail('上向きのCHが、引込元の分類に入っていません');
  else if (JSON.stringify(up.box) !== JSON.stringify(down.box)) fail('上向きのCHの大きさが、下向きのCHと違います');
  else if (JSON.stringify(up.ports.map((q) => [q.id, q.x, q.y])) !== JSON.stringify(down.ports.map((q) => [q.id, q.x, q.y]))) fail('上向きのCHの接続点が、下向きのCHと違います');
  else if (!(apexY(down)! > 12 && apexY(up)! < 12)) fail(`CHの向きが正しくありません（下向きの頂点 ${apexY(down)}／上向きの頂点 ${apexY(up)}）`);
  else console.log('  上向きのCH：引込元の分類に入っている／大きさ・接続点は下向きと同じ／頂点が上');
  if (addSymbol({ items: [] } as unknown as Doc, 'cable-head-up', 0, 0).doc.items.length !== 1) fail('上向きのCHを図面に足せません');
}

/* ---------- レイアウトを縮小・拡大（すきまだけを変える） ---------- */
console.log('\n■ レイアウトの縮小・拡大');
{
  const cases: [string, Answers][] = [
    ['標準（CB形・1か所）', { ...answers, mainBreakerForm: 'cb' } as Answers],
    ['PFS形・変圧器2台', { ...answers, mainBreakerForm: 'pfs', transformerCount: 2 } as Answers],
    ['PAS（VT・LA内蔵）', { ...answers, sectionalizer: 'pas', pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' } as Answers],
    ['3か所（送り先名称あり）', { ...answers, mainBreakerForm: 'cb', areaCount: 3, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried', 'a2:linkFrom': 1, 'a2:linkName': '第2変電所', 'a3:areaIntake': 'ds-vcb', 'a3:trCapacity': 100, 'a3:linkTap': 'bus', 'a3:linkCableInstallation': 'buried', 'a3:linkFrom': 1, 'a3:linkName': '第3出先' } as Answers],
  ];
  const bounds = (d: Doc) => docBounds(d);
  const axisBad = (d: Doc) => d.items.filter((i) => i.kind === 'wire' && Math.abs(i.x1 - i.x2) > 0.01 && Math.abs(i.y1 - i.y2) > 0.01).length;
  const problems = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => i.kind === 'overlap' || i.kind === 'through' || i.kind === 'floating' || i.kind === 'skew').length;
  const symBoxes = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => [i.id, i.symbolId, i.w, i.h, i.rotate, i.label.join('|'), i.labelDx, i.labelDy].join(':')).sort().join(',');
  const groupRel = (d: Doc) => {
    // 親と内蔵品の、相対位置
    const by = new Map(d.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => [i.id, i]));
    return [...by.values()].filter((i) => i.parent && by.get(i.parent)).map((i) => `${i.id}:${(i.x - by.get(i.parent!)!.x).toFixed(2)},${(i.y - by.get(i.parent!)!.y).toFixed(2)}`).sort().join(',');
  };
  for (const [name, a] of cases) {
    const base = fromLayout(layout(buildComposition(a), a), 'ls');
    const b0 = bounds(base);
    const p0 = problems(base);
    let cur = base;
    let presses = 0;
    let lastChanged = true;
    let broke = '';
    while (lastChanged && presses < 40) {
      const r = scaleLayout(cur, SHRINK);
      lastChanged = r.changed;
      if (!r.changed) break;
      presses++;
      const nb = bounds(r.doc);
      const pb = bounds(cur);
      if (symBoxes(r.doc) !== symBoxes(base)) { broke = '記号の大きさ・文字が変わりました'; break; }
      if (groupRel(r.doc) !== groupRel(base)) { broke = 'PASと内蔵品の位置関係が変わりました'; break; }
      if (axisBad(r.doc) > axisBad(base)) { broke = '斜めの線ができました'; break; }
      if (problems(r.doc) > p0) { broke = `重なり・つながっていない線・斜めの線が増えました（${p0} → ${problems(r.doc)}）：${inspectDrawing(r.doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew'].includes(i.kind)).map((i) => `${i.kind}@${Math.round(i.x)},${Math.round(i.y)} ${i.message}`).join(' / ')}`; break; }
      if (nb.x1 - nb.x0 > pb.x1 - pb.x0 + 0.01 || nb.y1 - nb.y0 > pb.y1 - pb.y0 + 0.01) { broke = '縮小したのに、大きくなりました'; break; }
      cur = r.doc;
    }
    const b1 = bounds(cur);
    const shrunkW = (b0.x1 - b0.x0) - (b1.x1 - b1.x0);
    const shrunkH = (b0.y1 - b0.y0) - (b1.y1 - b1.y0);
    if (broke) fail(`${name}：${broke}（${presses}回目）`);
    else if (presses >= 40) fail(`${name}：40回押しても、縮まなくならない（下限がありません）`);
    else if (presses === 0) console.log(`  ${name}：すでに、これ以上縮められない`);
    else console.log(`  ${name}：${presses}回で、これ以上縮められなくなる（横 −${shrunkW.toFixed(0)}・縦 −${shrunkH.toFixed(0)}）。記号・文字の大きさ、PASの内蔵品の位置、線の向きは変わらず、重なりは増えない`);
    // 拡大：大きくなり、重ならず、斜めの線ができない。縮めたあとに広げても、記号は壊れない
    const ex = scaleLayout(cur, 1 / SHRINK);
    const eb = bounds(ex.doc);
    if (!ex.changed || eb.x1 - eb.x0 <= b1.x1 - b1.x0 || eb.y1 - eb.y0 <= b1.y1 - b1.y0 + 0.01 && (b1.y1 - b1.y0) > 0 && false) fail(`${name}：拡大しても、大きくなりません`);
    else if (symBoxes(ex.doc) !== symBoxes(base) || axisBad(ex.doc) > axisBad(base) || problems(ex.doc) > p0) fail(`${name}：拡大したら、記号・線・重なりが変わりました`);
  }
}

/* ---------- 客柱：PAS・PGSの左に、枠の縦の真ん中で、隙間を空けて置く ---------- */
console.log('\n■ 客柱の自動配置（PAS・PGS）');
{
  const base: Answers = { ...answers, sourceType: 'pole', mainBreakerForm: 'cb', trCapacity: 100, transformerCount: 1, boundaryPattern: 'coincident' };
  const gen7 = (a: Answers) => layout(buildComposition(a), a);
  const frameOf = (symbolId: string) =>
    getSymbolDef(symbolId).shapes
      .filter((sh): sh is Extract<ReturnType<typeof getSymbolDef>['shapes'][number], { k: 'rect' }> => sh.k === 'rect')
      .sort((p, q) => q.w * q.h - p.w * p.h)[0]!;
  const cases: [string, Answers, boolean][] = [
    ['PAS', { ...base, sectionalizer: 'pas', pasControl: 'dgr' }, true],
    ['PAS（VT・LA内蔵）', { ...base, sectionalizer: 'pas', pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' }, true],
    ['PAS（制御なし）', { ...base, sectionalizer: 'pas', pasControl: 'none' }, true],
    ['PGS', { ...base, sectionalizer: 'pgs', pasControl: 'gr' }, true],
    ['UGS（キャビネット）', { ...base, sourceType: 'cabinet', sectionalizer: 'ugs', pasControl: 'gr' }, false],
    ['区分開閉器なし', { ...base, sectionalizer: 'none' }, false],
  ];
  for (const [name, a, want] of cases) {
    const d = gen7(a);
    const cps = d.symbols.filter((x) => x.symbolId === 'pole-customer');
    const pas = d.symbols.find((x) => x.role === 'pas');
    if (!want) {
      if (cps.length > 0) fail(`${name}：客柱が出ています（出さない決まり）`);
      else console.log(`  ${name}：客柱は出ない`);
      continue;
    }
    if (cps.length !== 1 || !pas) { fail(`${name}：客柱が1個出ていません（${cps.length}個）`); continue; }
    const cp = cps[0]!;
    const fr = frameOf(pas.symbolId);
    const gap = pas.x + fr.x - (cp.x + 30); // 丸の右の端（箱の左から30）と、枠の左の端
    const dy = Math.abs(cp.y + 16 - (pas.y + fr.y + fr.h / 2));
    if (gap < 8) fail(`${name}：客柱と枠の隙間が狭すぎます（${gap}）`);
    else if (dy > 0.01) fail(`${name}：客柱が枠の縦の真ん中からずれています（${dy}）`);
    else if (d.wires.some((w) => Math.abs(w.x1 - (cp.x + 16)) < 20 && Math.abs(w.y1 - (cp.y + 16)) < 20 && Math.abs(w.x2 - (cp.x + 16)) < 20 && Math.abs(w.y2 - (cp.y + 16)) < 20)) fail(`${name}：客柱に線がつながっています`);
    else console.log(`  ${name}：枠の左・縦の真ん中・隙間${gap}`);
    const issues = inspectDrawing(fromLayout(d), 'A3', 'portrait').filter((i) => i.kind !== 'paper');
    if (issues.length > 0) fail(`${name}：図面の点検で指摘が出ます（${issues.map((i) => i.message).join(' / ')}）`);
  }
}

/* ---------- 「線を引く」：実線と点線 ---------- */
console.log('\n■ 線を引く（実線・点線）');
{
  const a: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'no', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  const gen = (x: Answers, tag: string) => fromLayout(layout(buildComposition(x), x), tag);
  const g1 = gen(a, 'k1');
  const wireIds = (d: Doc) => new Set(d.items.filter((i) => i.kind === 'wire').map((i) => i.id));
  const before = wireIds(g1);
  const solid = addWire(g1, 400, 60, 400, 140).doc;
  const dashed = addWire(g1, 460, 60, 460, 140, { dashed: true }).doc;
  const added = (d: Doc) => d.items.find((i): i is DocWire => i.kind === 'wire' && !before.has(i.id));
  if (!added(solid) || added(solid)!.dashed) fail('実線で引いた線に、点線の印が付いています');
  else if (!added(dashed)?.dashed) fail('点線で引いた線に、点線の印が付いていません');
  else console.log('  引いた線の種類（実線・点線）が、図面に残る');
  // 点線で引いた線は、入力内容が変わって図面を作り直しても、点線のまま残る
  const edited: Doc = { ...dashed, edited: true };
  const g2 = gen({ ...a, transformerCount: 2, trConnection__2: 'tr-3p-dy' }, 'k2');
  const r = rebuildWithOverrides(g2, edited);
  const keptDashed = r.doc.items.some((i) => i.kind === 'wire' && i.dashed && Math.abs(i.x1 - 460) < 0.5 && Math.abs(i.y1 - 60) < 40);
  if (!keptDashed) fail('点線で引いた線が、作り直したあとに、点線のまま残っていません');
  else console.log('  点線で引いた線は、入力内容を変えて作り直しても、点線のまま残る');
  // 引いたあとで、種類を切り替えられる
  const addedId = added(solid)!.id;
  const toDashed = setWireKind(solid, [addedId], true);
  const backSolid = setWireKind(toDashed, [addedId], false);
  const pick = (d: Doc) => d.items.find((i): i is DocWire => i.kind === 'wire' && i.id === addedId)!;
  const others = (d: Doc) => d.items.filter((i) => i.id !== addedId).map((i) => JSON.stringify(i)).join('|');
  if (!pick(toDashed).dashed) fail('実線の線を点線に切り替えられません');
  else if ('dashed' in pick(backSolid)) fail('点線の線を実線に戻せません');
  else if (others(toDashed) !== others(solid) || others(backSolid) !== others(solid)) fail('種類を切り替えたとき、ほかの要素まで変わりました');
  else console.log('  選んだ線の実線・点線を、あとから切り替えられる（ほかの要素は変わらない）');
}

/* ---------- 図面の確認画面：範囲選択・複数選択・まとめて移動・まとめて削除 ---------- */
console.log('\n■ 範囲選択・複数選択');
{
  const a: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'no', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  const doc0 = fromLayout(layout(buildComposition(a), a));
  const sym = (d: Doc, id: string) => d.items.find((i) => i.id === id && i.kind === 'symbol') as DocSymbol | undefined;
  const ids = ['ds', 'main-breaker', 'ct'];
  if (ids.some((i) => !sym(doc0, i))) fail('試験用の図面に、DS・VCB・CTがありません');
  else {
    // まとめて移動：選んだ3つが同じだけ動く。選んでいないもの（変圧器）は動かない。つないである線は、ついていく
    const moved = moveItems(doc0, ids, 20, 10);
    const same = ids.every((i) => sym(moved, i)!.x === sym(doc0, i)!.x + 20 && sym(moved, i)!.y === sym(doc0, i)!.y + 10);
    const still = sym(moved, 'transformer')!.x === sym(doc0, 'transformer')!.x && sym(moved, 'transformer')!.y === sym(doc0, 'transformer')!.y;
    if (!same) fail('まとめて移動：選んだ記号が、同じだけ動いていません');
    else if (!still) fail('まとめて移動：選んでいない記号まで動いています');
    else console.log('  まとめて移動：選んだ3つが同じだけ動き、選んでいない変圧器は動かない');
    // 図面全体を囲んで、まとめて動かしても、つないである線は、ついていく（宙に浮かない）
    const everything = itemsInRange(doc0, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 });
    const movedAll = moveItems(doc0, everything, 20, 10);
    const floatingAfter = inspectDrawing(movedAll, 'A3', 'landscape').filter((i) => i.kind === 'floating').length;
    const floatingBefore = inspectDrawing(doc0, 'A3', 'landscape').filter((i) => i.kind === 'floating').length;
    const allSame = doc0.items.filter((i) => i.kind === 'symbol').every((i) => {
      const m = sym(movedAll, i.id)!;
      return m.x === (i as DocSymbol).x + 20 && m.y === (i as DocSymbol).y + 10;
    });
    if (!allSame) fail('図面全体のまとめて移動：すべての記号が、同じだけ動いていません');
    else if (floatingAfter > floatingBefore) fail(`図面全体をまとめて動かしたあと、つながっていない線が増えました（${floatingAfter - floatingBefore}本）`);
    else console.log(`  図面全体（${everything.length}件）をまとめて動かしても、線は、つながったまま`);
    // 動かさない（0）ときは、そのまま
    if (moveItems(doc0, ids, 0, 0) !== doc0) fail('動かす量が0のとき、図面が作り直されています');
    // まとめて削除
    const removed = removeItems(doc0, ['ds', 'main-breaker']);
    if (sym(removed, 'ds') || sym(removed, 'main-breaker') || !sym(removed, 'ct')) fail('まとめて削除：選んだものだけが消えていません');
    else console.log('  まとめて削除：選んだ2つだけが消える');
    // 1つの案件にない id が混ざっていても、止まらない
    if (removeItems(doc0, ['ds', 'nai']).items.some((i) => i.id === 'ds')) fail('存在しない id が混ざると、削除が止まります');
    // 範囲選択：まるごと入っているものだけ選ぶ
    const bb = (idList: string[]) => {
      const bs = idList.map((i) => itemBounds(doc0.items.find((x) => x.id === i)!));
      return { x0: Math.min(...bs.map((b) => b.x0)) - 1, y0: Math.min(...bs.map((b) => b.y0)) - 1, x1: Math.max(...bs.map((b) => b.x1)) + 1, y1: Math.max(...bs.map((b) => b.y1)) + 1 };
    };
    const found = itemsInRange(doc0, bb(['ds', 'main-breaker']));
    if (!found.includes('ds') || !found.includes('main-breaker')) fail('範囲選択：範囲に入っている記号が選ばれていません');
    else if (found.includes('transformer') || found.includes('ct') && !itemsInRange(doc0, bb(['ct'])).includes('ct')) fail('範囲選択：範囲の外の記号まで選ばれています');
    else console.log(`  範囲選択：範囲に入っている記号だけが選ばれる（${found.length}件）`);
    const half = itemBounds(doc0.items.find((x) => x.id === 'main-breaker')!);
    const partial = itemsInRange(doc0, { x0: half.x0, y0: half.y0, x1: (half.x0 + half.x1) / 2, y1: half.y1 });
    if (partial.includes('main-breaker')) fail('範囲選択：半分しか入っていない記号まで選ばれています');
    else console.log('  範囲選択：半分しか入っていない記号は、選ばれない');
    const all = itemsInRange(doc0, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 });
    const children = doc0.items.filter((i) => i.kind === 'symbol' && (i as DocSymbol).parent).map((i) => i.id);
    if (all.length === 0 || children.some((c) => all.includes(c))) fail('範囲選択：内蔵品が、親とは別に選ばれています');
    else console.log(`  範囲選択：図面全体を囲むと ${all.length}件。内蔵品は、親のかたまりの中に含まれる`);
  }
  // 内蔵品のある記号（PAS）：かたまり全体が入っているときだけ、かたまりごと選ばれる
  const withPas = fromLayout(layout(buildComposition({ ...a, sectionalizer: 'pas', hasPas: 'yes', pasControl: 'dgr' }), { ...a, sectionalizer: 'pas', hasPas: 'yes', pasControl: 'dgr' }));
  const pas = withPas.items.find((i) => i.id === 'pas');
  const inner = withPas.items.filter((i) => i.kind === 'symbol' && (i as DocSymbol).parent === 'pas');
  if (!pas || inner.length === 0) fail('試験用の図面に、PASとその内蔵品がありません');
  else {
    const pb = itemBounds(pas);
    const whole = itemsInRange(withPas, { x0: pb.x0 - 1, y0: pb.y0 - 1, x1: pb.x1 + 1, y1: pb.y1 + 1 });
    const ib = itemBounds(inner[0]!);
    const onlyInner = itemsInRange(withPas, { x0: ib.x0 - 1, y0: ib.y0 - 1, x1: ib.x1 + 1, y1: ib.y1 + 1 });
    if (!whole.includes('pas') || whole.includes(inner[0]!.id)) fail('範囲選択：PASを囲んだとき、PASがかたまりで選ばれていません');
    else if (onlyInner.includes(inner[0]!.id) || onlyInner.includes('pas')) fail('範囲選択：PASの内蔵品だけを囲んだとき、内蔵品やPASが選ばれています');
    else console.log('  範囲選択：PASを囲むとかたまりで選ばれ、内蔵品だけを囲んでも選ばれない');
  }
}

/* ---------- TCの点線は、開閉器（VCB・LBS）の図記号の真ん中につながる ---------- */
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  // 点線の引き始め：高さは図記号の真ん中。横は、主回路の縦線。ただし、可動刃（斜めの線）が縦線より右にあるとき（VCB）は、刃に触れた点（刃を突き抜けない）
  const centerOf = (s: { x: number; y: number; symbolId: string }) => {
    const def = getSymbolDef(s.symbolId);
    const inp = def.ports.find((q) => q.id === 'in');
    const axis = inp ? inp.x : def.box.w / 2;
    const cy = def.box.h / 2;
    let x = axis;
    for (const sh of def.shapes) {
      if (sh.k !== 'line' || sh.x1 === sh.x2 || sh.y1 === sh.y2) continue;
      if (cy < Math.min(sh.y1, sh.y2) || cy > Math.max(sh.y1, sh.y2)) continue;
      const xi = sh.x1 + ((sh.x2 - sh.x1) * (cy - sh.y1)) / (sh.y2 - sh.y1);
      if (xi > axis + 0.5) x = xi;
    }
    return { x: s.x + x, y: s.y + cy, vcb: s.symbolId === 'vcb' };
  };
  const check = (label: string, a: Answers, breakerId: (d: ReturnType<typeof layout>) => string, tcId: string) => {
    const d = layout(buildComposition(a), a);
    const brk = d.symbols.find((s) => s.id === breakerId(d));
    const tc = d.symbols.find((s) => s.id === tcId || s.role === tcId);
    if (!brk || !tc) { fail(`${label}：開閉器またはTCがありません`); return; }
    const c = centerOf(brk);
    const tl = portAbs(tc, 'l');
    // VCBは、刃に触れた点（記号の左端から 約34.3）。LBSは、縦線（24）
    const expectX = brk.x + (c.vcb ? 24 + (20 * 17) / 33 : 24);
    if (Math.abs(c.x - expectX) > 0.5) { fail(`${label}：点線の引き始めの位置が、想定と違います`); return; }
    const ok = d.wires.some((w) => w.dashed && Math.abs(w.x1 - c.x) < 0.5 && Math.abs(w.y1 - c.y) < 0.5 && Math.abs(w.x2 - tl.x) < 0.5 && Math.abs(w.y2 - tl.y) < 0.5);
    const found = inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind));
    const bad = !ok ? 'TCの点線が、開閉器の図記号の真ん中につながっていません' : findLabelCollisions(d).length > 0 ? '文字が重なっています' : found.length > 0 ? `編集用に取り込むと、問題が出ます（${JSON.stringify(found.slice(0, 2))}）` : '';
    if (bad) fail(`${label}：${bad}`);
    else console.log(`  ${label}：点線は開閉器の真ん中の高さ、刃に触れたところ（LBSは縦線）から引く。線・文字が重ならない`);
  };
  const rated: Answers = { vcbRatedVoltage: '7200', vcbRatedCurrent: 600 };
  for (const [name, extra] of [['OCRだけ', {}], ['DGR', { mainGroundRelay: 'dgr' }], ['GR', { mainGroundRelay: 'gr' }], ['DGR（母線の一次側）', { mainGroundRelay: 'dgr', mainZctPos: 'bus-primary' }], ['DGR（母線の二次側）', { mainGroundRelay: 'dgr', mainZctPos: 'bus-secondary' }]] as [string, Answers][]) {
    check(`主遮断装置VCB（${name}）`, { ...base, ...rated, ...extra }, () => 'main-breaker', 'trip-coil');
  }
  for (const [name, extra] of [['OCR', {}], ['OCR＋DGR', { mainGroundRelay: 'dgr' }]] as [string, Answers][]) {
    check(`主遮断装置LBS（${name}）`, { ...base, mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3, hasSiteCt: 'yes', hasSiteVt: 'no', relayCount: '1', relayType: 'OCR', ...extra }, () => 'main-breaker', 'trip-coil');
  }
  for (const [name, sw] of [['VCB', 'vcb'], ['DS＋VCB', 'ds-vcb'], ['LBS', 'lbs']] as const) {
    for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
      check(`送り出し${name}（ZCT=${pos}）`, { ...base, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkSwitch': sw, 'a2:linkGroundRelay': 'dgr', 'a2:linkZctPos': pos }, () => (sw === 'lbs' ? 'a2:sendout-lbs' : 'a2:sendout-vcb'), 'a2:sendout-trip-coil');
    }
  }
}

/* ---------- LAの上位（上側）の開閉器：開閉器の真下にLA。縦につながる ---------- */
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'yes', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  const problems = (d: ReturnType<typeof layout>) => findLabelCollisions(d).length > 0 ? '文字が重なっています' : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
  for (const sw of ['ds', 'pc', 'lbs']) {
    for (const tap of ['ds-source', 'ds-vcb', 'vcb-ct', 'ct-bus']) {
      for (const zpd of ['yes', 'no']) {
        const a: Answers = { ...base, laSwitch: sw, laTap: tap, hasZpd: zpd };
        const d = layout(buildComposition(a), a);
        const s1 = d.symbols.find((s) => s.role === 'la-switch');
        const la = d.symbols.find((s) => s.role === 'site-la');
        const label = `LAの上位=${sw}・LAの位置=${tap}・ZPD=${zpd}`;
        if (!s1 || !la) { fail(`${label}：開閉器またはLAが描かれていません`); continue; }
        const o = portAbs(s1, 'out');
        const i = portAbs(la, 'in');
        const vertical = Math.abs(o.x - i.x) < 0.5 && o.y < i.y && d.wires.some((w) => Math.abs(w.x1 - o.x) < 0.5 && Math.abs(w.x2 - o.x) < 0.5 && Math.abs(w.y1 - o.y) < 0.5 && Math.abs(w.y2 - i.y) < 0.5);
        const bad = !vertical ? '開閉器の真下に、LAが縦につながっていません' : problems(d);
        if (bad) fail(`${label}：${bad}`);
        else console.log(`  ${label}：開閉器 → LA（縦）。線・文字が重ならない`);
      }
    }
  }
  // 2か所目のLA
  const a2: Answers = { ...answers, mainBreakerForm: 'cb', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy', areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:hasLa': 'yes', 'a2:laSwitch': 'pc' };
  const d2 = layout(buildComposition(a2), a2);
  const bad2 = !d2.symbols.some((s) => s.role === 'a2:la-switch') ? '2か所目の開閉器がありません' : problems(d2);
  if (bad2) fail(`2か所目のLAの上位の開閉器：${bad2}`);
  else console.log('  2か所目のLAの上位の開閉器：描かれる。線・文字が重ならない');
}

/* ---------- 接地コンデンサ（GC）：ZCTの電源側が初期値。上位の開閉器の真下に縦につながる（第13弾 項目21） ---------- */
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'no', hasGc: 'yes', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy' };
  const problems = (d: ReturnType<typeof layout>) => findLabelCollisions(d).length > 0 ? '文字が重なっています' : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
  for (const relay of ['none', 'gr', 'dgr']) {
    for (const zct of ['cable', 'bus-primary', 'bus-secondary']) {
      for (const sw of ['none', 'ds', 'pc', 'lbs']) {
        for (const tap of ['zct-source', 'ds-source', 'ds-vcb', 'vcb-ct', 'ct-bus']) {
          const a: Answers = { ...base, mainGroundRelay: relay, mainZctPos: zct, gcSwitch: sw, gcTap: tap };
          const d = layout(buildComposition(a), a);
          const gc = d.symbols.find((s) => s.role === 'site-gc');
          const label = `GC：地絡継電器=${relay}・ZCT=${zct}・上位=${sw}・位置=${tap}`;
          if (!gc) { fail(`${label}：GCが描かれていません`); continue; }
          let bad = '';
          if (sw !== 'none') {
            const s1 = d.symbols.find((s) => s.role === 'gc-switch');
            if (!s1) bad = '開閉器が描かれていません';
            else {
              const o = portAbs(s1, 'out');
              const i = portAbs(gc, 'in');
              const vertical = Math.abs(o.x - i.x) < 0.5 && o.y < i.y && d.wires.some((w) => Math.abs(w.x1 - o.x) < 0.5 && Math.abs(w.x2 - o.x) < 0.5 && Math.abs(w.y1 - o.y) < 0.5 && Math.abs(w.y2 - i.y) < 0.5);
              if (!vertical) bad = '開閉器の真下に、GCが縦につながっていません';
            }
          }
          if (!bad && gc.label.join('|') !== 'GC') bad = `文字が「GC」になっていません（${gc.label.join('|')}）`;
          // ZCTの電源側：GCは、ZCTより上（電源側）
          if (!bad && tap === 'zct-source' && relay !== 'none') {
            const z = d.symbols.find((s) => s.role === 'main-zct');
            if (z && !(gc.y < z.y)) bad = `GCがZCTより上（電源側）にありません（GC y=${Math.round(gc.y)}・ZCT y=${Math.round(z.y)}）`;
          }
          bad ||= problems(d);
          if (bad) fail(`${label}：${bad}`);
        }
      }
    }
  }
  console.log('  GC：地絡継電器3種 × ZCT位置3種 × 上位の開閉器4種 × 位置5種：描かれる・ZCTの電源側・縦につながる・線と文字が重ならない');
}

/* ---------- 電動機（第13弾 項目26）：母線から／変圧器の二次側から。台数が増えても、線・文字が重ならない ---------- */
console.log('\n■ 電動機（母線から・変圧器の二次側から。1〜50台）');
{
  const problems = (d: ReturnType<typeof layout>) => findLabelCollisions(d).length > 0 ? '文字が重なっています' : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
  const mk = (src: string, n: number, extra: Answers = {}): Answers => {
    const a: Answers = { ...answers, mainBreakerForm: 'cb', transformerCount: 2, trCapacity: 100, trConnection: 'tr-3p-dy', hasMotor: 'yes', motorCount: n, ...extra };
    for (let i = 1; i <= n; i++) {
      const k = (id: string) => (i === 1 ? id : `${id}__${i}`);
      a[k('motorSource')] = src;
      a[k('motorSwitch')] = src === 'bus' ? ['none', 'ds', 'vcb', 'lbs', 'ds-vcb'][i % 5]! : ['none', 'mccb'][i % 2]!;
      a[k('motorCable')] = i % 3 === 0 ? 'no' : 'yes';
      a[k('motorCableInstallation')] = i % 2 === 0 ? 'buried' : 'overhead';
      a[k('motorCableLength')] = 10 + i;
      a[k('motorStartMethod')] = 'スターデルタ始動';
      a[k('motorCapacity')] = 55;
      if (src === 'secondary') a[k('motorSourceTr')] = String(1 + (i % 2));
    }
    return a;
  };
  for (const src of ['bus', 'secondary']) {
    for (const n of [1, 2, 5, 10, 20, 50]) {
      const a = mk(src, n);
      const d = layout(buildComposition(a), a);
      const motors = d.symbols.filter((s) => s.role === 'motor');
      // 向かい側の端末は、180°回して、頂点を上（ケーブル側）に向ける
      const sites = d.symbols.filter((s) => s.role === 'motor-cable-site');
      const bad = motors.length !== n ? `電動機の記号が ${motors.length} 個です（${n}台のはず）` : sites.some((s) => s.rotate !== 180) ? 'ケーブルの向かい側の端末が、回っていません' : new Set(motors.map((m) => Math.round(m.x))).size !== n ? '電動機が、同じ位置に重なっています' : problems(d);
      if (bad) fail(`電動機（${src === 'bus' ? '母線から' : '二次側から'}・${n}台）：${bad}`);
    }
  }
  // 母線から＋二次側からが、混ざっても
  const mixed: Answers = { ...mk('bus', 4), motorSource__2: 'secondary', motorSwitch__2: 'mccb', motorSource__4: 'secondary', motorSwitch__4: 'none', motorSourceTr__4: '2' };
  const dm = layout(buildComposition(mixed), mixed);
  if (dm.symbols.filter((s) => s.role === 'motor').length !== 4 || problems(dm)) fail(`電動機（母線から・二次側からが混ざる）：${problems(dm) || '電動機が4台描かれていません'}`);
  // 変圧器0台の2か所目のエリアに置く電動機
  const area: Answers = { ...answers, mainBreakerForm: 'cb', areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:transformerCount': 0, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried', 'a2:linkSwitch': 'lbs', 'a2:hasMotor': 'yes', 'a2:motorCount': 3, 'a2:motorSource': 'bus', 'a2:motorSwitch': 'ds', 'a2:motorSource__2': 'bus', 'a2:motorSwitch__2': 'ds', 'a2:motorSource__3': 'bus', 'a2:motorSwitch__3': 'ds' };
  const da = layout(buildComposition(area), area);
  if (da.symbols.filter((s) => s.role === 'a2:motor').length !== 3 || problems(da)) fail(`電動機（変圧器0台の2か所目のエリア）：${problems(da) || '電動機が3台描かれていません'}`);
  console.log('  母線から・二次側から・混在・変圧器0台のエリア：1〜50台まで、記号の数のとおりに描かれ、線・文字が重ならない（ケーブルの向かい側の端末は、頂点が上）');
}

/* ---------- GR（無方向性）：ZCTだけ。ZPDは無くてよい。位置の選択肢はDGRと同じ ---------- */
{
  const base: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'no', hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy', mainGroundRelay: 'gr' };
  const wireAtP = (d: ReturnType<typeof layout>, x: number, y: number) => d.wires.some((w) => (Math.abs(w.x2 - x) < 0.5 && Math.abs(w.y2 - y) < 0.5) || (Math.abs(w.x1 - x) < 0.5 && Math.abs(w.y1 - y) < 0.5));
  const problems = (d: ReturnType<typeof layout>) => findLabelCollisions(d).length > 0 ? '文字が重なっています' : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
  for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
    for (const [name, extra] of [['VCB', {}], ['LBS', { mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3 }]] as [string, Answers][]) {
      const a: Answers = { ...base, mainZctPos: pos, ...extra };
      const d = layout(buildComposition(a), a);
      const z = d.symbols.find((s) => s.role === 'main-zct');
      const r = d.symbols.find((s) => s.role === 'main-ground-relay');
      const label = `主遮断装置・GR・ZCT=${pos}・${name}`;
      if (!z || !r || r.symbolId !== 'relay-gr') { fail(`${label}：ZCTまたはGRが描かれていません`); continue; }
      const zSec = portAbs(z, 'sec');
      const rl = portAbs(r, 'l');
      const bad = !wireAtP(d, zSec.x, zSec.y) || !wireAtP(d, rl.x, rl.y) ? 'ZCTとGRが、線でつながっていません' : d.symbols.some((s) => s.symbolId === 'zpd') ? 'ZPDが描かれています' : d.symbols.filter((s) => s.symbolId === 'trip-coil').length !== 1 ? 'TCが1つではありません' : problems(d);
      if (bad) fail(`${label}：${bad}`);
      else console.log(`  ${label}：ZCT＋GR（ZPDなし）、TCは1つ。線・文字が重ならない`);
    }
  }
  for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
    const a: Answers = { ...base, mainGroundRelay: 'none', areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkSwitch': 'ds-vcb', 'a2:linkGroundRelay': 'gr', 'a2:linkZctPos': pos };
    const d = layout(buildComposition(a), a);
    const z = d.symbols.find((s) => s.id === 'a2:sendout-zct');
    const r = d.symbols.find((s) => s.id === 'a2:sendout-ground-relay');
    const t = d.symbols.find((s) => s.id === 'a2:sendout-trip-coil');
    const label = `送り出し・GR・ZCT=${pos}`;
    if (!z || !r || !t || r.symbolId !== 'relay-gr') { fail(`${label}：ZCT・GR・TCのどれかが描かれていません`); continue; }
    const bad = !wireAtP(d, portAbs(z, 'sec').x, portAbs(z, 'sec').y) || !wireAtP(d, portAbs(r, 'l').x, portAbs(r, 'l').y) ? 'ZCTとGRが、線でつながっていません' : problems(d);
    if (bad) fail(`${label}：${bad}`);
    else console.log(`  ${label}：ZCT＋GR＋TC（ZPDなし）。線・文字が重ならない`);
  }
  // 主遮断装置にGR、送り出しの開閉器にDGR
  const mix: Answers = { ...base, hasZpd: 'yes', areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkSwitch': 'vcb', 'a2:linkGroundRelay': 'dgr' };
  const dm = layout(buildComposition(mix), mix);
  const ids = dm.symbols.map((s) => s.symbolId);
  const mbad = !ids.includes('relay-gr') || !ids.includes('relay-dgr') ? 'GRとDGRが両方描かれていません' : problems(dm);
  if (mbad) fail(`GR（主遮断装置）＋DGR（送り出し）：${mbad}`);
  else console.log('  GR（主遮断装置）＋DGR（送り出し）：両方が描かれる。線・文字が重ならない');
}

/* ---------- 主遮断装置がLBSのとき：OCR・DGRの保護継電器とTC ---------- */
{
  const lbs: Answers = { ...answers, mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3, hasLa: 'no', transformerCount: 1, trCapacity: 100, trConnection: 'tr-3p-dy', hasSiteCt: 'yes', hasSiteVt: 'no', relayCount: '1', relayType: 'OCR' };
  for (const [name, extra] of [['OCRだけ', {}], ['OCR＋DGR', { hasZpd: 'yes', mainGroundRelay: 'dgr' }], ['DGRだけ', { relayCount: '0', hasZpd: 'yes', mainGroundRelay: 'dgr' }]] as [string, Answers][]) {
    const a: Answers = { ...lbs, ...extra };
    const d = layout(buildComposition(a), a);
    const tcs = d.symbols.filter((s) => s.symbolId === 'trip-coil');
    const ocr = d.symbols.find((s) => s.symbolId === 'relay-ocr');
    const dashed = d.wires.some((w) => w.dashed);
    const bad = tcs.length !== 1 ? `TCが ${tcs.length}個です（1つのはず）` : !dashed ? 'TCからLBSへ点線がありません' : (name !== 'DGRだけ' && !ocr) ? 'OCRがありません' : findLabelCollisions(d).length > 0 ? '文字が重なっています' : inspectDrawing(fromLayout(d), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0 ? '編集用に取り込むと、問題が出ます' : '';
    if (bad) fail(`LBS（${name}）：${bad}`);
    else console.log(`  LBS（${name}）：継電器 → TC（1つ）→ LBS（点線）。線・文字が重ならない`);
  }
}

/* ---------- 3か所以上のエリア：どのエリアから分岐するか、エリアごとに違ってよい ---------- */
console.log('\n■ 3か所以上のエリアのつなぎ方（1→2→3、1→2と1→3、4か所など）');
{
  const base3: Answers = { ...answers, mainBreakerForm: 'cb', transformerCount: 1 };
  const area = (n: number, from: number, tap = 'bus'): Answers => ({ [`a${n}:areaIntake`]: 'ds-vcb', [`a${n}:trCapacity`]: 100, [`a${n}:linkTap`]: tap, [`a${n}:linkFrom`]: String(from), [`a${n}:linkCableInstallation`]: 'buried', [`a${n}:linkCableCrossSection`]: '38' });
  const cases: [string, Answers][] = [
    ['1→2→3（数珠つなぎ）', { ...base3, areaCount: 3, ...area(2, 1), ...area(3, 2) }],
    ['1→2、1→3（1か所目から2本）', { ...base3, areaCount: 3, ...area(2, 1), ...area(3, 1) }],
    ['1→2、2→3、1→4（遠くへ渡す線を含む）', { ...base3, areaCount: 4, ...area(2, 1), ...area(3, 2, 'ds-vcb'), ...area(4, 1, 'vcb-load') }],
    ['1→2、1→3、1→4（同じ高さから3本）', { ...base3, areaCount: 4, ...area(2, 1), ...area(3, 1), ...area(4, 1) }],
    ['1→2、2→3、2→4、3→5（5か所）', { ...base3, areaCount: 5, ...area(2, 1), ...area(3, 2), ...area(4, 2, 'vcb-load'), ...area(5, 3) }],
    ['2か所目からの送り出しがDS＋VCB（1→2→3）', { ...base3, areaCount: 3, ...area(2, 1), ...area(3, 2), 'a3:linkSwitch': 'ds-vcb' }],
  ];
  for (const [name, a] of cases) {
    const d = layout(buildComposition(a), a);
    const doc = fromLayout(d);
    const bad = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind));
    const idsList = d.symbols.map((s) => s.id);
    const dup = idsList.filter((id, i) => idsList.indexOf(id) !== i);
    // つなぐ先のエリアごとに、ケーブルの縦線が、そのエリアの枠の上端まで来ている
    const frameTops = d.frames.length;
    if (dup.length) fail(`${name}：記号のIDが重なっています（${dup.join(',')}）`);
    else if (bad.length) fail(`${name}：線が記号を突き抜ける・浮く・文字が重なる問題があります（${bad.map((i) => i.message).slice(0, 2).join(' / ')}）`);
    else if (findLabelCollisions(d).length > 0) fail(`${name}：文字が重なっています`);
    else if (frameTops !== (a.areaCount as number)) fail(`${name}：エリアの枠の数が違います（${frameTops}）`);
    else console.log(`  ${name}：エリアの中を横切らず、線・文字が重ならない`);
  }
  const two = cases[5]![1];
  const dTwo = layout(buildComposition(two), two);
  if (!dTwo.symbols.some((s) => s.id === 'a3:sendout-ds') || !dTwo.symbols.some((s) => s.id === 'a3:sendout-vcb')) fail('2か所目からの送り出しの開閉器が描かれていません');
  else console.log('  2か所目から3か所目への送り出しの開閉器（DS＋VCB）も、描かれる');
  // 送り先ごとの開閉器：1か所目から、2か所目へはDS、3か所目へはVCB、と別々に描かれる（第13弾 項目22）
  const per: Answers = { ...base3, areaCount: 3, ...area(2, 1), ...area(3, 1), 'a2:linkSwitch': 'ds', 'a3:linkSwitch': 'vcb', 'a2:linkTap': 'ds-vcb', 'a3:linkTap': 'bus' };
  const dPer = layout(buildComposition(per), per);
  const ids = dPer.symbols.map((s) => s.id).filter((id) => /sendout/.test(id));
  if (ids.join() !== 'a2:sendout-ds,a3:sendout-vcb' && [...ids].sort().join() !== ['a2:sendout-ds', 'a3:sendout-vcb'].join()) fail(`送り先ごとの開閉器（1→2はDS・1→3はVCB）が、別々に描かれていません（${ids.join()}）`);
  else if (findLabelCollisions(dPer).length > 0 || inspectDrawing(fromLayout(dPer), 'A3', 'landscape').filter((i) => ['floating', 'through', 'overlap'].includes(i.kind)).length > 0) fail('送り先ごとの開閉器：文字・線が重なっています');
  else console.log('  1か所目から、2か所目へはDS・3か所目へはVCB：送り先ごとに、別々の開閉器が描かれる。線・文字は重ならない');
}

/* ---------- 手で直した内容は、入力内容を変えても残る ---------- */
console.log('\n■ 手で直した内容を残す（入力内容を変えて作り直しても）');
{
  const a0: Answers = { ...answers, hasLa: 'yes', hasZpd: 'yes', transformerCount: 1, feederCount: 0 };
  const gen = (a: Answers, tag: string) => fromLayout(layout(buildComposition(a), a), `${tag}`);
  const sym = (d: Doc, id: string) => d.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === id);
  const g1 = gen(a0, 'a0');
  const la0 = sym(g1, 'site-la');
  if (!la0) fail('LAのある図面が作れません');
  else {
    // LAだけを、右へ 200 動かして、別の機器を増やす
    const edited: Doc = { ...moveItem(g1, 'site-la', 200, 0), edited: true };
    const a1: Answers = { ...a0, transformerCount: 2, trConnection__2: 'tr-3p-dy' };
    const g2 = gen(a1, 'a1');
    const r = rebuildWithOverrides(g2, edited);
    const laNew = sym(r.doc, 'site-la');
    const laAuto = sym(g2, 'site-la');
    if (!laNew || !laAuto) fail('作り直した図面に、LAがありません');
    else if (Math.abs(laNew.x - (laAuto.x + 200)) > 0.01 || Math.abs(laNew.y - laAuto.y) > 0.01) fail(`LAが、動かした位置のままではありません（自動 ${laAuto.x} → ${laNew.x}、動かした量 200）`);
    else if (!sym(r.doc, 'transformer-2')) fail('入力で増やした変圧器が、図面にありません');
    else if (inspectDrawing(r.doc, 'A3', 'landscape').some((i) => i.kind === 'floating')) fail('作り直したあと、LAにつながる線が浮いています');
    else console.log('  LAを右へ動かして、変圧器を増やしても、LAは動かした位置のまま（変圧器も増える）');
    if (!r.report.kept || r.doc.edited !== true) fail('手で直した印が残っていません');

    // 作り直しを重ねても、位置は変わらない
    const r2 = rebuildWithOverrides(g2, r.doc);
    if (JSON.stringify(r2.doc.items.filter((i) => i.kind === 'symbol').map((i) => [i.id, (i as DocSymbol).x, (i as DocSymbol).y])) !== JSON.stringify(r.doc.items.filter((i) => i.kind === 'symbol').map((i) => [i.id, (i as DocSymbol).x, (i as DocSymbol).y]))) fail('作り直しを重ねたら、位置が変わりました');
    else console.log('  作り直しを重ねても、位置は変わらない');

    // 入力でLAを「なし」にしたら、LAは消え、手直しの記録は取っておく。「あり」に戻すと、動かした位置で戻る
    const aNone: Answers = { ...a1, hasLa: 'no' };
    const gNone = gen(aNone, 'none');
    const rNone = rebuildWithOverrides(gNone, r.doc);
    if (sym(rNone.doc, 'site-la')) fail('LAを「なし」にしたのに、LAが残っています');
    else if (!rNone.doc.overrides?.moved['site-la'] || rNone.report.dormant < 1) fail('LAの手直しの記録が、取ってありません');
    else {
      const rBack = rebuildWithOverrides(gen(a1, 'a1'), rNone.doc);
      const laBack = sym(rBack.doc, 'site-la');
      const auto = sym(g2, 'site-la');
      if (!laBack || !auto || Math.abs(laBack.x - (auto.x + 200)) > 0.01) fail('LAを「あり」に戻したら、動かした位置で戻るはずが、違います');
      else console.log('  LAを「なし」にするとLAは消え、「あり」に戻すと、動かした位置で戻る');
    }

    // 手で消した機器は、入力が変わっても消えたまま。手で足したメモは、近くの機器についていく
    const noZpd = removeItem(g1, 'zpd');
    const memo = addText(noZpd, (sym(g1, 'transformer')?.x ?? 0) + 20, (sym(g1, 'transformer')?.y ?? 0) + 20, 'メモ');
    const edited2: Doc = { ...memo.doc, edited: true };
    const r3 = rebuildWithOverrides(g2, edited2);
    const t = r3.doc.items.find((it) => it.kind === 'text' && it.lines[0] === 'メモ');
    const tr1 = sym(r3.doc, 'transformer-1');
    const tr1g = sym(g1, 'transformer');
    if (sym(r3.doc, 'zpd')) fail('手で消したZPDが、作り直しで戻ってしまいました');
    else if (!t || t.kind !== 'text' || !tr1 || !tr1g) fail('手で足したメモが、作り直したあとにありません');
    else if (Math.abs(t.x - (tr1.x + 20)) > 0.5 || Math.abs(t.y - (tr1.y + 20)) > 0.5) fail('メモが、近くの機器についていっていません');
    else console.log('  手で消したZPDは消えたまま、手で足したメモは、近くの変圧器についていく');

    // 手で直していない図面は、これまでどおり、作り直すだけ
    const r4 = rebuildWithOverrides(g2, g1);
    if (r4.report.kept || r4.doc.edited) fail('手で直していない図面に、手で直した印がつきました');
    else console.log('  手で直していない図面は、そのまま作り直すだけ');
  }
}
