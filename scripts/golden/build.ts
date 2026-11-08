/**
 * 図面の見本（ゴールデン）を作る部分。
 * 画面で「印刷」したときと同じ手順（回答 → 構成 → 自動配置 → 編集用の図面 → 用紙を決める → 1枚の絵）で作る。
 */
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import type { Doc } from '../../apps/web/src/editor/doc.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { buildLayerSheetSvg } from '../../apps/web/src/editor/layerSheet.ts';
import { layerTitle } from '../../apps/web/src/editor/layers.ts';
import { buildComposition, resolveDrawingName } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, layout } from '../../packages/layout/src/index.ts';
import { spreadUnits } from '../check-drawing/common.ts';
import { GOLDEN_CASES } from './cases.ts';
import type { GoldenCase } from './cases.ts';

export interface GoldenResult {
  case: GoldenCase;
  doc: Doc;
  svg: string;
  /** 図面に入っている記号の種類ごとの個数 */
  symbols: Record<string, number>;
}

export function buildGolden(c: GoldenCase): GoldenResult {
  const answers = spreadUnits(c.answers);
  const base = fromLayout(layout(buildComposition(answers), answers));
  const site = String(answers.customerNameForTitleBlock ?? answers.siteName ?? '');
  let doc = base;
  let svg: string;
  if (c.layer) {
    // 赤いレイヤーの見本：図面の上に赤い印を置いて、そのレイヤーの印刷にする
    const made = c.layer(base);
    doc = made.doc;
    svg = buildLayerSheetSvg(doc, made.layerId, { site, name: layerTitle(doc, made.layerId) ?? '', footer: COMPANY_NAME }).svg;
  } else {
    const title = { site, name: resolveDrawingName(answers), footer: COMPANY_NAME };
    const { paper, orientation } = chooseSheet(doc, title);
    svg = buildSheetSvg(doc, title, paper, orientation);
  }
  const symbols: Record<string, number> = {};
  for (const it of doc.items) if (it.kind === 'symbol') symbols[it.symbolId] = (symbols[it.symbolId] ?? 0) + 1;
  return { case: c, doc, svg, symbols };
}

export const buildAllGolden = (): GoldenResult[] => GOLDEN_CASES.map(buildGolden);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 見本の一覧（目で見て確かめるための1枚のページ） */
export function buildIndexHtml(results: GoldenResult[]): string {
  const rows = results
    .map(
      (r) => `    <section>
      <h2>${esc(r.case.id)}　${esc(r.case.title)}</h2>
      <p>記号 ${Object.values(r.symbols).reduce((a, b) => a + b, 0)}個</p>
      <img src="${esc(r.case.id)}.svg" alt="${esc(r.case.title)}" loading="lazy" />
    </section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>図面の見本の一覧</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; background: #f4f4f4; color: #111; }
  h1 { font-size: 1.2rem; }
  section { background: #fff; border: 1px solid #ccc; border-radius: 6px; padding: 8px 12px; margin: 12px 0; }
  h2 { font-size: 1rem; margin: 4px 0; }
  p { margin: 2px 0 8px; color: #555; font-size: 0.85rem; }
  img { max-width: 100%; height: auto; border: 1px solid #ddd; }
</style>
</head>
<body>
<h1>図面の見本の一覧（架空の現場 ${results.length}件）</h1>
<p>この見本は、図面の作り方を変えたときに、意図しない変化が出ていないかを自動で比べるためのものです。<br />
意図して図面を変えたときは、<code>pnpm golden</code> で保存し直します。</p>
${rows}
</body>
</html>
`;
}
