/**
 * 記号マスタ（packages/symbols）から記号カタログHTMLを生成する。
 *
 *   node --experimental-strip-types scripts/build-catalog.ts
 *
 * 出力:
 *   docs/symbol-catalog.html                 … 単体で開ける完成HTML
 *   $ARTIFACT_OUT （任意）                    … Artifact公開用のフラグメント
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SYMBOLS, symbolToSvg, validateAll } from '../packages/symbols/src/index.ts';
import { CATEGORY_LABEL } from '../packages/symbols/src/types.ts';
import type { SymbolCategory, SymbolDef } from '../packages/symbols/src/types.ts';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const errors = validateAll();
if (errors.length) {
  console.error('記号定義にエラーがあります:\n' + errors.join('\n'));
  process.exit(1);
}

const ORDER: SymbolCategory[] = [
  'incoming', 'boundary', 'switchgear', 'instrument', 'protection',
  'transformer', 'compensation', 'source', 'wiring', 'enclosure',
];

const grouped = ORDER.map((c) => ({
  category: c,
  label: CATEGORY_LABEL[c],
  items: SYMBOLS.filter((s) => s.category === c),
})).filter((g) => g.items.length > 0);

const reviewItems = SYMBOLS.filter((s) => s.review);

const fieldChip = (label: string, extra?: string): string =>
  `<span class="chip">${esc(label)}${extra ? `<i>${esc(extra)}</i>` : ''}</span>`;

function card(def: SymbolDef): string {
  const tags = [def.nameJa, def.nameFormal ?? '', def.abbr, def.id, ...(def.tags ?? [])]
    .join(' ')
    .toLowerCase();
  const fields = (def.fields ?? [])
    .map((f) => fieldChip(f.label, f.unit ? f.unit : f.type === 'select' ? `${f.options?.length ?? 0}択` : undefined))
    .join('');
  const slots = (def.slots ?? []).map((s) => fieldChip(s.label)).join('');
  return `
      <article class="card${def.review ? ' card--flag' : ''}" id="sym-${def.id}" data-search="${esc(tags)}">
        <div class="tile">${symbolToSvg(def, { padding: 8, scale: 1.7, showPorts: true })}</div>
        <div class="card-body">
          <div class="card-head">
            <span class="abbr">${esc(def.abbr)}</span>
            <h3>${esc(def.nameJa)}</h3>
          </div>
          ${def.nameFormal ? `<p class="formal">${esc(def.nameFormal)}</p>` : ''}
          <p class="idline"><code>${esc(def.id)}</code> ・ 接続点 ${def.ports.length}${
            def.altOf ? ` ・ <span class="alt">${esc(def.altOf)} の別表記</span>` : ''
          }</p>
          ${def.defaultLabel ? `<p class="deflabel">既定の記載文言：<b>${esc(def.defaultLabel)}</b></p>` : ''}
          ${fields ? `<div class="chips"><span class="chips-label">入力項目</span>${fields}</div>` : ''}
          ${slots ? `<div class="chips"><span class="chips-label">内蔵スロット</span>${slots}</div>` : ''}
          ${def.note ? `<p class="note">${esc(def.note)}</p>` : ''}
          ${def.review ? `<p class="flag"><span>要確認</span>${esc(def.review)}</p>` : ''}
        </div>
      </article>`;
}

const sections = grouped
  .map(
    (g) => `
    <section class="group" id="cat-${g.category}" data-cat="${g.category}">
      <header class="group-head">
        <h2>${esc(g.label)}</h2>
        <span class="count">${g.items.length}</span>
      </header>
      <div class="grid">${g.items.map(card).join('')}</div>
    </section>`,
  )
  .join('');

const chips = grouped
  .map((g) => `<a class="navchip" href="#cat-${g.category}">${esc(g.label)}<i>${g.items.length}</i></a>`)
  .join('');

const reviewList = reviewItems
  .map(
    (s) =>
      `<li><a href="#sym-${s.id}"><b>${esc(s.abbr)}</b> ${esc(s.nameJa)}</a><span>${esc(s.review ?? '')}</span></li>`,
  )
  .join('');

const STYLE = `
    :root {
      --paper: #eef1ef;
      --card: #ffffff;
      --tile: #fbfcfb;
      --ink: #161a18;
      --ink-2: #3b4442;
      --muted: #69736f;
      --rule: #d3d9d5;
      --rule-soft: #e4e8e6;
      --accent: #9a7412;
      --accent-soft: #f2e7c6;
      --flag: #9c4320;
      --flag-soft: #f6e3d9;
      --grid: #dfe6e2;
      --shadow: 0 1px 2px rgba(22, 26, 24, .06);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --paper: #101312;
        --card: #191d1b;
        --tile: #141817;
        --ink: #e9ede9;
        --ink-2: #c2cac6;
        --muted: #8e9995;
        --rule: #2c3331;
        --rule-soft: #232927;
        --grid: #242c29;
        --accent: #d6ac47;
        --accent-soft: #332c15;
        --flag: #e08a5f;
        --flag-soft: #33201a;
        --shadow: 0 1px 2px rgba(0,0,0,.4);
      }
    }
    :root[data-theme="dark"] {
      --paper: #101312;
      --card: #191d1b;
      --tile: #141817;
      --ink: #e9ede9;
      --ink-2: #c2cac6;
      --muted: #8e9995;
      --rule: #2c3331;
      --rule-soft: #232927;
      --grid: #242c29;
      --accent: #d6ac47;
      --accent-soft: #332c15;
      --flag: #e08a5f;
      --flag-soft: #33201a;
      --shadow: 0 1px 2px rgba(0,0,0,.4);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding-inline: 16px; padding-block: 0 72px; }
    code, .mono, .abbr, .count, .navchip i { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }

    header.page { padding-block: 40px 28px; border-bottom: 1px solid var(--rule); }
    .eyebrow {
      font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: .14em;
      text-transform: uppercase; color: var(--accent); margin: 0 0 10px;
    }
    header.page h1 { margin: 0; font-size: clamp(26px, 5vw, 38px); font-weight: 700; letter-spacing: .01em; text-wrap: balance; }
    header.page .lede { margin: 12px 0 0; max-width: 62ch; color: var(--ink-2); }
    .stats { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 22px; }
    .stat { display: flex; align-items: baseline; gap: 8px; }
    .stat b { font-family: "IBM Plex Mono", monospace; font-size: 22px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .stat span { font-size: 12px; color: var(--muted); letter-spacing: .04em; }

    .callout {
      margin-top: 26px; padding: 16px 18px; border-left: 3px solid var(--accent);
      background: var(--card); box-shadow: var(--shadow);
    }
    .callout p { margin: 0; font-size: 13.5px; color: var(--ink-2); }
    .callout p + p { margin-top: 8px; }

    .review-box { margin-top: 24px; padding: 18px 20px; background: var(--card); border: 1px solid var(--rule); box-shadow: var(--shadow); }
    .review-box h2 { margin: 0 0 4px; font-size: 15px; letter-spacing: .02em; }
    .review-box > p { margin: 0 0 14px; font-size: 13px; color: var(--muted); }
    .review-box ol { margin: 0; padding-left: 1.3em; display: grid; gap: 10px; }
    .review-box li { font-size: 13.5px; }
    .review-box li a { color: var(--ink); text-decoration-color: var(--accent); text-underline-offset: 3px; }
    .review-box li a b { font-family: "IBM Plex Mono", monospace; color: var(--accent); margin-right: 6px; }
    .review-box li span { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.6; }

    .controls {
      position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5;
      background: color-mix(in srgb, var(--paper) 92%, transparent);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--rule); margin-top: 32px;
      padding-block: 12px;
    }
    .controls-inner { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    input[type="search"] {
      flex: 1 1 200px; min-width: 0; padding: 8px 12px; font: inherit; font-size: 14px;
      background: var(--card); color: var(--ink);
      border: 1px solid var(--rule); border-radius: 2px;
    }
    input[type="search"]:focus-visible, .toggle:focus-visible, .navchip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .toggles { display: flex; gap: 8px; }
    .toggle {
      font: inherit; font-size: 12.5px; padding: 7px 12px; cursor: pointer;
      background: var(--card); color: var(--ink-2); border: 1px solid var(--rule); border-radius: 2px;
    }
    .toggle[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--ink); }
    .navchips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .navchip {
      display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px; text-decoration: none;
      padding: 4px 9px; border: 1px solid var(--rule-soft); border-radius: 2px; color: var(--ink-2); background: var(--card);
    }
    .navchip i { font-style: normal; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .navchip:hover { border-color: var(--accent); color: var(--ink); }

    .group { margin-top: 44px; scroll-margin-top: 90px; }
    .group-head { display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
    .group-head h2 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: .02em; }
    .count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin-top: 18px; }
    .card { background: var(--card); border: 1px solid var(--rule); box-shadow: var(--shadow); display: flex; flex-direction: column; scroll-margin-top: 100px; }
    .card--flag { border-color: color-mix(in srgb, var(--flag) 45%, var(--rule)); }
    .tile {
      display: grid; place-items: center; min-height: 160px; padding: 14px;
      background-color: var(--tile);
      border-bottom: 1px solid var(--rule-soft);
    }
    body.grid-on .tile {
      background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 8.5px 8.5px;
    }
    .tile svg { max-width: 100%; max-height: 136px; width: auto; height: auto; color: var(--ink); }
    .tile svg .ports { display: none; color: var(--flag); }
    body.ports-on .tile svg .ports { display: block; }

    .card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
    .card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .abbr { font-size: 12px; font-weight: 500; letter-spacing: .04em; color: var(--accent); }
    .card-head h3 { margin: 0; font-size: 14.5px; font-weight: 700; line-height: 1.45; }
    .formal, .idline, .deflabel, .note { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.65; }
    .idline code { font-size: 11px; color: var(--ink-2); }
    .deflabel b { color: var(--ink); }
    .note { color: var(--ink-2); padding-top: 4px; border-top: 1px dashed var(--rule-soft); }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .chips-label { font-size: 10.5px; letter-spacing: .08em; color: var(--muted); margin-right: 2px; }
    .chip { font-size: 11px; padding: 2px 7px; border: 1px solid var(--rule-soft); border-radius: 999px; color: var(--ink-2); }
    .chip i { font-style: normal; color: var(--muted); margin-left: 4px; }
    .flag { margin: 0; font-size: 12px; line-height: 1.6; color: var(--ink-2); background: var(--flag-soft); padding: 8px 10px; }
    .flag span { display: inline-block; font-size: 10.5px; letter-spacing: .08em; color: var(--flag); font-weight: 700; margin-right: 6px; }
    .alt { color: var(--accent); }

    .card[hidden], .group[hidden] { display: none !important; }
    .empty { margin-top: 40px; color: var(--muted); font-size: 14px; }
    footer.page { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--rule); font-size: 12px; color: var(--muted); }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

const SCRIPT = `
    (function () {
      var body = document.body;
      body.classList.add('grid-on');
      var search = document.getElementById('q');
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
      var groups = Array.prototype.slice.call(document.querySelectorAll('.group'));
      var empty = document.getElementById('empty');

      function apply() {
        var q = (search.value || '').trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (c) {
          var hit = !q || c.getAttribute('data-search').indexOf(q) !== -1;
          c.hidden = !hit;
          if (hit) shown++;
        });
        groups.forEach(function (g) {
          g.hidden = !g.querySelector('.card:not([hidden])');
        });
        empty.hidden = shown !== 0;
      }
      search.addEventListener('input', apply);

      function bindToggle(id, cls) {
        var btn = document.getElementById(id);
        btn.addEventListener('click', function () {
          var on = btn.getAttribute('aria-pressed') === 'true';
          btn.setAttribute('aria-pressed', String(!on));
          body.classList.toggle(cls, !on);
        });
      }
      bindToggle('t-ports', 'ports-on');
      bindToggle('t-grid', 'grid-on');
    })();
`;

const BODY = `<title>単線結線図 記号カタログ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLE}</style>
<div class="wrap">
  <header class="page">
    <p class="eyebrow">Phase 1 — Symbol Library</p>
    <h1>単線結線図 記号カタログ</h1>
    <p class="lede">高圧受電設備の単線結線図で使う図記号を、記号マスタ（データ）から描き起こしたものです。作図エンジン・記号パレット・PDF出力はすべてこの同じ定義を参照します。</p>
    <div class="stats">
      <div class="stat"><b>${SYMBOLS.length}</b><span>記号</span></div>
      <div class="stat"><b>${grouped.length}</b><span>カテゴリ</span></div>
      <div class="stat"><b>${reviewItems.length}</b><span>要確認</span></div>
    </div>
    <div class="callout">
      <p><b>すべて独自に描き起こしています。</b>JIS C 0617 等の規格書の図版は複製せず、規格の仕様（形状・比率・意味）を参照して作図しています。</p>
      <p>記号は「形」だけでなく、接続点（ポート）・入力項目・作図上の注意までを1件のデータとして持たせています。新しい機器が増えても、データを1件追加するだけでパレット・プロパティ入力欄・PDF出力に反映されます。</p>
    </div>
  </header>

  <div class="review-box">
    <h2>まずご確認いただきたい点</h2>
    <p>形が実際の図面と違いそうな記号です。ここだけ見ていただければ、あとはこちらで直せます。</p>
    <ol>${reviewList}</ol>
  </div>

  <div class="controls">
    <div class="controls-inner">
      <input type="search" id="q" placeholder="記号名・略称・用語で絞り込み（例: LBS、変圧器、PAS）" aria-label="記号を検索">
      <div class="toggles">
        <button type="button" class="toggle" id="t-ports" aria-pressed="false">接続点を表示</button>
        <button type="button" class="toggle" id="t-grid" aria-pressed="true">方眼</button>
      </div>
    </div>
    <nav class="navchips" aria-label="カテゴリ">${chips}</nav>
  </div>

  <p class="empty" id="empty" hidden>該当する記号がありません。</p>
${sections}

  <footer class="page">
    <p>記号マスタ: <code>packages/symbols/src/defs/</code> ／ このページは <code>pnpm catalog</code> で再生成されます。</p>
  </footer>
</div>
<script>${SCRIPT}</script>`;

const standalone = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${BODY}
</body>
</html>`;

const outDocs = resolve(import.meta.dirname, '../docs/symbol-catalog.html');
mkdirSync(dirname(outDocs), { recursive: true });
writeFileSync(outDocs, standalone, 'utf8');
console.log(`生成: ${outDocs} (${SYMBOLS.length}記号 / 要確認 ${reviewItems.length}件)`);

if (process.env.ARTIFACT_OUT) {
  const out = resolve(process.env.ARTIFACT_OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, BODY, 'utf8');
  console.log(`生成: ${out}`);
}
