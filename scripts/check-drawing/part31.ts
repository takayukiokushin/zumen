/**
 * 図面の検証（check-drawing）の31個目：行き止まりの分岐（図面にない設備へ。第20弾・図面再現の診断から）。
 * 2か所目以降のエリアの形態で「行き止まりの分岐」を選ぶと、ケーブル → 開閉器の箱（AS・PAS・PGS・GS）→ 行き先の名前だけを描く。
 * エリアの枠・変圧器・受電側の開閉器などは、描かない。
 */
import { areaView, buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS, totalTransformerKva, visibleQuestions, withAutoValues } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answers, fail } from './common.ts';

console.log('\n■ 行き止まりの分岐（図面にない設備へ）');
{
  const bad: string[] = [];
  const base: Answers = {
    ...answers, mainBreakerForm: 'cb', transformerCount: 1, hasPv: 'no', hasBattery: 'no', hasGenerator: 'no', hasCapacitor: 'no',
    areaCount: 2, 'a2:linkTap': 'bus', 'a2:linkCable': 'yes',
  };
  const mk = (extra: Answers): Answers => withAutoValues({ ...base, areaForm__2: 'dead-end', ...extra } as Answers);
  const items = (a: Answers) => buildComposition(a).filter((i) => i.role.startsWith('a2:'));
  const label = (a: Answers, role: string) => items(a).find((i) => i.role === `a2:${role}`)?.label.join('|');
  const sym = (a: Answers, role: string) => items(a).find((i) => i.role === `a2:${role}`)?.symbolId;

  if (!QUESTIONS.find((q) => q.id === 'areaForm')?.options?.some((o) => o.value === 'dead-end')) bad.push('「形態」に、行き止まりの分岐がありません');
  // 図面1の形：AS（VT内蔵型）＋DGR、行き先の名前
  const a = mk({ 'a2:deKind': 'as', 'a2:deControl': 'dgr', 'a2:deBuiltinVt': 'yes', 'a2:deRatedVoltage': '7200', 'a2:deRatedCurrent': '200', 'a2:deDestination': '消火栓設備へ' });
  const roles = items(a).map((i) => i.role.replace('a2:', ''));
  for (const r of ['cable-head-site', 'end-switch', 'end-switch-zct', 'end-switch-vt', 'end-switch-zpd', 'end-switch-relay', 'end-name']) if (!roles.includes(r)) bad.push(`図面1の形で、${r} がありません`);
  for (const r of ['area-frame', 'transformer', 'ds', 'main-breaker', 'ct']) if (roles.includes(r)) bad.push(`行き止まりの分岐に、${r} が描かれています`);
  if (label(a, 'end-switch') !== 'AS|7200V 200A|VT内蔵型') bad.push(`開閉器の文字が「AS|7200V 200A|VT内蔵型」ではありません（${label(a, 'end-switch')}）`);
  if (sym(a, 'end-switch') !== 'pas-builtin') bad.push(`VT内蔵のASが、箱の図記号になっていません（${sym(a, 'end-switch')}）`);
  if (sym(a, 'end-switch-relay') !== 'relay-dgr') bad.push('DGRが描かれていません');
  if (label(a, 'end-name') !== '消火栓設備へ') bad.push(`行き先の名前が違います（${label(a, 'end-name')}）`);
  // 種類ごとの図記号と名前
  const kinds: [string, Answers, string, string][] = [
    ['gs', { 'a2:deKind': 'gs', 'a2:deControl': 'none' }, 'gs', 'GS'],
    ['as', { 'a2:deKind': 'as', 'a2:deControl': 'none' }, 'as', 'AS'],
    ['pas', { 'a2:deKind': 'pas', 'a2:deControl': 'none' }, 'pas', 'PAS'],
    ['pgs', { 'a2:deKind': 'pgs', 'a2:deControl': 'gr', 'a2:deBuiltinVt': 'no' }, 'pas', 'PGS'],
    ['gs＋LA', { 'a2:deKind': 'gs', 'a2:deControl': 'none', 'a2:deBuiltinLa': 'yes' }, 'pas-builtin', 'GS|LA内蔵型'],
  ];
  for (const [name, extra, symWant, labelWant] of kinds) {
    const x = mk(extra);
    if (sym(x, 'end-switch') !== symWant) bad.push(`${name}：図記号が ${symWant} ではありません（${sym(x, 'end-switch')}）`);
    if (label(x, 'end-switch') !== labelWant) bad.push(`${name}：文字が「${labelWant}」ではありません（${label(x, 'end-switch')}）`);
  }
  // 行き先の名前が空なら、書かない
  if (items(mk({ 'a2:deDestination': '' })).some((i) => i.role === 'a2:end-name')) bad.push('行き先の名前が空なのに、書かれています');
  // 変圧器などは、答えがあっても、描かない・数えない
  const withTr = mk({ 'a2:transformerCount': 3, 'a2:trCapacity': 500, 'a2:hasCapacitor': 'yes' });
  if (items(withTr).some((i) => /transformer|capacitor|tr-lbs/.test(i.role))) bad.push('行き止まりの分岐のエリアに、変圧器・コンデンサの答えが残っていて、描かれています');
  if (totalTransformerKva(withTr).total !== totalTransformerKva({ ...base, areaCount: 1 } as Answers).total) bad.push('行き止まりの分岐のエリアの変圧器が、合計容量に数えられています');
  // 質問：行き止まりの質問が出る。変圧器・受電側の開閉器などの質問は出ない
  const view = areaView(effectiveAnswers(dropHiddenChoices(a)), 1);
  const ids = new Set(visibleQuestions(view, {}).map((q) => q.id));
  for (const id of ['deKind', 'deControl', 'deDestination']) if (!ids.has(id)) bad.push(`質問「${id}」が出ていません`);
  for (const id of ['transformerCount', 'areaIntake', 'hasGenerator', 'hasCapacitor']) if (ids.has(id)) bad.push(`行き止まりの分岐なのに、質問「${id}」が出ています`);
  // ふつうのエリアでは、行き止まりの質問は出ない
  const normalView = areaView(effectiveAnswers(dropHiddenChoices(withAutoValues({ ...base } as Answers))), 1);
  if (visibleQuestions(normalView, {}).some((q) => q.id === 'deKind')) bad.push('ふつうのエリアに、行き止まりの質問が出ています');
  // 図面：点検の問題が出ない。行き先の名前は、箱の下
  const lay = layout(buildComposition(a), a);
  const problems = inspectDrawing(fromLayout(lay), 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (problems.length > 0) bad.push(`行き止まりの分岐の図面に、点検の問題が ${problems.length}件あります（${problems[0]!.message}）`);
  const box = lay.symbols.find((x) => x.role === 'a2:end-switch');
  const name = lay.symbols.find((x) => x.role === 'a2:end-name');
  if (!box || !name || !(name.y > box.y + 40)) bad.push('行き先の名前が、開閉器の箱の下にありません');
  if (bad.length > 0) fail(`行き止まりの分岐に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  形態で「行き止まりの分岐」を選ぶと、ケーブル → AS・PAS・PGS・GSの箱（VT・LA・GR・DGR内蔵）→ 行き先の名前だけ。枠・変圧器などは描かず、数えない');
}
