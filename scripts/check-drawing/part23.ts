/**
 * 図面の検証（check-drawing）の23個目：PC（高圧カットアウト）の定格電流に200A・ヒューズの本数（第20弾・図面再現の診断から）。
 * 本数は、空欄のときは自動（変圧器の電灯＝単相は2本、ほかは3本。コンデンサは3本）。答えがあれば、それを使う。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ PC：定格電流に200A・ヒューズの本数（空欄は自動）');
{
  const bad: string[] = [];
  const opts = (id: string) => QUESTIONS.find((q) => q.id === id)?.options?.map((o) => String(o.value)) ?? [];
  for (const id of ['trPcRating', 'capPcRating']) if (!opts(id).includes('200A')) bad.push(`${id} の選択肢に、200Aがありません`);
  for (const id of ['trPcFuseCount', 'capPcFuseCount']) if (opts(id).join() !== '1,2,3') bad.push(`${id} の選択肢が、1・2・3ではありません（${opts(id).join()}）`);
  const make = (extra: Answers): ReturnType<typeof buildComposition> => {
    const raw: Answers = {
      ...answersSpread,
      transformerCount: 2,
      trUsage: '電灯', trConnection: 'tr-1p', trHasPc: 'yes', trPcRating: '200A', trPcFuse: '50A',
      trUsage__2: '動力', trConnection__2: 'tr-3p-yd', trHasPc__2: 'yes', trPcRating__2: '100A', trPcFuse__2: '30A',
      hasCapacitor: 'yes', capacitorCount: 1, capHasPc: 'yes', capPcRating: '30A', capPcFuse: '10A',
      ...extra,
    };
    return buildComposition(effectiveAnswers(dropHiddenChoices(raw)));
  };
  const pcLabels = (items: ReturnType<typeof buildComposition>, role: string) => items.filter((i) => i.role === role).map((i) => i.label.join('/'));
  const a = make({});
  const tr = pcLabels(a, 'tr-pc');
  if (tr[0] !== '200A/F×2/F:50A') bad.push(`電灯（単相）のPCの文字が「200A/F×2/F:50A」ではありません（${tr[0]}）`);
  if (tr[1] !== '100A/F×3/F:30A') bad.push(`動力のPCの文字が「100A/F×3/F:30A」ではありません（${tr[1]}）`);
  const cap = pcLabels(a, 'cap-pc');
  if (cap[0] !== '30A/F×3/F:10A') bad.push(`コンデンサのPCの文字が「30A/F×3/F:10A」ではありません（${cap[0]}）`);
  // 答えがあれば、それを使う（台ごと）
  const b = make({ trPcFuseCount: '3', trPcFuseCount__2: '1', capPcFuseCount: '2' });
  const trB = pcLabels(b, 'tr-pc');
  if (trB[0] !== '200A/F×3/F:50A' || trB[1] !== '100A/F×1/F:30A') bad.push(`本数の答えが、台ごとに使われていません（${trB.join(' ')}）`);
  if (pcLabels(b, 'cap-pc')[0] !== '30A/F×2/F:10A') bad.push('コンデンサの本数の答えが、使われていません');
  // 1・2・3以外の答え（古い案件など）は、読み飛ばして自動
  const c = make({ trPcFuseCount: '9' });
  if (pcLabels(c, 'tr-pc')[0] !== '200A/F×2/F:50A') bad.push('1〜3以外の本数が、自動になっていません');
  // 図面：点検の問題が増えない
  const eff = effectiveAnswers(dropHiddenChoices({ ...answersSpread, trHasPc: 'yes', trPcRating: '200A', trPcFuse: '50A' } as Answers));
  const doc = fromLayout(layout(buildComposition(eff), eff));
  const problems = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (problems.length > 0) bad.push(`PCの文字が増えた図面に、点検の問題が ${problems.length}件あります`);
  if (bad.length > 0) fail(`PCの定格・本数に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  PCの定格電流に200Aが選べる。ヒューズの本数は、空欄なら自動（電灯2本・動力3本・コンデンサ3本）、答えがあればそれ（台ごと）');
}
