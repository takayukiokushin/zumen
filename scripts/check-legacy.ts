/**
 * 古い形式の案件を、いまのアプリで開けるかの検証（docs/legacy-projects/ の見本を使う）。
 *
 *   ・見本は、過去の版で保存された案件の形を、そのまま残したもの。決して作り直さない（直したくなったら、見本を足す）
 *   ・回答：古い回答（無くなった質問・名前が変わった質問・後から増えた質問が空のもの）でも、図面が組み立てられる
 *   ・図面：保存してあった図面（控えの無い古い形・いまの形・壊れたレイヤー）を、図面の画面と同じ手順で開ける。
 *     手で直した内容（動かした記号・足した文字）が残る。入力を変えて作り直しても、残る。保存して開き直しても、同じ
 *
 *   node --experimental-strip-types scripts/check-legacy.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { buildComposition, inputNotices, missingRequired, normalizeAnswers, visibleQuestions, withAutoValues, areaView, areaCountOf } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout, renderSvg } from '../packages/layout/src/index.ts';
import { digest, fromLayout, tidyDoc } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocText } from '../apps/web/src/editor/doc.ts';
import { carryOver, purgeOrphanMarks, withCleanLayers } from '../apps/web/src/editor/layers.ts';
import { rebuildWithOverrides } from '../apps/web/src/editor/overrides.ts';

const dir = new URL('../docs/legacy-projects/', import.meta.url);
let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

interface Sample { name: string; era: string; answers: Answers; drawing: Doc | null }
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
console.log('■ 古い形式の案件（docs/legacy-projects/）');
if (files.length < 7) fail(`見本が足りません（${files.length}件。7件以上あるはずです。見本を消してはいけません）`);

/** 図面の画面を開くときの手順（Editor.tsx の最初の組み立てと同じ） */
function openLikeEditor(answers: Answers, saved: Doc | null): Doc {
  const composition = buildComposition(answers);
  const basis = digest(JSON.stringify(composition.map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0])));
  const generated = fromLayout(layout(composition, answers), basis);
  const initial = withCleanLayers(saved);
  if (!initial || initial.edited !== true) return initial ? carryOver(generated, initial) : generated;
  const tidy = tidyDoc(initial);
  const present = tidy.base ? tidy : { ...tidy, base: generated.base };
  // 入力が変わっていれば、手で直した内容を重ねて作り直す（図面の画面が開いたあとに、自動で行うこと）
  return present.basis === basis ? present : rebuildWithOverrides(generated, present).doc;
}
const sym = (d: Doc, id: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === id);
/** 手で足した文字を、中身（行）で探す（作り直すと、id は付け直されることがある） */
const txt = (d: Doc, lines: string[]) => d.items.find((i): i is DocText => i.kind === 'text' && i.lines.join('/') === lines.join('/'));
/** 図面の中身を、id に関係なく比べるための形（記号は id・位置・種類、線・文字は位置と中身） */
const canon = (d: Doc): string =>
  d.items
    .map((i) => (i.kind === 'symbol' ? `s:${i.id}:${i.symbolId}:${Math.round(i.x)}:${Math.round(i.y)}:${i.rotate}:${i.label.join('/')}` : i.kind === 'wire' ? `w:${Math.round(i.x1)}:${Math.round(i.y1)}:${Math.round(i.x2)}:${Math.round(i.y2)}:${i.dashed ? 1 : 0}` : i.kind === 'text' ? `t:${Math.round(i.x)}:${Math.round(i.y)}:${i.lines.join('/')}` : `f:${Math.round(i.x)}:${Math.round(i.y)}:${Math.round(i.w)}`))
    .sort()
    .join('\n');
const finite = (d: Doc): boolean => d.items.every((i) => (i.kind === 'wire' ? [i.x1, i.y1, i.x2, i.y2] : [i.x, i.y]).every((v) => Number.isFinite(v)));

for (const f of files) {
  const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Sample;
  const tag = `${f}`;
  try {
    // 回答：読み替え・初期値・質問の出し分け・案内・図面の組み立て
    const norm = normalizeAnswers(s.answers);
    // （引込点の区分と名称は、1つの欄につなげて読み替えるので、区分の欄は無くなる）
    for (const k of Object.keys(s.answers)) if (!(k in norm) && !/^(pole|cabinet)Prefix$/.test(k)) fail(`${tag}：回答の「${k}」が、読み込みで消えています`);
    if (f.startsWith('01-') && norm.poleName !== '柱番 1234') fail(`${tag}：引込点の区分と名称が、つなげて読まれていません（${String(norm.poleName)}）`);
    const eff = withAutoValues(s.answers);
    visibleQuestions(eff);
    missingRequired(eff);
    for (let n = 0; n < areaCountOf(eff); n++) inputNotices(areaView(eff, n), eff);
    const comp = buildComposition(s.answers);
    if (comp.length < 3) fail(`${tag}：機器の並びが組み立てられません（${comp.length}件）`);
    const lay = layout(comp, s.answers);
    if (!lay.symbols.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))) fail(`${tag}：記号の位置が数になっていません`);
    const svg = renderSvg(lay, { site: s.name, name: '' } as never);
    if (!svg.startsWith('<svg') && !svg.includes('<svg')) fail(`${tag}：図面の書き出しができません`);
    if (/NaN|undefined/.test(svg)) fail(`${tag}：図面の書き出しに NaN・undefined が混ざっています`);

    // 図面：保存してあるものを開く
    const doc = openLikeEditor(s.answers, s.drawing);
    if (!finite(doc)) fail(`${tag}：開いた図面に、位置が数になっていない要素があります`);
    if (doc.items.filter((i) => i.kind === 'symbol').length < 3) fail(`${tag}：開いた図面に、記号がほとんどありません`);
    if (s.drawing?.edited === true) {
      // 手で直した内容が残る：動かした記号・足した文字
      for (const t of s.drawing.items.filter((i): i is DocText => i.kind === 'text' && /^text-(old|cur)/.test(i.id))) {
        if (!txt(doc, t.lines)) fail(`${tag}：手で足した文字「${t.lines[0]}」が、開いたあとに残っていません`);
      }
      const moved = s.drawing.items.find((i): i is DocSymbol => i.kind === 'symbol' && /^transformer/.test(i.id));
      const gen = fromLayout(layout(buildComposition(s.answers), s.answers));
      const g = moved ? sym(gen, moved.id) : undefined;
      const now = moved ? sym(doc, moved.id) : undefined;
      if (moved && g && now && Math.abs(now.x - moved.x) > 0.5) fail(`${tag}：手で動かした記号の位置が、開いたあとに変わっています（保存 ${moved.x}・開いた ${now.x}。自動の図面では ${g.x}）`);
      // 入力を変えて作り直しても、手で直した内容が残る
      const changed: Answers = { ...s.answers, trCapacity__2: '500' };
      const redone = openLikeEditor(changed, s.drawing);
      for (const t of s.drawing.items.filter((i): i is DocText => i.kind === 'text' && /^text-(old|cur)/.test(i.id))) {
        if (!txt(redone, t.lines)) fail(`${tag}：入力を変えて作り直したら、手で足した文字「${t.lines[0]}」が消えました`);
      }
    }
    // 保存して、開き直しても、同じ（保存のときの整理を通す）
    const saved = JSON.parse(JSON.stringify(purgeOrphanMarks(doc))) as Doc;
    const again = openLikeEditor(s.answers, saved);
    if (canon(again) !== canon(doc)) fail(`${tag}：保存して開き直すと、図面が変わります`);
    // レイヤー：壊れた中身は整理され、残った分は正しい
    for (const l of doc.layers ?? []) {
      if (!l || typeof l.id !== 'string' || !Array.isArray(l.items)) fail(`${tag}：整理しきれないレイヤーが残っています`);
      for (const it of l.items) if (!Number.isFinite((it as { x?: number }).x ?? 0) && 'x' in it) fail(`${tag}：レイヤーの中に、位置が数になっていないものが残っています`);
    }
    if (f.startsWith('06-')) {
      const keep = doc.layers?.find((l) => l.id === 'outage')?.items.map((i) => i.id).join(',');
      if (keep !== 'ok1') fail(`${tag}：壊れたレイヤーの整理が違います（残ったもの：${keep ?? 'なし'}。ok1だけのはずです）`);
    }
    if (failed === 0) console.log(`  ${tag}：開けた（${s.era}）`);
  } catch (e) {
    fail(`${tag}：開くときに、エラーになりました（${e instanceof Error ? e.message : String(e)}）`);
  }
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
