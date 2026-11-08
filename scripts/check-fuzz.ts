/**
 * 大量のでたらめな入力・操作で、固まる・落ちる・おかしな文字（NaN など）が出る、ということが起きないかの検証（常設）。
 *
 *   1. 回答：画面で入れられる値だけの組み合わせ（ふつう）と、想定外の値まで混ぜた組み合わせ（でたらめ）を作り、
 *      図面の組み立て → 配置 → 整える・確認 → 印刷用の図まで通す
 *   2. レイヤー：図面の上に、赤い印（文字・×印・接地・枠・点・矢印・渡り線）を、でたらめに置く・直す・動かす・消す・
 *      元の図面を動かす・消す、を繰り返して、決まりごと（重複しない・つなぎ先が無いものを残さない・上限・元の図面の署名が変わらない…）を確かめる
 *   3. 壊れたレイヤーのデータ：形の違う保存データ（文字・null・数でない値など）を読み込んでも、案件が開けなくなったり、止まったりしない
 *
 * 乱数は決まった種から作るので、毎回同じ試行になる（失敗したときは、同じ種で、同じ失敗が再現できる）。
 * 回数は、環境変数 FUZZ_COUNT で増やせる（`pnpm fuzz` は 10倍）。
 *
 *   node --experimental-strip-types scripts/check-fuzz.ts
 */
import { assistGroundPoint, fromLayout, moveItem, portsOf, removeItem } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../apps/web/src/editor/doc.ts';
import { chooseSheet, inspectDrawing, tidyDrawing } from '../apps/web/src/editor/inspect.ts';
import { SHRINK, scaleLayout } from '../apps/web/src/editor/layoutScale.ts';
import { buildSheetSvg } from '../apps/web/src/editor/exportSheet.ts';
import { buildLayerSheetSvg } from '../apps/web/src/editor/layerSheet.ts';
import * as L from '../apps/web/src/editor/layers.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { AREA_KINDS, MAX_LAYER_ITEMS_PER_KIND, QUESTIONS, areaView, buildComposition, missingRequired, normalizeAnswers, resolveDrawingName, viewAt, visibleQuestions, withDerived } from '../packages/knowledge/src/index.ts';
import { ARROW_DIRS, LINK_SHAPES, layout, renderSvg } from '../packages/layout/src/index.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/** 決まった種から作る乱数 */
function rng(seed: number) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  return { rnd, pick, int };
}

/** 項目の並びの順番に関係なく、中身が同じか */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const BAD_TEXT = /[^>]{0,30}(NaN|undefined|Infinity|\[object )[^<]{0,30}/;

/* ------------------------------------------------------------------ */
/* 1. 回答のでたらめ                                                    */
/* ------------------------------------------------------------------ */

const TEXTS = ['', ' ', '検査用の事業場', 'x'.repeat(120), '<b>x</b>', '&amp;<script>', '😀', "a'b\"c", '１２３', '0'];
const isCount = (k: string) => /count$/i.test(k) || /^pcsToTr/.test(k);

function randomAnswers(r: ReturnType<typeof rng>, wild: boolean): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  const p = r.pick([0.15, 0.4, 0.8]);
  for (const q of QUESTIONS) {
    if (r.rnd() > p) continue;
    if (q.type === 'select' && q.options?.length) {
      a[q.id] = r.pick(q.options).value;
      if (q.allowFreeInput && r.rnd() < 0.15) a[q.id] = r.pick(isCount(q.id) ? ['7', '12', 'abc', '', '0'] : ['7', '75', 'abc', '1e999', '', '0']);
    } else if (q.type === 'number') a[q.id] = isCount(q.id) ? r.pick([0, 1, 2, 3, 5, 12]) : r.pick([0, 1, 5, 10, 50, 300, 1000, 0.5, 99999, 1e30]);
    else if (q.type === 'boolean') a[q.id] = r.pick(['yes', 'no']);
    else a[q.id] = r.pick(TEXTS);
  }
  if (wild) {
    for (const q of QUESTIONS) {
      if (r.rnd() < 0.08) a[q.id] = r.pick<unknown>([null, '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 0, -1, 1e300, true, false, -0.0001, '0', ' ', '-']);
    }
  }
  return a;
}

/** 回答から図面（編集用）まで作る。問題があれば、その段階と中身を返す */
function buildDoc(input: Record<string, unknown>): { doc?: Doc; title?: { site: string; name: string; footer: string }; error?: string } {
  let stage = 'start';
  const a = input as Answers;
  try {
    stage = '回答の読み取り';
    normalizeAnswers(a);
    withDerived(a);
    visibleQuestions(a);
    missingRequired(a);
    resolveDrawingName(a);
    viewAt(a, 0);
    areaView(a, 0);
    stage = '構成';
    const items = buildComposition(a);
    stage = '配置';
    const d = layout(items, a);
    const title = { site: String(a.siteName ?? ''), name: resolveDrawingName(a), footer: 'x' };
    stage = '図面の絵';
    const svg = renderSvg(d, title);
    const bad = svg.match(BAD_TEXT);
    if (bad) return { error: `${stage}：図面の文字に NaN/undefined/Infinity（${bad[0]}）` };
    stage = '編集用の図面';
    const doc = fromLayout(d);
    const ids = new Set<string>();
    for (const x of doc.items) {
      if (ids.has(x.id)) return { error: `${stage}：id の重複 ${x.id}` };
      ids.add(x.id);
    }
    for (const x of doc.items) {
      if (x.kind !== 'wire') continue;
      for (const e of [x.at1, x.at2]) {
        if (!e) continue;
        const s = doc.items.find((y) => y.id === e.item);
        if (!s || s.kind !== 'symbol') return { error: `${stage}：線のつなぎ先が無い ${e.item}` };
        if (!portsOf(s).some((p) => p.id === e.port)) return { error: `${stage}：つなぎ先の接続点が無い ${e.item}:${e.port}` };
      }
    }
    stage = '確認・整える';
    const sh = chooseSheet(doc, title);
    inspectDrawing(doc, sh.paper, sh.orientation);
    tidyDrawing(doc, sh.paper, sh.orientation);
    stage = '縮小・拡大';
    const sc = scaleLayout(doc, SHRINK);
    scaleLayout(sc.doc, 1 / SHRINK);
    stage = '印刷用の図';
    const ss = buildSheetSvg(doc, title, sh.paper, sh.orientation);
    const bad2 = ss.match(BAD_TEXT);
    if (bad2) return { error: `${stage}：印刷用の図面に NaN/undefined/Infinity（${bad2[0]}）` };
    return { doc, title };
  } catch (e) {
    return { error: `${stage}：${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}

console.log('■ でたらめな回答の組み合わせ（組み立て → 配置 → 確認・整える → 印刷用の図）');
{
  const t0 = Date.now();
  for (const [mode, count, seed] of [['ふつう（画面で入れられる値だけ）', 90, 101], ['でたらめ（想定外の値まで）', 60, 202]] as const) {
    const wild = mode.startsWith('でたらめ');
    const r = rng(seed);
    const n = count * SCALE;
    const seen = new Map<string, { n: number; at: number }>();
    for (let i = 0; i < n; i++) {
      const a = randomAnswers(r, wild);
      const res = buildDoc(a);
      if (res.error) {
        const key = res.error.replace(/[0-9]+/g, 'N');
        const v = seen.get(key);
        if (v) v.n++;
        else seen.set(key, { n: 1, at: i });
      }
    }
    for (const [msg, v] of seen) fail(`${mode}：${v.n}件（最初は ${v.at} 番目・種 ${seed}）：${msg}`);
    if (seen.size === 0) console.log(`  ${mode}：${n}通り、すべて問題なし`);
  }
  console.log(`  （${Math.round((Date.now() - t0) / 100) / 10}秒）`);
}

/* ------------------------------------------------------------------ */
/* 2. レイヤーのでたらめな操作                                           */
/* ------------------------------------------------------------------ */

const LAYER_TEXTS = ['', 'メモ', '停電範囲\n（第1）', 'x'.repeat(100), '<b>', '😀'];

/** レイヤーの決まりごとを確かめる（保存のときの整理＝purgeOrphanMarks のあとの形で） */
function layerProblems(doc: Doc): string[] {
  const out: string[] = [];
  const purged = L.purgeOrphanMarks(doc);
  for (const l of L.layersOf(purged)) {
    const ids = new Set<string>();
    const counts: Record<string, number> = {};
    const dotIds = new Set(l.items.filter((i) => i.kind === 'dot').map((i) => i.id));
    for (const it of l.items) {
      if (ids.has(it.id)) out.push(`${l.id}：id の重複 ${it.id}`);
      ids.add(it.id);
      counts[it.kind] = (counts[it.kind] ?? 0) + 1;
      if (it.kind === 'arrow' && !dotIds.has(it.dot)) out.push(`${l.id}：指す点が無い矢印が残っている`);
      if (it.kind === 'link' && (!dotIds.has(it.a) || !dotIds.has(it.b))) out.push(`${l.id}：つなぎ先の点が無い渡り線が残っている`);
      if (it.kind === 'dot' && L.resolveDotPoint(purged, it) === null) out.push(`${l.id}：置き場所が無い点が残っている`);
    }
    for (const [k, n] of Object.entries(counts)) if (n > MAX_LAYER_ITEMS_PER_KIND) out.push(`${l.id}：${k} が上限（${MAX_LAYER_ITEMS_PER_KIND}）を超えている（${n}）`);
    // 矢印は、1つの点に1本まで
    const arrowDots = l.items.filter((i) => i.kind === 'arrow').map((i) => (i.kind === 'arrow' ? i.dot : ''));
    if (new Set(arrowDots).size !== arrowDots.length) out.push(`${l.id}：1つの点に矢印が2本以上ある`);
    // 同じ2つの点を結ぶ渡り線は、重ならない
    const pairs = l.items.filter((i) => i.kind === 'link').map((i) => (i.kind === 'link' ? [i.a, i.b].sort().join('|') : ''));
    if (new Set(pairs).size !== pairs.length) out.push(`${l.id}：同じ2つの点を結ぶ渡り線が重なっている`);
  }
  // このアプリが作ったデータは、読み込むときの整理を、そのまま通る
  if (canon(L.sanitizeLayers(purged.layers)) !== canon(purged.layers)) out.push('読み込むときの整理で、正しいレイヤーのデータが変わる');
  // 保存のときの整理は、2回かけても同じ
  if (JSON.stringify(L.purgeOrphanMarks(purged)) !== JSON.stringify(purged)) out.push('保存のときの整理が、2回目で変わる');
  // 保存して開いても、そのまま戻る
  if (JSON.stringify(JSON.parse(JSON.stringify(purged.layers ?? null))) !== JSON.stringify(purged.layers ?? null)) out.push('保存して開くと、レイヤーの中身が変わる');
  return out;
}

function sheetProblems(doc: Doc, title: { site: string; name: string; footer: string }): string[] {
  const out: string[] = [];
  for (const info of L.layerInfos(doc)) {
    const { svg } = buildLayerSheetSvg(doc, info.id, { ...title, name: info.title });
    const bad = svg.match(BAD_TEXT);
    if (bad) out.push(`${info.id}：印刷用の図に NaN/undefined/Infinity（${bad[0]}）`);
  }
  return out;
}

const made: Record<string, number> = {};
function layerFuzzOnce(seed: number, baseDoc: Doc, title: { site: string; name: string; footer: string }): string | null {
  const r = rng(seed);
  let d = baseDoc;
  const syms = () => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const coord = () => (r.rnd() < 0.05 ? r.pick([-1e5, 1e5, 0]) : r.int(-100, 700));
  let cust: string | null = null;
  if (r.rnd() < 0.5) {
    const a = L.addLayer(d, '作業停電図');
    if (a) {
      d = a.doc;
      cust = a.id;
    }
  }
  const layers = ['outage', 'withstand', ...(cust ? [cust] : [])];
  const sig0 = L.baseSignature(d);
  let baseTouched = false;
  const itemsOf = (lid: string) => L.layerOf(d, lid)?.items ?? [];
  const idsOf = (lid: string, kind: string) => itemsOf(lid).filter((i) => i.kind === kind).map((i) => i.id);

  const steps = r.int(25, 45) * (SCALE > 1 ? 1 : 1);
  for (let s = 0; s < steps; s++) {
    const lid = r.pick(layers);
    const op = r.int(0, 25);
    try {
      if (op === 0) d = L.addLayerText(d, lid, coord(), coord(), r.pick(LAYER_TEXTS))?.doc ?? d;
      else if (op === 1 && syms().some(L.canMark)) d = L.addLayerCross(d, lid, r.pick(syms().filter(L.canMark)).id, r.pick(['S', 'M', 'L'] as const))?.doc ?? d;
      else if (op === 2) {
        // つなぐ場所は、記号の接続点（または、その近くの線）から選ぶ
        const sym = r.pick(syms());
        const pt = r.pick(portsOf(sym));
        const hit = pt ? assistGroundPoint(d, pt.x + r.int(-3, 3), pt.y + r.int(-3, 3), 40) : null;
        if (hit) d = L.addLayerGround(d, lid, hit.anchor, hit.x + r.int(-80, 80), hit.y + r.int(10, 90))?.doc ?? d;
      } else if (op === 3) d = L.addLayerArea(d, lid, L.normalizeRect(coord(), coord(), coord(), coord()), r.pick(AREA_KINDS).id)?.doc ?? d;
      else if (op === 4 || op === 5 || op === 22 || op === 23) d = L.addLayerDot(d, lid, coord(), coord(), r.rnd() < 0.3)?.doc ?? d;
      else if (op === 6 && idsOf(lid, 'dot').length) d = L.addLayerArrow(d, lid, r.pick(idsOf(lid, 'dot')))?.doc ?? d;
      else if ((op === 7 || op === 24 || op === 25) && idsOf(lid, 'dot').length > 1) d = L.addLayerLink(d, lid, r.pick(idsOf(lid, 'dot')), r.pick(idsOf(lid, 'dot')), r.pick(LINK_SHAPES).id)?.doc ?? d;
      else if (op === 8 && idsOf(lid, 'area').length) d = L.editArea(d, lid, r.pick(idsOf(lid, 'area')), r.pick([{ kind: r.pick(AREA_KINDS).id }, { hatch: r.rnd() < 0.5 }, { label: [r.pick(LAYER_TEXTS)] }, { size: r.pick([NaN, -5, 1e9, 2]) }, { bold: true }, { labelPos: r.pick(['tl', 'tr', 'bl', 'br'] as const) }, { rect: L.normalizeRect(coord(), coord(), coord(), coord()) }]));
      else if (op === 9 && idsOf(lid, 'arrow').length) d = L.editArrow(d, lid, r.pick(idsOf(lid, 'arrow')), r.pick([{ dir: r.pick(ARROW_DIRS) }, { len: r.pick([NaN, -5, 1e9, 50]) }, { label: [r.pick(LAYER_TEXTS)] }, { size: r.pick([NaN, 3]) }]));
      else if (op === 10 && idsOf(lid, 'link').length) d = L.editLink(d, lid, r.pick(idsOf(lid, 'link')), r.pick([{ shape: r.pick(LINK_SHAPES).id }, { flip: r.rnd() < 0.5 }]));
      else if (op === 11 && idsOf(lid, 'text').length) d = L.updateLayerText(d, lid, r.pick(idsOf(lid, 'text')), r.pick([{ size: r.pick([NaN, -1, 1e9, 3]) }, { bold: true }, { lines: [r.pick(LAYER_TEXTS)] }]));
      else if (op === 12 && idsOf(lid, 'ground').length) d = L.editGround(d, lid, r.pick(idsOf(lid, 'ground')), r.pick([{ lead: r.int(-80, 80) }, { drop: r.pick([NaN, -4, 1e6, 30]) }, { label: [r.pick(LAYER_TEXTS)] }, { size: r.pick([NaN, 2]) }]));
      else if (op === 13 && itemsOf(lid).length) {
        const ids = itemsOf(lid).filter(() => r.rnd() < 0.3).map((i) => i.id);
        d = L.removeLayerItems(d, lid, ids);
      } else if (op === 14 && idsOf(lid, 'dot').length) d = L.setDotPoint(d, lid, r.pick(idsOf(lid, 'dot')), coord(), coord(), r.rnd() < 0.3);
      else if (op === 15 && idsOf(lid, 'dot').length) d = L.moveLayerDots(d, lid, idsOf(lid, 'dot'), r.int(-20, 20), r.int(-20, 20));
      else if (op === 16 && idsOf(lid, 'arrow').length) d = L.setArrowTail(d, lid, r.pick(idsOf(lid, 'arrow')), coord(), coord());
      else if (op === 17 && itemsOf(lid).length) d = L.moveLayerItems(d, lid, itemsOf(lid).map((i) => i.id), r.int(-30, 30), r.int(-30, 30));
      else if (op === 18) d = L.setLayerOrientation(d, lid, r.pick(['portrait', 'landscape'] as const));
      else if (op === 19) d = L.confirmLayerReview(d, lid);
      else if (op === 20 && syms().length > 3) {
        // 元の図面を動かす・記号を消す（ここから、元の図面の署名は変わる）
        baseTouched = true;
        d = r.rnd() < 0.5 ? moveItem(d, r.pick(syms()).id, r.int(-40, 40), r.int(-40, 40)) : removeItem(d, r.pick(syms()).id);
      } else if (op === 21 && idsOf(lid, 'area').length) d = L.moveAreas(d, lid, idsOf(lid, 'area'), r.int(-20, 20), r.int(-20, 20));
    } catch (e) {
      return `操作 ${op}（レイヤー ${lid}）で止まった：${String((e as Error)?.message ?? e).slice(0, 120)}`;
    }
    if (!baseTouched && L.baseSignature(d) !== sig0) return `操作 ${op}：レイヤーだけの操作なのに、元の図面の署名が変わった`;
    if (!baseTouched) {
      for (const l2 of layers) if (L.layerNeedsReview(d, l2)) return `操作 ${op}：元の図面が変わっていないのに、要確認になった（${l2}）`;
    }
  }
  for (const l of L.layersOf(d)) for (const it of l.items) made[it.kind] = (made[it.kind] ?? 0) + 1;
  const probs = [...layerProblems(d), ...sheetProblems(d, title)];
  return probs.length ? probs.join(' ／ ') : null;
}

console.log('\n■ レイヤーのでたらめな操作（置く・直す・動かす・消す・元の図面を動かす・消す）');
{
  // 検査そのものが効いていること：わざと決まりを破ったデータを、見つけられるか
  const b0 = buildDoc({}).doc!;
  const dup = L.setLayerItems(b0, 'outage', [
    { kind: 'dot', id: 'x', x: 0, y: 0, ndx: 0, ndy: 0 },
    { kind: 'dot', id: 'x', x: 1, y: 1, ndx: 1, ndy: 1 },
  ]);
  const over = L.setLayerItems(b0, 'outage', Array.from({ length: MAX_LAYER_ITEMS_PER_KIND + 1 }, (_, i) => ({ kind: 'dot' as const, id: `o${i}`, x: i, y: 0, ndx: i, ndy: 0 })));
  const twoArrows = L.setLayerItems(b0, 'outage', [
    { kind: 'dot', id: 'p', x: 0, y: 0, ndx: 0, ndy: 0 },
    { kind: 'arrow', id: 'a1', dot: 'p' },
    { kind: 'arrow', id: 'a2', dot: 'p' },
  ]);
  if (!layerProblems(dup).some((m) => m.includes('重複'))) fail('検査が効いていません：id が重複したレイヤーを見つけられない');
  if (!layerProblems(over).some((m) => m.includes('上限'))) fail('検査が効いていません：上限を超えたレイヤーを見つけられない');
  if (!layerProblems(twoArrows).some((m) => m.includes('矢印が2本'))) fail('検査が効いていません：1つの点に2本の矢印があるレイヤーを見つけられない');

  const t0 = Date.now();
  const r = rng(303);
  const bases: { doc: Doc; title: { site: string; name: string; footer: string } }[] = [];
  for (let i = 0; bases.length < 6 && i < 60; i++) {
    const res = buildDoc(randomAnswers(r, false));
    if (res.doc && res.title && res.doc.items.filter((x) => x.kind === 'symbol').length > 8) bases.push({ doc: res.doc, title: res.title });
  }
  const runs = 60 * SCALE;
  const seen = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const b = bases[i % bases.length]!;
    const msg = layerFuzzOnce(1000 + i, b.doc, b.title);
    if (msg) seen.set(`${msg.slice(0, 160)}（種 ${1000 + i}）`, (seen.get(msg) ?? 0) + 1);
  }
  for (const [m] of seen) fail(`レイヤー：${m}`);
  // でたらめな操作が、実際に、すべての種類の印を置けていること（何も置けていない検査にならないように）
  for (const k of ['text', 'cross', 'ground', 'area', 'dot', 'arrow', 'link']) if ((made[k] ?? 0) < runs / 2) fail(`レイヤー：でたらめな操作で、${k} が ${made[k] ?? 0}個しか置けていません（検査が効いていないかもしれません）`);
  if (seen.size === 0) console.log(`  ${runs}通り（1通りあたり 25〜45回の操作）、すべて問題なし。置けた印：${Object.entries(made).map(([k, v]) => `${k} ${v}`).join('・')}`);
  console.log(`  （${Math.round((Date.now() - t0) / 100) / 10}秒）`);
}

/* ------------------------------------------------------------------ */
/* 3. 壊れたレイヤーのデータ                                             */
/* ------------------------------------------------------------------ */

console.log('\n■ 壊れたレイヤーのデータ（形の違う保存）を読み込んでも、止まらない');
{
  const r = rng(404);
  const base = buildDoc({}).doc!;
  const title = { site: '検査', name: '検査', footer: 'x' };
  const junk = (): unknown => r.pick<unknown>([null, undefined, 0, -1, NaN, 1e300, 'x', '', true, [], {}, [1, 2], { a: 1 }, '<script>', '__proto__']);
  const KINDS = ['text', 'cross', 'ground', 'area', 'dot', 'arrow', 'link', 'zzz', 5, null];
  const FIELDS = ['id', 'kind', 'x', 'y', 'w', 'h', 'lines', 'label', 'size', 'bold', 'anchor', 'target', 'near', 'ndx', 'ndy', 'dot', 'a', 'b', 'shape', 'flip', 'dir', 'len', 'lead', 'drop', 'hatch', 'labelPos', 'dx', 'dy', 'red'];
  const badItem = (): unknown => {
    const it: Record<string, unknown> = { kind: r.pick(KINDS), id: r.rnd() < 0.8 ? `i${r.int(0, 9)}` : junk() };
    for (const f of FIELDS) if (r.rnd() < 0.35) it[f] = junk();
    if (r.rnd() < 0.3) it.anchor = r.pick<unknown>([{ kind: 'port', item: junk(), port: junk() }, { kind: 'wire', t: junk() }, junk()]);
    return it;
  };
  const badLayer = (): unknown =>
    r.rnd() < 0.15
      ? junk()
      : { id: r.pick<unknown>(['outage', 'withstand', 'custom-1', 'custom-9', junk()]), name: r.rnd() < 0.5 ? junk() : '名前', items: r.rnd() < 0.2 ? junk() : Array.from({ length: r.int(0, 8) }, badItem), orientation: r.rnd() < 0.3 ? junk() : undefined, seen: r.rnd() < 0.3 ? junk() : undefined };
  const n = 250 * SCALE;
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const layers = r.rnd() < 0.1 ? junk() : Array.from({ length: r.int(0, 4) }, badLayer);
    // 保存データを読み込むときの整理（アプリの読み込み口と同じ）を通してから使う
    const doc = L.withCleanLayers({ ...base, layers } as unknown as Doc);
    try {
      L.layerInfos(doc);
      L.baseSignature(doc);
      for (const info of ['outage', 'withstand', 'custom-1', 'custom-9']) {
        L.layerNeedsReview(doc, info);
        L.layerItemsAsDocItems(doc, info);
        L.resolveCrosses(doc, info);
        L.resolveGrounds(doc, info);
        L.resolveAreas(doc, info);
        L.resolveDots(doc, info);
        L.resolveArrows(doc, info);
        L.resolveLinks(doc, info);
        buildLayerSheetSvg(doc, info, title);
      }
      L.purgeOrphanMarks(doc);
      L.carryOver(base, doc);
    } catch (e) {
      const m = String((e as Error)?.message ?? e).slice(0, 100);
      seen.set(m, (seen.get(m) ?? 0) + 1);
    }
  }
  for (const [m, c] of seen) fail(`壊れたレイヤーのデータで止まる（${c}件）：${m}`);
  if (seen.size === 0) console.log(`  ${n}通り、すべて、止まらずに読み込めた`);
}

console.log(failed === 0 ? '\n✓ 大量のでたらめな入力・操作でも、問題ありませんでした' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
