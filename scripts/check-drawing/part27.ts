/**
 * 図面の検証（check-drawing）の27個目：送り出しの盤の名称・VCBの番号（第20弾・図面再現の診断から）。
 * 「盤の名称」は、送り出し1段目の、いちばん上の開閉器の文字の先頭に。「VCBの番号」は、VCBの文字を「VCB(No.2)」の形に。どちらも任意。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS, visibleQuestions } from '../../packages/knowledge/src/index.ts';
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
  // 図面：点検の問題が増えない
  const base = make({ 'a2:linkSwitch': 'ds-vcb' });
  const probs = (m: ReturnType<typeof make>) => inspectDrawing(fromLayout(layout(m.items, m.eff)), 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind)).length;
  if (probs(b) > probs(base)) bad.push(`盤の名称を入れた図面の点検の問題が、${probs(base)}件から ${probs(b)}件に増えました`);
  if (bad.length > 0) fail(`送り出しの盤の名称に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  盤の名称は、送り出し1段目のいちばん上の開閉器の先頭に。VCBは「VCB(No.2)」。空欄・開閉器なしのときは、これまでどおり');
}
