/**
 * 図面の検証（check-drawing）の17個目：「記号を追加・差し替え」の「区分開閉器」リスト（第20弾 項目6）。
 * 24通り（PAS・PGS・UGS × GR・DGR × 内蔵4つ）の完成形を足したとき、中身が決まりどおりで、線・文字の問題が増えず、
 * 動かすと一緒に動き、消すと一緒に消え、作り直し・書き戻しでも、壊れない。
 */
import { fromLayout, moveItem, removeItem, replaceSymbol } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import { addSectionalizerSet, isSectionalizer, setThumb, swapSectionalizerSet } from '../../apps/web/src/editor/sectionalizerSets.ts';
import { buildGenerated, writeBack } from '../../apps/web/src/editor/writeback.ts';
import { SECTIONALIZER_SETS, SET_CONTROLS, SET_PATTERNS, SET_SECTIONALIZERS, buildComposition, normalizeAnswers, QUESTIONS, withAutoValues } from '../../packages/knowledge/src/index.ts';
import type { Answers, Value } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 区分開閉器のリスト：24通りの完成形を足す');
{
  if (SECTIONALIZER_SETS.length !== SET_SECTIONALIZERS.length * SET_CONTROLS.length * SET_PATTERNS.length || SECTIONALIZER_SETS.length !== 24) fail(`完成形の数が24ではありません（${SECTIONALIZER_SETS.length}）`);
  if (new Set(SECTIONALIZER_SETS.map((s) => s.id)).size !== SECTIONALIZER_SETS.length) fail('完成形のidが重なっています');

  const base = fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const problems = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew'].includes(i.kind)).length;
  const p0 = problems(base);
  const bad: string[] = [];
  const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  let checked = 0;
  for (const set of SECTIONALIZER_SETS) {
    const name = set.id;
    checked++;
    const { doc, id } = addSectionalizerSet(base, set);
    const added = syms(doc).filter((s) => !base.items.some((b) => b.id === s.id));
    const pas = added.find((s) => s.id === id);
    if (!pas) { bad.push(`${name}：区分開閉器がありません`); continue; }
    // 区分開閉器の種類（PAS・PGS・UGSの図記号。内蔵があるときは、枠を広げた別表記）
    const pdef = getSymbol(pas.symbolId);
    // （PGS・UGS も、自動作図と同じく、PASと同じ図記号に、名前の文字（PGS・UGS）を添える）
    if ((pdef.altOf ?? pdef.id) !== 'pas') bad.push(`${name}：区分開閉器の図記号が違います（${pas.symbolId}）`);
    if (pas.label[0] !== set.sectionalizer.toUpperCase()) bad.push(`${name}：区分開閉器の名前の文字が違います（${pas.label[0]}）`);
    if (pdef.altOf !== undefined !== (set.vt || set.la)) bad.push(`${name}：内蔵があるときだけ、枠を広げた図記号のはずです（${pas.symbolId}）`);
    // 中身：ZCTは、どちらにも／VT・LAは、選んだとき／ZPDは、DGRのときだけ
    const kids = added.filter((s) => s.parent === id && s.slot).map((s) => s.symbolId).sort();
    const want = ['zct-pas', ...(set.vt ? ['vt-pas'] : []), ...(set.la ? ['la-pas'] : []), ...(set.control === 'dgr' ? [set.la ? 'zpd-pas-boxed' : 'zpd-pas'] : [])].sort();
    if (kids.join() !== want.join()) bad.push(`${name}：中身が違います（${kids.join('・')} / 期待 ${want.join('・')}）`);
    // 継電器：GRまたはDGR。区分開閉器の子（スロットなし）
    const relays = added.filter((s) => /^relay-/.test(s.symbolId));
    if (relays.length !== 1 || relays[0]!.symbolId !== `relay-${set.control}` || relays[0]!.parent !== id || relays[0]!.slot) bad.push(`${name}：継電器が決まりどおりではありません（${relays.map((r) => r.symbolId).join('・')}）`);
    // 追加した記号は、いままでの図面の記号に、触れていない（記号を足しただけ）／外へ出る線が無い
    // 客柱：PAS・PGSのときだけ、左に1つ（区分開閉器の子・スロットなし。UGSには付かない）（第20弾 項目8・番号4）
    const poles = added.filter((s) => s.symbolId === 'pole-customer');
    const wantPole = set.sectionalizer !== 'ugs';
    if (poles.length !== (wantPole ? 1 : 0)) bad.push(`${name}：客柱の数が違います（${poles.length}。PAS・PGSは1つ、UGSは0）`);
    else if (wantPole) {
      const pole = poles[0]!;
      const pb = getSymbol(pole.symbolId).box;
      const sb = pdef.box;
      if (pole.parent !== id || pole.slot) bad.push(`${name}：客柱が、区分開閉器の子（スロットなし）になっていません`);
      // 区分開閉器の左で、枠の高さの中（自動作図と同じ位置）
      if (pole.x + pb.w > pas.x || pole.x + pb.w < pas.x - 30) bad.push(`${name}：客柱が、区分開閉器の左のすぐ近くにありません`);
      if (pole.y + pb.h / 2 < pas.y || pole.y + pb.h / 2 > pas.y + sb.h) bad.push(`${name}：客柱の高さが、区分開閉器の枠の高さの中ではありません`);
      // 自動作図の客柱と、同じ位置（同じ図記号の区分開閉器どうし）
      const aPas = base.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === 'pas');
      const aPole = base.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === 'customer-pole');
      if (aPas && aPole && aPas.symbolId === pas.symbolId && (Math.abs(pole.x - pas.x - (aPole.x - aPas.x)) > 0.01 || Math.abs(pole.y - pas.y - (aPole.y - aPas.y)) > 0.01)) bad.push(`${name}：客柱の位置が、自動作図と違います`);
      if (pole.label.some((l) => l.trim() !== '')) bad.push(`${name}：客柱に文字が付いています`);
    }
    if (added.length !== 1 + want.length + 1 + (wantPole ? 1 : 0)) bad.push(`${name}：足された記号の数が違います（${added.length}）`);
    if (problems(doc) > p0) bad.push(`${name}：足したら、重なり・つながっていない線・斜めの線が増えました（${p0}→${problems(doc)}）`);
    // 線の端の記号が、図面の中に実在する
    const ids = new Set(doc.items.map((i) => i.id));
    for (const w of doc.items.filter((i): i is DocWire => i.kind === 'wire')) for (const a of [w.at1, w.at2]) if (a && !ids.has(a.item)) bad.push(`${name}：線のつなぎ先が、図面にありません（${a.item}）`);
    // 動かすと、中身も継電器も、制御線も、一緒に動く
    const m = moveItem(doc, id, 30, -20);
    for (const s of added) {
      const n = syms(m).find((x) => x.id === s.id)!;
      if (Math.abs(n.x - s.x - 30) > 0.01 || Math.abs(n.y - s.y + 20) > 0.01) bad.push(`${name}：区分開閉器を動かしたら、${s.symbolId} が一緒に動いていません`);
    }
    // 消すと、中身・継電器・制御線が、すべて消える（もとの図面に戻る）
    const gone = removeItem(doc, id);
    if (gone.items.length !== base.items.length || gone.items.some((i) => !base.items.some((b) => b.id === i.id))) bad.push(`${name}：区分開閉器を消したら、足したものが残っています（${gone.items.length - base.items.length}個）`);
    // 区分開閉器を、ほかの記号に差し替えても、継電器は残る
    const rep = replaceSymbol(doc, id, set.sectionalizer === 'pas' ? 'pgs' : 'pas');
    if (!syms(rep).some((s) => s.parent === id && /^relay-/.test(s.symbolId))) bad.push(`${name}：区分開閉器を差し替えたら、継電器が消えました`);
    if (wantPole && !syms(rep).some((s) => s.parent === id && s.symbolId === 'pole-customer')) bad.push(`${name}：区分開閉器を差し替えたら、客柱が消えました`);
    // 一覧の見本の絵
    if (!/<svg/.test(setThumb(set).svg)) bad.push(`${name}：一覧の見本の絵が作れません`);
  }
  if (bad.length > 0) fail(`区分開閉器の完成形に問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
  else console.log(`  ${checked}通りで、中身（ZCT・VT・LA・ZPD）・継電器（GR/DGR）が決まりどおり。線・文字の問題は増えず、動かすと一緒に動き、消すと全部消える`);
}

console.log('\n■ 区分開閉器のリスト：作り直し・入力への書き戻しで壊れない');
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const raw: Answers = { ...answersSpread, areaCount: '1' };
  const bad: string[] = [];
  const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  for (const set of SECTIONALIZER_SETS.filter((s) => s.sectionalizer === 'pas' || (s.vt && s.la))) {
    const gen = buildGenerated(toEff(raw));
    const { doc } = addSectionalizerSet(gen, set);
    const cur: Doc = { ...doc, edited: true };
    const n0 = syms(cur).length;
    // 作り直し（入力は同じ）：足した完成形が、そのまま残る
    const re = rebuildWithOverrides(buildGenerated(toEff(raw)), cur);
    if (syms(re.doc).length !== n0) bad.push(`${set.id}：作り直したら、記号の数が変わりました（${n0}→${syms(re.doc).length}）`);
    const relay = syms(re.doc).find((s) => s.symbolId === `relay-${set.control}` && s.parent);
    if (!relay || !syms(re.doc).some((s) => s.id === relay.parent)) bad.push(`${set.id}：作り直したら、継電器が区分開閉器の子でなくなりました`);
    // 入力への書き戻し：足しただけで、入力が勝手に変わらない（書き戻せない変更は、図面にだけ残る）
    const r = writeBack(raw, cur, toEff);
    if (r && JSON.stringify(r.answers) !== JSON.stringify(raw)) {
      const changed = Object.keys(r.answers).filter((k) => JSON.stringify(r.answers[k]) !== JSON.stringify(raw[k]));
      bad.push(`${set.id}：足しただけなのに、入力が変わりました（${changed.slice(0, 4).join('・')}）`);
    }
  }
  if (bad.length > 0) fail(`区分開閉器の完成形の、作り直し・書き戻しに問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
  else console.log('  足した完成形は、作り直しても残り、入力へは、勝手に書き戻されない');
}

console.log('\n■ 区分開閉器のリスト：選んでいる区分開閉器の中身を入れ替える');
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const bad: string[] = [];
  const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const wiresOf = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
  const problems = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew'].includes(i.kind)).length;
  const wantKids = (set: (typeof SECTIONALIZER_SETS)[number]) => ['zct-pas', ...(set.vt ? ['vt-pas'] : []), ...(set.la ? ['la-pas'] : []), ...(set.control === 'dgr' ? [set.la ? 'zpd-pas-boxed' : 'zpd-pas'] : [])].sort();
  const inPort = (s: DocSymbol) => { const p = getSymbol(s.symbolId).ports.find((q) => q.id === 'in')!; return [s.x + p.x, s.y + p.y]; };
  const base = fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const baseP = problems(base);

  // (1) 足したセット × 入れ替え先 24通り × 24通り。中身・継電器・位置・名前の文字・余分な線が残らないこと
  let n = 0;
  let k = 0;
  for (const from of SECTIONALIZER_SETS) {
    const { doc, id } = addSectionalizerSet(base, from);
    const pas0 = syms(doc).find((s) => s.id === id)!;
    const in0 = inPort(pas0);
    for (const to of SECTIONALIZER_SETS) {
      n++;
      const r = swapSectionalizerSet(doc, id, to);
      const name = `${from.id}→${to.id}`;
      if (!r) { bad.push(`${name}：入れ替えられません`); continue; }
      const pas = syms(r).find((s) => s.id === id);
      if (!pas) { bad.push(`${name}：区分開閉器が消えました`); continue; }
      const kids = syms(r).filter((s) => s.parent === id && s.slot).map((s) => s.symbolId).sort();
      if (kids.join() !== wantKids(to).join()) bad.push(`${name}：中身が違います（${kids.join('・')}）`);
      const relays = syms(r).filter((s) => s.parent === id && !s.slot && /^relay-/.test(s.symbolId));
      if (relays.length !== 1 || relays[0]!.symbolId !== `relay-${to.control}`) bad.push(`${name}：継電器が違います（${relays.map((x) => x.symbolId).join('・')}）`);
      const inN = inPort(pas);
      if (Math.abs(inN[0]! - in0[0]!) > 0.01 || Math.abs(inN[1]! - in0[1]!) > 0.01) bad.push(`${name}：区分開閉器の入口の位置が動きました`);
      if (pas.label[0] !== to.sectionalizer.toUpperCase()) bad.push(`${name}：名前の文字が合っていません（${pas.label[0]}）`);
      if (pas.label.some((l) => /内蔵型$/.test(l)) !== (to.vt || to.la)) bad.push(`${name}：「内蔵型」の行が合っていません（${pas.label.join('｜')}）`);
      // 余分な線・記号が残っていない（足してすぐ、その入れ替え先にした図面と、同じ数）
      const direct = addSectionalizerSet(base, to).doc;
      // 客柱は、入れ替えない（いまのまま残る）：入れ替える前と、同じ位置に、同じものが残る
      const polesBefore = syms(doc).filter((x) => x.parent === id && x.symbolId === 'pole-customer');
      const polesAfter = syms(r).filter((x) => x.parent === id && x.symbolId === 'pole-customer');
      if (polesBefore.length !== polesAfter.length || polesBefore.some((b, i) => b.id !== polesAfter[i]!.id || Math.abs(b.x - polesAfter[i]!.x) > 0.01 || Math.abs(b.y - polesAfter[i]!.y) > 0.01)) bad.push(`${name}：入れ替えたら、客柱が変わりました（${polesBefore.length}→${polesAfter.length}）`);
      const poleDiff = polesAfter.length - syms(direct).filter((x) => x.symbolId === 'pole-customer' && x.parent).length;
      if (syms(r).length !== syms(direct).length + poleDiff || wiresOf(r).length !== wiresOf(direct).length) bad.push(`${name}：記号・線の数が、はじめから足したときと違います（記号 ${syms(r).length}/${syms(direct).length}・線 ${wiresOf(r).length}/${wiresOf(direct).length}）`);
      // つなぎ先が、図面にある
      const ids = new Set(r.items.map((i) => i.id));
      for (const w of wiresOf(r)) for (const a of [w.at1, w.at2]) if (a && !ids.has(a.item)) bad.push(`${name}：線のつなぎ先が、図面にありません（${a.item}）`);
      // 線・文字の問題は、増えない（組み合わせのうち、7通りに1つで、全体を調べる）
      if (k++ % 7 === 0 && problems(r) > baseP) bad.push(`${name}：入れ替えたら、重なり・つながっていない線・斜めの線が増えました`);
    }
  }
  console.log(`  足したセット：${n}通り（24 × 24）で、中身・継電器・入口の位置・名前の文字が決まりどおり。余分な線は残らない`);

  // (2) 自動作図の区分開閉器：上下につながっている線は、そのまま。入力の書き戻し・作り直しでも壊れない
  const raw: Answers = { ...answersSpread, areaCount: '1' };
  const gen = buildGenerated(toEff(raw));
  const pas0 = syms(gen).find((s) => s.id === 'pas')!;
  const portWires = (d: Doc) => wiresOf(d).filter((w) => w.at1?.item === 'pas' || w.at2?.item === 'pas').map((w) => w.id).sort().join();
  const w0 = portWires(gen);
  for (const to of SECTIONALIZER_SETS.filter((s, i) => i % 3 === 0)) {
    const r = swapSectionalizerSet(gen, 'pas', to);
    const name = `自動作図の区分開閉器→${to.id}`;
    if (!r) { bad.push(`${name}：入れ替えられません`); continue; }
    if (portWires(r) !== w0) bad.push(`${name}：区分開閉器の上下につながっていた線が、変わりました`);
    const kids = syms(r).filter((s) => s.parent === 'pas' && s.slot).map((s) => s.symbolId).sort();
    if (kids.join() !== wantKids(to).join()) bad.push(`${name}：中身が違います（${kids.join('・')}）`);
    if (syms(r).filter((s) => /^relay-(gr|dgr)$/.test(s.symbolId) && !/^(relay|relay-tt)$/.test(s.id) && (s.parent === 'pas' || /pas/.test(s.id))).length !== 1) bad.push(`${name}：区分開閉器の継電器が1つではありません`);
    if (problems(r) > problems(gen)) bad.push(`${name}：入れ替えたら、重なり・つながっていない線・斜めの線が増えました`);
    const cur: Doc = { ...r, edited: true };
    const wb = writeBack(raw, cur, toEff);
    const rb = rebuildWithOverrides(wb ? buildGenerated(toEff(wb.answers)) : buildGenerated(toEff(raw)), wb ? wb.doc : cur);
    if (!syms(rb.doc).some((s) => s.id === 'pas')) bad.push(`${name}：書き戻し・作り直しで、区分開閉器が消えました`);
    const left = wiresOf(rb.doc).filter((w) => [w.at1, w.at2].some((a) => a && !rb.doc.items.some((i) => i.id === a.item)));
    if (left.length > 0) bad.push(`${name}：書き戻し・作り直しのあと、つなぎ先の無い線があります`);
  }
  console.log('  自動作図の区分開閉器：上下の線はそのまま。書き戻し・作り直しでも、区分開閉器は残り、つなぎ先の無い線は出ない');

  // (3) 回してある区分開閉器は、入れ替えない
  {
    const { doc, id } = addSectionalizerSet(base, SECTIONALIZER_SETS[0]!);
    const rotated: Doc = { ...doc, items: doc.items.map((i) => (i.id === id && i.kind === 'symbol' ? { ...i, rotate: 90 } : i)) };
    if (swapSectionalizerSet(rotated, id, SECTIONALIZER_SETS[5]!) !== null) bad.push('回してある区分開閉器を、入れ替えています');
    if (!isSectionalizer(syms(doc).find((s) => s.id === id)) || isSectionalizer(syms(base).find((s) => s.symbolId === 'ds'))) bad.push('区分開閉器の判定が合っていません');
  }
  if (bad.length > 0) fail(`区分開閉器の入れ替えに問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
}

console.log('\n■ 区分開閉器どうしの差し替え：名前の文字も、差し替え先に合わせる（第20弾・書き戻しの残り ①）');
{
  const bad: string[] = [];
  const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const base = fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const { doc, id } = addSectionalizerSet(base, SECTIONALIZER_SETS.find((s) => s.id === 'pas-dgr-vt-la')!);
  const at = (d: Doc) => syms(d).find((s) => s.id === id)!;
  const first = at(doc).label[0];
  if (first !== 'PAS') bad.push(`足した直後の名前の文字が PAS ではありません（${first}）`);
  for (const to of ['pgs', 'ugs', 'pas'] as const) {
    const r = replaceSymbol(doc, id, to);
    const l = at(r).label;
    if (l[0] !== to.toUpperCase()) bad.push(`${to} に差し替えたのに、名前の文字が ${to.toUpperCase()} になりません（${l[0]}）`);
    if (l.slice(1).join('|') !== at(doc).label.slice(1).join('|')) bad.push(`${to} に差し替えたら、2行目以降の文字が変わりました`);
  }
  // PGS → PAS の往復で、元に戻る
  const round = replaceSymbol(replaceSymbol(doc, id, 'pgs'), id, 'pas');
  if (at(round).label[0] !== 'PAS') bad.push('PAS → PGS → PAS で、名前の文字が元に戻りません');
  // 手で書き換えた名前の文字（PAS・PGS・UGS 以外）は、そのまま
  const hand: Doc = { ...doc, items: doc.items.map((i) => (i.id === id && i.kind === 'symbol' ? { ...i, label: ['手書きの名前', ...i.label.slice(1)] } : i)) };
  if (at(replaceSymbol(hand, id, 'pgs')).label[0] !== '手書きの名前') bad.push('手で書き換えた名前の文字が、差し替えで消えました');
  // 区分開閉器でない記号の差し替えでは、文字は動かない
  const ds = syms(base).find((s) => s.symbolId === 'ds');
  if (ds) {
    const r = replaceSymbol(base, ds.id, 'lbs');
    const a = syms(r).find((s) => s.id === ds.id)!;
    if (a.label.join('|') !== ds.label.join('|')) bad.push('DS → LBS の差し替えで、文字が変わりました');
  }
  if (bad.length > 0) fail(`区分開閉器の差し替えの名前の文字に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  PAS・PGS・UGS どうしの差し替えで、1行目の名前の文字が変わる（2行目以降・手書きの名前・ほかの記号は、そのまま）');
}
