/**
 * 図面の結線の検証。
 *
 * 「記号を動かしても線が離れない」「印刷しても寸分の狂いがない」
 * 「記号を差し替えると前後の線が自動で伸縮する」を、実案件の図面で確かめる。
 *
 *   node --experimental-strip-types scripts/check-drawing.ts
 */
import {
  applyAnchors,
  descendantsOf,
  digest,
  groupRootOf,
  removeItem,
  assistMove,
  fromLayout,
  moveItem,
  portsOf,
  replaceSymbol,
  rotateSymbol,
  tidyDoc,
} from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../apps/web/src/editor/doc.ts';
import { buildComposition, indexedKey, PER_UNIT_QUESTION_IDS, QUESTIONS, QUESTION_GROUPS } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { rotatedBox, rotatedPort, LABEL_FONT, SHEET_MARGIN, SHEET_PAD, findLabelCollisions, layout, layoutTitle, renderSvg, sheetSize, textWidth } from '../packages/layout/src/index.ts';
import { getSymbol as getSymbolDef } from '../packages/symbols/src/index.ts';
import { inspectDrawing, tidyDrawing } from '../apps/web/src/editor/inspect.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/** 変圧器3台・コンデンサ2組・低圧回線2本の、いちばん込み入った構成 */
const answers: Answers = {
  siteName: '検証用',
  receivingType: 'high',
  receivingVoltage: 6600,
  sourceType: 'pole',
  boundaryPattern: 'coincident',
  hasPas: 'yes',
  pasControl: 'dgr',
  pasBuiltinVt: 'yes',
  vctLocation: 'indoor',
  vctCount: 2,
  areaCount: 1,
  areaForm: 'cubicle',
  mainBreakerForm: 'cb',
  dsRating: '7200V 200A',
  vcbRating: '7200V 600A',
  hasSiteVt: 'yes',
  hasSiteCt: 'yes',
  transformerCount: 3,
  trConnection: 'tr-3p-dy',
  trUsage: '動力',
  trCapacity: 300,
  trVoltage: '6600V/210V',
  hasCapacitor: 'yes',
  capacitorCount: 2,
  hasPv: 'yes',
  pvGroupCount: '1',
  pcsCapacity: 50,
  pcsCount: '4',
  pcsToTr1: 2,
  pcsToTr2: 2,
  hasGenerator: 'yes',
};


/**
 * 件ごとに独立して答えるようになったので、試験の回答も件ごとに用意する。
 * 「3台とも同じ変圧器」という現場はよくあるので、
 * 1件目の答えを件数ぶんに広げる（すでに入れてある件はそのまま）。
 * PCSの容量の種類だけは件ごとに中身が違うので広げない。
 */
function spreadUnits(a: Answers): Answers {
  const out: Answers = { ...a };
  for (const g of QUESTION_GROUPS) {
    if (!g.repeatCountKey || g.id === 'pv') continue;
    const count = Math.max(1, Number(a[g.repeatCountKey] ?? 1));
    for (const q of QUESTIONS) {
      if (q.group !== g.id || !PER_UNIT_QUESTION_IDS.has(q.id)) continue;
      if (a[q.id] === undefined) continue;
      for (let i = 1; i < count; i++) {
        if (out[indexedKey(q.id, i)] === undefined) out[indexedKey(q.id, i)] = a[q.id];
      }
    }
  }
  return out;
}

const answersSpread = spreadUnits(answers);
const build = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));

const wires = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
const symbols = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');

/** つないである端が、接続点の真上にあるか。ずれの最大値を返す */
function worstGap(d: Doc): number {
  const port = (item: string, port: string) => {
    const s = d.items.find((i) => i.id === item);
    return s && s.kind === 'symbol' ? portsOf(s).find((p) => p.id === port) : undefined;
  };
  let worst = 0;
  for (const w of wires(d)) {
    for (const end of [1, 2] as const) {
      const a = end === 1 ? w.at1 : w.at2;
      if (!a) continue;
      const p = port(a.item, a.port);
      if (!p) continue;
      const wx = end === 1 ? w.x1 : w.x2;
      const wy = end === 1 ? w.y1 : w.y2;
      worst = Math.max(worst, Math.hypot(p.x - wx, p.y - wy));
    }
  }
  return worst;
}

/** 斜めになっている線（縦でも横でもない線）の本数 */
const skewed = (d: Doc) => wires(d).filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2).length;

const anchoredEnds = (d: Doc) => wires(d).reduce((n, w) => n + (w.at1 ? 1 : 0) + (w.at2 ? 1 : 0), 0);

/* ---------- 1. 取り込んだ時点でつながっているか ---------- */
console.log('■ 取り込み');
const base = build();
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

/* ---------- 5. 回しても離れないか ---------- */
console.log('\n■ 記号を回す');
if (tr) {
  let d = base;
  for (let i = 0; i < 4; i++) d = rotateSymbol(d, tr.id, 90);
  if (worstGap(d) !== 0) fail(`4回回したあと ${worstGap(d)} のずれがあります`);
  else console.log('  90°を4回まわしても、線の端は接続点の真上のまま');
  const back = symbols(d).find((s) => s.id === tr.id)!;
  if (back.rotate !== 0) fail(`4回まわして向きが ${back.rotate}° になりました`);
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    const above = d.symbols.filter((s) => ['zpd', 'ovgr', 'ocr', 'ct-test-terminal', 'site-la', 'ct', 'ds-vt-pf', 'ds-vt'].includes(s.role));
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
  const first = two.symbols.filter((s) => !s.role.startsWith('a2:'));
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
    const a: Answers = { ...base, 'a2:linkTap': tap };
    const d = layout(buildComposition(a), a);
    const w = d.wires.find((x) => x.dashed && x.y1 === x.y2 && x.x1 < right1 + 1);
    return w?.y1;
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
  // 「つながない」ときは、ケーブルを描かず、エリアだけ並べる
  const alone: Answers = { ...base, 'a2:linkCable': 'no' };
  const dAlone = layout(buildComposition(alone), alone);
  if (dAlone.wires.some((w) => w.dashed && w.x1 > right1)) fail('「つながない」なのに、ケーブルが描かれています');
  else console.log('  「つながない」とき：ケーブルは描かず、エリアだけ並べる');
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
        [[w.x1, w.y1], [w.x2, w.y2]].some(([x, y]) => Math.abs(x! - spine.x) <= 1),
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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

/* ---------- 18. 3点不一致のときの、保安上の責任分界点 ---------- */
console.log('\n■ 3点不一致：保安上の責任分界点（主遮断装置の中央に横線）');
{
  const base = (over: Answers): Answers => ({
    siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
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
    else if (!(x0 < axisX - 100 && x1 > axisX + 10)) fail(`${c.name}：横線が主回路の縦線をまたいでいません（${x0}〜${x1}、縦線 ${axisX}）`);
    else if (m.label.join('') !== '保安上の責任分界点') fail(`${c.name}：文言が「${m.label.join('')}」です`);
    else console.log(`  ${c.name}：${main.symbolId} の中央（y=${centerY}）に横線、「${m.label.join('')}」`);
    // 文言が横線の上・左端にあること（主回路の縦線から離れていて、重ならない）
    if (!(m.labelAt.y < lineY && m.labelAt.x <= axisX - 100 && m.labelAt.anchor === 'start')) fail(`${c.name}：文言の位置が線の左上ではありません`);
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
  const base: Answers = { ...answers, hasPas: 'yes' };
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

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
