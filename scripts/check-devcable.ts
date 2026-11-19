/**
 * 変圧器・高圧コンデンサ・高圧の発電機の、電源側の高圧ケーブル（第18弾 F-①：母線から、ケーブルで接続する）の検査。
 *   パターン1：母線 → LBS → ケーブル → 機器
 *   パターン2：母線 → LBS → ケーブル → LBS → 機器
 *   パターン6：母線 → ケーブル → 開閉器（VCB・AS・LBS）→ 機器
 *   ＋ 開閉器の組み合わせ・順番（DS＋LBS、LBS＋VCS、DS＋LBS＋VCS ほか）、ケーブルの種類（埋設・架空）、複数台・複数エリア
 * それぞれ、図面を作って、(1) 開閉器・ケーブルの端末が、選んだ順に、上から並ぶ (2) ケーブルのあいだに、何も入らない
 * (3) 線が浮く・斜め・突き抜け・重なり・余分な線が無い (4) ケーブルの途中に ZCT 以外が無い、を確かめる。
 *
 *   node --experimental-strip-types scripts/check-devcable.ts
 */
import { fromLayout } from '../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../apps/web/src/editor/doc.ts';
import { cableViolations, hvStretches } from '../apps/web/src/editor/hvCable.ts';
import { inspectDrawing } from '../apps/web/src/editor/inspect.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { answersSpread } from './check-drawing/common.ts';

let failed = 0;
const fail = (m: string) => {
  console.error(`  NG: ${m}`);
  failed++;
};
console.log('■ 機器の電源側の高圧ケーブル（母線から、ケーブルで接続する）');

const SYM: Record<string, string> = { ds: 'ds', vcb: 'vcb', lbs: 'lbs-pf', 'lbs-plain': 'lbs', vcs: 'vcs', as: 'as' };
const KINDS = ['floating', 'skew', 'through', 'stray', 'overlap'];

interface Case {
  name: string;
  /** 機器：tr・cap・gen */
  p: 'tr' | 'cap' | 'gen';
  up: string[];
  dn: string[];
  inst?: 'buried' | 'overhead';
  areas?: number;
  count?: number;
  own?: Record<string, string>;
}
const CASES: Case[] = [];
for (const p of ['tr', 'cap', 'gen'] as const) {
  CASES.push({ name: `${p}：パターン1（LBS→ケーブル→機器）`, p, up: ['lbs'], dn: [], inst: 'buried' });
  CASES.push({ name: `${p}：パターン2（LBS→ケーブル→LBS→機器）`, p, up: ['lbs'], dn: ['lbs'], inst: 'overhead' });
  CASES.push({ name: `${p}：パターン6（ケーブル→VCB→機器）`, p, up: [], dn: ['vcb'], inst: 'buried' });
  CASES.push({ name: `${p}：パターン6（ケーブル→AS→機器）`, p, up: [], dn: ['as'], inst: 'overhead' });
  CASES.push({ name: `${p}：手前 DS→LBS→VCS・あと VCB`, p, up: ['ds', 'lbs', 'vcs'], dn: ['vcb'], inst: 'buried' });
  CASES.push({ name: `${p}：手前 LBS＋VCS・あと DS＋LBS`, p, up: ['lbs', 'vcs'], dn: ['ds', 'lbs'], inst: 'overhead' });
  CASES.push({ name: `${p}：ケーブルだけ`, p, up: [], dn: [] });
  CASES.push({ name: `${p}：複数エリア・複数台`, p, up: ['ds', 'vcb'], dn: ['lbs'], areas: 3, count: 2 });
}
CASES.push({ name: 'tr：ケーブルのあと LBS＋手前のLBS（PC・LBSの質問と併用）', p: 'tr', up: ['vcb'], dn: ['lbs'], own: { trHasLbs: 'yes', trHasPc: 'yes' } });
CASES.push({ name: 'cap：リアクトル付き＋VCS', p: 'cap', up: ['lbs'], dn: ['vcs'], own: { hasReactor: 'yes', capHasVcs: 'yes' } });

const COUNT_KEY = { tr: 'transformerCount', cap: 'capacitorCount', gen: 'generatorCount' } as const;
let drawings = 0;
for (const c of CASES) {
  const base: Record<string, unknown> = { ...answersSpread, areaCount: String(c.areas ?? 1), hasCapacitor: 'yes', hasGenerator: 'yes', generatorTransformer: 'bus', ...c.own };
  base[COUNT_KEY[c.p]] = String(c.count ?? 1);
  base[`${c.p}HasCable`] = 'yes';
  c.up.forEach((v, i) => (base[`${c.p}CableUp${i + 1}`] = v));
  c.dn.forEach((v, i) => (base[`${c.p}CableDn${i + 1}`] = v));
  if (c.inst) base[`${c.p}CableInstallation`] = c.inst;
  base[`${c.p}CableStructure`] = 'CVT';
  base[`${c.p}CableLength`] = '30';
  const a = dropHiddenChoices(base as Answers);
  let doc: Doc;
  try {
    const e = effectiveAnswers(a);
    doc = fromLayout(layout(buildComposition(e), e));
  } catch (err) {
    fail(`${c.name}：図面を作れませんでした（${(err as Error).message}）`);
    continue;
  }
  drawings++;
  const syms = doc.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  // 1つ目の列（エリア1・1台目）
  const col = (role: string) => syms.find((s) => s.id === `${c.p}-cable-${role}-1` || s.id === `${c.p}-cable-${role}`);
  const src = col('source');
  const site = col('site');
  if (!src || !site) {
    fail(`${c.name}：ケーブルの端末が、図面にありません`);
    continue;
  }
  if (site.rotate !== 180) fail(`${c.name}：機器側のケーブルの端末が、180°回っていません`);
  // 手前の開閉器は、選んだ順に、上から並び、ケーブルの電源側の端末より上
  const upSyms = c.up.map((v, i) => col(`up${i + 1}`)).filter((s): s is DocSymbol => !!s);
  const dnSyms = c.dn.map((v, i) => col(`dn${i + 1}`)).filter((s): s is DocSymbol => !!s);
  if (upSyms.length !== c.up.length || dnSyms.length !== c.dn.length) fail(`${c.name}：開閉器の数が合いません（手前 ${upSyms.length}/${c.up.length}・あと ${dnSyms.length}/${c.dn.length}）`);
  c.up.forEach((v, i) => {
    if (upSyms[i] && upSyms[i]!.symbolId !== SYM[v]) fail(`${c.name}：手前の${i + 1}つ目の記号が違います（${upSyms[i]!.symbolId}／${SYM[v]}）`);
  });
  c.dn.forEach((v, i) => {
    if (dnSyms[i] && dnSyms[i]!.symbolId !== SYM[v]) fail(`${c.name}：あとの${i + 1}つ目の記号が違います（${dnSyms[i]!.symbolId}／${SYM[v]}）`);
  });
  const ys = [...upSyms, src, site, ...dnSyms].map((s) => s.y);
  if (ys.some((y, i) => i > 0 && y <= ys[i - 1]!)) fail(`${c.name}：開閉器・ケーブルの端末が、選んだ順に、上から並んでいません`);
  // 機器は、それらより下
  const dev = syms.find((s) => s.id === (c.p === 'tr' ? 'transformer' : c.p === 'cap' ? 'capacitor' : 'generator') || s.id === `${c.p === 'tr' ? 'transformer' : c.p === 'cap' ? 'capacitor' : 'generator'}-1`);
  if (!dev || dev.y <= site.y) fail(`${c.name}：機器が、ケーブルの下にありません`);
  // 図面に異常が無い
  const issues = inspectDrawing(doc, 'A3', 'portrait').filter((i) => KINDS.includes(i.kind));
  if (issues.length > 0) fail(`${c.name}：図面に異常があります（${[...new Set(issues.map((i) => i.kind))].join('・')} ${issues.length}件：${issues[0]!.message}）`);
  // ケーブルの途中に何も入らない（ケーブルが、高圧として見つかり、途中に記号が無い）
  const st = hvStretches(doc).filter((s) => s.heads.some((h) => h.startsWith(`${c.p}-cable-`)));
  if (st.length === 0) fail(`${c.name}：高圧ケーブルとして見つかりません`);
  for (const s of st) if (s.mid.length > 0) fail(`${c.name}：ケーブルの途中に記号が入っています（${s.mid.join('、')}）`);
  const v = cableViolations(doc);
  if (v.length > 0) fail(`${c.name}：ケーブルの途中に、ZCT 以外が接続されています`);
}
console.log(`  ${drawings}通りを作って確かめた`);

// 「なし」のとき（ふだん）は、これまでと同じ図面（ケーブルの記号が1つも入らない）
{
  const a = dropHiddenChoices({ ...answersSpread, areaCount: '2' } as Answers);
  const e = effectiveAnswers(a);
  const d = fromLayout(layout(buildComposition(e), e));
  if (d.items.some((i) => i.kind === 'symbol' && /^(tr|cap|gen)-cable-/.test(i.id))) fail('ケーブルが「なし」なのに、ケーブルの記号が入っています');
}

if (failed === 0) console.log('\n✓ 機器の電源側の高圧ケーブルは、選んだ順に並び、図面が崩れません');
else console.error(`\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
