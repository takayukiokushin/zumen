/**
 * 図面の検証（check-drawing）の1つ目：取り込み・記号を動かす・差し替え・消す・段ぞろえ・配置・図面を整える・PAS内蔵品 など。
 * 共有するものは common.ts。scripts/check-drawing.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { applyAnchors, descendantsOf, digest, groupRootOf, removeItem, addWire, assistMove, assistPoint, assistWireNew, fromLayout, moveItem, portsOf, replaceSymbol, tidyDoc } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocWire } from '../../apps/web/src/editor/doc.ts';
import { buildComposition } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { rotatedBox, findLabelCollisions, layout } from '../../packages/layout/src/index.ts';
import { getSymbol as getSymbolDef } from '../../packages/symbols/src/index.ts';
import { chooseSheet, inspectDrawing, tidyDrawing } from '../../apps/web/src/editor/inspect.ts';
import { portY, fail, answers, spreadUnits, answersSpread, build, wires, symbols, worstGap, skewed, anchoredEnds } from './common.ts';

/* ---------- 1. 取り込んだ時点でつながっているか ---------- */
console.log('■ 取り込み');
export const base = build();
console.log(`  記号 ${symbols(base).length}個 / 線 ${wires(base).length}本 / つないである端 ${anchoredEnds(base)}箇所`);
if (anchoredEnds(base) === 0) fail('線がどの接続点にもつながっていません');
if (worstGap(base) !== 0) fail(`取り込んだ時点で ${worstGap(base)} のずれがあります`);
if (skewed(base) !== 0) fail(`取り込んだ時点で斜めの線が ${skewed(base)}本あります`);

/* 整えるのが何度やっても同じ結果になるか（印刷のたびに形が変わらない） */
const once = tidyDoc(base);
const twice = tidyDoc(once);
if (JSON.stringify(once) !== JSON.stringify(twice)) fail('「結線を整える」を2回かけると結果が変わります');
else console.log('  「結線を整える」は何度かけても同じ結果になりました');

/* ---------- 2. 動かしても離れないか ---------- */
console.log('\n■ 記号を動かす');
const tr = symbols(base).find((s) => s.symbolId.startsWith('tr-'));
if (!tr) fail('変圧器が見つかりません');
else {
  // 半端な量で何度も動かす。丸め誤差が溜まると、ここでずれが出る
  let d = base;
  const steps: [number, number][] = [
    [13.5, -7.25], [-21.75, 33.5], [48, 0], [0, -62.5], [-39.75, 19.25], [7.5, 7.5],
  ];
  for (const [dx, dy] of steps) d = moveItem(d, tr.id, dx, dy);
  const gap = worstGap(d);
  if (gap !== 0) fail(`6回動かしたあと、線の端が接続点から ${gap} ずれました`);
  else console.log('  6回動かしても、線の端は接続点の真上のまま（ずれ 0）');

  // 片側が自由な線は、まっすぐのまま伸び縮みする
  const before = skewed(base);
  const after = skewed(d);
  if (after > before) fail(`動かしたあと斜めの線が ${after - before}本増えました`);
  else console.log(`  斜めになった線はありません（${after}本）`);

  // 動かした記号につながる線が、ちゃんと追いかけてきたか
  const movedTr = symbols(d).find((s) => s.id === tr.id)!;
  if (movedTr.x === tr.x && movedTr.y === tr.y) fail('記号が動いていません');
  const attached = wires(d).filter((w) => w.at1?.item === tr.id || w.at2?.item === tr.id);
  if (attached.length === 0) fail('変圧器につながっている線がありません');
  else console.log(`  変圧器につながる ${attached.length}本の線が一緒に動きました`);
}

/* ---------- 3. まっすぐになる位置に吸い寄せるか ---------- */
console.log('\n■ 動かすときの手助け');
// 上下を別の記号につながれている機器（主回路に直列に入っているもの）で試す。
// 横にずらすと線が斜めになるので、まっすぐに戻る位置へ吸い寄せられるはず
const inline = symbols(base).find((s) =>
  wires(base).some((w) => {
    const [a, b] = [w.at1, w.at2];
    return (a?.item === s.id && b && b.item !== s.id) || (b?.item === s.id && a && a.item !== s.id);
  }),
);
if (!inline) fail('上下を別の記号につないである機器が見つかりません');
else {
  const off = moveItem(base, inline.id, 30, 0);
  if (skewed(off) === 0) fail('横にずらしても線が斜めになりませんでした（試験の前提が崩れています）');

  const a = assistMove(off, inline.id, -27.2, 0);
  if (Math.abs(a.dx - -30) > 1e-9) fail(`まっすぐになる位置に吸い寄せられませんでした（${a.dx}）`);
  else console.log(`  2.8ずれた位置を指しても、まっすぐ揃う位置（${a.dx}）に吸い付きました`);
  if (a.guideX === undefined) fail('目安の線の位置が返りませんでした');
  else console.log(`  目安の線は x=${a.guideX} に出ます`);

  // 吸い寄せたあとは、本当にまっすぐに戻っているか
  const back = moveItem(off, inline.id, a.dx, a.dy);
  if (skewed(back) !== 0) fail(`吸い寄せたのに斜めの線が ${skewed(back)}本 残りました`);
  else console.log('  吸い寄せた位置に置くと、斜めの線は無くなりました');

  // 遠いところを指しているときは、手助けしない
  const far = assistMove(off, inline.id, -5, 0);
  if (Math.abs(far.dx - -30) < 1e-9) fail('離れた位置なのに吸い寄せてしまいました');
  else console.log(`  離れた位置（${far.dx}）では吸い寄せませんでした`);
}

/* ---------- 3b. 線を引くときの手助け（吸い付くが、離せば突き抜けられる） ---------- */
console.log('\n■ 線を引くときの手助け');
{
  const wire = (id: string, x1: number, y1: number, x2: number, y2: number): DocWire => ({ kind: 'wire', id, x1, y1, x2, y2 });
  // 横線 w1（x 0〜100、y=0）と、縦線 w2（x=50、y -40〜-10）だけの図面
  const mini: Doc = { ...base, items: [wire('w1', 0, 0, 100, 0), wire('w2', 50, -40, 50, -10)] };
  const ok = (cond: boolean, okMsg: string, ngMsg: string) => (cond ? console.log(`  ${okMsg}`) : fail(ngMsg));

  const e = assistPoint(mini, 103, 3);
  ok(e.kind === 'end' && e.x === 100 && e.y === 0, '始点：線の端の近くを指すと、その端に吸い付く', `線の端に吸い付きません（${JSON.stringify(e)}）`);
  const onw = assistPoint(mini, 62, 4);
  ok(onw.kind === 'wire' && onw.y === 0 && onw.x === 62, '始点：線の途中を指すと、線の上（ずれない位置）に吸い付く（枝分かれ）', `線の上に吸い付きません（${JSON.stringify(onw)}）`);
  const far = assistPoint(mini, 200, 200);
  ok(far.kind === 'grid', '始点：何も近くになければ、格子に合わせるだけ', `遠いのに吸い付きました（${JSON.stringify(far)}）`);

  // 縦の線を、横線 w1 に向けて引く：近づくと、ちょうど線の上で止まる
  const stop = assistWireNew(mini, 30, -50, 30, -3);
  ok(stop.kind === 'wire' && stop.x === 30 && stop.y === 0, '終点：横線の近くまで引くと、横線の上でぴったり止まる（はみ出さない）', `横線の上で止まりません（${JSON.stringify(stop)}）`);
  // 突き抜けたいときは、離せばよい（範囲の外なら、吸い付かない）
  const through = assistWireNew(mini, 30, -50, 30, 15);
  ok(through.kind === 'grid' && through.y > 0, '終点：吸い付く範囲より先まで引けば、横線を突き抜けて引ける', `突き抜けられません（${JSON.stringify(through)}）`);
  // 横の線を、縦線 w2 に向けて引く
  const stopV = assistWireNew(mini, 0, -25, 47, -25);
  ok(stopV.kind === 'wire' && stopV.x === 50, '終点：縦線の近くまで引くと、縦線のところで止まる', `縦線で止まりません（${JSON.stringify(stopV)}）`);
  const missV = assistWireNew(mini, 0, -60, 47, -60);
  ok(missV.kind !== 'wire', '終点：縦線の長さの範囲の外では、吸い付かない', `範囲の外なのに吸い付きました（${JSON.stringify(missV)}）`);
  // 線の端に向けて引く
  const toEnd = assistWireNew(mini, 150, 0, 103, 0);
  ok(toEnd.kind === 'end' && toEnd.x === 100, '終点：既存の線の端の近くまで引くと、端に吸い付く', `線の端に吸い付きません（${JSON.stringify(toEnd)}）`);
  // 揃う位置
  const al = assistWireNew(mini, 0, -80, 103, -80);
  ok(al.kind === 'align' && al.x === 100 && al.guideX === 100, '終点：線の端と、たてが揃う位置に、目安の線つきで吸い付く', `揃う位置に吸い付きません（${JSON.stringify(al)}）`);

  // addWire：吸い付きあり／なし（Alt キー）
  const withA = addWire(mini, 103, 3, 140, 3).doc.items.find((i) => i.kind === 'wire' && i.id !== 'w1' && i.id !== 'w2') as DocWire;
  ok(withA && withA.x1 === 100 && withA.y1 === 0, '線を追加：始点が、線の端にぴったり合う', `始点が合いません（${JSON.stringify(withA)}）`);
  const noA = addWire(mini, 103, 3, 140, 3, { assist: false }).doc.items.find((i) => i.kind === 'wire' && i.id !== 'w1' && i.id !== 'w2') as DocWire;
  ok(noA && noA.x1 === 104 && noA.y1 === 4, '線を追加（Altキーを押しながら）：吸い付かず、格子に合わせるだけ', `吸い付かない指定なのに吸い付きました（${JSON.stringify(noA)}）`);

  // 平行な線と、同じ長さ（前に引いた線と、長さをそろえて並べる）
  const len = assistWireNew(mini, 30, 20, 127, 20);
  ok(len.kind === 'align' && len.x === 130 && len.guideX === 130, '終点：平行な線（長さ100）と同じ長さになる位置に、目安の線つきで吸い付く', `同じ長さの位置に吸い付きません（${JSON.stringify(len)}）`);
  const lenL = assistWireNew(mini, 230, 20, 133, 20);
  ok(lenL.kind === 'align' && lenL.x === 130, '終点：左向きに引くときも、同じ長さの位置に吸い付く', `左向きで吸い付きません（${JSON.stringify(lenL)}）`);
  const lenFar = assistWireNew(mini, 30, 20, 150, 20);
  ok(lenFar.kind !== 'align' || lenFar.x !== 130, '終点：同じ長さから遠いときは、吸い付かない', `遠いのに吸い付きました（${JSON.stringify(lenFar)}）`);

  // 既存の線を動かすとき
  const m1: Doc = { ...mini, items: [...mini.items, wire('m1', 200, 40, 260, 40)] };
  const mvH = assistMove(m1, 'm1', 0, -37, 10);
  ok(mvH.dy === -40 && mvH.guideY === 0, '線を動かす：平行な線（高さ0）と、同じ高さに並ぶ位置に吸い付く', `同じ高さに吸い付きません（${JSON.stringify(mvH)}）`);
  const mvFar = assistMove(m1, 'm1', 0, -25, 10);
  ok(mvFar.dy !== -40, '線を動かす：離れているときは、吸い付かない（わざとずらして置ける）', `離れているのに吸い付きました（${JSON.stringify(mvFar)}）`);
  const m2: Doc = { ...mini, items: [...mini.items, wire('m2', 100, -25, 160, -25)] };
  const mvE = assistMove(m2, 'm2', -47, 0, 10);
  ok(mvE.dx === -50 && mvE.guideX === 50, '線を動かす：線の端が、縦線の上に乗る位置に吸い付く（枝分かれ・止まる）', `縦線の上に吸い付きません（${JSON.stringify(mvE)}）`);

  // 記号を動かすとき、ほかの線と揃う位置にも吸い付く
  const sym = symbols(base).find((s) => portsOf(s).length > 0)!;
  const p0 = portsOf(sym)[0]!;
  const withV: Doc = { ...mini, items: [...base.items, wire('wx', p0.x + 6, p0.y - 500, p0.x + 6, p0.y + 500)] };
  const mv = assistMove(withV, sym.id, 5.5, 0);
  ok(Math.abs(mv.dx - 6) < 1e-9 && mv.guideX === p0.x + 6, '記号を動かす：近くの縦線と、たてが揃う位置に吸い付く', `縦線と揃いません（${JSON.stringify(mv)}）`);
}

/* ---------- 3c. 用紙の大きさと向きは、図面の大きさから自動で決まる ---------- */
console.log('\n■ 用紙の自動選び');
{
  const title = { site: '山田工場', name: 'キュービクル式高圧受電設備単線結線図' };
  const wireDoc = (x2: number, y2: number): Doc => ({ ...base, items: [{ kind: 'wire', id: 'w', x1: 0, y1: 0, x2, y2 }] });
  const ok = (cond: boolean, okMsg: string, ngMsg: string) => (cond ? console.log(`  ${okMsg}`) : fail(ngMsg));
  const c0 = chooseSheet(base, title);
  ok(c0.paper === 'A4' && c0.orientation === 'portrait' && c0.scale >= 0.8, `ふつうの図面は、A4の縦（倍率 ${c0.scale.toFixed(2)}）`, `ふつうの図面が A4縦になりません（${JSON.stringify(c0)}）`);
  const wide = chooseSheet(wireDoc(900, 0), title);
  ok(wide.paper === 'A4' && wide.orientation === 'landscape', `横に長い図面は、A4の横（倍率 ${wide.scale.toFixed(2)}）`, `横に長いのに A4横になりません（${JSON.stringify(wide)}）`);
  const tall = chooseSheet(wireDoc(0, 1300), title);
  ok(tall.paper === 'A3' && tall.scale >= 0.8, `A4に収まらない大きな図面は、A3（${tall.orientation === 'portrait' ? '縦' : '横'}・倍率 ${tall.scale.toFixed(2)}）`, `大きな図面が A3 になりません（${JSON.stringify(tall)}）`);
  const huge = chooseSheet(wireDoc(0, 6000), title);
  ok(huge.paper === 'A3' && huge.scale < 0.8, `どの用紙でも収まらないときは、いちばん大きく出せる用紙（A3・倍率 ${huge.scale.toFixed(2)}）`, `収まらない図面の用紙がおかしい（${JSON.stringify(huge)}）`);
  // 利用者が向きを選んだとき：その向きだけで決める（図面の形に合わせた自動の向きとは逆でも、そのとおりになる）
  const forcedP = chooseSheet(wireDoc(900, 0), title, 'portrait');
  const forcedL = chooseSheet(base, title, 'landscape');
  ok(forcedP.orientation === 'portrait' && forcedL.orientation === 'landscape', '向きを選ぶと、その向きになる（横長の図面を縦に、ふつうの図面を横に）', `選んだ向きにならない（${JSON.stringify([forcedP, forcedL])}）`);
  // 用紙の名前（A3・A4）を、図面の指摘に出さない
  const paperMsgs = [wireDoc(0, 6000), wireDoc(900, 0), wireDoc(3000, 3000)]
    .flatMap((d) => inspectDrawing(d, 'A3', 'portrait').filter((i) => i.kind === 'paper').map((i) => i.message));
  ok(paperMsgs.length > 0 && paperMsgs.every((m) => !/A[34]/.test(m)), '大きすぎる図面の指摘に、用紙の名前（A3・A4）が出ない', `指摘に用紙の名前が出ています（${paperMsgs.join(' / ')}）`);
}

/* ---------- 4. 記号を差し替えると線が伸縮するか ---------- */
console.log('\n■ 記号の差し替え');
const vcb = symbols(base).find((s) => s.symbolId === 'vcb');
if (!vcb) fail('VCBが見つかりません');
else {
  const keyPortBefore = portsOf(vcb)[0]!;
  const attachedBefore = wires(base).filter((w) => w.at1?.item === vcb.id || w.at2?.item === vcb.id);
  const lenBefore = attachedBefore.map((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1));

  const swapped = replaceSymbol(base, vcb.id, 'lbs-pf');
  const after = symbols(swapped).find((s) => s.id === vcb.id)!;
  if (after.symbolId !== 'lbs-pf') fail('記号が差し替わっていません');

  const keyPortAfter = portsOf(after)[0]!;
  const moved = Math.hypot(keyPortAfter.x - keyPortBefore.x, keyPortAfter.y - keyPortBefore.y);
  if (moved !== 0) fail(`差し替えで引込側の接続点が ${moved} 動きました`);
  else console.log('  引込側の接続点は、その場から動きませんでした');

  const attachedAfter = wires(swapped).filter((w) => w.at1?.item === vcb.id || w.at2?.item === vcb.id);
  if (attachedAfter.length !== attachedBefore.length) {
    fail(`結線の本数が ${attachedBefore.length}→${attachedAfter.length} に変わりました`);
  } else {
    console.log(`  つながっていた ${attachedAfter.length}本の線はそのまま残りました`);
  }
  if (worstGap(swapped) !== 0) fail(`差し替えのあと ${worstGap(swapped)} のずれがあります`);
  if (skewed(swapped) > skewed(base)) fail('差し替えで斜めの線ができました');

  const lenAfter = attachedAfter.map((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1));
  const stretched = lenBefore.some((l, i) => Math.abs(l - (lenAfter[i] ?? l)) > 1e-9);
  console.log(`  線の長さ: ${lenBefore.map((l) => l.toFixed(1)).join(' / ')} → ${lenAfter.map((l) => l.toFixed(1)).join(' / ')}`);
  if (!stretched) console.log('  （大きさが同じ記号だったため、伸縮はありませんでした）');
  else console.log('  記号の大きさに合わせて、前後の線が自動で伸縮しました');
}

/* ---------- 5. 「90度回す」は無い。ただし、自動で回して置いた記号（PFなど）の向きは、図面に残る ---------- */
console.log('\n■ 記号の向き（自動で置いた向きは、そのまま保たれる）');
{
  const rotated = symbols(base).filter((s) => s.rotate !== 0);
  const generated = layout(buildComposition(answersSpread), answersSpread).symbols.filter((s) => s.rotate !== 0);
  if (rotated.length !== generated.length || rotated.some((s, i) => s.rotate !== generated[i]!.rotate)) {
    fail('編集用の図面に取り込んだとき、記号の向きが変わっています');
  } else console.log(`  回して置いた記号 ${rotated.length}個の向きが、自動レイアウトのまま`);
}

/* ---------- 6. 記号を消したときの後始末 ---------- */
console.log('\n■ 記号を消す');
if (tr) {
  const d = applyAnchors({ items: base.items.filter((i) => i.id !== tr.id) });
  const dangling = wires(d).filter((w) => w.at1?.item === tr.id || w.at2?.item === tr.id);
  if (dangling.length) fail(`消した記号へのつなぎ先が ${dangling.length}箇所 残っています`);
  else console.log('  消した記号へのつなぎ先は、きちんと外れました');
}

/* ---------- 7. PASのように中に部品を抱えている記号 ---------- */
console.log('\n■ 内蔵品をひとかたまりで扱う');
// 内蔵機器が入るときは枠を広げた pas-builtin になる。どちらもPASとして扱う
const pas = symbols(base).find((s) => s.symbolId === 'pas' || s.symbolId === 'pas-builtin');
if (!pas) fail('PASが見つかりません');
else {
  const kids = descendantsOf(base, pas.id);
  if (kids.length === 0) fail('PASに内蔵品（ZCT・VT・LA）がありません');
  else {
    const names = symbols(base)
      .filter((s) => kids.includes(s.id))
      .map((s) => s.symbolId);
    console.log(`  PASの中身: ${names.join(' / ')}（${kids.length}個）`);
  }

  // 中の部品を指しても、かたまりの外側（PAS）が選ばれる
  for (const k of kids) {
    if (groupRootOf(base, k) !== pas.id) fail(`${k} のかたまりの外側がPASになっていません`);
  }

  // 動かすと、中身も同じだけ動く
  const before = symbols(base).filter((s) => kids.includes(s.id)).map((s) => ({ id: s.id, x: s.x, y: s.y }));
  const movedDoc = moveItem(base, pas.id, 24, -16);
  let allMoved = true;
  for (const b of before) {
    const after = symbols(movedDoc).find((s) => s.id === b.id)!;
    if (after.x - b.x !== 24 || after.y - b.y !== -16) allMoved = false;
  }
  if (!allMoved) fail('PASを動かしても、内蔵品がついてきませんでした');
  else console.log(`  PASを動かすと、内蔵品 ${kids.length}個 も同じだけ動きました`);
  if (worstGap(movedDoc) !== 0) fail(`PASを動かしたあと ${worstGap(movedDoc)} のずれがあります`);

  // 消すと、中身も一緒に消える
  const cut = removeItem(base, pas.id);
  const leftovers = symbols(cut).filter((s) => kids.includes(s.id) || s.id === pas.id);
  if (leftovers.length > 0) fail(`PASを消したのに ${leftovers.map((s) => s.symbolId).join('・')} が残りました`);
  else console.log('  PASを消すと、内蔵品も一緒に消えました');

  // スロットの無い記号に差し替えると、中身も一緒に消える
  const swapped = replaceSymbol(base, pas.id, 'lbs-pf');
  const orphans = symbols(swapped).filter((s) => kids.includes(s.id));
  if (orphans.length > 0) fail(`スロットの無い記号に差し替えたのに ${orphans.length}個 残りました`);
  else console.log('  スロットの無い記号に差し替えると、内蔵品も一緒に消えました');
}

/* ---------- 8. 並列の段ぞろえ ---------- */
console.log('\n■ 段ぞろえ（変圧器・コンデンサの高さ）');
{
  const common: Answers = spreadUnits({
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
    transformerCount: 3, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
    hasCapacitor: 'yes', capacitorCount: 2, hasReactor: 'yes',
  });

  /** 同じ記号が、どの列でも同じ高さに来ているか */
  const sameY = (a: Answers, symbolId: string): { ys: number[]; ok: boolean } => {
    const d = layout(buildComposition(a), a);
    const ys = d.symbols.filter((s) => s.symbolId === symbolId).map((s) => s.y);
    return { ys, ok: new Set(ys).size <= 1 };
  };

  const cases: [string, Answers][] = [
    ['前置きなし', { ...common }],
    ['Trの前にPC・SCの前にLBS＋VCS', { ...common, trHasPc: 'yes', capHasLbs: 'yes', capHasVcs: 'yes' }],
    ['Trの前にLBS・SCの前にPC', { ...common, trHasLbs: 'yes', capHasPc: 'yes' }],
  ];
  for (const [name, a] of cases) {
    const tr = sameY(a, 'tr-3p-dy');
    const sc = sameY(a, 'sc');
    if (!tr.ok) fail(`${name}：変圧器の高さが揃っていません（${tr.ys.join(' / ')}）`);
    if (!sc.ok) fail(`${name}：コンデンサの高さが揃っていません（${sc.ys.join(' / ')}）`);
    // 変圧器とコンデンサは同じ段なので、同じ高さに来る
    if (tr.ok && sc.ok && tr.ys[0] !== sc.ys[0]) {
      fail(`${name}：変圧器(${tr.ys[0]})とコンデンサ(${sc.ys[0]})の高さが違います`);
    }
    if (tr.ok && sc.ok && tr.ys[0] === sc.ys[0]) {
      console.log(`  ${name}：変圧器3台とコンデンサ2台が、すべて y=${tr.ys[0]} に揃いました`);
    }
  }

  // 前置き機器そのものも、列をまたいで揃っているか
  const mixed: Answers = { ...common, trHasPc: 'yes', capHasPc: 'yes' };
  const pc = sameY(mixed, 'pc');
  if (!pc.ok) fail(`PCの高さが揃っていません（${pc.ys.join(' / ')}）`);
  else console.log(`  変圧器側とコンデンサ側のPC ${pc.ys.length}個 も y=${pc.ys[0]} に揃いました`);
}

/* 手前の開閉器（PC・LBS）が1つだけの列は、PCの段にそろえる */
console.log('\n■ 変圧器の手前の開閉器（PC・LBS）の高さ');
{
  const base: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
    trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
  };
  const pos = (a: Answers) => {
    const d = layout(buildComposition(a), a);
    const ys = (role: string) => d.symbols.filter((s) => s.role === role).map((s) => Math.round(s.y));
    return { pc: ys('tr-pc'), lbs: ys('tr-lbs'), tr: ys('transformer') };
  };
  const mixed = pos({ ...base, transformerCount: 3, trHasPc: 'yes', trHasLbs: 'no', trHasPc__2: 'no', trHasLbs__2: 'yes', trHasPc__3: 'no', trHasLbs__3: 'no' });
  if (mixed.pc[0] !== mixed.lbs[0]) fail(`PCの列とLBSの列で、開閉器の高さが違います（PC ${mixed.pc[0]} / LBS ${mixed.lbs[0]}）`);
  else console.log(`  1台目PC・2台目LBS・3台目なし：PCもLBSも y=${mixed.pc[0]} に揃いました`);
  if (new Set(mixed.tr).size !== 1) fail(`変圧器の高さが揃っていません（${mixed.tr.join(' / ')}）`);
  const onlyLbs = pos({ ...base, transformerCount: 2, trHasLbs: 'yes' });
  const onlyPc = pos({ ...base, transformerCount: 2, trHasPc: 'yes' });
  if (onlyLbs.lbs[0] !== onlyPc.pc[0]) fail(`LBSだけの図とPCだけの図で、開閉器の高さが違います（${onlyLbs.lbs[0]} / ${onlyPc.pc[0]}）`);
  else console.log(`  LBSだけの図も、PCだけの図も、開閉器は y=${onlyPc.pc[0]}`);
  // 2つ入る列（PC→LBS）は、これまでどおり PC が上・LBS が下
  const both = pos({ ...base, transformerCount: 2, trHasPc: 'yes', trHasLbs: 'yes', trHasPc__2: 'no', trHasLbs__2: 'yes' });
  if (!(both.pc[0]! < both.lbs[0]!)) fail(`PCとLBSが2つ入る列で、PCがLBSの上にありません（PC ${both.pc[0]} / LBS ${both.lbs[0]}）`);
  else if (both.lbs[1] !== both.pc[0]) fail(`2台目のLBSだけの列が、PCの段にそろっていません（${both.lbs[1]} / ${both.pc[0]}）`);
  else console.log(`  1台目がPC＋LBS・2台目がLBSだけ：2台目のLBSは、1台目のPCの高さ（y=${both.pc[0]}）にそろった`);
  // 手前に何も無い図は、変圧器が上に来る（1段ぶん縦に短くなる）
  const none = pos({ ...base, transformerCount: 2 });
  if (!(onlyLbs.tr[0]! >= none.tr[0]!)) fail('開閉器のある図の変圧器が、無い図より上にあります');
}

/* 縦のバランス：母線は手前の分岐から離れ、DS・VT・VCBの間は間延びしない */
console.log('\n■ 縦方向のバランス（母線と手前の機器の間隔、DS・VT・VCBの間隔）');
{
  const base: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 400A',
    hasSiteCt: 'yes', ctRatio: '100/5A', hasZpd: 'yes', hasLa: 'yes',
    trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
  };
  const bottomOf = (s: { symbolId: string; y: number; rotate: number }) => {
    const rb = rotatedBox(getSymbolDef(s.symbolId).box, s.rotate);
    return s.y + rb.dy + rb.h;
  };
  for (const [name, a] of [
    ['変圧器2台（母線あり）', { ...base, transformerCount: 2 }],
    ['変圧器3台・PCあり', { ...base, transformerCount: 3, trHasPc: 'yes' }],
  ] as [string, Answers][]) {
    const d = layout(buildComposition(a), a);
    // 高圧母線＝いちばん長い横線（変圧器の列をつなぐ線）
    const bus = d.wires.filter((w) => w.y1 === w.y2).sort((p, q) => Math.abs(q.x2 - q.x1) - Math.abs(p.x2 - p.x1))[0];
    if (!bus) {
      fail(`${name}：高圧母線が見つかりません`);
      continue;
    }
    const above = d.symbols.filter((s) => ['zpd', 'ovgr', 'relay', 'relay-tt', 'trip-coil', 'site-la', 'ct', 'ds-vt-pf', 'ds-vt'].includes(s.role));
    const tight = above.filter((s) => bottomOf(s) > bus.y1 - 12);
    if (tight.length) fail(`${name}：母線(y=${Math.round(bus.y1)})に近すぎる記号があります（${tight.map((s) => `${s.role} 下端${Math.round(bottomOf(s))}`).join('、')}）`);
    else console.log(`  ${name}：母線と、その手前の機器（ZPD・OCR・試験端子・LA）の下端が、12以上離れている`);
  }
  // DS → VT → VCB は、VTの文字が横に書かれるので、間延びしない
  {
    const a: Answers = { ...base, transformerCount: 1 };
    const d = layout(buildComposition(a), a);
    const ds = d.symbols.find((s) => s.role === 'ds');
    const vcb = d.symbols.find((s) => s.role === 'main-breaker');
    const vt = d.symbols.find((s) => s.role === 'ds-vt');
    if (!ds || !vcb || !vt) fail('DS・VT・VCBが見つかりません');
    else {
      const gap = vcb.y - (ds.y + getSymbolDef('ds').box.h);
      if (gap > 64) fail(`DSの出口からVCBまでが ${Math.round(gap)} あります（64以下のはず）`);
      else console.log(`  DSの出口からVCBの入口まで ${Math.round(gap)}（VTの分岐を含む）`);
      if (vt.labelAt.anchor !== 'start' || vt.labelAt.x < vt.x + getSymbolDef(vt.symbolId).box.w) fail('VT＋PFの文字が、VTの右横にありません');
    }
  }
}

/* 励磁突入電流抑制開閉器：VCBの横に並列。上と下を、主回路につなぐ */
console.log('\n■ 励磁突入電流抑制開閉器（VCBと並列）');
{
  const base: Answers = {
    ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 600A', hasSiteCt: 'yes', ctRatio: '300A/5A',
    hasInrush: 'yes', inrushRatedVoltage: '7200', inrushRatedCurrent: 200, inrushFuseCount: 3, inrushFuseSpec: '7200V G75A 40kA',
    transformerCount: 1, feederCount: 0, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no', hasZpd: 'no', hasLa: 'no',
  };
  const check = (name: string, a: Answers) => {
    const d = layout(buildComposition(a), a);
    const sym = (role: string) => d.symbols.find((s) => s.role === role);
    const vcb = sym('main-breaker');
    const inr = sym('inrush-lbs');
    if (!vcb || !inr) {
      fail(`${name}：VCBまたは励突抑制開閉器が描かれていません`);
      return;
    }
    // 入口・出口の高さが、VCBとそろっている
    const defV = getSymbolDef(vcb.symbolId);
    const defI = getSymbolDef(inr.symbolId);
    const inV = vcb.y + defV.ports.find((p) => p.id === 'in')!.y;
    const outV = vcb.y + defV.ports.find((p) => p.id === 'out')!.y;
    const inI = inr.y + defI.ports.find((p) => p.id === 'in')!.y;
    const outI = inr.y + defI.ports.find((p) => p.id === 'out')!.y;
    if (Math.abs(inV - inI) > 0.5 || Math.abs(outV - outI) > 0.5) fail(`${name}：励突抑制開閉器の入口・出口の高さが、VCBとそろっていません（VCB ${inV}→${outV} / 励突 ${inI}→${outI}）`);
    // VCBの左に離れて並ぶ
    const right = inr.x + defI.box.w;
    if (!(right < vcb.x - 10)) fail(`${name}：励突抑制開閉器が、VCBの左に離れていません`);
    // 上と下を、主回路につなぐ線がある（真横→真縦）
    const cx = inr.x + defI.ports.find((p) => p.id === 'in')!.x;
    const hasWire = (x1: number, y1: number, x2: number, y2: number) =>
      d.wires.some((w) => Math.abs(Math.min(w.x1, w.x2) - Math.min(x1, x2)) < 0.5 && Math.abs(Math.max(w.x1, w.x2) - Math.max(x1, x2)) < 0.5 && Math.abs(Math.min(w.y1, w.y2) - Math.min(y1, y2)) < 0.5 && Math.abs(Math.max(w.y1, w.y2) - Math.max(y1, y2)) < 0.5);
    const up = inV - 8;
    const down = outV + 8;
    const spine = vcb.x + defV.ports.find((p) => p.id === 'in')!.x;
    if (!(hasWire(spine, up, cx, up) && hasWire(cx, up, cx, inI) && hasWire(cx, outI, cx, down) && hasWire(cx, down, spine, down))) fail(`${name}：励突抑制開閉器の上下を主回路につなぐ線が、そろっていません`);
    // 文字・記号の重なり、編集用に取り込んだときの問題
    const cols = findLabelCollisions(d);
    const issues = inspectDrawing(fromLayout(d), 'A4', 'portrait');
    if (cols.length || issues.length) fail(`${name}：文字の重なり${cols.length}件／図面の問題${issues.length}件`);
    else console.log(`  ${name}：VCBの左に並列（入口 y=${Math.round(inI)}・出口 y=${Math.round(outI)} がVCBと同じ）、上下を主回路へ。重なりなし`);
  };
  check('CB形・変圧器1台', base);
  check('ZPD：DSとVCBの間／LA：VCBとCTの間', { ...base, hasZpd: 'yes', hasLa: 'yes', zpdTap: 'ds-vcb', laTap: 'vcb-ct' });
  check('変圧器2台・ZPD・LA（既定の位置）', { ...base, transformerCount: 2, trCapacity: 100, hasZpd: 'yes', hasLa: 'yes' });
  // 「なし」のときは、描かない（これまでと同じ）
  const none = layout(buildComposition({ ...base, hasInrush: 'no' }), { ...base, hasInrush: 'no' });
  if (none.symbols.some((s) => s.role === 'inrush-lbs')) fail('「なし」なのに、励突抑制開閉器が描かれています');
}

/* ZPD・LAは、別々の記号で、選んだ位置に描かれる。母線や他の記号に重ならない */
console.log('\n■ ZPD・LAの位置（別々の記号・母線に重ならない）');
{
  const base: Answers = {
    ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 400A', hasSiteCt: 'yes', ctRatio: '100/5A',
    hasZpd: 'yes', hasLa: 'yes', transformerCount: 2, trConnection: 'tr-3p-yd', trCapacity: 100, feederCount: 0, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no',
  };
  const at = (a: Answers) => {
    const d = layout(buildComposition(a), a);
    const y = (role: string) => d.symbols.find((s) => s.role === role)?.y;
    return { d, ds: y('ds'), vcb: y('main-breaker'), ct: y('ct'), zpd: y('zpd'), la: y('site-la'), ovgr: y('ovgr') };
  };
  const dflt = at(base);
  const moved = at({ ...base, zpdTap: 'ds-vcb', laTap: 'vcb-ct' });
  // 別々の記号：ZPDとLAの文字がそれぞれ別、位置も別
  const labels = (d: ReturnType<typeof layout>) => ['zpd', 'site-la'].map((r) => d.symbols.find((s) => s.role === r)?.label.join('|'));
  if (labels(dflt.d).join() !== 'ZPD,LA') fail(`ZPDとLAの文字が、別々になっていません（${labels(dflt.d).join(' / ')}）`);
  if (dflt.zpd === dflt.la) fail('ZPDとLAが、同じ高さに重なっています');
  // LAの形：主回路（x=0）から真横に線が出て、真下に折れる。記号（四角の矢印・アース）は、回さず縦のまま、アースが一番下
  for (const [name, d] of [['既定', dflt.d], ['DSとVCBの間', layout(buildComposition({ ...base, laTap: 'ds-vcb' }), { ...base, laTap: 'ds-vcb' })]] as const) {
    const la = d.symbols.find((s) => s.role === 'site-la');
    if (!la) {
      fail(`LA（${name}）が描かれていません`);
      continue;
    }
    const def = getSymbolDef('la');
    const entry = def.ports.find((p) => p.id === 'in')!;
    const inX = la.x + entry.x;
    const inY = la.y + entry.y;
    const earthY = la.y + def.box.h;
    const lead = d.wires.find((w) => w.y1 === w.y2 && Math.abs(w.y1 - inY) < 0.5 && Math.min(w.x1, w.x2) <= inX + 0.5 && Math.max(w.x1, w.x2) >= -0.5);
    if (la.rotate !== 0) fail(`LA（${name}）が回っています（${la.rotate}°。縦のままのはず）`);
    else if (!(inX < -20)) fail(`LA（${name}）が、主回路の左に離れて置かれていません（x=${Math.round(inX)}）`);
    else if (!lead) fail(`LA（${name}）に、主回路から真横に出る線がありません`);
    else if (!(earthY > inY + 20)) fail(`LA（${name}）のアースが、接続点の真下に来ていません`);
    else console.log(`  LA（${name}）：主回路から左へ真横に ${Math.round(-inX)}、そこから真下へ。記号は縦のまま、アースが一番下（y=${Math.round(earthY)}）`);
  }
  // 位置：DSとVCBの間 → VCBとCTの間 → 変圧器の手前（既定）
  if (!(moved.zpd! > moved.ds! && moved.zpd! < moved.vcb!)) fail(`ZPDが、DSとVCBの間にありません（DS ${moved.ds} / ZPD ${moved.zpd} / VCB ${moved.vcb}）`);
  else console.log(`  ZPDを「DSとVCBの間」に：DS y=${Math.round(moved.ds!)} → ZPD y=${Math.round(moved.zpd!)} → VCB y=${Math.round(moved.vcb!)}`);
  if (!(moved.la! > moved.vcb! && moved.la! < moved.ct!)) fail(`LAが、VCBとCTの間にありません（VCB ${moved.vcb} / LA ${moved.la} / CT ${moved.ct}）`);
  else console.log(`  LAを「VCBとCTの間」に：VCB y=${Math.round(moved.vcb!)} → LA y=${Math.round(moved.la!)} → CT y=${Math.round(moved.ct!)}`);
  if (!(dflt.zpd! > dflt.ct! && dflt.la! > dflt.ct!)) fail('既定の位置が、CTの下（変圧器の手前）になっていません');
  else console.log('  位置を答えていないときは、CTの下（変圧器の手前）');
  // ZPD・LAが、母線・変圧器・ほかの記号に重ならない（どの位置でも）
  for (const [name, a] of [
    ['既定（変圧器の手前）', base],
    ['ZPD：DSとVCBの間／LA：VCBとCTの間', { ...base, zpdTap: 'ds-vcb', laTap: 'vcb-ct' }],
    ['ZPD：VCBとCTの間／LA：DSとVCBの間', { ...base, zpdTap: 'vcb-ct', laTap: 'ds-vcb' }],
    ['ZPD・LAとも、DSとVCBの間', { ...base, zpdTap: 'ds-vcb', laTap: 'ds-vcb' }],
    ['PFS形：LBSの次', { ...base, mainBreakerForm: 'pfs', zpdTap: 'lbs-ct', laTap: 'lbs-ct', hasSiteCt: 'yes' }],
  ] as [string, Answers][]) {
    const d = layout(buildComposition(a), a);
    const doc = fromLayout(d);
    const issues = inspectDrawing(doc, 'A4', 'portrait');
    const cols = findLabelCollisions(d);
    // 記号どうしの重なり（箱どうし）
    const boxes = d.symbols
      .filter((s) => !s.parent && !['enclosure-cubicle'].includes(s.symbolId))
      .map((s) => {
        const rb = rotatedBox(getSymbolDef(s.symbolId).box, s.rotate);
        return { role: s.role, x0: s.x + rb.dx, y0: s.y + rb.dy, x1: s.x + rb.dx + rb.w, y1: s.y + rb.dy + rb.h };
      });
    const overlap: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!;
        const q = boxes[j]!;
        if (p.x0 < q.x1 - 1 && q.x0 < p.x1 - 1 && p.y0 < q.y1 - 1 && q.y0 < p.y1 - 1) overlap.push(`${p.role}×${q.role}`);
      }
    }
    // 母線（変圧器をつなぐ横線）が、ZPD・LAの箱を横切らない
    const bus = d.wires.filter((w) => w.y1 === w.y2).sort((p, q) => Math.abs(q.x2 - q.x1) - Math.abs(p.x2 - p.x1))[0];
    const cross = bus
      ? boxes.filter((b) => ['zpd', 'site-la', 'ovgr'].includes(b.role) && b.y0 < bus.y1 && b.y1 > bus.y1 && b.x1 > Math.min(bus.x1, bus.x2) && b.x0 < Math.max(bus.x1, bus.x2)).map((b) => b.role)
      : [];
    if (issues.length || cols.length || overlap.length || cross.length) {
      fail(`${name}：${[issues.length ? `図面の問題${issues.length}件` : '', cols.length ? `文字の重なり${cols.length}件` : '', overlap.length ? `記号の重なり ${overlap.join('、')}` : '', cross.length ? `母線が横切る ${cross.join('、')}` : ''].filter(Boolean).join(' / ')}`);
    } else console.log(`  ${name}：重なりなし`);
  }
}

/* 受電設備エリアが2か所以上：左から右へ並べ、枠の上端をそろえ、ケーブルでつなぐ */
console.log('\n■ 受電設備エリアが2か所以上のときの配置');
{
  const base: Answers = {
    ...answers, areaCount: 2, areaForm: 'cubicle', areaPlacement: 'outdoor', areaForm__2: 'room-open', areaPlacement__2: 'indoor',
    transformerCount: 2, trCapacity: 100, feederCount: 0, hasCapacitor: 'no', hasPv: 'no',
    'a2:areaIntake': 'lbs-pf', 'a2:lbsRatedVoltage': '7200', 'a2:lbsRatedCurrent': 200, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried',
    'a2:linkCableStructure': 'CVT', 'a2:linkCableCrossSection': '38', 'a2:linkCableLength': 20,
    'a2:transformerCount': 2, 'a2:trConnection': 'tr-3p-dy', 'a2:trCapacity': 100, 'a2:trCapacity__2': 50, 'a2:trConnection__2': 'tr-3p-dy',
  };
  const one = layout(buildComposition({ ...base, areaCount: 1 }), { ...base, areaCount: 1 });
  const two = layout(buildComposition(base), base);
  // 1か所目の記号（エリアをつなぐ線の途中に足す、ケーブルの端末・送り出しの開閉器は、数えない）
  const first = two.symbols.filter((s) => !s.role.startsWith('a2:') && !/^(cable-head-send|sendout)/.test(s.role));
  const second = two.symbols.filter((s) => s.role.startsWith('a2:'));
  if (first.length !== one.symbols.length) fail(`1か所目の記号の数が、1か所だけのときと違います（${first.length} / ${one.symbols.length}）`);
  const same = first.every((s, i) => s.symbolId === one.symbols[i]!.symbolId && s.x === one.symbols[i]!.x && s.y === one.symbols[i]!.y);
  if (!same) fail('1か所目の記号の位置が、1か所だけのときと変わっています');
  else console.log(`  1か所目（記号 ${first.length}個）は、1か所だけのときと、同じ位置`);
  if (second.length === 0) fail('2か所目の記号が描かれていません');
  const right1 = Math.max(...first.map((s) => s.x + getSymbolDef(s.symbolId).box.w));
  const left2 = Math.min(...second.map((s) => s.x));
  if (!(left2 > right1)) fail(`2か所目が、1か所目の右に離れて並んでいません（1か所目の右端 ${Math.round(right1)} / 2か所目の左端 ${Math.round(left2)}）`);
  else console.log(`  2か所目は、1か所目の右（${Math.round(left2 - right1)}離れて）`);
  if (two.frames.length !== 2) fail(`エリアの枠が ${two.frames.length}つです（2つのはず）`);
  else if (two.frames[0]!.y !== two.frames[1]!.y) fail(`2つの枠の上端がそろっていません（${two.frames[0]!.y} / ${two.frames[1]!.y}）`);
  else console.log(`  2つの枠の上端が、y=${two.frames[0]!.y} でそろっている。枠の文字：${two.frames.map((f) => f.label).join(' ／ ')}`);
  // 枠どうしが重ならない
  const [fa, fb] = [...two.frames].sort((p, q) => p.x - q.x);
  if (fa && fb && !(fa.x + fa.w < fb.x)) fail('2つの枠が重なっています');
  // ケーブルの線：点線（埋設）で、2か所目の枠の上端（主回路の真上）まで来ている
  const entryX = second.find((s) => s.role === 'a2:cable-head-site');
  const dashed = two.wires.filter((w) => w.dashed && (w.x1 > right1 - 1 || w.x2 > right1 - 1));
  if (dashed.length < 3) fail(`エリア間の点線のケーブルが描かれていません（${dashed.length}本）`);
  const frameTop = two.frames[1]!.y;
  const reaches = dashed.some((w) => (w.y1 === frameTop || w.y2 === frameTop) && w.x1 === w.x2);
  if (!reaches) fail('ケーブルの線が、2か所目の枠の上端まで来ていません');
  const hasText = (two.texts ?? []).some((t) => t.lines.join('|') === '埋ケ|CVT|38mm2 20m');
  if (!hasText) fail(`ケーブルの文字が描かれていません（${(two.texts ?? []).map((t) => t.lines.join('|')).join(' ／ ')}）`);
  if (entryX && !(Math.abs(entryX.x + getSymbolDef('cable-head').box.w / 2 - second[0]!.x) >= 0)) fail('受け側の端末の位置が不正です');
  const cols = findLabelCollisions(two);
  if (cols.length) fail(`2か所のとき、文字が重なっています：${[...new Set(cols)].slice(0, 3).join(' / ')}`);
  else console.log(`  エリア間のケーブル：点線 ${dashed.length}本、文字「埋ケ / CVT / 38mm2 20m」。文字の重なりなし`);
  // 編集できる図面に取り込んでも、問題が出ない
  const doc = fromLayout(two);
  const issues = inspectDrawing(doc, 'A3', 'landscape');
  if (issues.length) fail(`2か所の図面を取り込むと、問題が ${issues.length}件 出ます（${issues.slice(0, 2).map((i) => i.message).join(' / ')}）`);
  else console.log('  編集用に取り込んでも、結線・重なりの問題なし');
  if (!doc.items.some((i) => i.kind === 'text')) fail('ケーブルの文字が、編集用の図面に入っていません');
  // 分岐の位置ごとに、つなぐ高さが変わる（DSの電源側 → DSとVCBの間 → VCBの負荷側 → 高圧母線）
  const tapY = (tap: string) => {
    const a: Answers = { ...base, relayCount: '0', 'a2:linkTap': tap };
    const d = layout(buildComposition(a), a);
    // 分岐の高さ＝送り出し側のケーブルの端末（横向き）の高さ
    const h = d.symbols.find((x) => x.id === 'cable-head-send');
    return h ? portY(h, 'in') : undefined;
  };
  const ys = ['ds-source', 'ds-vcb', 'vcb-load', 'bus'].map(tapY);
  if (ys.some((y) => y === undefined) || !(ys[0]! < ys[1]! && ys[1]! < ys[2]! && ys[2]! < ys[3]!)) fail(`分岐の位置の高さが、上から順になっていません（${ys.join(' / ')}）`);
  else console.log(`  分岐の高さ（上から）：DSの電源側 ${Math.round(ys[0]!)} → DSとVCBの間 ${Math.round(ys[1]!)} → VCBの負荷側 ${Math.round(ys[2]!)} → 高圧母線 ${Math.round(ys[3]!)}`);
  // 3か所：3か所目は、2か所目の右。分岐元は2か所目
  const three: Answers = { ...base, areaCount: 3, areaForm__3: 'cubicle', areaPlacement__3: 'outdoor', 'a3:areaIntake': 'none', 'a3:linkFrom': '2', 'a3:linkTap': 'bus', 'a3:trCapacity': 50, 'a3:trConnection': 'tr-3p-dy' };
  const d3 = layout(buildComposition(three), three);
  const x2 = Math.max(...d3.symbols.filter((s) => s.role.startsWith('a2:')).map((s) => s.x));
  const x3 = Math.min(...d3.symbols.filter((s) => s.role.startsWith('a3:')).map((s) => s.x));
  if (d3.frames.length !== 3 || !(x3 > x2)) fail(`3か所並べたとき、3か所目が2か所目の右にありません（枠 ${d3.frames.length}つ）`);
  else console.log('  3か所：左から1・2・3か所目の順に並ぶ（3か所目は、2か所目から分岐）');
  // 回答の印：2か所目の答えを変えると変わる（手で直した図面に「回答が変わりました」と知らせるため）。1か所の案件は、2か所目のキーが無いので変わらない
  {
    const basisOf = (a: Answers) => digest(JSON.stringify(buildComposition(a).map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0])));
    const b0 = basisOf(base);
    const b1 = basisOf({ ...base, 'a2:trCapacity': 150 });
    const b2 = basisOf({ ...base, 'a2:areaIntake': 'vcb' });
    if (b0 === b1 || b0 === b2) fail('2か所目の答えを変えても、回答の印が変わりません');
    else console.log('  2か所目の答え（容量・受電側の開閉器）を変えると、回答の印が変わる');
    const old1 = basisOf({ ...base, areaCount: 1 });
    const old1b = basisOf({ ...base, areaCount: 1, 'a2:trCapacity': 150, 'a2:areaIntake': 'vcb' });
    if (old1 !== old1b) fail('1か所の案件に、2か所目の答えが残っていても、回答の印が変わってしまいます');
  }
  // 「いいえ」（ケーブルでつながない）ときも、単独にせず、ふつうの線でつなぐ。回路の構成は同じで、違いは、ケーブルの図記号（端末・点線・文字）だけ
  const alone: Answers = { ...base, 'a2:linkCable': 'no' };
  const dAlone = layout(buildComposition(alone), alone);
  const frameTop2 = dAlone.frames[1]!.y;
  const reachesTop = dAlone.wires.some((w) => w.x1 === w.x2 && (w.y1 === frameTop2 || w.y2 === frameTop2) && !w.dashed);
  const noCableSymbols = !dAlone.symbols.some((s) => /cable-head-send|a2:cable-head-site/.test(s.id));
  const noDash = !dAlone.wires.some((w) => w.dashed && w.x1 > right1);
  const noText = !(dAlone.texts ?? []).some((t) => t.lines.join('|').includes('埋ケ'));
  const sameSymbols = (d: typeof two) => d.symbols.map((s) => s.id).filter((id) => !/cable-head/.test(id)).join(',');
  if (!reachesTop) fail('「いいえ」なのに、2か所目に線がつながっていません（単独で描かれています）');
  else if (!noCableSymbols || !noDash || !noText) fail('「いいえ」なのに、ケーブルの図記号（端末・点線・文字）が描かれています');
  else if (sameSymbols(dAlone) !== sameSymbols(two)) fail('「いいえ」のときと、ケーブルのときで、回路の構成（記号）が違います');
  else if (findLabelCollisions(dAlone).length > 0) fail('「いいえ」のとき、文字が重なっています');
  else console.log('  「いいえ」のとき：単独にせず、ふつうの線でつなぐ。記号の構成はケーブルのときと同じで、ケーブルの端末・点線・文字だけ無い');
  const aloneDoc = fromLayout(dAlone);
  if (inspectDrawing(aloneDoc, 'A3', 'landscape').length > 0) fail('「いいえ」の図面を取り込むと、問題が出ます');
}

/* ---------- 9. 主回路の記号の大きさ ---------- */
console.log('\n■ 記号の大きさ');
{
  const ids = ['ds', 'vcb', 'pc', 'lbs-pf', 'vcs', 'tr-3p-dy', 'sr', 'sc'];
  const boxes = ids.map((id) => {
    const def = getSymbolDef(id);
    return { id, w: def.box.w, h: def.box.h, portX: def.ports[0]!.x };
  });
  const sizes = new Set(boxes.map((b) => `${b.w}x${b.h}`));
  if (sizes.size !== 1) {
    fail(`主回路の記号の大きさが揃っていません：${boxes.map((b) => `${b.id} ${b.w}x${b.h}`).join(' / ')}`);
  } else {
    console.log(`  ${ids.length}種類すべて ${[...sizes][0]}（接続点も中央に）`);
  }
  const offCentre = boxes.filter((b) => b.portX !== boxes[0]!.w / 2);
  if (offCentre.length > 0) fail(`接続点が中央にない記号：${offCentre.map((b) => b.id).join('・')}`);

  // 枠が同じでも、中の絵が小さいと並べたときに貧相に見える。
  // 開閉器（DS・VCB・VCS）は、絵そのものの大きさも揃えておく
  const drawn = (id: string) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const sh of getSymbolDef(id).shapes) {
      const xs =
        sh.k === 'line' ? [sh.x1, sh.x2]
        : sh.k === 'circle' ? [sh.cx - sh.r, sh.cx + sh.r]
        : sh.k === 'rect' ? [sh.x, sh.x + sh.w]
        : [];
      for (const x of xs) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
    return x1 - x0;
  };
  const widths = ['ds', 'vcb', 'vcs'].map((id) => ({ id, w: drawn(id) }));
  const widest = Math.max(...widths.map((v) => v.w));
  const small = widths.filter((v) => widest - v.w > 10);
  if (small.length > 0) {
    fail(`開閉器の絵が小さすぎます：${small.map((v) => `${v.id} ${v.w.toFixed(0)}`).join(' / ')}（いちばん大きいもの ${widest.toFixed(0)}）`);
  } else {
    console.log(`  開閉器の絵の大きさ：${widths.map((v) => `${v.id} ${v.w.toFixed(0)}`).join(' / ')}`);
  }
}

/* ---------- 10. 図面を整える ---------- */
console.log('\n■ 図面を整える');
{
  const common: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr', pasBuiltinVt: 'yes',
    vctLocation: 'indoor', vctCount: 2, areaCount: 1, areaForm: 'cubicle', hasSiteCt: 'yes',
  };
  const patterns: [string, Answers][] = ([
    ['PFS形・変圧器1台', { ...common, mainBreakerForm: 'pfs', transformerCount: 1, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300 }],
    ['CB形・変圧器3台・コンデンサ2台', { ...common, mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
      transformerCount: 3, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
      hasCapacitor: 'yes', capacitorCount: 2, hasReactor: 'yes', capacitorCapacity: '3φ106kvar' }],
    ['前置き機器つき・低圧回線2本', { ...common, mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
      transformerCount: 2, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
      trHasPc: 'yes', trPcRating: '30A', trPcFuse: '10A',
      hasCapacitor: 'yes', capacitorCount: 2, capHasLbs: 'yes', capHasVcs: 'yes',
      capLbsRating: '200A', capPfG: '50A', capPfLoad: 'C', capPfLoadAmp: '30A', capPfKa: '40kA',
      hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: '3', pcsToTr1: 1, pcsToTr2: 2 }],
    ['発電機・太陽光つき', { ...common, mainBreakerForm: 'pfs', transformerCount: 2, trConnection: 'tr-3p-dy',
      trUsage: '動力', trCapacity: 300, hasGenerator: 'yes', hasPv: 'yes', pvCapacity: '50kW×2' }],
  ] as [string, Answers][]).map(([n, a2]) => [n, spreadUnits(a2)]);

  for (const [name, a] of patterns) {
    const d = fromLayout(layout(buildComposition(a), a));
    const r = tidyDrawing(d, 'A4', 'portrait');
    const left = r.issues;
    const serious = left.filter((i) => i.kind !== 'paper');
    if (serious.length > 0) {
      fail(`${name}：整えたあとも ${serious.length}件 残りました（${serious[0]!.message}）`);
    } else {
      console.log(`  ${name}：整えたあと、直すところはありません`);
    }
  }

  // わざと壊した図面を直せるか
  const a: Answers = spreadUnits({ ...common, mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
    transformerCount: 2, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300 });
  const clean = fromLayout(layout(buildComposition(a), a));
  const trs = symbols(clean).filter((s) => s.symbolId.startsWith('tr-'));
  const vcb = symbols(clean).find((s) => s.symbolId === 'vcb')!;
  const port = portsOf(trs[0]!)[0]!;
  const items = clean.items.map((i) => ({ ...i }));
  // 接続点の少し横で終わっている線（どこにもつながっていない）
  items.push({ kind: 'wire', id: 'bad-float', x1: port.x + 70, y1: port.y, x2: port.x + 15, y2: port.y } as DocWire);
  items.push({ kind: 'wire', id: 'bad-poke', x1: vcb.x + 24, y1: vcb.y - 30, x2: vcb.x + 24, y2: vcb.y + 30 } as DocWire);
  items.push({ kind: 'wire', id: 'bad-zero', x1: 10, y1: 10, x2: 10, y2: 10 } as DocWire);
  const t2 = items.find((i) => i.id === trs[1]!.id)! as typeof trs[0];
  t2.labelDx = trs[0]!.x + trs[0]!.labelDx - t2.x;
  t2.labelDy = trs[0]!.y + trs[0]!.labelDy - t2.y;
  const brokenDoc = { ...clean, items };

  const found = inspectDrawing(brokenDoc, 'A4', 'portrait');
  for (const kind of ['floating', 'through', 'overlap'] as const) {
    if (!found.some((i) => i.kind === kind)) fail(`壊した図面の「${kind}」を見つけられませんでした`);
  }
  console.log(`  わざと壊した図面：${found.length}件の問題を見つけました`);

  const r = tidyDrawing(brokenDoc, 'A4', 'portrait');
  if (r.doc.items.some((i) => i.id === 'bad-zero')) fail('長さ0の線が消えていません');
  if (r.fixed.floating < 1) fail('宙に浮いた線をつなげませんでした');
  if (r.fixed.through < 1) fail('記号に突っ込んだ線を引っ込められませんでした');
  if (r.fixed.overlap < 1) fail('重なった文字をずらせませんでした');
  const after = inspectDrawing(r.doc, 'A4', 'portrait');
  if (after.some((i) => i.kind === 'overlap')) fail('整えたあとも文字が重なっています');
  // 接続点に近いほうの端がつながっていればよい（反対の端は宙に浮いたままでよい）
  const floatWire = wires(r.doc).find((w) => w.id === 'bad-float');
  if (!floatWire || (!floatWire.at1 && !floatWire.at2)) {
    fail('接続点の近くにある線をつなげませんでした');
  }
  console.log(
    `  直した件数：${Object.entries(r.fixed).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' / ')}` +
    `／残り ${after.length}件`,
  );
}

/* ---------- 11. 斜めになった線をまっすぐにする ---------- */
console.log('\n■ 斜めの線を、機器を動かして直す');
{
  const a: Answers = spreadUnits({
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
    transformerCount: 3, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
    hasCapacitor: 'yes', capacitorCount: 2, hasReactor: 'yes',
  });
  const clean = fromLayout(layout(buildComposition(a), a));
  const ws = wires(clean);
  // 上下とも別の機器につながっている機器（動かすと線が斜めになる）
  const inline = symbols(clean).find(
    (s) =>
      ws.some((w) => w.at1?.item === s.id && w.at2 && w.at2.item !== s.id) &&
      ws.some((w) => w.at2?.item === s.id && w.at1 && w.at1.item !== s.id),
  );
  if (!inline) fail('上下とも別の機器につながっている機器が見つかりません');
  else {
    for (const [dx, dy] of [[40, 0], [26, 18], [-52, 0], [0, 34]] as const) {
      const moved = moveItem(clean, inline.id, dx, dy);
      const r = tidyDrawing(moved, 'A4', 'portrait');
      const left = skewed(r.doc);
      if (left > 0) fail(`(${dx},${dy}) 動かしたあと、整えても斜めが ${left}本 残りました`);
    }
    console.log('  4通りの動かし方すべてで、整えると斜めは0本になりました');
  }

  // 作りたての図面に、余計な動きが起きないこと
  const same = tidyDrawing(clean, 'A4', 'portrait');
  if (same.fixed.skew > 0) fail(`作りたての図面で、機器を ${same.fixed.skew}回 動かしてしまいました`);
  else console.log('  作りたての図面では、機器を動かしません');
}

/* ---------- 12. 稲妻（つなぎ先の無い斜めの線） ---------- */
console.log('\n■ 稲妻のような斜めの線をまっすぐにする');
{
  const clean = build();
  const bend = (id: string, x1: number, y1: number, x2: number, y2: number): DocWire => ({
    kind: 'wire', id, x1, y1, x2, y2,
  });
  const cases: Array<[string, DocWire[]]> = [
    ['どこにもつながっていない1本', [bend('z1', 300, 200, 360, 250)]],
    ['稲妻（短い斜めが3本つながる）', [
      bend('z1', 300, 200, 340, 230),
      bend('z2', 340, 230, 300, 260),
      bend('z3', 300, 260, 350, 300),
    ]],
    ['ほぼ水平だが少しだけ傾いている', [bend('z1', 300, 200, 420, 203)]],
  ];
  for (const [name, extra] of cases) {
    const broken: Doc = { ...clean, items: [...clean.items, ...extra] };
    if (skewed(broken) !== extra.length) fail(`${name}：試験の前提が崩れています`);
    const r = tidyDrawing(broken, 'A4', 'portrait');
    const left = skewed(r.doc);
    if (left > 0) fail(`${name}：整えても斜めが ${left}本 残りました`);
    else console.log(`  ${name}：斜め ${extra.length}本 → 0本`);
  }

  // つながっていた鎖が、まっすぐにしたあとも切れていないこと
  const zig: Doc = {
    ...clean,
    items: [...clean.items, bend('z1', 300, 200, 340, 230), bend('z2', 340, 230, 300, 260)],
  };
  const tidied = tidyDrawing(zig, 'A4', 'portrait').doc;
  const z1 = wires(tidied).find((w) => w.id === 'z1');
  const z2 = wires(tidied).find((w) => w.id === 'z2');
  if (!z1 || !z2) fail('まっすぐにしたら線が消えました');
  else if (z1.x2 !== z2.x1 || z1.y2 !== z2.y1) {
    fail(`まっすぐにしたら鎖が切れました：(${z1.x2},${z1.y2}) と (${z2.x1},${z2.y1})`);
  } else console.log('  つながっていた線どうしは、まっすぐにしても離れません');
}

/* ---------- 13. PASの内蔵機器（LA・VT）が母線につながっているか ---------- */
console.log('\n■ PASに内蔵したLA・VTが母線につながっているか');
{
  const a: Answers = {
    siteName: 'x', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    pasBuiltinVt: 'yes', pasBuiltinLa: 'yes',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', transformerCount: 1, trConnection: 'tr-3p-dy', trCapacity: 100,
  };
  const doc = fromLayout(layout(buildComposition(a), a));

  /**
   * 内蔵機器が、PASの中の主回路につながっているか。
   * 入口が主回路の真上にあればそれでつながっている（VT）。
   * 離れている場合は、入口から主回路まで横線が要る（LA）。
   */
  const linked = (d: Doc, role: string): boolean => {
    const pas = symbols(d).find((x) => x.id === 'pas');
    const kid = symbols(d).find((x) => x.id === role);
    if (!pas || !kid) return false;
    const inPort = portsOf(kid).find((p) => p.id === 'in');
    const spine = portsOf(pas).find((p) => p.id === 'in');
    if (!inPort || !spine) return false;
    if (Math.abs(inPort.x - spine.x) <= 0.5) return true;
    return wires(d).some(
      (w) =>
        Math.abs(w.x1 - w.x2) + Math.abs(w.y1 - w.y2) > 0.5 &&
        [[w.x1, w.y1], [w.x2, w.y2]].some(([x, y]) => Math.hypot(x! - inPort.x, y! - inPort.y) <= 1) &&
        [[w.x1, w.y1], [w.x2, w.y2]].some(([x]) => Math.abs(x! - spine.x) <= 1),
    );
  };

  /** 内蔵機器の線が、主回路より左へはみ出していないか（VTの横棒が貫いていた） */
  const spineX = (d: Doc) => {
    const pas = symbols(d).find((x) => x.id === 'pas')!;
    return portsOf(pas).find((p) => p.id === 'in')!.x;
  };

  for (const [role, name] of [['pas-la', 'LA'], ['pas-vt', 'VT']] as const) {
    if (!linked(doc, role)) fail(`${name}が母線につながっていません（作った直後）`);
    else console.log(`  ${name}：作った直後から母線につながっています`);
  }

  // 「結線を整える」で消えないこと（短い分岐線が吸い寄せられて消えていた）
  const r = tidyDrawing(doc, 'A4', 'portrait');
  for (const [role, name] of [['pas-la', 'LA'], ['pas-vt', 'VT']] as const) {
    if (!linked(r.doc, role)) fail(`${name}の分岐線が「結線を整える」で消えました`);
    else console.log(`  ${name}：整えてもつながったままです`);
  }
  // ZCTから右へ出る線が、途中で途切れていないこと
  {
    const zct = symbols(r.doc).find((x) => x.id === 'pas-zct');
    const sec = zct ? portsOf(zct).find((p) => p.id === 'sec') : undefined;
    if (!zct || !sec) fail('ZCTの二次側の接続点が見つかりません');
    else {
      // その高さにある水平の線分（記号の線も図面の線も）を集めて、すき間を探す
      const segs: [number, number][] = [];
      for (const it of r.doc.items) {
        if (it.kind === 'wire' && it.y1 === it.y2 && Math.abs(it.y1 - sec.y) < 0.01) {
          segs.push([Math.min(it.x1, it.x2), Math.max(it.x1, it.x2)]);
        }
        if (it.kind === 'symbol') {
          for (const sh of getSymbolDef(it.symbolId).shapes) {
            if (sh.k === 'line' && sh.y1 === sh.y2 && Math.abs(it.y + sh.y1 - sec.y) < 0.01) {
              segs.push([it.x + Math.min(sh.x1, sh.x2), it.x + Math.max(sh.x1, sh.x2)]);
            }
            if (sh.k === 'circle' && Math.abs(it.y + sh.cy - sec.y) < 0.01) {
              segs.push([it.x + sh.cx - sh.r, it.x + sh.cx + sh.r]);
            }
          }
        }
      }
      segs.sort((a2, b2) => a2[0] - b2[0]);
      let reach = segs.length ? segs[0]![1] : 0;
      const gaps: string[] = [];
      for (const [s2, e2] of segs.slice(1)) {
        if (s2 > reach + 0.01) gaps.push(`${reach.toFixed(0)}〜${s2.toFixed(0)}`);
        reach = Math.max(reach, e2);
      }
      if (gaps.length > 0) fail(`ZCTから右へ出る線が途切れています（${gaps.join(' , ')}）`);
      else console.log('  ZCTから右へ出る線は途切れていません');
    }
  }

  // LAは枠の左の線までと主回路までが同じくらいの余白になっていること
  // 接地記号は、枠の外（下）へ出ていること
  {
    const pasSym = symbols(r.doc).find((x) => x.id === 'pas')!;
    const pasBox = getSymbolDef(pasSym.symbolId);
    const frame = pasBox.shapes.find((sh) => sh.k === 'rect')!;
    const fx0 = pasSym.x + frame.x;
    const fy1 = pasSym.y + frame.y + frame.h;
    const spine = pasSym.x + pasBox.ports[0]!.x;
    const la = symbols(r.doc).find((x) => x.id === 'pas-la');
    if (!la) fail('内蔵LAが見つかりません');
    else {
      const xs = getSymbolDef(la.symbolId).shapes.flatMap((sh) =>
        sh.k === 'line' ? [la.x + sh.x1, la.x + sh.x2] : [],
      );
      const ys = getSymbolDef(la.symbolId).shapes.flatMap((sh) =>
        sh.k === 'line' ? [la.y + sh.y1, la.y + sh.y2] : [],
      );
      const left = Math.min(...xs) - fx0;
      const right = spine - Math.max(...xs);
      if (Math.abs(left - right) > 3) fail(`LAの左右の余白がそろっていません：左${left} 右${right}`);
      else console.log(`  LAの左右の余白はほぼ同じ（左${left} 右${right}）`);
      if (Math.max(...ys) <= fy1) fail('LAの接地記号が枠の中に入っています（外に出してください）');
      else console.log(`  LAの接地記号は枠の外に出ています（枠の下へ ${(Math.max(...ys) - fy1).toFixed(0)}）`);
    }
  }

  // VTの横棒が主回路を貫いて左へはみ出していないこと
  {
    const sx = spineX(r.doc);
    const vt = symbols(r.doc).find((x) => x.id === 'pas-vt');
    const over = vt
      ? getSymbolDef(vt.symbolId).shapes.filter(
          (sh) => sh.k === 'line' && Math.min(vt.x + sh.x1, vt.x + sh.x2) < sx - 0.01,
        ).length
      : 0;
    if (over > 0) fail(`VTの線が主回路（x=${sx}）より左へはみ出しています（${over}本）`);
    else console.log('  VTの横棒は主回路より左へはみ出していません');
  }

  const floating = r.issues.filter((i) => i.kind === 'floating').length;
  if (floating > 0) fail(`内蔵機器の分岐点が「浮いている」と誤って指摘されました（${floating}件）`);
  else console.log('  内蔵機器の分岐点を、浮いているとは指摘しません');

  // 長さゼロの線が残っていないこと
  const zero = wires(r.doc).filter((w) => w.x1 === w.x2 && w.y1 === w.y2).length;
  if (zero > 0) fail(`長さゼロの線が ${zero}本 残っています`);
  else console.log('  長さゼロの線はありません');
}
