/**
 * 図面の検証（check-drawing）の23個目：PC（高圧カットアウト）の定格電流に200A・ヒューズの本数（第20弾・図面再現の診断から）。
 * 本数は、空欄のときは自動（変圧器：単相は2本、三相は3本。コンデンサは3本）。答えがあれば、それを使う。
 */
import { buildComposition, dropHiddenChoices, effectiveAnswers, QUESTIONS } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ PC：定格電流の選択肢（30A・50A・100A）・ヒューズの本数（空欄は自動）');
{
  const bad: string[] = [];
  const opts = (id: string) => QUESTIONS.find((q) => q.id === id)?.options?.map((o) => String(o.value)) ?? [];
  for (const id of ['trPcRating', 'capPcRating']) if (opts(id).includes('200A')) bad.push(`${id} の選択肢に、200Aが残っています（PCの定格電流は、30A・50A・100Aだけ）`);
  for (const id of ['trPcRating', 'capPcRating']) if (!QUESTIONS.find((q) => q.id === id)?.allowFreeInput) bad.push(`${id}：200Aなどを手で入力できません`);
  for (const id of ['trPcFuseCount', 'capPcFuseCount']) if (opts(id).join() !== '2,3') bad.push(`${id} の選択肢が、2・3ではありません（1本はない）（${opts(id).join()}）`);
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
  const b = make({ trPcFuseCount: '3', trPcFuseCount__2: '2', capPcFuseCount: '2' });
  const trB = pcLabels(b, 'tr-pc');
  if (trB[0] !== '200A/F×3/F:50A' || trB[1] !== '100A/F×2/F:30A') bad.push(`本数の答えが、台ごとに使われていません（${trB.join(' ')}）`);
  if (pcLabels(b, 'cap-pc')[0] !== '30A/F×2/F:10A') bad.push('コンデンサの本数の答えが、使われていません');
  // 2・3以外の答え（1本は無い。古い案件など）は、読み飛ばして自動
  for (const v of ['9', '1']) {
    const c = make({ trPcFuseCount: v });
    if (pcLabels(c, 'tr-pc')[0] !== '200A/F×2/F:50A') bad.push(`2・3以外の本数（${v}）が、自動になっていません`);
  }
  // 入力欄にも、結線方式（なければ用途）から、自動で入る（保存はしない・選び直せる）
  const auto = (extra: Answers, key = 'trPcFuseCount') => String(effectiveAnswers(dropHiddenChoices({ ...answersSpread, trHasPc: 'yes', ...extra } as Answers))[key] ?? '');
  const cases: [string, Answers, string][] = [
    ['電灯・単相三線式', { trUsage: '電灯', trConnection: 'tr-1p' }, '2'],
    ['電灯・単相二線式', { trUsage: '電灯', trConnection: 'tr-1p-2w' }, '2'],
    ['単相の並行運転', { trUsage: '電灯', trConnection: 'tr-1p-parallel' }, '2'],
    ['動力・Δ-Y', { trUsage: '動力', trConnection: 'tr-3p-dy' }, '3'],
    ['動力・Y-Δ', { trUsage: '動力', trConnection: 'tr-3p-yd' }, '3'],
    ['動力・Δ-Δ', { trUsage: '動力', trConnection: 'tr-3p-dd' }, '3'],
    ['動力・Δ-Δ（単相×3）', { trUsage: '動力', trConnection: 'tr-3p-dd-1p3' }, '3'],
    ['電灯・動力・V結線', { trUsage: '電灯・動力', trConnection: 'tr-vv' }, '3'],
    ['電灯・V結線', { trUsage: '電灯', trConnection: 'tr-vv' }, '3'],
    ['用途だけ（電灯）', { trUsage: '電灯', trConnection: '' }, '2'],
  ];
  for (const [name, extra, want] of cases) {
    const raw = { ...extra } as Answers;
    if (raw.trConnection === '') delete raw.trConnection;
    const got = auto(raw);
    if (got !== want && !(name === '用途だけ（電灯）' && got === '2')) bad.push(`${name}：本数の入力欄に「${want}」が自動で入りません（${got || '空'}）`);
  }
  // 答えた本数は、自動で上書きされない
  if (auto({ trUsage: '電灯', trConnection: 'tr-1p', trPcFuseCount: '3' }) !== '3') bad.push('答えた本数が、自動で上書きされました');
  // 自動の本数は、相で決まる（電灯でも、V結線＝三相なら3本）
  const phase = make({ trUsage: '電灯', trConnection: 'tr-vv' });
  if (pcLabels(phase, 'tr-pc')[0] !== '200A/F×3/F:50A') bad.push(`電灯でもV結線（三相）なら、PCの本数が3本になりません（${pcLabels(phase, 'tr-pc')[0]}）`);
  // 図面：点検の問題が増えない
  const eff = effectiveAnswers(dropHiddenChoices({ ...answersSpread, trHasPc: 'yes', trPcRating: '200A', trPcFuse: '50A' } as Answers));
  const doc = fromLayout(layout(buildComposition(eff), eff));
  const problems = inspectDrawing(doc, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (problems.length > 0) bad.push(`PCの文字が増えた図面に、点検の問題が ${problems.length}件あります`);
  if (bad.length > 0) fail(`PCの定格・本数に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  PCの定格電流は、30A・50A・100Aから選べる（200Aなどは、手で入力できる）。ヒューズの本数は、空欄なら自動（電灯2本・動力3本・コンデンサ3本）、答えがあればそれ（台ごと）');
}
