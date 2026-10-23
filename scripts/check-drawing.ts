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
import { buildComposition } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { getSymbol as getSymbolDef } from '../packages/symbols/src/index.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/** 変圧器3台・コンデンサ2組・低圧回線2本の、いちばん込み入った構成 */
const answers: Answers = {
  customerName: '検証用',
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
  hasGenerator: 'yes',
  feederCount: 2,
};

const build = (): Doc => fromLayout(layout(buildComposition(answers), answers));

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
const pas = symbols(base).find((s) => s.symbolId === 'pas');
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
  const common: Answers = {
    customerName: 'x', siteName: 'x', receivingType: 'high', receivingVoltage: 6600,
    sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', pasControl: 'dgr',
    vctLocation: 'indoor', vctCount: 1, areaCount: 1, areaForm: 'cubicle',
    mainBreakerForm: 'cb', dsRating: 'x', vcbRating: 'y',
    transformerCount: 3, trConnection: 'tr-3p-dy', trUsage: '動力', trCapacity: 300,
    hasCapacitor: 'yes', capacitorCount: 2, hasReactor: 'yes',
  };

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
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
