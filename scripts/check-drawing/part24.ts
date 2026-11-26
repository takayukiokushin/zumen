/**
 * 図面の検証（check-drawing）の24個目：引込みの LA・PC の定格（第20弾・図面再現の診断から）。
 * LA の定格電圧・放電電流（空欄でもよい）、LA の上位が PC のときの、PC の定格電流・ヒューズ・本数（本数は、空欄なら3本）。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 引込みの LA・PC の定格（空欄でもよい）');
{
  const bad: string[] = [];
  const make = (extra: Answers) => {
    const raw: Answers = { ...answersSpread, hasLa: 'yes', laTap: 'ct-bus', laSwitch: 'pc', ...extra };
    const eff = effectiveAnswers(dropHiddenChoices(raw));
    return { items: buildComposition(eff), eff };
  };
  const label = (items: ReturnType<typeof buildComposition>, role: string) => items.find((i) => i.role === role)?.label.join('/');
  const q = (id: string) => QUESTIONS.find((x) => x.id === id);
  for (const id of ['laRatedVoltage', 'laDischargeCurrent', 'laPcRating', 'laPcFuse', 'laPcFuseCount']) if (!q(id)) bad.push(`${id} の質問がありません`);
  // 空欄：LA は「LA」だけ。PC は「PC」と、本数（3本）
  const a = make({});
  if (label(a.items, 'site-la') !== 'LA') bad.push(`空欄のとき、LAの文字が「LA」だけではありません（${label(a.items, 'site-la')}）`);
  if (label(a.items, 'la-switch') !== 'PC/F×3') bad.push(`空欄のとき、PCの文字が「PC/F×3」ではありません（${label(a.items, 'la-switch')}）`);
  // 入力：図面1と同じ（PC 30A・F×3・F:30A、LA 8.4kV・2.5kA）
  const b = make({ laRatedVoltage: '8.4kV', laDischargeCurrent: '2.5kA', laPcRating: '30A', laPcFuse: '30A' });
  if (label(b.items, 'site-la') !== 'LA/8.4kV/2.5kA') bad.push(`LAの文字が「LA/8.4kV/2.5kA」ではありません（${label(b.items, 'site-la')}）`);
  if (label(b.items, 'la-switch') !== 'PC/30A/F×3/F:30A') bad.push(`PCの文字が「PC/30A/F×3/F:30A」ではありません（${label(b.items, 'la-switch')}）`);
  // 本数の答え
  const c = make({ laPcFuseCount: '2' });
  if (label(c.items, 'la-switch') !== 'PC/F×2') bad.push('PCの本数の答え（2）が、使われていません');
  for (const v of ['9', '1']) if (label(make({ laPcFuseCount: v }).items, 'la-switch') !== 'PC/F×3') bad.push(`2・3以外の本数（${v}）が、3本になっていません`);
  // PC 以外（DS・LBS）：これまでどおり（定格の入力は、出ない）
  for (const [sw, txt] of [['ds', 'DS'], ['lbs', 'LBS']] as const) {
    const d = make({ laSwitch: sw, laPcRating: '30A' });
    if (label(d.items, 'la-switch') !== txt) bad.push(`${txt} のとき、文字が変わりました（${label(d.items, 'la-switch')}）`);
  }
  // 図面：点検の問題が増えない
  const doc = fromLayout(layout(b.items, b.eff));
  const problems = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (problems.length > 0) bad.push(`LA・PCの定格を入れた図面に、点検の問題が ${problems.length}件あります`);
  if (bad.length > 0) fail(`引込みのLA・PCの定格に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  LAの定格電圧・放電電流（空欄なら「LA」だけ）、PCの定格電流・ヒューズ・本数（空欄なら「F×3」）が、図面に出る。DS・LBSのときは、これまでどおり');
}

console.log('\n■ 電流が未記入のときの「-A」（第20弾・図面再現の診断から）');
{
  const bad: string[] = [];
  const make = (extra: Answers) => {
    const raw: Answers = { ...answersSpread, transformerCount: 1, ...extra };
    const eff = effectiveAnswers(dropHiddenChoices(raw));
    return buildComposition(eff);
  };
  const label = (items: ReturnType<typeof buildComposition>, role: string) => items.find((i) => i.role === role)?.label.join('/');
  const pcOpts = ['trPcFuse', 'capPcFuse', 'laPcFuse', 'trPfG', 'trPfLoadAmp', 'capPfG', 'capPfLoadAmp', 'lbsPfG'];
  for (const id of pcOpts) {
    const opts = QUESTIONS.find((x) => x.id === id)?.options?.map((o) => o.value) ?? [];
    if (!opts.includes('-A')) bad.push(`${id} の選択肢に「-A」がありません`);
  }
  // PC のヒューズ：「F:-A」
  const pc = label(make({ trHasPc: 'yes', trHasLbs: 'no', trPcRating: '30A', trPcFuse: '-A' }), 'tr-pc');
  if (!pc || !pc.endsWith('F:-A')) bad.push(`PCのヒューズが「F:-A」になりません（${pc}）`);
  // LBS の PF：「G-A T-A 40kA」
  const lbs = make({ trHasLbs: 'yes', trHasPc: 'no', trPfG: '-A', trPfLoadAmp: '-A', trPfKa: '40kA' }).find((i) => i.role === 'tr-lbs')?.label.join('/');
  if (!lbs || !lbs.includes('G-A T-A 40kA')) bad.push(`PFの文字が「G-A T-A 40kA」になりません（${lbs}）`);
  if (bad.length > 0) fail(`電流の「-A」に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  PC・PFの電流に「-A（未記入）」を選べ、図面には「F:-A」「G-A T-A」のように、そのまま出る');
}
