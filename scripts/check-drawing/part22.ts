/**
 * 図面の検証（check-drawing）の22個目：GS（ガス開閉器。ASのガス絶縁版）（第20弾・図面再現の診断から）。
 * 絵はASと同じ形で、名前だけ「GS」。ケーブルの手前・あとの開閉器と、エリア間の送り出しの開閉器に、選べる。
 */
import { effectiveAnswers, buildComposition, dropHiddenChoices, QUESTIONS } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { SYMBOLS, getSymbol, paletteCategories } from '../../packages/symbols/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ GS（ガス開閉器。ASのガス版）：記号・選択肢・図面');
{
  const bad: string[] = [];
  const gs = getSymbol('gs');
  const as = getSymbol('as');
  if (JSON.stringify(gs.shapes) !== JSON.stringify(as.shapes)) bad.push('GSの絵が、ASと同じ形ではありません');
  if (JSON.stringify(gs.ports) !== JSON.stringify(as.ports) || gs.box.w !== as.box.w || gs.box.h !== as.box.h) bad.push('GSの接続点・大きさが、ASと違います');
  if (gs.labelLines?.[0] !== 'GS' || gs.abbr !== 'GS') bad.push('GSの名前の文字が「GS」ではありません');
  if (!SYMBOLS.some((s) => s.id === 'gs')) bad.push('GSが、記号の一覧にありません');
  if (!paletteCategories().includes('switchgear')) bad.push('開閉器の分類が、追加の一覧にありません');
  // 選択肢：ケーブルの手前・あとの開閉器、エリア間の送り出し
  const hasGs = (id: string) => QUESTIONS.find((q) => q.id === id)?.options?.some((o) => String(o.value) === 'gs') === true;
  for (const id of ['trCableUp1', 'trCableDn1', 'capCableUp1', 'capCableDn3', 'genCableUp2', 'linkSwitch', 'link2Switch', 'link3Switch', 'link4Switch'])
    if (QUESTIONS.some((q) => q.id === id) && !hasGs(id)) bad.push(`${id} の選択肢に、GSがありません`);
  // 図面：変圧器の手前（ケーブルのあと）・コンデンサのケーブルのあと・エリア間の送り出し
  const raw: Answers = {
    ...answersSpread,
    areaCount: 2,
    transformerCount: 1,
    trHasCable: 'yes',
    trCableInstallation: 'buried',
    trCableUp1: 'ds',
    trCableDn1: 'gs',
    hasCapacitor: 'yes',
    capacitorCount: 1,
    capHasCable: 'yes',
    capCableInstallation: 'buried',
    capCableDn1: 'gs',
    areaForm__2: 'cubicle',
    areaPlacement__2: 'outdoor',
    'a2:areaIntake': 'ds-vcb',
    'a2:trCapacity': 100,
    'a2:linkTap': 'bus',
    'a2:linkSwitch': 'gs',
    'a2:linkCableInstallation': 'buried',
    'a2:linkCableLength': 30,
  };
  const eff = effectiveAnswers(dropHiddenChoices(raw));
  const items = buildComposition(eff);
  const gsItems = items.filter((i) => i.symbolId === 'gs');
  if (gsItems.length !== 3) bad.push(`GSの数が3つではありません（${gsItems.length}。変圧器のケーブルのあと・コンデンサのケーブルのあと・送り出し）`);
  if (gsItems.some((i) => i.label.join('') !== 'GS')) bad.push(`GSの文字が「GS」ではありません（${gsItems.map((i) => i.label.join('/')).join(' ')}）`);
  if (!gsItems.some((i) => i.role.includes('sendout-gs'))) bad.push('送り出しの開閉器に、GSが出ません');
  const doc = fromLayout(layout(items, eff));
  const problems = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (problems.length > 0) bad.push(`GSを入れた図面に、点検の問題が ${problems.length}件あります（${problems.slice(0, 2).map((p) => p.message.slice(0, 20)).join('／')}）`);
  if (bad.length > 0) fail(`GSに問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  GSは、ASと同じ絵・名前だけ「GS」。ケーブルの手前・あとの開閉器と、エリア間の送り出しに選べて、図面に出る（点検の問題0件）');
}
