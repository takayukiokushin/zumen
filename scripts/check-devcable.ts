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
import type { Doc, DocSymbol, DocWire } from '../apps/web/src/editor/doc.ts';
import { cableViolations, hvStretches } from '../apps/web/src/editor/hvCable.ts';
import { inspectDrawing } from '../apps/web/src/editor/inspect.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers, feedChoices, linkRows, rowsContext } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout } from '../packages/layout/src/index.ts';
import { getSymbol } from '../packages/symbols/src/index.ts';
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
  p: 'tr' | 'cap' | 'gen' | 'motor';
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
// 電動機（母線から接続・ケーブルあり）：ケーブルのあとの開閉器
CASES.push({ name: 'motor：ケーブル→LBS→電動機', p: 'motor', up: [], dn: ['lbs'], inst: 'buried', own: { motorSwitch: 'ds' } });
CASES.push({ name: 'motor：DS＋VCB→ケーブル→DS＋LBS＋VCS', p: 'motor', up: [], dn: ['ds', 'lbs', 'vcs'], inst: 'overhead', own: { motorSwitch: 'ds-vcb' } });
CASES.push({ name: 'motor：VCS→ケーブル→AS・複数台', p: 'motor', up: [], dn: ['as'], count: 2, own: { motorSwitch: 'lbs', motorSwitch2: 'vcs' } });
CASES.push({ name: 'tr：ケーブルのあと LBS＋手前のLBS（PC・LBSの質問と併用）', p: 'tr', up: ['vcb'], dn: ['lbs'], own: { trHasLbs: 'yes', trHasPc: 'yes' } });
CASES.push({ name: 'cap：リアクトル付き＋VCS', p: 'cap', up: ['lbs'], dn: ['vcs'], own: { hasReactor: 'yes', capHasVcs: 'yes' } });

const COUNT_KEY = { tr: 'transformerCount', cap: 'capacitorCount', gen: 'generatorCount', motor: 'motorCount' } as const;
let drawings = 0;
for (const c of CASES) {
  const base: Record<string, unknown> = { ...answersSpread, areaCount: String(c.areas ?? 1), hasCapacitor: 'yes', hasGenerator: 'yes', generatorTransformer: 'bus', ...c.own };
  base[COUNT_KEY[c.p]] = String(c.count ?? 1);
  if (c.p === 'motor') Object.assign(base, { hasMotor: 'yes', motorSource: 'bus', motorCable: 'yes' });
  else base[`${c.p}HasCable`] = 'yes';
  c.up.forEach((v, i) => (base[`${c.p}CableUp${i + 1}`] = v));
  if (c.p === 'motor' && c.inst) base.motorCableInstallation = c.inst;
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
  const devId = c.p === 'tr' ? 'transformer' : c.p === 'cap' ? 'capacitor' : c.p === 'gen' ? 'generator' : 'motor';
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
  const ys = [...(c.p === 'motor' ? [] : upSyms), src, site, ...dnSyms].map((s) => s.y);
  if (ys.some((y, i) => i > 0 && y <= ys[i - 1]!)) fail(`${c.name}：開閉器・ケーブルの端末が、選んだ順に、上から並んでいません`);
  // 機器は、それらより下
  const dev = syms.find((s) => s.id === devId || s.id === `${devId}-1`);
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

/* ---- 1つの開閉器の二次側から、複数に分かれる（パターン3・4。第18弾 F-②） ---- */
type Raw = Record<string, unknown>;
const unitKey = (key: string, i: number) => (i === 0 ? key : `${key}__${i + 1}`);
const drawFeed = (name: string, raw: Raw, expect?: (doc: Doc, comp: ReturnType<typeof buildComposition>) => string | null) => {
  const a = dropHiddenChoices({ ...answersSpread, areaCount: '1', hasCapacitor: 'no', hasGenerator: 'no', hasMotor: 'no', ...raw } as Answers);
  let doc: Doc;
  let comp: ReturnType<typeof buildComposition>;
  try {
    const e = effectiveAnswers(a);
    comp = buildComposition(e);
    doc = fromLayout(layout(comp, e));
  } catch (err) {
    fail(`${name}：図面を作れませんでした（${(err as Error).message}）`);
    return;
  }
  drawings++;
  const issues = inspectDrawing(doc, 'A3', 'portrait').filter((i) => KINDS.includes(i.kind));
  if (issues.length > 0 && process.env.DBG_ISSUE) console.log('DBG', name, JSON.stringify(raw), JSON.stringify(issues.map((i) => [i.kind, Math.round(i.x), Math.round(i.y), i.itemId])), JSON.stringify(doc.items.find((x) => x.id === issues[0]!.itemId)));
  if (issues.length > 0) fail(`${name}：図面に異常があります（${[...new Set(issues.map((i) => i.kind))].join('・')} ${issues.length}件：${issues[0]!.message}）`);
  if (cableViolations(doc).length > 0) fail(`${name}：ケーブルの途中に、ZCT 以外が接続されています`);
  const msg = expect?.(doc, comp);
  if (msg) fail(`${name}：${msg}`);
};
const trUnit = (i: number, from: string | undefined, extra: Raw = {}): Raw => {
  const out: Raw = {};
  const set = (k: string, v: unknown) => (out[unitKey(k, i)] = v);
  if (from) set('trFrom', from);
  set('trHasCable', 'yes');
  set('trCableDn1', 'lbs');
  set('trCableInstallation', 'buried');
  set('trCableStructure', 'CVT');
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return out;
};
for (const n of [2, 3, 5, 8]) {
  const raw: Raw = { transformerCount: String(n), ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }) };
  for (let i = 1; i < n; i++) Object.assign(raw, trUnit(i, 'tr-cable-up2:0'));
  drawFeed(`パターン3：VCBの二次側から ${n}本に分かれる（ケーブル＋LBS＋変圧器）`, raw, (doc) => {
    const trs = doc.items.filter((i): i is DocSymbol => i.kind === 'symbol' && /^transformer(-\d+)?$/.test(i.id));
    return trs.length === n ? null : `変圧器が ${trs.length}台（${n}台のはず）`;
  });
}
// 直接つなぐ（ケーブルなし・開閉器なし）／開閉器だけ
{
  const raw: Raw = { transformerCount: '3', ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }), trFrom__2: 'tr-cable-up2:0', trFrom__3: 'tr-cable-up2:0', trHasCable__3: 'yes', trCableDn1__3: 'vcb' };
  delete raw.trHasCable__2;
  drawFeed('パターン3：1本は直接、1本はケーブルなしの開閉器だけ', raw);
}
// 2つの別の開閉器から、それぞれ分かれる（低い位置から分かれる列を、元の列の近くに置く）
{
  const raw: Raw = { transformerCount: '4', ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb', trCableUp3: 'vcs' }), ...trUnit(1, 'tr-cable-up1:0'), ...trUnit(2, 'tr-cable-up3:0'), ...trUnit(3, 'tr-cable-up3:0') };
  drawFeed('2つの別の開閉器から、それぞれ分かれる', raw, (doc, comp) => {
    const lane = (role: string) => comp.find((i) => i.role === role)?.lane;
    const l2 = lane('transformer');
    return l2 === undefined ? '変圧器が見つかりません' : null;
  });
}
// 分かれて出た列から、さらに分かれる（入れ子）
{
  const raw: Raw = { transformerCount: '3', ...trUnit(0, undefined, { trCableUp1: 'vcb' }), ...trUnit(1, 'tr-cable-up1:0', { trCableDn1: 'lbs', trCableDn2: 'vcs' }), ...trUnit(2, 'tr-cable-dn1:1') };
  drawFeed('分かれて出た列から、さらに分かれる', raw);
}
// コンデンサ・発電機・電動機が、変圧器の開閉器から分かれる（機器の種類をまたぐ）
{
  const raw: Raw = {
    transformerCount: '1',
    ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }),
    hasCapacitor: 'yes', capacitorCount: '1', capFrom: 'tr-cable-up2:0', capHasCable: 'yes', capCableDn1: 'lbs',
    hasGenerator: 'yes', generatorCount: '1', generatorTransformer: 'bus', genFrom: 'tr-cable-up2:0',
    hasMotor: 'yes', motorCount: '1', motorSource: 'bus', motorSwitch: 'none', motorFrom: 'tr-cable-up2:0', motorCable: 'yes', motorCableDn1: 'vcb',
  };
  drawFeed('コンデンサ・発電機・電動機が、変圧器のVCBの二次側から分かれる', raw);
  const e = effectiveAnswers(dropHiddenChoices({ ...answersSpread, areaCount: '1', ...raw } as Answers));
  if (feedChoices(e, 'tr', 0).length !== 0) fail('1台目の変圧器に、接続元の選択肢が出ています（自分より前の機器が無い）');
  const forCap = feedChoices(e, 'cap', 0).map((c) => c.value);
  if (!forCap.includes('tr-cable-up2:0') || !forCap.includes('tr-cable-dn1:0')) fail(`コンデンサの接続元の選択肢に、変圧器の開閉器が出ていません（${forCap.join(',')}）`);
}
// 自分より後ろの列の開閉器を選んでいる（古い答え・取り違え）→ 母線から出るものとして扱い、図面が崩れない
{
  const raw: Raw = { transformerCount: '2', ...trUnit(0, 'tr-cable-up1:1', { trCableUp1: 'ds' }), ...trUnit(1, undefined, { trCableUp1: 'vcb' }) };
  drawFeed('自分より後ろの列の開閉器が、接続元になっている（母線から出るものとして扱う）', raw, (doc, comp) => (comp.some((i) => i.feedFrom) ? '母線から出るものとして扱われていません' : null));
}
// 2か所目のエリアでも、同じ
{
  const raw: Raw = { areaCount: '2' };
  const prefix = (o: Raw): Raw => Object.fromEntries(Object.entries(o).map(([k, v]) => [`a2:${k}`, v]));
  Object.assign(raw, prefix({ transformerCount: '3', ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }), ...trUnit(1, 'tr-cable-up2:0'), ...trUnit(2, 'tr-cable-up2:0') }));
  drawFeed('2か所目のエリアで、VCBの二次側から分かれる', raw);
}

/* ---- エリア間の接続：どの分岐位置でも、段を重ねられる・ケーブルのあとにASを付けられる（パターン5。第18弾 F-③） ---- */
{
  const TAPS = ['ds-source', 'ds-vcb', 'vcb-load', 'bus', 'tr-secondary'];
  let n = 0;
  for (const tap of TAPS) {
    for (const stages of [1, 2, 3, 4]) {
      for (const first of ['none', 'ds-vcb', 'lbs']) {
        const raw: Raw = { areaCount: '2', transformerCount: '1', 'a2:linkTap': tap, 'a2:linkStageCount': String(stages), 'a2:linkSwitch': first, 'a2:linkCable': 'yes', 'a2:linkCableInstallation': 'buried', 'a2:linkCableStructure': 'CVT' };
        const sw = ['as', 'lbs', 'ds', 'vcs'];
        for (let k = 2; k <= stages; k++) {
          raw[`a2:link${k}Switch`] = sw[(k - 2) % sw.length]!;
          raw[`a2:link${k}Cable`] = k % 2 === 0 ? 'yes' : 'no';
          raw[`a2:link${k}CableInstallation`] = k % 2 === 0 ? 'overhead' : 'none';
        }
        n++;
        drawFeed(`エリア間（${tap}・${stages}段・1段目 ${first}${stages >= 2 ? '・2段目 AS' : ''}）`, raw, (_doc, comp) => {
          const made = comp.filter((i) => i.kind === 'sendout' && /sendout-as/.test(i.role)).length;
          return stages >= 2 && made !== 1 ? `ASが ${made}つ描かれました（1つのはず）` : null;
        });
      }
    }
  }
  // 3か所目のエリアが、2か所目から分岐する（段あり）
  drawFeed('3か所目が、2か所目から、2段（DS＋VCB → ケーブル → AS）で分岐', { areaCount: '3', transformerCount: '1', 'a3:linkFrom': '2', 'a3:linkTap': 'bus', 'a3:linkStageCount': '2', 'a3:linkSwitch': 'ds-vcb', 'a3:linkCable': 'yes', 'a3:link2Switch': 'as', 'a3:link2Cable': 'yes' });
  console.log(`  エリア間の段（分岐位置 5 × 段数 4 × 1段目 3）${n}通り＋3か所目`);
}

/* ---- 変圧器の二次側から別のエリアへ：開閉器・ケーブルの端末を、変圧器の真下に置き、ケーブルは、まわりを避ける（第18弾 F-③） ---- */
{
  const none = { hasCapacitor: 'no', hasGenerator: 'no', hasPv: 'no', hasBattery: 'no', hasAuxTr: 'no', hasMotor: 'no' };
  const link = (trNo: number, sw: string, extra: Raw = {}): Raw => ({ 'a2:linkTap': 'tr-secondary', 'a2:linkSourceTr': String(trNo), 'a2:linkSwitch': sw, 'a2:linkCable': 'yes', 'a2:linkCableInstallation': 'buried', 'a2:linkCableStructure': 'CVT', ...extra });
  const under = (name: string, raw: Raw, expectUnder: boolean, trNo: number) =>
    drawFeed(name, { areaCount: '2', transformerCount: '3', ...none, ...raw }, (doc) => {
      const syms = doc.items.filter((i): i is DocSymbol => i.kind === 'symbol');
      const tr = syms.find((x) => x.id === `transformer-${trNo}` || (trNo === 1 && x.id === 'transformer'));
      const sw = syms.find((x) => /(^|:)sendout-(lbs|ds|vcb)$/.test(x.id)) ?? syms.find((x) => /(^|:)cable-head-send$/.test(x.id));
      if (!tr || !sw) return '変圧器か送り出しの開閉器が見つかりません';
      const trCx = tr.x + getSymbol(tr.symbolId).box.w / 2;
      const swCx = sw.x + getSymbol(sw.symbolId).box.w / 2;
      const isUnder = Math.abs(trCx - swCx) < 6 && sw.y > tr.y;
      if (isUnder !== expectUnder) return expectUnder ? `開閉器が、変圧器の真下にありません（変圧器 ${Math.round(trCx)}・開閉器 ${Math.round(swCx)}）` : '変圧器の真下に置けない場面なのに、真下に置いています';
      return null;
    });
  under('変圧器2台目の二次側から、LBS＋ケーブル：2台目の真下', link(2, 'lbs'), true, 2);
  under('変圧器1台目の二次側から、DS＋VCB＋ケーブル：1台目の真下', link(1, 'ds-vcb'), true, 1);
  under('変圧器3台目の二次側から、開閉器なし＋ケーブル：3台目の真下', link(3, 'none'), true, 3);
  under('変圧器2台目の二次側から、2段（LBS → ケーブル → AS → ケーブル）：真下', link(2, 'lbs', { 'a2:linkStageCount': '2', 'a2:link2Switch': 'as', 'a2:link2Cable': 'yes' }), true, 2);
  // 真下に置けない場面は、これまでどおり、エリアのすきまに置き、図面は崩れない
  under('変圧器の下に低圧の回線（太陽光）がある：すきまに置く', link(2, 'lbs', { hasPv: 'yes' }), false, 2);
  under('図面の下に、電動機（つながない）が、変圧器の真下に来る：すきまに置く', { transformerCount: '1', ...link(1, 'lbs', { hasMotor: 'yes', motorCount: '1' }) }, false, 1);
  under('同じ変圧器から、2本出る：すきまに置く', { areaCount: '3', ...link(2, 'lbs'), 'a3:linkFrom': '1', ...Object.fromEntries(Object.entries(link(2, 'vcb')).map(([k, v]) => [k.replace('a2:', 'a3:'), v])) }, false, 2);
}

// 変圧器の二次側から出す線：でたらめな組み合わせ（変圧器の台数・どの台から出すか・開閉器・ケーブル・太陽光・発電機・電動機・蓄電池など）で、図面が崩れない
{
  const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
  let seed = Number(process.env.DEVSEED ?? 777);
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T,>(l: T[]): T => l[Math.floor(rnd() * l.length)]!;
  let inArea = 0;
  for (let n = 0; n < 60 * SCALE; n++) {
    const trs = 1 + Math.floor(rnd() * 4);
    const areas = 2 + Math.floor(rnd() * 2);
    const raw: Raw = {
      areaCount: String(areas), transformerCount: String(trs),
      hasCapacitor: pick(['yes', 'no']), hasGenerator: pick(['yes', 'no']), hasPv: pick(['yes', 'no']), hasBattery: pick(['yes', 'no']), hasMotor: pick(['yes', 'no']),
    };
    if (rnd() < 0.7) Object.assign(raw, trUnit(0, undefined, { trCableUp1: pick(['ds', 'vcb', 'lbs']), trCableUp2: pick(['vcb', 'lbs', 'vcs']) }));
    if (trs > 1 && rnd() < 0.5) Object.assign(raw, trUnit(1, pick(['bus', 'tr-cable-up1:0', 'tr-cable-up2:0'])));
    if (raw.hasCapacitor === 'yes') Object.assign(raw, { capacitorCount: '1', capHasCable: 'yes', capCableDn1: pick(['lbs', 'vcb']) });
    for (let to = 2; to <= areas; to++) {
      const p = `a${to}:`;
      Object.assign(raw, {
        [`${p}linkTap`]: pick(['tr-secondary', 'tr-secondary', 'bus', 'ds-vcb', 'device', 'device']),
        [`${p}linkDevice`]: pick(['tr-cable-up1:0', 'tr-cable-up2:0', 'tr-cable-dn1:0', 'tr-cable-up1:1', 'tr-lbs:0', 'cap-cable-dn1:0', 'cap-lbs:0', 'motor-vcb:0', 'tr-cable-up9:0']),
        [`${p}linkSourceTr`]: String(1 + Math.floor(rnd() * trs)),
        [`${p}linkSwitch`]: pick(['none', 'lbs', 'ds-vcb', 'vcb', 'as']),
        [`${p}linkCable`]: pick(['yes', 'yes', 'no']),
        [`${p}linkCableInstallation`]: pick(['buried', 'overhead']),
        [`${p}linkCableStructure`]: 'CVT',
      });
    }
    drawFeed(`変圧器の二次側から（でたらめ ${n + 1}）`, raw, (doc) => {
      const syms = doc.items.filter((i): i is DocSymbol => i.kind === 'symbol');
      const sw = syms.find((x) => /(^|:)sendout-(lbs|ds|vcb)$/.test(x.id) || /(^|:)cable-head-send$/.test(x.id));
      const tr = syms.find((x) => /^transformer(-\d+)?$/.test(x.id) && sw && Math.abs(x.x + getSymbol(x.symbolId).box.w / 2 - (sw.x + getSymbol(sw.symbolId).box.w / 2)) < 6);
      if (tr) inArea++;
      return null;
    });
  }
  console.log(`  変圧器の二次側から出す線（でたらめ ${60 * SCALE}通り・うち変圧器の真下に置いたもの ${inArea}通り）`);
  if (inArea < Math.max(2, SCALE * 2)) fail(`変圧器の真下に置いた図面が少なすぎます（${inArea}通り）。置き方が壊れていないか確かめてください`);
}

/* ---- ほかの機器の開閉器の二次側から、別のエリアへ出す（パターン4。第18弾 F-③） ---- */
{
  const none = { hasCapacitor: 'no', hasGenerator: 'no', hasPv: 'no', hasBattery: 'no', hasAuxTr: 'no', hasMotor: 'no' };
  const dev = (ref: string, sw: string, extra: Raw = {}): Raw => ({ 'a2:linkTap': 'device', 'a2:linkDevice': ref, 'a2:linkSwitch': sw, 'a2:linkCable': 'yes', 'a2:linkCableInstallation': 'overhead', 'a2:linkCableStructure': 'CVT', ...extra });
  const base = (n: number): Raw => ({ areaCount: '2', transformerCount: String(n), ...none, ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }) });
  const withKids = (n: number): Raw => {
    const raw = base(n);
    for (let i = 1; i < n; i++) Object.assign(raw, trUnit(i, 'tr-cable-up2:0'));
    return raw;
  };
  // 開閉器の高い所（DSの二次側）から／低い所（VCBの二次側）から
  for (const [ref, label] of [['tr-cable-up1:0', 'DSの二次側'], ['tr-cable-up2:0', 'VCBの二次側']] as const) {
    for (const n of [1, 2, 3, 5]) {
      drawFeed(`パターン4：変圧器${n}台（2台目以降は、VCBの二次側から分かれる）。${label}から、別の電気室へ`, { ...withKids(n), ...dev(ref, 'lbs') }, (doc) => {
        const wires = doc.items.filter((i): i is DocWire => i.kind === 'wire');
        const sendLbs = doc.items.find((i) => i.kind === 'symbol' && /(^|:)sendout-lbs$/.test(i.id)) as DocSymbol | undefined;
        const src = doc.items.find((i) => i.kind === 'symbol' && i.id === (n > 1 ? 'tr-cable-up' + ref.slice(-3, -2) + '-1' : 'tr-cable-up' + ref.slice(-3, -2))) as DocSymbol | undefined;
        void wires;
        if (!sendLbs) return '送り出しのLBSが描かれていません';
        if (!src) return null;
        // 送り出しの並びは、元の開閉器の列より右にある
        return sendLbs.x > src.x ? null : '送り出しの並びが、元の開閉器の列の右にありません';
      });
    }
  }
  // 段を重ねる（DS＋VCB → ケーブル → AS）／開閉器なし／ケーブルなし（ふつうの線）
  drawFeed('パターン4＋5：VCBの二次側から、2段（LBS → ケーブル → AS → ケーブル）', { ...withKids(2), ...dev('tr-cable-up2:0', 'lbs', { 'a2:linkStageCount': '2', 'a2:link2Switch': 'as', 'a2:link2Cable': 'yes', 'a2:link2CableInstallation': 'buried' }) });
  drawFeed('パターン4：開閉器なし・ケーブルあり', { ...withKids(2), ...dev('tr-cable-up1:0', 'none') });
  drawFeed('パターン4：開閉器なし・ケーブルなし（ふつうの線）', { ...withKids(3), ...dev('tr-cable-up2:0', 'none', { 'a2:linkCable': 'no' }) });
  // 元が見つからない（古い答え）：これまでの位置（母線の右端）から出る。図面は崩れない
  drawFeed('パターン4：元の開閉器が、いまは無い（古い答え）', { ...withKids(2), ...dev('tr-cable-dn1:5', 'lbs') });
  // 3か所目のエリアにも、同じ列から別々に出す／2か所目の機器の開閉器から3か所目へ出す
  drawFeed('パターン4：2か所目と3か所目へ、別々の開閉器から出す', { ...withKids(3), areaCount: '3', ...dev('tr-cable-up1:0', 'lbs'), ...Object.fromEntries(Object.entries(dev('tr-cable-up2:0', 'vcb')).map(([k, v]) => [k.replace('a2:', 'a3:'), v])) });
  drawFeed('パターン4：2か所目の機器の開閉器から、3か所目へ', { areaCount: '3', transformerCount: '1', ...none, 'a2:transformerCount': '2', ...Object.fromEntries(Object.entries({ ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }), ...trUnit(1, 'tr-cable-up2:0') }).map(([k, v]) => [`a2:${k}`, v])), 'a3:linkFrom': '2', 'a3:linkTap': 'device', 'a3:linkDevice': 'tr-cable-up1:0', 'a3:linkSwitch': 'lbs', 'a3:linkCable': 'yes' });
  // コンデンサ・電動機の開閉器の二次側から
  // 入力画面の質問「どの開閉器の二次側ですか？」の選択肢：送り出す側のエリアの、すべての機器の開閉器（順序の制限なし）
  {
    const optsOf = (raw: Raw, to: number): string[] => {
      const e = effectiveAnswers(dropHiddenChoices({ ...answersSpread, ...raw } as Answers));
      return linkRows(rowsContext(e), to).find((r) => r.question.id === 'linkDevice')?.question.options?.map((o) => o.value) ?? [];
    };
    const o2 = optsOf({ ...withKids(2), ...dev('tr-cable-up1:0', 'lbs') }, 1);
    for (const want of ['tr-cable-up1:0', 'tr-cable-up2:0', 'tr-cable-dn1:1']) if (!o2.includes(want)) fail(`分岐元の選択肢に ${want} がありません（${o2.join(',')}）`);
    if (o2.length < 3) fail(`分岐元の選択肢が少なすぎます（${o2.join(',')}）`);
    const lab = linkRows(rowsContext(effectiveAnswers(dropHiddenChoices({ ...answersSpread, ...withKids(2), ...dev('tr-cable-up1:0', 'lbs') } as Answers))), 1).find((r) => r.question.id === 'linkDevice')?.question.options?.[0]?.label ?? '';
    if (!/^feed:tr:1:DS:/.test(lab)) fail(`分岐元の選択肢の名前の符号が違います（${lab}）`);
    // 3か所目の送り元が2か所目のとき、選択肢は、2か所目の機器から作る
    const raw3: Raw = { areaCount: '3', transformerCount: '1', ...none, 'a2:transformerCount': '2', ...Object.fromEntries(Object.entries({ ...trUnit(0, undefined, { trCableUp1: 'ds', trCableUp2: 'vcb' }), ...trUnit(1, 'tr-cable-up2:0') }).map(([k, v]) => [`a2:${k}`, v])), 'a3:linkFrom': '2', 'a3:linkTap': 'device' };
    const o3 = optsOf(raw3, 2);
    if (!o3.includes('tr-cable-up1:0')) fail(`3か所目への分岐元の選択肢が、2か所目の機器から作られていません（${o3.join(',')}）`);
  }
  drawFeed('パターン4：コンデンサの開閉器の二次側から', { areaCount: '2', transformerCount: '1', ...none, hasCapacitor: 'yes', capacitorCount: '1', capHasCable: 'yes', capCableDn1: 'lbs', capCableInstallation: 'overhead', ...dev('cap-cable-dn1:0', 'vcb') });
}

// でたらめな組み合わせ：機器の種類・台数・ケーブル・開閉器・接続元を、でたらめに選んで、図面が崩れない
{
  const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = <T,>(l: T[]): T => l[Math.floor(rnd() * l.length)]!;
  const SW = ['ds', 'vcb', 'lbs', 'vcs', 'as'];
  let tried = 0;
  let fed = 0;
  for (let n = 0; n < 80 * SCALE; n++) {
    const raw: Raw = {
      areaCount: String(1 + (n % 2)),
      hasCapacitor: 'no', hasGenerator: 'no', hasMotor: 'no',
    };
    const area = (n % 2) + 1 >= 2 && rnd() < 0.6 ? 'a2:' : '';
    const put = (o: Raw) => Object.assign(raw, Object.fromEntries(Object.entries(o).map(([k, v]) => [`${area}${k}`, v])));
    const counts = { tr: 1 + Math.floor(rnd() * 4), cap: Math.floor(rnd() * 3), gen: Math.floor(rnd() * 2), motor: Math.floor(rnd() * 3) };
    put({ transformerCount: String(counts.tr) });
    if (counts.cap) put({ hasCapacitor: 'yes', capacitorCount: String(counts.cap) });
    if (counts.gen) put({ hasGenerator: 'yes', generatorCount: String(counts.gen), generatorTransformer: 'bus' });
    if (counts.motor) put({ hasMotor: 'yes', motorCount: String(counts.motor), motorSource: 'bus', motorSwitch: 'none' });
    const devs = (['tr', 'cap', 'gen', 'motor'] as const).flatMap((p) => Array.from({ length: counts[p] }, (_, i) => ({ p, i })));
    // 機器の順（変圧器→コンデンサ→電動機→発電機の順に、列が並ぶので、接続元は、先に決まった機器から選ぶ）
    for (const { p, i } of devs) {
      const o: Raw = {};
      const k = (key: string) => unitKey(key, i);
      if (rnd() < 0.7) {
        if (p === 'motor') o[k('motorCable')] = 'yes';
        else o[k(`${p}HasCable`)] = 'yes';
        o[k(`${p}CableInstallation`)] = pick(['buried', 'overhead']);
        o[k(`${p}CableStructure`)] = 'CVT';
        const used: string[] = [];
        for (const side of p === 'motor' ? ['Dn'] : ['Up', 'Dn']) {
          for (let j = 1; j <= 3; j++) {
            const rest = SW.filter((x) => !used.includes(x));
            if (rnd() < 0.5 || rest.length === 0) break;
            const v = pick(rest);
            used.push(v);
            o[k(`${p}Cable${side}${j}`)] = v;
          }
          used.length = 0;
        }
      }
      put(o);
      // 接続元：ここまでの答えで選べるものから、でたらめに（選べるものが無ければ、母線）
      const view: Raw = {};
      for (const [kk, vv] of Object.entries(raw)) view[kk.replace(/^a2:/, '')] = vv;
      try {
        const ch = feedChoices(effectiveAnswers(dropHiddenChoices({ ...answersSpread, ...view } as Answers)), p, i);
        if (ch.length > 0 && rnd() < 0.6) {
          put({ [k(`${p}From`)]: pick(ch).value });
          fed++;
        }
      } catch {
        /* 選べないときは母線 */
      }
    }
    tried++;
    drawFeed(`でたらめ ${n + 1}`, raw);
  }
  console.log(`  でたらめな組み合わせ ${tried}通り（うち接続元を選んだ機器 ${fed}台）`);
  if (fed < 20) fail(`接続元を選んだ機器が少なすぎます（${fed}台）。選択肢の作り方が壊れていないか確かめてください`);
}

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
