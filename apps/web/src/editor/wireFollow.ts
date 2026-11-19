import { rotatedBox } from '@zumen/layout';
import { defOf, portsOf } from './doc.ts';
import type { Doc, DocSymbol, DocWire } from './doc.ts';

/**
 * 入力が変わって、図面を作り直したとき、記号の位置は、手で直した内容（レイアウトの縮小・拡大を含む）を重ねて、元の記号の位置に合わせる。
 * ところが、記号に直接つないでいない線（自動で作った図面の、途中の折れ線・低圧の母線・PASの内蔵品の中の線など）は、
 * 手で直した内容に入っていないので、作り直した、元の位置に戻ってしまい、記号だけが動いて、線が置き去りになる（図面が崩れる）。
 *
 * そこで、作り直した図面の線を、「線のつながり方」は保ったまま、記号の動きに合わせて動かし直す：
 *  1. 線の端のうち、同じ点に集まるものを、1つの「結び目」にまとめる（ほかの線の途中に、端が触れているものも、その線の上の結び目）
 *  2. 記号につないである端は、記号の接続点の、いまの位置（＝動いた分が分かる）
 *  3. 縦の線は、両端の x が同じ、横の線は、両端の y が同じ、という決まりを保つ。
 *     つながった結び目どうしを、x・y それぞれ、同じ動き量にする（記号につながった結び目があれば、その動き量。無ければ、まわりの動き量の平均）
 *  4. 結び目の新しい位置に、線の端を置き直す。ほかの線の途中に触れている結び目は、その線が届くまで、のばす
 */

interface End {
  /** 作り直した直後（動かす前）の位置 */
  x: number;
  y: number;
  /** 記号につないである端（または、記号の中にある端）の、いまの位置 */
  fixed?: { x: number; y: number };
  /** 接続点につないである端か */
  port?: boolean;
  /** つないでいないが、記号の中にある端か */
  inside?: boolean;
}

class UnionFind {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    while (this.p[a] !== a) {
      this.p[a] = this.p[this.p[a]!]!;
      a = this.p[a]!;
    }
    return a;
  }
  union(a: number, b: number): void {
    this.p[this.find(a)] = this.find(b);
  }
}

/**
 * generated：作り直した直後の図面（記号は、まだ動かしていない）。work：手で直した内容を重ねたあとの図面。
 * generated にあった線（id が同じ）のうち、つなぎ先を持たない端がある線を、記号の動きに合わせて動かし直した図面を返す。
 * 記号がまったく動いていないときは、何も変えずに返す。
 *
 * 線の端は、1つずつ別の「端」として扱い、同じ点に集まっている端どうしは、動き量が食い違わないときだけ、同じ動き量にそろえる
 * （縮小・拡大で、上と下の機器が、別々の量だけ動いたときは、そろえずに、別々に動かす。母線は、両方に届くよう、のばす）。
 */
export function followAutoWires(generated: Doc, work: Doc): Doc {
  const genWires = generated.items.filter((i): i is DocWire => i.kind === 'wire' && !i.fan);
  const workWire = new Map(work.items.filter((i): i is DocWire => i.kind === 'wire').map((w) => [w.id, w]));
  const wires = genWires.filter((w) => workWire.has(w.id));
  if (wires.length === 0) return work;

  const sym = new Map(work.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((s) => [s.id, s]));
  const portNow = (a: { item: string; port: string } | undefined) => {
    const s = a ? sym.get(a.item) : undefined;
    return s ? (portsOf(s).find((p) => p.id === a!.port) ?? null) : null;
  };

  // 作り直した直後の記号の位置と、いまの位置（動いた量が分かる）
  const genSym = generated.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const insideSymbol = (x: number, y: number): { dx: number; dy: number } | null => {
    let best: { area: number; dx: number; dy: number } | null = null;
    for (const g of genSym) {
      const w = sym.get(g.id);
      if (!w) continue;
      const rb = rotatedBox(defOf(g).box, g.rotate);
      const x0 = g.x + rb.dx;
      const y0 = g.y + rb.dy;
      if (x < x0 - 0.5 || x > x0 + rb.w + 0.5 || y < y0 - 0.5 || y > y0 + rb.h + 0.5) continue;
      const area = rb.w * rb.h;
      if (!best || area < best.area) best = { area, dx: w.x - g.x, dy: w.y - g.y };
    }
    return best ? { dx: best.dx, dy: best.dy } : null;
  };

  // 端：線 i の始点は 2i、終点は 2i+1
  const ends: End[] = [];
  let anyMoved = false;
  for (const w of wires) {
    for (const [x, y, an] of [[w.x1, w.y1, w.at1], [w.x2, w.y2, w.at2]] as const) {
      const p = portNow(an);
      // つないでいない端が、記号の中（たとえば、開閉器の真ん中から出るTCの点線）にあるときは、その記号と同じ量だけ動く
      const inside = !an ? insideSymbol(x, y) : null;
      const fixed = p ? { x: p.x, y: p.y } : inside ? { x: x + inside.dx, y: y + inside.dy } : undefined;
      ends.push({ x, y, ...(fixed ? { fixed } : {}), ...(p ? { port: true } : {}), ...(inside ? { inside: true } : {}) });
      if (fixed && (Math.abs(fixed.x - x) > 0.01 || Math.abs(fixed.y - y) > 0.01)) anyMoved = true;
    }
  }
  if (!anyMoved) return work;

  const isV = (w: DocWire) => Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.y1 - w.y2) >= 0.01;
  const isH = (w: DocWire) => Math.abs(w.y1 - w.y2) < 0.01 && Math.abs(w.x1 - w.x2) >= 0.01;
  // 片方が記号の接続点、もう片方が記号の中（つないでいない）の線：記号の中の端は、線の向きには、その記号と同じだけ動くが、
  // 線と直角の向きには、接続点の側の動きに合わせる（手で動かしたときと同じ。そのままだと、線が斜めになる）（第18弾 C-2）
  wires.forEach((w, i) => {
    for (const [a, b] of [[2 * i, 2 * i + 1], [2 * i + 1, 2 * i]] as const) {
      const e = ends[a]!;
      const o = ends[b]!;
      if (!e.inside || e.port || !e.fixed || !o.port || !o.fixed) continue;
      if (isH(w)) e.fixed = { x: e.fixed.x, y: e.y + (o.fixed.y - o.y) };
      else if (isV(w)) e.fixed = { x: e.x + (o.fixed.x - o.x), y: e.fixed.y };
    }
  });

  const ufx = new UnionFind(ends.length);
  const ufy = new UnionFind(ends.length);
  // 同じ線の両端：縦なら x、横なら y が同じ（動かない決まり）
  wires.forEach((w, i) => {
    if (isV(w)) ufx.union(2 * i, 2 * i + 1);
    if (isH(w)) ufy.union(2 * i, 2 * i + 1);
  });

  const anchoredDisp = (uf: UnionFind, axis: 'x' | 'y'): Map<number, number[]> => {
    const m = new Map<number, number[]>();
    ends.forEach((e, i) => {
      if (!e.fixed) return;
      const g = uf.find(i);
      m.set(g, [...(m.get(g) ?? []), axis === 'x' ? e.fixed.x - e.x : e.fixed.y - e.y]);
    });
    return m;
  };
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  /** 動き量が食い違わないときだけ、2つの組を、1つにする */
  const joinIfCompatible = (uf: UnionFind, axis: 'x' | 'y', a: number, b: number) => {
    const ga = uf.find(a);
    const gb = uf.find(b);
    if (ga === gb) return;
    const da = anchoredDisp(uf, axis);
    const va = da.get(ga);
    const vb = da.get(gb);
    if (va && vb && Math.abs(mean(va) - mean(vb)) > 0.5) return;
    uf.union(ga, gb);
  };

  // 同じ点に集まった端どうし
  const buckets = new Map<string, number[]>();
  ends.forEach((e, i) => {
    const k = `${Math.round(e.x * 2)}:${Math.round(e.y * 2)}`;
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  });
  for (const list of buckets.values()) {
    for (let a = 1; a < list.length; a++) {
      joinIfCompatible(ufx, 'x', list[0]!, list[a]!);
      joinIfCompatible(ufy, 'y', list[0]!, list[a]!);
    }
  }
  // ほかの線の途中に、端が触れている
  const contacts: { end: number; wire: number }[] = [];
  ends.forEach((e, i) => {
    wires.forEach((w, wi) => {
      if (i === 2 * wi || i === 2 * wi + 1) return;
      if (isH(w) && Math.abs(e.y - w.y1) < 0.5 && e.x > Math.min(w.x1, w.x2) + 0.5 && e.x < Math.max(w.x1, w.x2) - 0.5) {
        contacts.push({ end: i, wire: wi });
        joinIfCompatible(ufy, 'y', i, 2 * wi);
      } else if (isV(w) && Math.abs(e.x - w.x1) < 0.5 && e.y > Math.min(w.y1, w.y2) + 0.5 && e.y < Math.max(w.y1, w.y2) - 0.5) {
        contacts.push({ end: i, wire: wi });
        joinIfCompatible(ufx, 'x', i, 2 * wi);
      }
    });
  });

  const solve = (uf: UnionFind, axis: 'x' | 'y'): Map<number, number> => {
    const value = new Map<number, number>();
    for (const [g, ds] of anchoredDisp(uf, axis)) value.set(g, mean(ds));
    // 記号につながっていない組：反対向きの線（x なら横の線、y なら縦の線）の、もう一方の端の動き量から決める。
    // 上と下（左と右）の両側に、つながった端があれば、その間の位置に応じて、動き量を割り振る（ゴムのように、間をのばし・ちぢめる）。片側だけなら、いちばん近い端の動き量
    const pos = (i: number) => (axis === 'x' ? ends[i]!.x : ends[i]!.y);
    // 動き量が分かっている端に、いちばん近い（つながっている）ものから、1つずつ決める
    // （遠くの端の動き量に引きずられて、近くの端が決まる前に、先に決まってしまわないように）
    for (let guard = 0; guard < 2000; guard++) {
      const samples = new Map<number, { at: number; v: number }[]>();
      const here = new Map<number, number>();
      wires.forEach((w, wi) => {
        if (!((axis === 'x' && isH(w)) || (axis === 'y' && isV(w)))) return;
        for (const [mine, other] of [[2 * wi, 2 * wi + 1], [2 * wi + 1, 2 * wi]] as const) {
          const gm = uf.find(mine);
          const go = uf.find(other);
          here.set(gm, pos(mine));
          if (!value.has(gm) && value.has(go)) samples.set(gm, [...(samples.get(gm) ?? []), { at: pos(other), v: value.get(go)! }]);
        }
      });
      if (samples.size === 0) break;
      // 決められるもののうち、いちばん近い端までの距離が、最も短いもの
      let pick: { g: number; list: { at: number; v: number }[]; d: number } | null = null;
      for (const [g, list] of samples) {
        const at = here.get(g)!;
        const d = Math.min(...list.map((o) => Math.abs(o.at - at)));
        if (!pick || d < pick.d) pick = { g, list, d };
      }
      const { g, list } = pick!;
      const at = here.get(g)!;
      const before = list.filter((o) => o.at <= at).sort((p, q) => q.at - p.at)[0];
      const after = list.filter((o) => o.at > at).sort((p, q) => p.at - q.at)[0];
      let v: number;
      if (before && after && after.at - before.at > 0.01) v = before.v + ((after.v - before.v) * (at - before.at)) / (after.at - before.at);
      else v = list.slice().sort((p, q) => Math.abs(p.at - at) - Math.abs(q.at - at))[0]!.v;
      value.set(g, v);
    }
    return value;
  };
  const vx = solve(ufx, 'x');
  const vy = solve(ufy, 'y');
  const dxOf = (i: number) => (ends[i]!.fixed ? ends[i]!.fixed!.x - ends[i]!.x : (vx.get(ufx.find(i)) ?? 0));
  const dyOf = (i: number) => (ends[i]!.fixed ? ends[i]!.fixed!.y - ends[i]!.y : (vy.get(ufy.find(i)) ?? 0));
  // 記号に押しのけられた線：作り直した直後に、記号の下（上・左・右）を通っていた線は、記号が動いても、その側を通るように、動き量を直す
  // （縮小・拡大で、記号が、つながっていない線より大きく動いたとき、線が記号を突き抜けてしまわないように）
  const fixedGroupsX = new Set<number>();
  const fixedGroupsY = new Set<number>();
  ends.forEach((e, i) => {
    if (!e.fixed) return;
    fixedGroupsX.add(ufx.find(i));
    fixedGroupsY.add(ufy.find(i));
  });
  const boxes = genSym.flatMap((g) => {
    const w = sym.get(g.id);
    if (!w) return [];
    const rb = rotatedBox(defOf(g).box, g.rotate);
    const rn = rotatedBox(defOf(w).box, w.rotate);
    return [{ g: { x0: g.x + rb.dx, y0: g.y + rb.dy, x1: g.x + rb.dx + rb.w, y1: g.y + rb.dy + rb.h }, n: { x0: w.x + rn.dx, y0: w.y + rn.dy, x1: w.x + rn.dx + rn.w, y1: w.y + rn.dy + rn.h } }];
  });
  const keepSide = (axis: 'x' | 'y') => {
    const uf = axis === 'x' ? ufx : ufy;
    const value = axis === 'x' ? vx : vy;
    const fixedG = axis === 'x' ? fixedGroupsX : fixedGroupsY;
    const lo = new Map<number, number>();
    const hi = new Map<number, number>();
    wires.forEach((w, wi) => {
      // y を決める線は横の線、x を決める線は縦の線
      if (!(axis === 'y' ? isH(w) : isV(w))) return;
      const g = uf.find(2 * wi);
      if (fixedG.has(g) || !value.has(g)) return;
      const at = axis === 'y' ? w.y1 : w.x1;
      // 線の、もう一方の向きの範囲（作り直した直後と、いま）
      const g0 = axis === 'y' ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2);
      const g1 = axis === 'y' ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
      const nA = axis === 'y' ? ends[2 * wi]!.x + dxOf(2 * wi) : ends[2 * wi]!.y + dyOf(2 * wi);
      const nB = axis === 'y' ? ends[2 * wi + 1]!.x + dxOf(2 * wi + 1) : ends[2 * wi + 1]!.y + dyOf(2 * wi + 1);
      const n0 = Math.min(nA, nB);
      const n1 = Math.max(nA, nB);
      for (const b of boxes) {
        const gLo = axis === 'y' ? b.g.x0 : b.g.y0;
        const gHi = axis === 'y' ? b.g.x1 : b.g.y1;
        const nLo = axis === 'y' ? b.n.x0 : b.n.y0;
        const nHi = axis === 'y' ? b.n.x1 : b.n.y1;
        if (!(g0 < gHi - 0.5 && g1 > gLo + 0.5)) continue; // 作り直した直後に、この記号の脇を通っていない
        if (!(n0 < nHi - 0.5 && n1 > nLo + 0.5)) continue; // いまは、この記号の脇を通っていない
        const sLo = axis === 'y' ? b.g.y0 : b.g.x0;
        const sHi = axis === 'y' ? b.g.y1 : b.g.x1;
        const tLo = axis === 'y' ? b.n.y0 : b.n.x0;
        const tHi = axis === 'y' ? b.n.y1 : b.n.x1;
        if (at >= sHi - 0.5) lo.set(g, Math.max(lo.get(g) ?? -Infinity, tHi + (at - sHi) - at));
        else if (at <= sLo + 0.5) hi.set(g, Math.min(hi.get(g) ?? Infinity, tLo - (sLo - at) - at));
      }
    });
    for (const g of new Set([...lo.keys(), ...hi.keys()])) {
      const l = lo.get(g) ?? -Infinity;
      const h = hi.get(g) ?? Infinity;
      const v = value.get(g)!;
      if (l <= h) value.set(g, Math.min(h, Math.max(l, v)));
    }
  };
  keepSide('y');
  keepSide('x');

  // 線の端を置き直す（記号につないである端は、すでに、接続点の真上にある）
  const next = new Map<string, DocWire>();
  wires.forEach((w, wi) => {
    const cur = workWire.get(w.id)!;
    // 両端がつないである線が、「描かない」状態（長さ0）に畳まれているときは、そのまま残す。
    // 記号を動かして、線が、つなぎ先の記号の中へ折り返してしまうとき（applyAnchors が決める。接続点の位置だけで決まる）は、手で直した図面でも、線は描かない。
    // ここで広げ直すと、手で直した図面と違って、斜め・記号を突き抜ける線として、再び現れる（第18弾 C-1）
    if (cur.at1 && cur.at2 && portNow(cur.at1) && portNow(cur.at2) && Math.hypot(cur.x1 - cur.x2, cur.y1 - cur.y2) < 0.01) {
      next.set(w.id, cur);
      return;
    }
    const out: DocWire = { ...cur };
    // つないである端は、接続点の真上（片側だけつないでいて、途中で「描かない」状態に畳まれていた線は、ここで、広げ直す）。つないでいない端は、動き量の分だけ動かす
    out.x1 = ends[2 * wi]!.x + dxOf(2 * wi);
    out.y1 = ends[2 * wi]!.y + dyOf(2 * wi);
    out.x2 = ends[2 * wi + 1]!.x + dxOf(2 * wi + 1);
    out.y2 = ends[2 * wi + 1]!.y + dyOf(2 * wi + 1);
    next.set(w.id, out);
  });
  // 同じ点に集まっていた端が、別々の動き量になって、離れたとき：
  // 線と直角に出ている線の端は、そのまま残し、横（縦）の線のほうを、その端まで届くように、のばす（T字の分かれ目が切れて、浮かないように）（第18弾 C-2）
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    for (const b of list) {
      const bw = wires[b >> 1]!;
      const px = ends[b]!.x + dxOf(b);
      const py = ends[b]!.y + dyOf(b);
      for (const a of list) {
        if (a >> 1 === b >> 1) continue;
        const aw = wires[a >> 1]!;
        const ax = ends[a]!.x + dxOf(a);
        const ay = ends[a]!.y + dyOf(a);
        if (Math.abs(ax - px) < 0.5 && Math.abs(ay - py) < 0.5) continue; // 離れていない
        const out = next.get(aw.id)!;
        if (isH(aw) && isV(bw) && Math.abs(py - out.y1) < 0.5) contacts.push({ end: b, wire: a >> 1 });
        else if (isV(aw) && isH(bw) && Math.abs(px - out.x1) < 0.5) contacts.push({ end: b, wire: a >> 1 });
      }
    }
  }
  // ほかの線の途中に触れている端：その線が、端まで届くように、のばす
  for (const c of contacts) {
    const w = wires[c.wire]!;
    const out = next.get(w.id)!;
    const px = ends[c.end]!.x + dxOf(c.end);
    const py = ends[c.end]!.y + dyOf(c.end);
    if (isH(w)) {
      const lo = Math.min(out.x1, out.x2);
      const hi = Math.max(out.x1, out.x2);
      if (px < lo) (out.x1 <= out.x2 ? (out.x1 = px) : (out.x2 = px));
      else if (px > hi) (out.x1 >= out.x2 ? (out.x1 = px) : (out.x2 = px));
    } else if (isV(w)) {
      const lo = Math.min(out.y1, out.y2);
      const hi = Math.max(out.y1, out.y2);
      if (py < lo) (out.y1 <= out.y2 ? (out.y1 = py) : (out.y2 = py));
      else if (py > hi) (out.y1 >= out.y2 ? (out.y1 = py) : (out.y2 = py));
    }
  }
  return { ...work, items: work.items.map((it) => (it.kind === 'wire' && next.has(it.id) ? next.get(it.id)! : it)) };
}
