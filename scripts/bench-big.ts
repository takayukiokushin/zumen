/**
 * 大きな図面（変圧器・コンデンサ・PCS が多い案件）で、どの段階にどれだけ時間がかかるかを測る。
 *
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/bench-big.ts [台数 ...]
 *
 * 画面の「入力欄の反応」（1文字ごとに、回答 → 構成 → 配置までやり直す）と、
 * 「結線を整える」「確認」「印刷用の図」にかかる時間を、台数ごとに出す。
 */
import { fromLayout } from '../apps/web/src/editor/doc.ts';
import { chooseSheet, inspectDrawing, tidyDrawing } from '../apps/web/src/editor/inspect.ts';
import { buildSheetSvg } from '../apps/web/src/editor/exportSheet.ts';
import { GOLDEN_CASES } from './golden/cases.ts';
import { spreadUnits } from './check-drawing/common.ts';
import { buildComposition, resolveDrawingName, normalizeAnswers, withDerived } from '../packages/knowledge/src/index.ts';
import { COMPANY_NAME, layout } from '../packages/layout/src/index.ts';

const base = GOLDEN_CASES.find((c) => c.id === '15-tr8-pv')!.answers;
const ms = (t0: number) => +(performance.now() - t0).toFixed(1);

/** 台数を n にした回答（変圧器 n 台、PCS は各変圧器に2台ずつ） */
export function bigAnswers(n: number) {
  const a: Record<string, unknown> = { ...base, transformerCount: n, pcsCount: String(Math.min(100, n * 2)), hasCapacitor: 'yes', capacitorCount: Math.min(100, n), capacitorCapacity: '50kvar' };
  for (let i = 1; i <= 100; i++) delete a[`pcsToTr${i}`];
  for (let i = 1; i <= n && i <= 50; i++) a[`pcsToTr${i}`] = 2;
  return a;
}

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
for (const n of sizes.length ? sizes : [8, 20, 50, 100]) {
  const raw = bigAnswers(n);
  let t = performance.now();
  const answers = spreadUnits(raw as never);
  const comp = buildComposition(answers);
  const tComp = ms(t);
  t = performance.now();
  const lay = layout(comp, answers);
  const tLay = ms(t);
  t = performance.now();
  const doc = fromLayout(lay);
  const tDoc = ms(t);
  const title = { site: 'bench', name: resolveDrawingName(answers), footer: COMPANY_NAME };
  t = performance.now();
  const { paper, orientation } = chooseSheet(doc, title);
  const tSheet = ms(t);
  t = performance.now();
  const issues = inspectDrawing(doc, paper, orientation);
  const tInspect = ms(t);
  t = performance.now();
  const tidy = tidyDrawing(doc, paper, orientation);
  const tTidy = ms(t);
  t = performance.now();
  const svg = buildSheetSvg(doc, title, paper, orientation);
  const tSvg = ms(t);
  // 1文字ごとの反応：回答の正規化 → 構成 → 配置
  t = performance.now();
  for (let i = 0; i < 5; i++) layout(buildComposition(spreadUnits({ ...raw, siteName: `x${i}` } as never)), answers);
  const tKey = +((performance.now() - t) / 5).toFixed(1);
  console.log(
    `台数${String(n).padStart(3)}：記号${doc.items.filter((x) => x.kind === 'symbol').length}・確認で見つかった点${issues.length} ｜ 構成 ${tComp}ms／配置 ${tLay}ms／編集用の図面 ${tDoc}ms／用紙 ${tSheet}ms／確認 ${tInspect}ms／結線を整える ${tTidy}ms／印刷用の図 ${tSvg}ms（${(svg.length / 1024).toFixed(0)}KB）｜1文字ごとの再計算（構成+配置）${tKey}ms`,
  );
}
