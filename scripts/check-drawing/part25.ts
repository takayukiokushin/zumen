/**
 * 図面の検証（check-drawing）の25個目：客柱を描く／描かない（第20弾・図面再現の診断から）。
 * ふつうは描く（答えが無い以前の案件も描く）。「描かない」を選ぶと、PAS・PGSの左の客柱が出ない。UGSのときは、質問が出ない。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS, visibleQuestions } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 客柱を描く／描かない');
{
  const bad: string[] = [];
  const make = (extra: Answers) => {
    const raw: Answers = { ...answersSpread, ...extra };
    const eff = effectiveAnswers(dropHiddenChoices(raw));
    return { items: buildComposition(eff), eff };
  };
  const poles = (items: ReturnType<typeof buildComposition>) => items.filter((i) => i.role === 'customer-pole').length;
  const q = QUESTIONS.find((x) => x.id === 'customerPole');
  if (!q || q.defaultValue !== 'yes') bad.push('「客柱を描きますか？」の初期値が「描く」ではありません');
  for (const sec of ['pas', 'pgs']) {
    if (poles(make({ sectionalizer: sec }).items) !== 1) bad.push(`${sec}：答えが無いとき、客柱が1つ描かれません`);
    if (poles(make({ sectionalizer: sec, customerPole: 'yes' }).items) !== 1) bad.push(`${sec}：「描く」のとき、客柱が1つ描かれません`);
    const no = make({ sectionalizer: sec, customerPole: 'no' });
    if (poles(no.items) !== 0) bad.push(`${sec}：「描かない」のとき、客柱が残っています`);
    // 客柱が無くても、PASは描かれ、図面の点検の問題が増えない
    if (!no.items.some((i) => i.role === 'pas')) bad.push(`${sec}：「描かない」のとき、区分開閉器まで消えました`);
    const doc = fromLayout(layout(no.items, no.eff));
    const problems = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
    if (problems.length > 0) bad.push(`${sec}：客柱なしの図面に、点検の問題が ${problems.length}件あります`);
  }
  // UGS・なし：質問は出ない。客柱も出ない（「描かない」の答えが残っていても、UGSは描かない）
  for (const sec of ['ugs', 'none']) {
    const a = make({ sectionalizer: sec });
    if (visibleQuestions(a.eff, {}).some((x) => x.id === 'customerPole')) bad.push(`${sec}：「客柱を描きますか？」の質問が出ています`);
    if (poles(a.items) !== 0) bad.push(`${sec}：客柱が描かれています`);
  }
  if (!visibleQuestions(make({ sectionalizer: 'pas' }).eff, {}).some((x) => x.id === 'customerPole')) bad.push('PASのとき、「客柱を描きますか？」の質問が出ません');
  if (bad.length > 0) fail(`客柱の描く／描かないに問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  客柱は、ふつう描く（答えが無い案件も）。「描かない」で、PAS・PGSの左の客柱だけが消える。UGS・区分開閉器なしのときは、質問が出ない');
}
