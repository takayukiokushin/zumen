/**
 * 図面の検証（check-drawing）の17個目：「記号を追加・差し替え」の「区分開閉器」リスト（第20弾 項目6）。
 * 24通り（PAS・PGS・UGS × GR・DGR × 内蔵4つ）の完成形を足したとき、中身が決まりどおりで、線・文字の問題が増えず、
 * 動かすと一緒に動き、消すと一緒に消え、作り直し・書き戻しでも、壊れない。
 */
import { fromLayout, moveItem, removeItem, replaceSymbol } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import { addSectionalizerSet, setThumb } from '../../apps/web/src/editor/sectionalizerSets.ts';
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
    if (added.length !== 1 + want.length + 1) bad.push(`${name}：足された記号の数が違います（${added.length}）`);
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
