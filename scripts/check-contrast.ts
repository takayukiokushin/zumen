/**
 * 画面の色の見やすさの検証（ライト・ダークの両方）。
 *
 * styles.css の色を読み取って、文字と背景の明るさの差（コントラスト比）を測る。
 *   ・文字は 4.5 以上
 *   ・入力欄やボタンの枠線は 3 以上（枠が見えないと、どこを押せるか分からない）
 *
 *   node --experimental-strip-types scripts/check-contrast.ts
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../apps/web/src/styles.css', import.meta.url), 'utf8');

/** 「--名前: #色」の組を、ブロックの中から集める */
function colorsIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}
/** 波かっこの対応を数えて、指定した見出しから始まるブロックを取り出す */
function blockAt(start: number): string {
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  return '';
}

const light = colorsIn(blockAt(css.indexOf(':root {')));
const darkOverrides = colorsIn(blockAt(css.indexOf(':root[data-theme="dark"]')));
const dark = { ...light, ...darkOverrides };
// OSの設定に従う「自動」のダークも、同じ値になっていること
const autoDark = colorsIn(blockAt(css.indexOf(':root[data-theme="auto"]')));

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/** [文字の色, 背景の色の一覧]。実際に重ねて使っている組み合わせ */
const TEXT: [string, string[]][] = [
  ['ink', ['paper', 'panel', 'field', 'alt']],
  ['ink-2', ['paper', 'panel', 'field', 'alt']],
  ['muted', ['paper', 'panel', 'field', 'alt', 'accent-soft']],
  ['accent-text', ['paper', 'panel', 'accent-soft']],
  ['need', ['paper', 'panel', 'need-soft']],
  ['ok', ['paper', 'panel', 'ok-soft']],
];
/** 枠線の色と、その両側にある背景 */
const BORDER: [string, string[]][] = [['control-border', ['paper', 'panel', 'field']]];

for (const [name, theme] of [['ライト', light], ['ダーク', dark]] as const) {
  console.log(`■ ${name}`);
  let worst = Infinity;
  for (const [fg, bgs] of TEXT) {
    for (const bg of bgs) {
      if (!theme[fg] || !theme[bg]) { fail(`${name}：色 ${fg} か ${bg} が styles.css に見つかりません`); continue; }
      const r = ratio(theme[fg]!, theme[bg]!);
      worst = Math.min(worst, r);
      if (r < 4.5) fail(`${name}：文字 ${fg}（${theme[fg]}）を ${bg}（${theme[bg]}）に重ねると ${r.toFixed(2)}（4.5 必要）`);
    }
  }
  console.log(`  文字：最も低い組み合わせで ${worst.toFixed(2)}（4.5 以上が必要）`);
  let worstB = Infinity;
  for (const [fg, bgs] of BORDER) {
    for (const bg of bgs) {
      if (!theme[fg] || !theme[bg]) { fail(`${name}：色 ${fg} か ${bg} が styles.css に見つかりません`); continue; }
      const r = ratio(theme[fg]!, theme[bg]!);
      worstB = Math.min(worstB, r);
      if (r < 3) fail(`${name}：枠線 ${fg}（${theme[fg]}）を ${bg}（${theme[bg]}）に重ねると ${r.toFixed(2)}（3 必要）`);
    }
  }
  console.log(`  枠線：最も低い組み合わせで ${worstB.toFixed(2)}（3 以上が必要）`);
}

// 「自動」のダークが、ダークと同じ色になっているか
for (const [k, v] of Object.entries(autoDark)) {
  if (dark[k] !== v) fail(`「自動」のダークの色 ${k}（${v}）が、ダーク（${dark[k]}）と違います`);
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
