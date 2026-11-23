/**
 * 図面の検証（check-drawing）の32個目：GS（ガス開閉器）の定格の書き方（第20弾・図面再現の診断から）。
 * 「7200V 200A」（電圧と電流のあいだは半角スペース1つ）。電流が不明なら「7200V -A」。電圧も電流も無ければ、GSの文字だけ。
 * 送り出し・機器（変圧器・コンデンサ・発電機・電動機）の高圧ケーブルの開閉器・行き止まりの分岐・記号の追加、のどれでも、同じ書き方。
 */
import { areaView, buildComposition, dropHiddenChoices, effectiveAnswers, visibleQuestions, withAutoValues } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { answers, fail } from './common.ts';

console.log('\n■ GS（ガス開閉器）の定格の書き方');
{
  const bad: string[] = [];
  const mk = (extra: Answers): Answers => withAutoValues({ ...answers, mainBreakerForm: 'cb', hasPv: 'no', hasBattery: 'no', hasGenerator: 'no', areaCount: 2, 'a2:linkTap': 'bus', 'a2:linkCable': 'yes', ...extra } as Answers);
  const label = (a: Answers, role: string) => buildComposition(a).find((i) => i.role === role)?.label.join('|');

  // 送り出しのGS
  const sg = (extra: Answers) => label(mk({ 'a2:linkSwitch': 'gs', ...extra }), 'a2:sendout-gs');
  if (sg({ 'a2:linkGsVoltage': '7200', 'a2:linkGsCurrent': '200A' }) !== 'GS|7200V 200A') bad.push(`送り出しのGSの定格が「GS|7200V 200A」ではありません（${sg({ 'a2:linkGsVoltage': '7200', 'a2:linkGsCurrent': '200A' })}）`);
  if (sg({ 'a2:linkGsVoltage': '7200' }) !== 'GS|7200V -A') bad.push(`電流が空欄のとき、「7200V -A」になりません（${sg({ 'a2:linkGsVoltage': '7200' })}）`);
  if (sg({ 'a2:linkGsVoltage': '7200', 'a2:linkGsCurrent': '-A' }) !== 'GS|7200V -A') bad.push('電流が「-A」のとき、「7200V -A」になりません');
  if (sg({}) !== 'GS') bad.push(`電圧も電流も無いとき、GSの文字だけになりません（${sg({})}）`);
  // 2段目
  const s2 = label(mk({ 'a2:linkStageCount': '2', 'a2:linkSwitch': 'ds', 'a2:link2Switch': 'gs', 'a2:link2Cable': 'yes', 'a2:link2GsVoltage': '6600', 'a2:link2GsCurrent': '100A' }), 'a2:sendout-gs-2');
  if (s2 !== 'GS|6600V 100A') bad.push(`2段目のGSの定格が違います（${s2}）`);
  // 質問は、GSのときだけ
  const qs = (sw: string) => new Set(visibleQuestions(areaView(effectiveAnswers(dropHiddenChoices(mk({ 'a2:linkSwitch': sw }))), 1), {}).map((q) => q.id));
  if (!qs('gs').has('linkGsVoltage') || !qs('gs').has('linkGsCurrent') || qs('as').has('linkGsVoltage') || qs('vcb').has('linkGsCurrent')) bad.push('GSの定格の質問が、GSのときだけ出ていません');

  // 機器の高圧ケーブルのあとの開閉器（コンデンサ）
  const cap = mk({ hasCapacitor: 'yes', capacitorCount: 1, capHasCable: 'yes', capCableDn1: 'gs', capGsVoltage: '7200', capGsCurrent: '200A', transformerCount: 1 });
  const capLabel = label(cap, 'cap-cable-dn1');
  if (capLabel !== 'GS|7200V 200A') bad.push(`コンデンサのケーブルのあとのGSの定格が違います（${capLabel}）`);
  const cap2 = mk({ hasCapacitor: 'yes', capacitorCount: 1, capHasCable: 'yes', capCableDn1: 'gs', capGsVoltage: '7200', transformerCount: 1 });
  if (label(cap2, 'cap-cable-dn1') !== 'GS|7200V -A') bad.push('コンデンサのGSで、電流が空欄のとき、「7200V -A」になりません');
  const capAs = mk({ hasCapacitor: 'yes', capacitorCount: 1, capHasCable: 'yes', capCableDn1: 'as', capGsVoltage: '7200', transformerCount: 1 });
  if (label(capAs, 'cap-cable-dn1') !== 'AS') bad.push(`GS以外の開閉器（AS）に、GSの定格が混ざっています（${label(capAs, 'cap-cable-dn1')}）`);

  // 行き止まりの分岐のGS
  const de = (extra: Answers) => label(mk({ areaForm__2: 'dead-end', 'a2:deKind': 'gs', 'a2:deControl': 'none', ...extra }), 'a2:end-switch');
  if (de({ 'a2:deRatedVoltage': '7200', 'a2:deRatedCurrent': '200' }) !== 'GS|7200V 200A') bad.push(`行き止まりのGSの定格が違います（${de({ 'a2:deRatedVoltage': '7200', 'a2:deRatedCurrent': '200' })}）`);
  if (de({ 'a2:deRatedVoltage': '7200' }) !== 'GS|7200V -A') bad.push('行き止まりのGSで、電流が空欄のとき、「7200V -A」になりません');

  // 記号を追加：1行で、電圧と電流のあいだは半角スペース1つ
  const gs = getSymbol('gs');
  if (!gs.labelLines?.includes('{ratedVoltage}V {ratedCurrent}A')) bad.push(`追加するGSの記号の文字が、「{ratedVoltage}V {ratedCurrent}A」の1行ではありません（${gs.labelLines?.join('／')}）`);
  if (bad.length > 0) fail(`GSの定格の書き方に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  GSの定格は「7200V 200A」（半角スペース1つ）。電流が不明なら「7200V -A」。送り出し・機器のケーブルのあと・行き止まりの分岐・記号の追加で、同じ');
}
