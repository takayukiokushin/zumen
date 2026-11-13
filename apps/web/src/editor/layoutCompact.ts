import { labelRect } from '@zumen/layout';
import { applyAnchors, docBounds, itemBounds } from './doc.ts';
import type { Doc, DocFrame, DocItem, DocSymbol, DocText, DocWire } from './doc.ts';

/**
 * 「レイアウトを縮小」の、列ごとに縮める方式（第13弾 項目50）。
 *
 * 従来の方式（layoutScale.ts の scaleByProjection）は、図面全体を、1本の定規で測って縮めていた。
 * 記号・文字が占める範囲を、縦（横）に投影して、どこにも何も無いすきまだけを縮める。
 * そのため、横に出ている枝の文字などが、ほかの列の縦棒の、縮められるすきまをふさいでいた。
 *
 * この方式は、列ごとに考える。
 * 1. 記号（内蔵品と、記号の脇の文字を含む）・メモ・枠を、「かたまり」とする。
 * 2. かたまりどうしは、「もう一方の向きで重なっているもの」だけが、互いに近づける限界を決める
 *    （同じ縦に並んでいるものだけが、縦の間隔を決める）。
 * 3. 縦（横）に重なっているかたまりどうしは、いまの位置の関係を、そのまま保つ（行がそろったまま動く）。
 * 4. 記号どうしをつなぐ線（縦棒・横棒）は、長さが MIN_BAR より短くならない。線の途中から枝が出ているときは、枝の位置が、線の途中に残る。
 * 5. これらの条件を満たす、いちばん詰まった位置を求める（上・左から順に、条件で決まる最小の位置）。
 *
 * 座標は、「位置の点」として登録する。同じ高さ（幅）の点は、ひとまとめにして、いまの間隔のまま動かす。
 * だから、そろっていたものは、そろったまま。横線は横のまま、縦線は縦のまま。
 * うまく解けないとき、結果が壊れているときは、null を返す（呼ぶ側が、従来の方式に切り替える）。
 */

export type Axis = 'x' | 'y';

interface Block {
  /** 記号のかたまり（親と内蔵品の id）・メモ・枠の id */
  ids: string[];
  kind: 'sym' | 'text' | 'frame';
  u0: number;
  u1: number;
  w0: number;
  w1: number;
  p0: number;
  p1: number;
  /** 縦横の範囲（紙の上の座標） */
  r: Rect;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 点（座標の値）の登録簿。同じ集まりの点は、いまの間隔のまま、いっしょに動く */
class Points {
  val: number[] = [];
  private par: number[] = [];
  add(v: number): number {
    this.val.push(v);
    this.par.push(this.val.length - 1);
    return this.val.length - 1;
  }
  find(i: number): number {
    let r = i;
    while (this.par[r] !== r) r = this.par[r]!;
    let c = i;
    while (this.par[c] !== r) {
      const n = this.par[c]!;
      this.par[c] = r;
      c = n;
    }
    return r;
  }
  /** 2つの点を、いまの間隔のまま、ひとまとめにする（集まりの代表は、いちばん小さい値の点） */
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.val[ra]! <= this.val[rb]!) this.par[rb] = ra;
    else this.par[ra] = rb;
  }
}

/** これより近い座標は、同じ高さ（幅）とみなす */
const TOL = 0.5;
/** 横（縦）の重なりを見るときの、余裕 */
const OVERLAP_MARGIN = 1;

const rectOf = (doc: Doc, it: DocSymbol): Rect => {
  const b = itemBounds(it);
  let { x0, y0, x1, y1 } = b;
  if (it.label.length > 0) {
    const r = labelRect({ x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor }, it.label);
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  void doc;
  return { x0, y0, x1, y1 };
};

/** 親をたどって、かたまりの先頭の id を返す表を作る */
function rootTable(doc: Doc): (id: string) => string {
  const byId = new Map(doc.items.map((it) => [it.id, it]));
  const cache = new Map<string, string>();
  return (id: string) => {
    const hit = cache.get(id);
    if (hit) return hit;
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur && cur.kind === 'symbol' && cur.parent && !seen.has(cur.id)) {
      seen.add(cur.id);
      const up = byId.get(cur.parent);
      if (!up) break;
      cur = up;
    }
    const root = cur?.id ?? id;
    cache.set(id, root);
    return root;
  };
}

/**
 * 縮めた（広げた）あとの、すきまの長さ。縮めるときは、floor より狭くはしない（もともと floor より狭いすきまは、そのまま）。
 * 広げるときは、そのまま factor 倍
 */
function shrunk(len: number, factor: number, floor: number): number {
  if (len <= TOL) return len;
  if (factor >= 1) return len * factor;
  return len <= floor ? len : Math.max(floor, len * factor);
}

export interface CompactParams {
  /** 何も通っていないすきまの、最小の幅 */
  minGap: number;
  /** 記号どうしをつなぐ線の、最小の長さ */
  minBar: number;
}

/**
 * 1つの向き（'y'＝縦、'x'＝横）について、列ごとに縮める。
 * 解けなかったときは null。
 */
function compactAxis(doc: Doc, axis: Axis, factor: number, params: CompactParams): Doc | null {
  const isY = axis === 'y';
  const uOf = (x: number, y: number) => (isY ? y : x);
  const wOf = (x: number, y: number) => (isY ? x : y);
  const rootOf = rootTable(doc);

  /* ---- かたまり ---- */
  const pts = new Points();
  const blocks: Block[] = [];
  const groups = new Map<string, { r: Rect; ids: string[] }>();
  for (const it of doc.items) {
    if (it.kind !== 'symbol') continue;
    const root = rootOf(it.id);
    const r = rectOf(doc, it);
    const g = groups.get(root);
    if (g) {
      g.r = { x0: Math.min(g.r.x0, r.x0), y0: Math.min(g.r.y0, r.y0), x1: Math.max(g.r.x1, r.x1), y1: Math.max(g.r.y1, r.y1) };
      g.ids.push(it.id);
    } else groups.set(root, { r, ids: [it.id] });
  }
  const pushBlock = (ids: string[], kind: Block['kind'], r: Rect) => {
    const u0 = uOf(r.x0, r.y0);
    const u1 = uOf(r.x1, r.y1);
    const w0 = wOf(r.x0, r.y0);
    const w1 = wOf(r.x1, r.y1);
    const b: Block = { ids, kind, u0: Math.min(u0, u1), u1: Math.max(u0, u1), w0: Math.min(w0, w1), w1: Math.max(w0, w1), p0: -1, p1: -1, r };
    b.p0 = pts.add(b.u0);
    b.p1 = pts.add(b.u1);
    pts.union(b.p0, b.p1);
    blocks.push(b);
  };
  const blockOfItem = new Map<string, Block>();
  for (const g of groups.values()) pushBlock(g.ids, 'sym', g.r);
  for (const it of doc.items) {
    if (it.kind === 'text') pushBlock([it.id], 'text', itemBounds(it));
    // 枠は、縦のときだけ、かたまりにする（横は、中身に合わせて、両端を動かす）
    else if (it.kind === 'frame' && isY) pushBlock([it.id], 'frame', itemBounds(it));
  }
  for (const b of blocks) for (const id of b.ids) blockOfItem.set(id, b);

  /* ---- 線の両端 ---- */
  const wires = doc.items.filter((it): it is DocWire => it.kind === 'wire');
  const wp = new Map<string, { a: number; b: number }>();
  for (const w of wires) {
    const a = pts.add(uOf(w.x1, w.y1));
    const b = pts.add(uOf(w.x2, w.y2));
    wp.set(w.id, { a, b });
    // 記号につないだ端は、その記号といっしょに動く。つないでいなくても、記号・文字の範囲の中にある端は、その記号・文字といっしょに動く
    // （VCBの接点から出るTCの点線の、記号の中にある端など）
    for (const [at, p, x, y] of [[w.at1, a, w.x1, w.y1], [w.at2, b, w.x2, w.y2]] as const) {
      const blk = at ? blockOfItem.get(at.item) : undefined;
      if (blk) {
        pts.union(p, blk.p0);
        continue;
      }
      let inside: Block | undefined;
      for (const B of blocks) {
        if (B.kind === 'frame') continue;
        if (x < B.r.x0 - TOL || x > B.r.x1 + TOL || y < B.r.y0 - TOL || y > B.r.y1 + TOL) continue;
        if (!inside || (B.r.x1 - B.r.x0) * (B.r.y1 - B.r.y0) < (inside.r.x1 - inside.r.x0) * (inside.r.y1 - inside.r.y0)) inside = B;
      }
      if (inside) pts.union(p, inside.p0);
    }
  }
  /** 枠（横のとき）の、左右の端 */
  const frames = isY ? [] : doc.items.filter((it): it is DocFrame => it.kind === 'frame');
  const frameP = frames.map((f) => ({ f, l: pts.add(f.x), r: pts.add(f.x + f.w) }));

  /* ---- 近い座標は、同じ高さ（幅）とみなして、ひとまとめにする ---- */
  {
    const order = pts.val.map((_, i) => i).sort((a, b) => pts.val[a]! - pts.val[b]!);
    for (let k = 1; k < order.length; k++) if (pts.val[order[k]!]! - pts.val[order[k - 1]!]! <= TOL) pts.union(order[k - 1]!, order[k]!);
  }

  /* ---- 条件（V(b) ≥ V(a) + c） ---- */
  const edges: { a: number; b: number; c: number; k: string }[] = [];
  let curKind = '';
  const edge = (a: number, b: number, c: number) => {
    // 縮めるときは、いまの間隔より狭い条件だけ（いまの位置が、必ず条件を満たす）。広げるときは、広げた間隔を、そのまま条件にする
    edges.push({ a, b, c: factor < 1 ? Math.min(c, pts.val[b]! - pts.val[a]!) : c, k: curKind });
    // 縮めるときは、どの間隔も、いまより広がらない（相手に引っ張られて、離れてしまうものが出ないように。
    // たとえば、どの線にもつながっていない客柱が、PASから離れていかないように）
    if (factor < 1 && curKind !== 'frame') edges.push({ a: b, b: a, c: -(pts.val[b]! - pts.val[a]!), k: 'upper' });
  };

  curKind = 'sep';
  // 1. 同じ縦（横）に並んでいるものだけが、近づける限界を決める
  const byEnd = [...blocks].sort((p, q) => p.u1 - q.u1);
  for (const B of blocks) {
    // B より前（上・左）にあるもので、B と、もう一方の向きで重なっているもの。近いものから見ていき、B の幅が全部ふさがったら、そこまで
    let hi = byEnd.length - 1;
    // B.u0 + TOL 以下で終わるものの、いちばん後ろを探す
    let lo = 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (byEnd[mid]!.u1 <= B.u0 + TOL) lo = mid;
      else hi = mid - 1;
    }
    if (byEnd[lo]!.u1 > B.u0 + TOL) continue;
    const covered: [number, number][] = [];
    const lo0 = B.w0 - OVERLAP_MARGIN;
    const hi0 = B.w1 + OVERLAP_MARGIN;
    for (let k = lo; k >= 0; k--) {
      const A = byEnd[k]!;
      if (A === B) continue;
      if (!(A.w0 < B.w1 + OVERLAP_MARGIN && B.w0 < A.w1 + OVERLAP_MARGIN)) continue;
      const s = Math.max(A.w0, lo0);
      const e = Math.min(A.w1, hi0);
      // すでに、もっと近いものにふさがれている部分だけなら、条件は要らない
      const fresh = covered.every(([cs, ce]) => !(s >= cs && e <= ce));
      if (fresh) edge(A.p1, B.p0, shrunk(Math.max(0, B.u0 - A.u1), factor, params.minGap));
      covered.push([s, e]);
      covered.sort((p, q) => p[0] - q[0]);
      const merged: [number, number][] = [];
      for (const c of covered) {
        const last = merged.at(-1);
        if (last && c[0] <= last[1] + 0.5) last[1] = Math.max(last[1], c[1]);
        else merged.push([c[0], c[1]]);
      }
      covered.length = 0;
      covered.push(...merged);
      if (covered.length === 1 && covered[0]![0] <= lo0 && covered[0]![1] >= hi0) break;
    }
  }

  // 2. 縦に重なっているかたまり（同じ行にあるもの）は、いまの位置の関係を保つ（行がそろったまま動く）。
  //    横の縮小では、これをしない：横に重なっているだけ（記号の脇の長い文字が、別の列の上に張り出している、など）で、
  //    動けなくなってしまう。縦に並んだ記号は、つないである縦の線の端が、同じ幅の点として、ひとまとめになるので、そろったまま動く
  if (isY) {
    const s = [...blocks].sort((p, q) => p.u0 - q.u0);
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length && s[j]!.u0 < s[i]!.u1 - TOL; j++) pts.union(s[i]!.p0, s[j]!.p0);
    }
  }

  // 3. 線
  curKind = 'wire';
  const axisWires = wires.map((w) => {
    const pp = wp.get(w.id)!;
    const ua = uOf(w.x1, w.y1);
    const ub = uOf(w.x2, w.y2);
    const wa = wOf(w.x1, w.y1);
    const wb = wOf(w.x2, w.y2);
    return { w, pa: pp.a, pb: pp.b, ua, ub, wa, wb };
  });
  // 線の両端（枝の付け根になりうる点）
  const ends = axisWires.flatMap((e) => [
    { p: e.pa, u: e.ua, wv: e.wa, id: e.w.id },
    { p: e.pb, u: e.ub, wv: e.wb, id: e.w.id },
  ]);
  for (const e of axisWires) {
    const lenU = Math.abs(e.ub - e.ua);
    if (lenU <= TOL) {
      // この向きと直角の線（縦の縮小のときの、横線）：ふさぐものとして、上下（左右）のかたまりの順を保つ
      const wl = Math.min(e.wa, e.wb);
      const wr = Math.max(e.wa, e.wb);
      if (wr - wl <= TOL) continue;
      const h = e.pa;
      const hv = e.ua;
      for (const B of blocks) {
        if (!(B.w1 > wl + TOL && B.w0 < wr - TOL)) continue;
        if (B.u1 <= hv + TOL) edge(B.p1, h, shrunk(Math.max(0, hv - B.u1), factor, params.minGap));
        else if (B.u0 >= hv - TOL) edge(h, B.p0, shrunk(Math.max(0, B.u0 - hv), factor, params.minGap));
      }
      continue;
    }
    // この向きに伸びている線：途中から出ている枝の付け根を含めて、つながった長さの列にする
    const straight = Math.abs(e.wb - e.wa) <= TOL;
    const chain: { p: number; u: number }[] = [
      { p: e.pa, u: e.ua },
      { p: e.pb, u: e.ub },
    ];
    if (straight) {
      const lo = Math.min(e.ua, e.ub);
      const hi = Math.max(e.ua, e.ub);
      for (const q of ends) {
        if (q.id === e.w.id) continue;
        if (Math.abs(q.wv - e.wa) <= TOL && q.u > lo + TOL && q.u < hi - TOL) chain.push({ p: q.p, u: q.u });
      }
    }
    chain.sort((p, q) => p.u - q.u);
    for (let k = 1; k < chain.length; k++) {
      const len = chain[k]!.u - chain[k - 1]!.u;
      if (len <= TOL) continue;
      edge(chain[k - 1]!.p, chain[k]!.p, shrunk(len, factor, params.minBar));
    }
  }

  // 4. 枠（横のとき）：左の端は、中に入っているかたまりのうち、いちばん左のものの左端に、右の端は、いちばん右のものの右端に、
  //    いまの余白のまま、くっついて動く。中に入っているかたまりは、枠の外へ出ない
  curKind = 'frame';
  for (const { f, l, r } of frameP) {
    const inner = blocks.filter((B) => B.kind !== 'frame' && B.u0 >= f.x - TOL && B.u1 <= f.x + f.w + TOL && B.w0 >= f.y - 14 - TOL);
    if (inner.length === 0) continue;
    const left = inner.reduce((p, q) => (q.u0 < p.u0 ? q : p));
    const right = inner.reduce((p, q) => (q.u1 > p.u1 ? q : p));
    pts.union(l, left.p0);
    pts.union(r, right.p1);
    for (const B of inner) {
      edge(l, B.p0, 0);
      edge(B.p1, r, 0);
    }
  }

  /* ---- 解く ---- */
  // 集まりごとの、いまの値（代表の値）。条件は、集まりの間の条件に直す
  const roots = new Map<number, number>();
  const rootList: number[] = [];
  const idxOf = (p: number): number => {
    const r = pts.find(p);
    let i = roots.get(r);
    if (i === undefined) {
      i = rootList.length;
      roots.set(r, i);
      rootList.push(r);
    }
    return i;
  };
  for (let p = 0; p < pts.val.length; p++) idxOf(p);
  const n = rootList.length;
  const base = rootList.map((r) => pts.val[r]!);
  const dOf = (p: number) => pts.val[p]! - pts.val[pts.find(p)]!;
  interface E {
    f: number;
    t: number;
    w: number;
    k: string;
  }
  const es: E[] = [];
  for (const e of edges) {
    const f = idxOf(e.a);
    const t = idxOf(e.b);
    if (f === t) continue;
    es.push({ f, t, w: dOf(e.a) + e.c - dOf(e.b), k: e.k });
  }
  const hasIn = new Array<boolean>(n).fill(false);
  for (const e of es) hasIn[e.t] = true;
  // 何にも縛られていない集まりは、すぐ手前（上・左）の集まりから、いまの間隔を縮めた分だけ離す（宙に浮いて、端へ寄らないように）
  const sorted = base.map((_, i) => i).sort((a, b) => base[a]! - base[b]!);
  for (let k = 1; k < sorted.length; k++) {
    const t = sorted[k]!;
    if (hasIn[t]) continue;
    const f = sorted[k - 1]!;
    es.push({ f, t, w: Math.max(0, base[t]! - base[f]!) * factor, k: 'pseudo' });
    hasIn[t] = true;
  }
  const v = new Array<number>(n).fill(-Infinity);
  // 先頭は、いまの位置のまま
  if (sorted.length > 0) v[sorted[0]!] = base[sorted[0]!]!;
  const order = es.map((_, i) => i).sort((a, b) => base[es[a]!.f]! - base[es[b]!.f]!);
  /**
   * 条件を満たす、いちばん小さい値を求める。条件が輪になって、どこまでも上がり続けるとき（広げるときに起こりうる）は、
   * その輪の条件を「いまの間隔のまま」に弱めて、やり直す。弱められないときは、解けない（false）
   */
  const pred = new Map<number, E>();
  const relax = (): boolean => {
    for (let repair = 0; repair < 80; repair++) {
      pred.clear();
      let settled = false;
      for (let pass = 0; pass < Math.min(400, n + 5); pass++) {
        let changed = false;
        for (const i of order) {
          const e = es[i]!;
          const from = v[e.f]!;
          if (from === -Infinity) continue;
          const cand = from + e.w;
          if (cand > v[e.t]! + 1e-9) {
            v[e.t] = cand;
            pred.set(e.t, e);
            changed = true;
          }
        }
        if (!changed) {
          settled = true;
          break;
        }
      }
      if (settled) return true;
      // 輪を探す：いちばん上がった集まりから、直前の条件を、n回さかのぼる
      let top = -1;
      for (const k of pred.keys()) if (top < 0 || v[k]! > v[top]!) top = k;
      let cur: number | undefined = top;
      for (let k = 0; k < n + 2 && cur !== undefined; k++) cur = pred.get(cur)?.f;
      const seen: number[] = [];
      while (cur !== undefined && !seen.includes(cur)) {
        seen.push(cur);
        cur = pred.get(cur)?.f;
      }
      if (cur === undefined) return false;
      const loop = seen.slice(seen.indexOf(cur));
      let weakened = false;
      for (const node of loop) {
        const e = pred.get(node);
        if (!e) continue;
        const old = base[e.t]! - base[e.f]!;
        if (e.w > old + 1e-9) {
          e.w = old;
          weakened = true;
        }
      }
      if (!weakened) return false;
      // 上がりすぎた値を、やり直す
      for (let k = 0; k < n; k++) v[k] = -Infinity;
      if (sorted.length > 0) v[sorted[0]!] = base[sorted[0]!]!;
    }
    return false;
  };
  if (!relax()) return null;
  // どこからも届かなかった集まり（輪になっているもの）は、いまの位置のまま
  let unreached = false;
  for (let i = 0; i < n; i++) {
    if (v[i] === -Infinity) {
      v[i] = base[i]!;
      unreached = true;
    }
  }
  if (unreached && !relax()) return null;
  const V = (p: number): number => {
    const i = idxOf(p);
    return v[i]! + dOf(p);
  };

  /* ---- 反映 ---- */
  const shiftOf = new Map<string, number>();
  for (const b of blocks) {
    const d = V(b.p0) - b.u0;
    for (const id of b.ids) shiftOf.set(id, d);
  }
  const framePos = new Map(frameP.map((x) => [x.f.id, { x: V(x.l), r: V(x.r) }]));
  const items = doc.items.map((it): DocItem => {
    if (it.kind === 'symbol' || it.kind === 'text' || (it.kind === 'frame' && isY)) {
      const d = shiftOf.get(it.id) ?? 0;
      if (Math.abs(d) < 1e-9) return it;
      return (isY ? { ...it, y: it.y + d } : { ...it, x: it.x + d }) as DocSymbol | DocText | DocFrame;
    }
    if (it.kind === 'frame') {
      const fp = framePos.get(it.id);
      return fp ? { ...it, x: fp.x, w: fp.r - fp.x } : it;
    }
    const pp = wp.get(it.id)!;
    const a = V(pp.a);
    const b = V(pp.b);
    return isY ? { ...it, y1: a, y2: b } : { ...it, x1: a, x2: b };
  });
  return { ...doc, items };
}

/** 動いたか（どれか1つでも、0.01より大きく動いた） */
function moved(a: Doc, b: Doc): boolean {
  for (let i = 0; i < a.items.length; i++) {
    const p = a.items[i]!;
    const q = b.items[i]!;
    if (p.kind === 'wire' && q.kind === 'wire') {
      if (Math.abs(p.x1 - q.x1) + Math.abs(p.y1 - q.y1) + Math.abs(p.x2 - q.x2) + Math.abs(p.y2 - q.y2) > 0.01) return true;
    } else if (p.kind === 'frame' && q.kind === 'frame') {
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.w - q.w) > 0.01) return true;
    } else if ('x' in p && 'x' in q) {
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 0.01) return true;
    }
  }
  return false;
}

/** 結果が壊れていないか：線の向き・かたまりの重なり・全体の大きさ */
function sound(before: Doc, after: Doc): boolean {
  const bw = new Map(before.items.filter((i): i is DocWire => i.kind === 'wire').map((w) => [w.id, w]));
  for (const w of after.items) {
    if (w.kind !== 'wire') continue;
    const o = bw.get(w.id);
    if (!o) return false;
    const wasV = Math.abs(o.x1 - o.x2) < 0.01;
    const wasH = Math.abs(o.y1 - o.y2) < 0.01;
    if (wasV && Math.abs(w.x1 - w.x2) > 0.02) return false;
    if (wasH && Math.abs(w.y1 - w.y2) > 0.02) return false;
    if (!Number.isFinite(w.x1 + w.y1 + w.x2 + w.y2)) return false;
  }
  // かたまりの重なり：新しく重なったものがあってはいけない
  const rects = (d: Doc): { id: string; r: Rect }[] => {
    const rootOf = rootTable(d);
    const m = new Map<string, Rect>();
    for (const it of d.items) {
      let key = it.id;
      let r: Rect;
      if (it.kind === 'symbol') {
        key = rootOf(it.id);
        r = rectOf(d, it);
      } else if (it.kind === 'text') r = itemBounds(it);
      else continue;
      const c = m.get(key);
      m.set(key, c ? { x0: Math.min(c.x0, r.x0), y0: Math.min(c.y0, r.y0), x1: Math.max(c.x1, r.x1), y1: Math.max(c.y1, r.y1) } : r);
    }
    return [...m.entries()].map(([id, r]) => ({ id, r }));
  };
  const hit = (p: Rect, q: Rect) => p.x0 < q.x1 - 0.5 && q.x0 < p.x1 - 0.5 && p.y0 < q.y1 - 0.5 && q.y0 < p.y1 - 0.5;
  const rb = rects(before);
  const ra = rects(after);
  const was = new Set<string>();
  for (let i = 0; i < rb.length; i++) for (let j = i + 1; j < rb.length; j++) if (hit(rb[i]!.r, rb[j]!.r)) was.add(`${rb[i]!.id}|${rb[j]!.id}`);
  for (let i = 0; i < ra.length; i++) {
    for (let j = i + 1; j < ra.length; j++) {
      if (hit(ra[i]!.r, ra[j]!.r) && !was.has(`${ra[i]!.id}|${ra[j]!.id}`) && !was.has(`${ra[j]!.id}|${ra[i]!.id}`)) return false;
    }
  }
  return true;
}

/**
 * 1つの向きだけ、列ごとに縮める。解けない・動かない・結果が壊れるときは null。
 * 結果は、つなぎ先に合わせて線の端を直し、小数点以下6けたにそろえてある。
 */
export function compactOneAxis(doc: Doc, axis: Axis, factor: number, params: CompactParams): Doc | null {
  if (factor === 1) return null;
  const raw = compactAxis(doc, axis, factor, params);
  if (!raw || !moved(doc, raw)) return null;
  const anchored = applyAnchors(raw);
  // 計算の、ごく小さなずれで、縦（横）の線が、斜めと見なされないように、小数点以下6けたにそろえる
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const out: Doc = {
    ...anchored,
    items: anchored.items.map((it): DocItem => {
      if (it.kind === 'wire') return { ...it, x1: r6(it.x1), y1: r6(it.y1), x2: r6(it.x2), y2: r6(it.y2) };
      if (it.kind === 'symbol') return { ...it, x: r6(it.x), y: r6(it.y) };
      return it;
    }),
  };
  if (!sound(doc, out)) return null;
  // 縮小したのに大きくなる・拡大したのに小さくなる、ということがあってはいけない
  const b0 = docBounds(doc);
  const b1 = docBounds(out);
  const dw = b1.x1 - b1.x0 - (b0.x1 - b0.x0);
  const dh = b1.y1 - b1.y0 - (b0.y1 - b0.y0);
  if (factor < 1 ? dw > 0.01 || dh > 0.01 : dw < -0.01 || dh < -0.01) return null;
  return out;
}
