/**
 * 図面の検証（check-drawing）の29個目：変圧器の手前のVT（PF付）・CT（第20弾・図面再現の診断から。VEMの形）。
 * 変圧器ごとに、枝の中へ。LBS → CT → 変圧器の順で、VT（PF付）は、CT（無ければ変圧器）の真上で、右へ分かれる。付けなければ、これまでどおり。
 */
import { buildComposition, QUESTIONS, withAutoValues } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answers, fail } from './common.ts';

console.log('\n■ 変圧器の手前のVT（PF付）・CT');
{
  const bad: string[] = [];
  for (const id of ['trHasVt', 'trVtRatio', 'trHasCt', 'trCtRatio']) if (!QUESTIONS.find((q) => q.id === id)) bad.push(`${id} の質問がありません`);
  const mk = (extra: Answers): Answers =>
    withAutoValues({
      ...answers, mainBreakerForm: 'cb', transformerCount: 1, hasPv: 'no', hasBattery: 'no', hasGenerator: 'no', hasCapacitor: 'no',
      areaCount: 2, 'a2:areaIntake': 'none', 'a2:linkTap': 'bus', 'a2:linkCable': 'yes',
      'a2:transformerCount': 2, 'a2:trCapacity': 300, 'a2:trVoltage': '6600/210V', 'a2:trConnection': 'tr-3p-dy', 'a2:trUsage': '動力', 'a2:trHasLbs': 'yes', 'a2:trPfG': '40A', 'a2:trPfLoadAmp': '40A',
      'a2:trCapacity__2': 300, 'a2:trVoltage__2': '6600/210V', 'a2:trConnection__2': 'tr-3p-dy', 'a2:trUsage__2': '動力', 'a2:trHasLbs__2': 'yes',
      ...extra,
    } as Answers);
  const draw = (extra: Answers) => { const a = mk(extra); const items = buildComposition(a); return { items, lay: layout(items, a) }; };
  const plain = draw({});
  if (plain.items.some((i) => /tr-vt|tr-ct/.test(i.role))) bad.push('付けていないのに、VT・CTが出ています');
  // 1台目だけに、VT（PF付）とCT（40 → 40/5A）。2台目は付けない
  const on = draw({ 'a2:trHasVt': 'yes', 'a2:trHasCt': 'yes', 'a2:trCtRatio': '40' });
  const sym = (r: string) => on.lay.symbols.filter((x) => x.role.endsWith(r));
  if (sym('tr-ct').length !== 1 || sym('tr-vt').length !== 1 || sym('tr-vt-pf').length !== 1) bad.push(`1台目だけに付けたのに、数が合いません（CT ${sym('tr-ct').length}・VT ${sym('tr-vt').length}・PF ${sym('tr-vt-pf').length}）`);
  else {
    const lbs = on.lay.symbols.find((x) => x.role.endsWith('tr-lbs') && x.id.endsWith('-1'))!;
    const tr = on.lay.symbols.find((x) => x.role.endsWith('transformer') && x.id.endsWith('-1'))!;
    const ct = sym('tr-ct')[0]!;
    const vt = sym('tr-vt')[0]!;
    const pf = sym('tr-vt-pf')[0]!;
    if (!(lbs.y < ct.y && ct.y < tr.y)) bad.push('LBS → CT → 変圧器の順に並んでいません');
    if (!(vt.y > lbs.y + 40 && vt.y < ct.y + 20)) bad.push(`VTが、LBSとCTのあいだにありません（LBS ${Math.round(lbs.y)}・VT ${Math.round(vt.y)}・CT ${Math.round(ct.y)}）`);
    if (!(pf.x > ct.x && vt.x > pf.x)) bad.push('PF・VTが、列の右へ、順に並んでいません');
    if (ct.label.join('/') !== 'CT/40/5A') bad.push(`CTの文字が「CT/40/5A」ではありません（${ct.label.join('/')}）`);
    if (vt.label.join('/') !== 'VT＋PF/6600/110V') bad.push(`VTの文字が「VT＋PF/6600/110V」ではありません（${vt.label.join('/')}）`);
    // 2台目の列には、付いていない（別の台の記号に、つながっていない）
    const tr2 = on.lay.symbols.find((x) => x.role.endsWith('transformer') && x.id.endsWith('-2'))!;
    if (Math.abs(tr2.x - ct.x) < 40) bad.push('2台目の列に、CTが付いています');
  }
  // CTなし（VTだけ）、台数が3台（2台目だけ付ける）でも、点検の問題が増えない
  const variants: [string, Answers][] = [
    ['VTだけ', { 'a2:trHasVt': 'yes' }],
    ['CTだけ', { 'a2:trHasCt': 'yes', 'a2:trCtRatio': '40' }],
    ['2台目だけ', { 'a2:trHasVt__2': 'yes', 'a2:trHasCt__2': 'yes', 'a2:trCtRatio__2': '60' }],
  ];
  const count = (x: { lay: ReturnType<typeof layout> }) => inspectDrawing(fromLayout(x.lay), 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind)).length;
  for (const [name, extra] of variants) {
    const v = draw(extra);
    if (count(v) > count(plain)) bad.push(`${name}：点検の問題が、${count(plain)}件から ${count(v)}件に増えました`);
  }
  if (count(on) > count(plain)) bad.push(`VT・CTを付けた図面の点検の問題が、${count(plain)}件から ${count(on)}件に増えました`);
  if (bad.length > 0) fail(`変圧器の手前のVT・CTに問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  変圧器ごとに、LBS → CT → 変圧器。VT（PF付）は、CT（無ければ変圧器）の真上で右へ分かれる。付けなければ、これまでどおり');
}
