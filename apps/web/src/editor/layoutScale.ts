import { labelRect } from '@zumen/layout';
import { applyAnchors, groupRootOf, itemBounds } from './doc.ts';
import type { Doc, DocItem, DocSymbol } from './doc.ts';

/**
 * 「レイアウトを縮小」「レイアウトを拡大」：図面全体の、記号どうしのすきまを、縮める・広げる。
 *
 * 記号や文字の大きさは、変えない。動かすのは、すきまだけ（図面全体の横幅・縦幅も、そのぶん変わる）。
 *
 * 仕組み：横と縦を、別々に考える。
 * 1. 記号（内蔵品と、記号の脇の文字を含む）・メモ・枠の文字が占める範囲を、「ふさがっている範囲」とする。
 *    ふさがっている範囲のあいだの、何も無い範囲を、「すきま」とする。
 * 2. すきまだけを、縮める（広げる）。ふさがっている範囲は、そのまま、ずらすだけ。
 * 3. 線の端は、同じ変換で動かす（記号につないだ端は、記号と一緒に動く）。
 *
 * こうすると、
 * - 記号・文字が、新しく重なることは無い（ふさがっている範囲は、形も、間の位置も、変わらない）。
 * - 横線は横のまま、縦線は縦のまま（斜めの線ができない）。
 * - 同じ縦（横）に並んでいたものは、そろったまま。
 * - これ以上縮められないとき（すきまが、最小まで縮んだとき）は、何も変わらないので、それと分かる。
 */

/**
 * これより狭くはしない、すきまの最小の幅。
 * 記号どうしを結ぶ線（縦棒・横棒）が入っているすきまは、線の長さが MIN_BAR より短くならないところまで。
 * 何も通っていない、ただの空きは、小さくしてよい（記号・文字は、ふさがっている範囲として、そのまま動くだけなので、重ならない）。
 * （以前は、どちらも 10 だった。そのため、縦棒（もとは16ほど）が、6しか縮まなかった）
 */
export const MIN_GAP = 4;
/** 記号どうしを結ぶ線（縦棒・横棒）の、これより短くはしない長さ */
export const MIN_BAR = 8;
/** 1回押すごとの倍率（縮小は × SHRINK、拡大は ÷ SHRINK） */
export const SHRINK = 0.88;

interface Span {
  a: number;
  b: number;
}

/** 重なっている・接している範囲を、つなげる */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.b > s.a).sort((p, q) => p.a - q.a);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.a <= last.b + 0.5) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out;
}

/** すきまの新しい幅。縮めるときは、最小の幅まで。もともと最小より狭いすきまは、そのまま */
function newGap(len: number, factor: number, floor: number): number {
  if (len <= 0.5) return len;
  if (factor < 1) return Math.max(Math.min(len, floor), len * factor);
  return len * factor;
}

/** 範囲の並びから、座標を変える関数を作る（ふさがっている範囲は、そのまま平行に動く。すきまは、伸び縮みする） */
function axisMap(spans: Span[], factor: number, floorOf: (a: number, b: number) => number): (v: number) => number {
  if (spans.length === 0) return (v) => v;
  // 各範囲の、動いたあとの先頭の位置
  const shift: number[] = [0];
  const gaps: { a: number; b: number; len2: number }[] = [];
  for (let i = 1; i < spans.length; i++) {
    const gapLen = spans[i]!.a - spans[i - 1]!.b;
    const len2 = newGap(gapLen, factor, floorOf(spans[i - 1]!.b, spans[i]!.a));
    gaps.push({ a: spans[i - 1]!.b, b: spans[i]!.a, len2 });
    shift.push(shift[i - 1]! + (len2 - gapLen));
  }
  return (v) => {
    if (v <= spans[0]!.a) return v;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i]!;
      if (v <= s.b) return v + shift[i]!;
      const g = gaps[i];
      if (g && v < g.b) {
        const len = g.b - g.a;
        const t = len > 0 ? (v - g.a) / len : 0;
        return g.a + shift[i]! + t * g.len2;
      }
    }
    return v + shift[spans.length - 1]!;
  };
}

/**
 * 図面全体のすきまを、factor 倍にする（1より小さければ縮小、大きければ拡大）。
 * changed：実際に動いたか（すきまが最小まで縮んでいて、これ以上縮められないときは false）。
 */
export function scaleLayout(doc: Doc, factor: number): { doc: Doc; changed: boolean } {
  const byId = new Map(doc.items.map((it) => [it.id, it]));
  const xs: Span[] = [];
  const ys: Span[] = [];
  const rootBox = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();

  for (const it of doc.items) {
    if (it.kind === 'symbol') {
      // 内蔵品は、親と一緒に、1つのかたまりにする。記号の脇の文字も、一緒にする
      const root = groupRootOf(doc, it.id);
      const b = itemBounds(it);
      let { x0, y0, x1, y1 } = b;
      if (it.label.length > 0) {
        const r = labelRect({ x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor }, it.label);
        x0 = Math.min(x0, r.x0);
        y0 = Math.min(y0, r.y0);
        x1 = Math.max(x1, r.x1);
        y1 = Math.max(y1, r.y1);
      }
      const cur = rootBox.get(root);
      rootBox.set(
        root,
        cur ? { x0: Math.min(cur.x0, x0), y0: Math.min(cur.y0, y0), x1: Math.max(cur.x1, x1), y1: Math.max(cur.y1, y1) } : { x0, y0, x1, y1 },
      );
    } else if (it.kind === 'text') {
      const b = itemBounds(it);
      xs.push({ a: b.x0, b: b.x1 });
      ys.push({ a: b.y0, b: b.y1 });
    } else if (it.kind === 'frame') {
      // 枠は、縦の位置（と、枠の名前が占める高さ）だけ、ふさがっている範囲にする。横は、枠の端の位置を、変換で動かす
      const b = itemBounds(it);
      ys.push({ a: b.y0, b: b.y1 });
    }
  }
  for (const b of rootBox.values()) {
    xs.push({ a: b.x0, b: b.x1 });
    ys.push({ a: b.y0, b: b.y1 });
  }
  // すきまに、記号どうしを結ぶ線が入り込んでいるか（縦のすきまは縦棒、横のすきまは横棒）
  const wires = doc.items.filter((it): it is Extract<DocItem, { kind: 'wire' }> => it.kind === 'wire');
  const vBars = wires.filter((w) => Math.abs(w.x1 - w.x2) < 0.01).map((w) => ({ a: Math.min(w.y1, w.y2), b: Math.max(w.y1, w.y2) }));
  const hBars = wires.filter((w) => Math.abs(w.y1 - w.y2) < 0.01).map((w) => ({ a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2) }));
  // 線が入り込んでいるすきまは、その線（のすきまの中の部分）が、MIN_BAR より短くならないところまで。
  // 線の長さは、すきまの伸び縮みに比例するので、すきまの長さと線の長さの比は、何回押しても変わらない
  const floorFor = (bars: Span[]) => (ga: number, gb: number): number => {
    // すきまの中に入っている、いちばん短い線（4より短いものは、飾りの短い線なので数えない）
    const insides = bars.map((w) => Math.min(w.b, gb) - Math.max(w.a, ga)).filter((n) => n >= 4);
    return insides.length > 0 ? Math.max(MIN_BAR, ((gb - ga) * MIN_BAR) / Math.min(...insides)) : MIN_GAP;
  };
  const fx = axisMap(merge(xs), factor, floorFor(hBars));
  const fy = axisMap(merge(ys), factor, floorFor(vBars));

  // 記号の動き：かたまり（親）の中心の変換から、動く量を決める。内蔵品も同じ量だけ動く
  const shiftOf = new Map<string, { dx: number; dy: number }>();
  for (const [root, b] of rootBox) {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    shiftOf.set(root, { dx: fx(cx) - cx, dy: fy(cy) - cy });
  }

  let moved = false;
  const next = doc.items.map((it): DocItem => {
    if (it.kind === 'symbol') {
      const sh = shiftOf.get(groupRootOf(doc, it.id));
      if (!sh || (Math.abs(sh.dx) < 0.01 && Math.abs(sh.dy) < 0.01)) return it;
      moved = true;
      return { ...it, x: it.x + sh.dx, y: it.y + sh.dy } as DocSymbol;
    }
    if (it.kind === 'wire') {
      const w = { ...it, x1: fx(it.x1), y1: fy(it.y1), x2: fx(it.x2), y2: fy(it.y2) };
      if (Math.abs(w.x1 - it.x1) + Math.abs(w.y1 - it.y1) + Math.abs(w.x2 - it.x2) + Math.abs(w.y2 - it.y2) > 0.01) moved = true;
      return w;
    }
    if (it.kind === 'frame') {
      const x0 = fx(it.x);
      const x1 = fx(it.x + it.w);
      const y = fy(it.y);
      if (Math.abs(x0 - it.x) + Math.abs(x1 - (it.x + it.w)) + Math.abs(y - it.y) > 0.01) moved = true;
      return { ...it, x: x0, y, w: x1 - x0 };
    }
    // メモ（文字）：文字が占める範囲の中心の変換で、ずらす
    const b = itemBounds(it);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const dx = fx(cx) - cx;
    const dy = fy(cy) - cy;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return it;
    moved = true;
    return { ...it, x: it.x + dx, y: it.y + dy };
  });
  void byId;
  if (!moved) return { doc, changed: false };
  // 記号につないだ線の端を、接続点の位置に合わせ直す（変換のあとの、ごく小さなずれを、なくす）
  const anchored = applyAnchors({ ...doc, items: next });
  // 計算の、ごく小さなずれ（0.0000000000001 など）で、縦（横）の線が、斜めと見なされないように、小数点以下6けたにそろえる
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    doc: {
      ...anchored,
      items: anchored.items.map((it): DocItem => {
        if (it.kind === 'wire') return { ...it, x1: r6(it.x1), y1: r6(it.y1), x2: r6(it.x2), y2: r6(it.y2) };
        if (it.kind === 'symbol') return { ...it, x: r6(it.x), y: r6(it.y) };
        return it;
      }),
    },
    changed: true,
  };
}
