/**
 * 図面の検証（check-drawing）で、3つの部分が共有するもの：試験用の回答・図面の作り方・「問題」の数え方。
 * 部分は、part1.ts → part2.ts → part3.ts の順に、scripts/check-drawing.ts から呼ばれる。
 */
import { fromLayout, portsOf } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { buildComposition, indexedKey, PER_UNIT_QUESTION_IDS, QUESTIONS, QUESTION_GROUPS } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { rotatedPort, layout } from '../../packages/layout/src/index.ts';
import { getSymbol as getSymbolDef } from '../../packages/symbols/src/index.ts';

export type PlacedSymbolLike = ReturnType<typeof layout>['symbols'][number];
export const portAbs = (s: PlacedSymbolLike, id: string) => {
  const def = getSymbolDef(s.symbolId);
  const p = def.ports.find((q) => q.id === id)!;
  const [rx, ry] = rotatedPort(def.box, p.x, p.y, s.rotate);
  return { x: s.x + rx, y: s.y + ry };
};
export const portX = (s: PlacedSymbolLike, id: string) => portAbs(s, id).x;
export const portY = (s: PlacedSymbolLike, id: string) => portAbs(s, id).y;

/** 問題の件数（最後に、scripts/check-drawing.ts が見て、終了の番号を決める） */
export const state = { failed: 0 };
export const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  state.failed++;
};

/** 変圧器3台・コンデンサ2組・低圧回線2本の、いちばん込み入った構成 */
export const answers: Answers = {
  siteName: '検証用',
  receivingVoltage: 6600,
  sourceType: 'pole',
  boundaryPattern: 'coincident',
  hasPas: 'yes',
  pasControl: 'dgr',
  pasBuiltinVt: 'yes',
  vctLocation: 'indoor',
  vctCount: 2,
  areaCount: 1,
  areaForm: 'cubicle',
  mainBreakerForm: 'cb',
  dsRating: '7200V 200A',
  vcbRating: '7200V 600A',
  hasSiteVt: 'yes',
  hasSiteCt: 'yes',
  transformerCount: 3,
  trConnection: 'tr-3p-dy',
  trUsage: '動力',
  trCapacity: 300,
  trVoltage: '6600/210V',
  hasCapacitor: 'yes',
  capacitorCount: 2,
  hasPv: 'yes',
  pvGroupCount: '1',
  pcsCapacity: 50,
  pcsCount: '4',
  pcsToTr1: 2,
  pcsToTr2: 2,
  hasGenerator: 'yes',
};


/**
 * 件ごとに独立して答えるようになったので、試験の回答も件ごとに用意する。
 * 「3台とも同じ変圧器」という現場はよくあるので、
 * 1件目の答えを件数ぶんに広げる（すでに入れてある件はそのまま）。
 * PCSの容量の種類だけは件ごとに中身が違うので広げない。
 */
export function spreadUnits(a: Answers): Answers {
  const out: Answers = { ...a };
  for (const g of QUESTION_GROUPS) {
    if (!g.repeatCountKey || g.id === 'pv') continue;
    const count = Math.max(1, Number(a[g.repeatCountKey] ?? 1));
    for (const q of QUESTIONS) {
      if (q.group !== g.id || !PER_UNIT_QUESTION_IDS.has(q.id)) continue;
      if (a[q.id] === undefined) continue;
      for (let i = 1; i < count; i++) {
        if (out[indexedKey(q.id, i)] === undefined) out[indexedKey(q.id, i)] = a[q.id];
      }
    }
  }
  return out;
}

export const answersSpread = spreadUnits(answers);
export const build = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));

export const wires = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
export const symbols = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');

/** つないである端が、接続点の真上にあるか。ずれの最大値を返す */
export function worstGap(d: Doc): number {
  const port = (item: string, port: string) => {
    const s = d.items.find((i) => i.id === item);
    return s && s.kind === 'symbol' ? portsOf(s).find((p) => p.id === port) : undefined;
  };
  let worst = 0;
  for (const w of wires(d)) {
    // 折り返して描かないことにした線（長さが見えないほど短い）は、数えない
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 0.01) continue;
    for (const end of [1, 2] as const) {
      const a = end === 1 ? w.at1 : w.at2;
      if (!a) continue;
      const p = port(a.item, a.port);
      if (!p) continue;
      const wx = end === 1 ? w.x1 : w.x2;
      const wy = end === 1 ? w.y1 : w.y2;
      worst = Math.max(worst, Math.hypot(p.x - wx, p.y - wy));
    }
  }
  return worst;
}

/** 斜めになっている線（縦でも横でもない線）の本数 */
export const skewed = (d: Doc) => wires(d).filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2).length;

export const anchoredEnds = (d: Doc) => wires(d).reduce((n, w) => n + (w.at1 ? 1 : 0) + (w.at2 ? 1 : 0), 0);
