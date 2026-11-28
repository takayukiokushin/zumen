/**
 * 図面の検証（check-drawing）の35個目：「間隔を詰める・広げる」を繰り返しても、線の上に乗せる記号（VCT・CT・ZCT など）が、線から離れない
 * （第21弾 整合チェック 4。以前は、でたらめな回答から作った240通りのうち、約15〜20%で、縮小・拡大のあとに、記号が線の脇に離れた）。
 * あわせて、そのあとの図面に GR を足しても、線が GR を突き抜けない（離れた VCT に合わせて、GR が、縦線の上に置かれていた）。
 */
import { dedupeIds, fromLayout, tidyDoc } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { SHRINK, scaleLayout } from '../../apps/web/src/editor/layoutScale.ts';
import { rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import { buildComposition, dropHiddenChoices, evaluate, missingRequiredFields } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { getSymbol } from '../../packages/symbols/src/index.ts';
import { fail } from './common.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function answersOf(seed: number, area: number): Answers {
  const rnd = rng(seed * 7919 + area * 31);
  let a = { startMode: 'blank-open', areaCount: String(area) } as Answers;
  for (let step = 0; step < 800; step++) {
    const miss = missingRequiredFields(a);
    if (miss.length === 0) break;
    const f = miss[0]!;
    const q = f.question;
    let v: string | number;
    if (f.key === 'areaCount') v = String(area);
    else if (q.type === 'number') v = 1 + Math.floor(rnd() * 3);
    else if (q.type === 'boolean') v = 'yes';
    else if (q.type === 'select') {
      const opts = (q.options ?? []).filter((x) => evaluate(x.showIf, f.context));
      if (opts.length === 0) v = '1';
      else {
        const vals = opts.map((x) => String(x.value));
        const num = vals.every((x) => /^\d+$/.test(x));
        const pool = num ? vals.filter((x) => +x >= 1 && +x <= 3) : vals;
        const from = pool.length > 0 ? pool : vals;
        v = from[Math.floor(rnd() * from.length)]!;
      }
    } else v = 'テスト';
    a = dropHiddenChoices({ ...a, [f.key]: v } as Answers);
  }
  return a;
}

const gen35 = (a: Answers) => fromLayout(layout(buildComposition(a), a));
/** 線の上に乗せる記号のうち、どの縦線の上にも乗っていないものの数 */
const detached35 = (d: Doc): number => {
  const wires = d.items.filter((w): w is DocWire => w.kind === 'wire' && Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.y1 - w.y2) > 0.5);
  let n = 0;
  for (const it of d.items) {
    if (it.kind !== 'symbol' || it.parent || it.rotate % 360 !== 0) continue;
    const ow = getSymbol((it as DocSymbol).symbolId).onWire;
    if (!ow) continue;
    const ax = it.x + ow.x;
    const ay = it.y + getSymbol(it.symbolId).box.h / 2;
    if (!wires.some((w) => ay >= Math.min(w.y1, w.y2) - 1 && ay <= Math.max(w.y1, w.y2) + 1 && Math.abs(w.x1 - ax) <= 1.5)) n++;
  }
  return n;
};
const trouble35 = (d: Doc): number => inspectDrawing(d, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew', 'gap'].includes(i.kind)).length;

console.log('\n■ 間隔を詰める・広げる：線の上に乗せる記号（VCT・CT・ZCT）が、線から離れない');
{
  const OPS35: [string, number[]][] = [
    ['縮小×3', [SHRINK, SHRINK, SHRINK]],
    ['縮小→拡大', [SHRINK, 1 / SHRINK]],
    ['拡大×3', [1 / SHRINK, 1 / SHRINK, 1 / SHRINK]],
  ];
  let total = 0;
  const bad: string[] = [];
  for (const area of [1, 2]) {
    for (let seed = 1; seed <= 30; seed++) {
      const a0 = answersOf(seed, area);
      let base: Doc;
      try {
        base = gen35(a0);
      } catch {
        continue;
      }
      total++;
      for (const [name, fs] of OPS35) {
        let d = base;
        for (const f of fs) {
          const r = scaleLayout(d, f);
          if (r.changed) d = r.doc;
        }
        if (detached35(d) > detached35(base)) bad.push(`エリア${area}・種${seed}・${name}：線から離れた記号 ${detached35(base)}→${detached35(d)}`);
        else if (trouble35(d) > trouble35(base)) bad.push(`エリア${area}・種${seed}・${name}：重なりなどが ${trouble35(base)}→${trouble35(d)} に増えた`);
      }
    }
  }
  if (bad.length > 0) fail(`縮小・拡大のあとに、線から離れた記号（または重なり）が出る図面が ${bad.length}通りあります（例：${bad.slice(0, 2).join(' ／ ')}）`);
  else console.log(`  ${total}通りの図面で、縮小・拡大を繰り返しても、線から離れた記号は、増えなかった`);
}

console.log('\n■ 縮小→拡大した図面に GR を足しても、線が GR を突き抜けない（第21弾 整合チェック 4）');
{
  const a0 = answersOf(9, 1);
  let d: Doc = { ...gen35(a0), edited: true };
  for (const f of [SHRINK, 1 / SHRINK]) {
    const r = scaleLayout(d, f);
    if (r.changed) d = r.doc;
  }
  const opened = tidyDoc(dedupeIds(d));
  const prev = opened.base ? opened : { ...opened, base: d.base };
  const g2 = gen35(dropHiddenChoices({ ...a0, mainGroundRelay: 'gr', hasZpd: 'yes' } as Answers));
  const res = rebuildWithOverrides(g2, prev).doc;
  const through = inspectDrawing(res, 'A4', 'portrait').filter((i) => ['through', 'floating', 'skew', 'stray'].includes(i.kind));
  if (through.length > 0) fail(`縮小→拡大した図面に GR を足すと、問題が ${through.length}件出ます（${through[0]?.message}）`);
  else console.log('  線が GR を突き抜けない');
}
