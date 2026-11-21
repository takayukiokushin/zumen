/**
 * 図面の検証（check-drawing）の18個目：記号の文字の位置（第20弾 項目3）。
 * A：記号を動かすと、文字は標準の位置に戻る（そこでも重なるときだけ、逃げる）。
 * B：記号を選んでいるとき、文字だけを動かせる。記号を動かすと、文字は標準の位置に戻る。
 */
import { addSymbol, fromLayout, moveItem, moveItems, moveLabel, standardLabelOffset } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing, settleLabels } from '../../apps/web/src/editor/inspect.ts';
import { rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import { addSectionalizerSet } from '../../apps/web/src/editor/sectionalizerSets.ts';
import { buildGenerated } from '../../apps/web/src/editor/writeback.ts';
import { SECTIONALIZER_SETS, buildComposition, normalizeAnswers, QUESTIONS, withAutoValues } from '../../packages/knowledge/src/index.ts';
import type { Answers, Value } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 記号の文字の位置：動かすと標準に戻る／文字だけを動かせる');
{
  const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const withLabel = (d: Doc) => syms(d).filter((s) => s.label.length > 0);
  const problems = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew'].includes(i.kind)).length;
  const bad: string[] = [];
  const base = fromLayout(layout(buildComposition(answersSpread), answersSpread));
  const p0 = problems(base);
  const labeled = withLabel(base).filter((s) => !s.parent);
  if (labeled.length < 10) fail(`文字の付いた記号が少なすぎます（${labeled.length}）`);

  // 標準の位置：自動作図の記号は、自動作図が決めた位置
  for (const s of labeled) {
    const std = standardLabelOffset(base, s);
    if (std.dx !== s.labelDx || std.dy !== s.labelDy) bad.push(`${s.id}：標準の位置が、自動作図の位置と違います`);
  }

  // A：ずれた文字（自動補正で逃げたあとの位置）は、記号を動かすと、標準の位置に戻る
  let backed = 0;
  for (const s of labeled) {
    const std = standardLabelOffset(base, s);
    const away = moveLabel(base, s.id, 37, 23);
    const back = settleLabels(moveItem(away, s.id, 0, 0), [s.id]);
    const n = syms(back).find((x) => x.id === s.id)!;
    // 標準の位置に戻る（そこが重なるときは、逃げた位置のこともある。そのときは、標準の位置から、近いところ）
    if (n.labelDx === std.dx && n.labelDy === std.dy) backed++;
    else if (Math.hypot(n.labelDx - std.dx, n.labelDy - std.dy) > 120) bad.push(`${s.id}：文字が、標準の位置から遠くに置かれました`);
  }
  if (backed < labeled.length * 0.7) bad.push(`標準の位置に戻った文字が少なすぎます（${backed}/${labeled.length}）`);

  // B：文字だけを動かすと、記号は動かず、文字だけが動く。動かしたあとに、記号を動かすと、標準に戻る
  {
    const s = labeled[3]!;
    const m = moveLabel(base, s.id, 40, -15);
    const n = syms(m).find((x) => x.id === s.id)!;
    if (n.x !== s.x || n.y !== s.y) bad.push('文字だけを動かしたのに、記号が動きました');
    if (n.labelDx !== s.labelDx + 40 || n.labelDy !== s.labelDy - 15) bad.push('文字だけを動かした量が合いません');
    if (syms(m).some((x) => x.id !== s.id && (x.labelDx !== syms(base).find((b) => b.id === x.id)!.labelDx))) bad.push('文字だけを動かしたのに、ほかの記号の文字が動きました');
    const moved = settleLabels(moveItem(m, s.id, 20, 0), [s.id]);
    const k = syms(moved).find((x) => x.id === s.id)!;
    const std = standardLabelOffset(base, s);
    if (Math.hypot(k.labelDx - std.dx, k.labelDy - std.dy) > 120) bad.push('手で動かした文字が、記号を動かしても、標準の位置に戻りません');
    // 複数の記号をまとめて動かしたとき：それぞれ標準の位置に戻る
    const a = labeled[1]!, b = labeled[5]!;
    let mm = moveLabel(moveLabel(base, a.id, 30, 30), b.id, -30, 20);
    mm = settleLabels(moveItems(mm, [a.id, b.id], 10, 0), [a.id, b.id]);
    for (const t of [a, b]) {
      const nt = syms(mm).find((x) => x.id === t.id)!;
      const st = standardLabelOffset(base, t);
      if (Math.hypot(nt.labelDx - st.dx, nt.labelDy - st.dy) > 120) bad.push(`まとめて動かしたとき、${t.id} の文字が標準に戻りません`);
    }
  }

  // 標準の位置が、ほかの記号でふさがれているとき：標準には戻さず、重ならない場所へ逃げる
  {
    const s = labeled.find((x) => x.symbolId === 'ds') ?? labeled[2]!;
    const std = standardLabelOffset(base, s);
    const added = addSymbol(base, 'ds', s.x + std.dx + 30, s.y + std.dy - 5);
    const clash = settleLabels(moveLabel(added.doc, s.id, 15, 15), [s.id]);
    const k = syms(clash).find((x) => x.id === s.id)!;
    if (k.labelDx === std.dx && k.labelDy === std.dy) bad.push('標準の位置がふさがれているのに、標準の位置に戻しています');
    if (syms(clash).some((x) => x.id !== s.id && x.id !== added.id && (x.labelDx !== syms(base).find((b) => b.id === x.id)!.labelDx))) bad.push('逃がしたとき、ほかの記号の文字まで動いています');
  }

  // すべての記号で：動かして整えても、線・文字の問題は、動かしただけのときより増えず、動かしていない記号の文字は変わらない
  // （動かす向きによっては、つながっている線が斜めになる。それは、文字とは関係ないので、動かしただけのときと比べる）
  let n = 0;
  for (const s of labeled) {
    n++;
    const only = moveItem(base, s.id, 10, 0);
    const r = settleLabels(moveItem(moveLabel(base, s.id, 25, 25), s.id, 10, 0), [s.id]);
    if (problems(r) > problems(only)) bad.push(`${s.id}：動かして整えたら、重なり・つながっていない線・斜めの線が増えました（${problems(only)}→${problems(r)}）`);
    for (const o of syms(r)) {
      const b0 = syms(base).find((x) => x.id === o.id)!;
      // 動かしていない記号（線につられて動いたものも）の文字は、そのまま
      if (o.id !== s.id && (o.labelDx !== b0.labelDx || o.labelDy !== b0.labelDy)) bad.push(`${s.id} を動かしたら、動かしていない ${o.id} の文字の位置が変わりました`);
    }
  }

  // 手で足した区分開閉器の完成形：文字は、完成形の位置が標準
  {
    const set = SECTIONALIZER_SETS.find((x) => x.id === 'pas-dgr-vt-la')!;
    const { doc, id } = addSectionalizerSet(base, set);
    const pas = syms(doc).find((x) => x.id === id)!;
    const std0 = standardLabelOffset(doc, pas);
    if (std0.dx !== pas.labelDx || std0.dy !== pas.labelDy) bad.push('区分開閉器の完成形の文字の標準の位置が、完成形の位置と違います');
    const m = settleLabels(moveItem(moveLabel(doc, id, 50, 50), id, 5, 0), [id]);
    const k = syms(m).find((x) => x.id === id)!;
    if (Math.hypot(k.labelDx - pas.labelDx, k.labelDy - pas.labelDy) > 120) bad.push('区分開閉器の完成形の文字が、動かしたあと、標準の位置に戻りません');
  }

  // 手で動かした文字の位置は、図面を作り直しても残る
  {
    const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
    const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
    const raw: Answers = { ...answersSpread, areaCount: '1' };
    const gen = buildGenerated(toEff(raw));
    const t = syms(gen).filter((x) => x.label.length > 0 && !x.parent)[4]!;
    const cur: Doc = { ...moveLabel(gen, t.id, 33, 17), edited: true };
    const re = rebuildWithOverrides(buildGenerated(toEff(raw)), cur);
    const k = syms(re.doc).find((x) => x.id === t.id);
    if (!k || k.labelDx !== t.labelDx + 33 || k.labelDy !== t.labelDy + 17) bad.push('手で動かした文字の位置が、図面を作り直したあとに残っていません');
  }

  if (bad.length > 0) fail(`記号の文字の位置に問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
  else console.log(`  標準の位置に戻る（${backed}/${labeled.length}）。文字だけを動かせて、記号は動かない。まとめて動かしても、それぞれ戻る。${n}個の記号で、動かして整えても、問題は増えない。作り直しても、手で動かした文字は残る`);
}
