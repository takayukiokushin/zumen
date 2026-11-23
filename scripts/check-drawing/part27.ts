/**
 * 図面の検証（check-drawing）の27個目：送り出しの盤の名称・VCBの番号（第20弾・図面再現の診断から）。
 * 「盤の名称」は、送り出し1段目の、いちばん上の開閉器の文字の先頭に。「VCBの番号」は、VCBの文字を「VCB(No.2)」の形に。どちらも任意。
 */
import { areaView, buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS, visibleQuestions } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 送り出しの盤の名称・VCBの番号');
{
  const bad: string[] = [];
  const make = (extra: Answers) => {
    const raw: Answers = { ...answersSpread, areaCount: '2', 'a2:linkTap': 'bus', 'a2:linkCable': 'yes', 'a2:linkCableInstallation': 'buried', 'a2:linkCableStructure': 'CVT', ...extra };
    const eff = effectiveAnswers(dropHiddenChoices(raw));
    return { items: buildComposition(eff), eff };
  };
  const label = (items: ReturnType<typeof buildComposition>, role: string) => items.find((i) => i.role === role)?.label.join('/');
  for (const id of ['linkPanelName', 'linkVcbNo']) if (!QUESTIONS.find((x) => x.id === id)) bad.push(`${id} の質問がありません`);
  const NAME = '高圧動力盤No.1';
  // 空欄：これまでどおり（DS／VCB）
  const a = make({ 'a2:linkSwitch': 'ds-vcb' });
  if (label(a.items, 'a2:sendout-ds') !== 'DS' || label(a.items, 'a2:sendout-vcb') !== 'VCB') bad.push(`空欄のとき、文字が変わりました（${label(a.items, 'a2:sendout-ds')}・${label(a.items, 'a2:sendout-vcb')}）`);
  // DS＋VCB：盤の名称は、いちばん上のDSにだけ。VCBは「VCB(No.2)」
  const b = make({ 'a2:linkSwitch': 'ds-vcb', 'a2:linkPanelName': NAME, 'a2:linkVcbNo': 'No.2' });
  if (label(b.items, 'a2:sendout-ds') !== `${NAME}/DS`) bad.push(`DS＋VCBで、DSの文字が「${NAME}/DS」ではありません（${label(b.items, 'a2:sendout-ds')}）`);
  if (label(b.items, 'a2:sendout-vcb') !== 'VCB(No.2)') bad.push(`VCBの文字が「VCB(No.2)」ではありません（${label(b.items, 'a2:sendout-vcb')}）`);
  // VCBだけ：盤の名称は、VCBの先頭に
  const c = make({ 'a2:linkSwitch': 'vcb', 'a2:linkPanelName': NAME, 'a2:linkVcbNo': 'No.3' });
  if (label(c.items, 'a2:sendout-vcb') !== `${NAME}/VCB(No.3)`) bad.push(`VCBだけのとき、文字が違います（${label(c.items, 'a2:sendout-vcb')}）`);
  // LBS・VCSなど、ほかの開閉器でも、いちばん上に
  const d = make({ 'a2:linkSwitch': 'lbs', 'a2:linkPanelName': NAME });
  if (!label(d.items, 'a2:sendout-lbs')?.startsWith(`${NAME}/LBS`)) bad.push(`LBSのとき、盤の名称が先頭に付いていません（${label(d.items, 'a2:sendout-lbs')}）`);
  // 開閉器なし：質問が出ない／文字も出ない
  const e = make({ 'a2:linkSwitch': 'none', 'a2:linkPanelName': NAME });
  const view = { ...e.eff, areaNo: 2, linkSwitch: 'none' } as Answers;
  if (visibleQuestions(view, {}).some((x) => x.id === 'linkPanelName')) bad.push('開閉器なしのとき、「盤の名称」の質問が出ています');
  if (e.items.some((i) => i.label.some((l) => l.includes(NAME)))) bad.push('開閉器なしのとき、盤の名称が図面に出ています');
  // 送り出しのDS・VCBの定格（任意）：DS・VCBの文字の下に、そのまま書く。段ごと。空欄なら書かない
  const r = make({ 'a2:linkSwitch': 'ds-vcb', 'a2:linkPanelName': NAME, 'a2:linkVcbNo': 'No.4', 'a2:linkDsRating': '7200V 400A', 'a2:linkVcbRating': '7200V 400A 12.5kA' });
  if (label(r.items, 'a2:sendout-ds') !== `${NAME}/DS/7200V 400A`) bad.push(`DSの定格が、DSの文字の下に出ていません（${label(r.items, 'a2:sendout-ds')}）`);
  if (label(r.items, 'a2:sendout-vcb') !== 'VCB(No.4)/7200V 400A 12.5kA') bad.push(`VCBの定格が、VCBの文字の下に出ていません（${label(r.items, 'a2:sendout-vcb')}）`);
  const r2 = make({ 'a2:linkStageCount': '2', 'a2:linkSwitch': 'ds', 'a2:link2Switch': 'vcb', 'a2:linkDsRating': '7200V 200A', 'a2:link2VcbRating': '7200V 600A 12.5kA', 'a2:link2Cable': 'yes' });
  if (label(r2.items, 'a2:sendout-ds') !== 'DS/7200V 200A' || label(r2.items, 'a2:sendout-vcb-2') !== 'VCB/7200V 600A 12.5kA') bad.push(`2段目の定格が違います（${label(r2.items, 'a2:sendout-ds')}・${label(r2.items, 'a2:sendout-vcb-2')}）`);
  const onlyDs = make({ 'a2:linkSwitch': 'ds', 'a2:linkVcbRating': '7200V 400A 12.5kA' });
  if (label(onlyDs.items, 'a2:sendout-ds') !== 'DS') bad.push('DSだけのとき、VCBの定格の答えが、DSの文字に混ざっています');
  const qIds = (sw: string) => new Set(visibleQuestions(areaView(make({ 'a2:linkSwitch': sw }).eff, 1), {}).map((q) => q.id));
  if (!qIds('ds-vcb').has('linkDsRating') || !qIds('ds-vcb').has('linkVcbRating') || qIds('ds').has('linkVcbRating') || qIds('vcb').has('linkDsRating') || qIds('none').has('linkDsRating')) bad.push('DS・VCBの定格の質問が、開閉器に合わせて出ていません');
  // 図面：点検の問題が増えない
  const base = make({ 'a2:linkSwitch': 'ds-vcb' });
  const probs = (m: ReturnType<typeof make>) => inspectDrawing(fromLayout(layout(m.items, m.eff)), 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind)).length;
  if (probs(b) > probs(base)) bad.push(`盤の名称を入れた図面の点検の問題が、${probs(base)}件から ${probs(b)}件に増えました`);
  if (bad.length > 0) fail(`送り出しの盤の名称に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  盤の名称は、送り出し1段目のいちばん上の開閉器の先頭に。VCBは「VCB(No.2)」。DS・VCBの定格は、その文字の下に（任意）。空欄・開閉器なしのときは、これまでどおり');
}
