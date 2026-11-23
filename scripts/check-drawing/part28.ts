/**
 * 図面の検証（check-drawing）の28個目：母線から直接の送り出しに、VCBの次のCT・OCRを付ける（第20弾・図面再現の診断から）。
 * これまでは、「変圧器の二次側」からの送り出しだけが、途中の機器（VT・CT・ZPD・GC）と継電器を付けられた。母線から直接の送り出し（高圧動力盤）にも付けられる。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS, visibleQuestions, withAutoValues } from '../../packages/knowledge/src/index.ts';
import { linkPartPositions } from '../../packages/knowledge/src/link-parts.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answers, fail } from './common.ts';

console.log('\n■ 母線から直接の送り出しに、VCBの次のCT・OCR');
{
  const bad: string[] = [];
  const mk = (extra: Answers): Answers =>
    withAutoValues({
      ...answers, mainBreakerForm: 'cb', transformerCount: 2, hasPv: 'no', hasCapacitor: 'no', hasBattery: 'no', hasGenerator: 'no',
      areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:linkTap': 'bus', ...extra,
    } as Answers);
  const draw = (extra: Answers) => { const a = mk(extra); return { lay: layout(buildComposition(a), a), a }; };
  const rel: Answers = {
    'a2:linkSwitch': 'ds-vcb', 'a2:linkCable': 'yes', 'a2:linkGroundRelay': 'none',
    'a2:linkPartCount': '1', 'a2:linkPart1Kind': 'ct', 'a2:linkPart1CtRatio': '100', 'a2:linkRelayOCR': 'yes', 'a2:linkRelayOCRAt': 'part-1',
  };
  // 位置は、はじめから「1段目の開閉器の次」。「変圧器の出口の次」は、母線から直接のときは選べない
  const pos = mk(rel)['a2:linkPart1Pos'];
  if (pos !== 'sw1') bad.push(`母線からのとき、位置の初期値が「1段目の開閉器の次」ではありません（${String(pos)}）`);
  const posQ = QUESTIONS.find((q) => q.id === 'linkPart1Pos');
  const tr = posQ?.options?.find((o) => o.value === 'tr');
  if (!tr?.showIf) bad.push('「変圧器の出口の次」が、母線からのときも選べる状態です');
  if (!linkPartPositions().find((o) => o.value === 'tr')?.open) bad.push('位置の一覧で、「変圧器の出口の次」に条件がありません');
  // 質問が出る
  const view = effectiveAnswers(dropHiddenChoices(mk(rel)));
  const areaQs = visibleQuestions({ ...view, areaNo: 2, linkTap: 'bus' } as Answers, {}).map((q) => q.id);
  for (const id of ['linkPartCount', 'linkRelayOCR']) if (!areaQs.includes(id)) bad.push(`母線からのとき、「${id}」の質問が出ません`);

  const { lay, a } = draw(rel);
  const at = (r: string) => lay.symbols.find((x) => x.role.endsWith(r));
  const vcb = at('sendout-vcb');
  const ct = at('sendout-part-1-ct');
  const ocr = at('sendout-relay-ocr');
  const tc = at('sendout-trip-coil');
  if (!vcb || !ct || !ocr || !tc) bad.push(`VCB・CT・OCR・TCのどれかが描かれていません（${[vcb, ct, ocr, tc].map((x) => (x ? '○' : '×')).join('')}）`);
  else {
    if (!(ct.y > vcb.y)) bad.push('CTが、VCBの下（次）にありません');
    if (!(ocr.x > ct.x)) bad.push('OCRが、CTの右にありません');
    if (!lay.wires.some((w) => Math.abs(w.y1 - w.y2) < 0.5 && Math.min(w.x1, w.x2) <= ocr.x && Math.max(w.x1, w.x2) >= ct.x)) bad.push('CTとOCRが、横の線でつながっていません');
  }
  // 点検：問題が増えない（CT・OCRなしと比べる）
  const count = (x: ReturnType<typeof draw>) => inspectDrawing(fromLayout(x.lay), 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind)).length;
  const plain = draw({ 'a2:linkSwitch': 'ds-vcb', 'a2:linkCable': 'yes' });
  if (count({ lay, a }) > count(plain)) bad.push(`CT・OCRを付けた図面の点検の問題が、${count(plain)}件から ${count({ lay, a })}件に増えました`);
  // 付けなければ、これまでと同じ（記号の数が変わらない）
  if (plain.lay.symbols.some((x) => /sendout-part|sendout-relay/.test(x.role))) bad.push('付けていないのに、途中の機器・継電器が描かれています');
  if (bad.length > 0) fail(`母線からの送り出しのCT・OCRに問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  母線から直接の送り出しにも、VCBの次にCT、その右にOCR（とTC）を付けられる。位置は、はじめから「1段目の開閉器の次」。付けなければ、これまでどおり');
}
