/**
 * あとから動かしやすくする（第13弾 項目55 修正18／B-10）。
 *
 * ① 記号を消したとき、その上下（左右）の線を、1本の直線につなぐ（healBeforeRemove）。
 *    鎖のいちばん端の記号を消したときは、行き止まりになる線も、一緒に消す。
 * ② 記号を、線の上に動かして離したとき、その線を2つに割って、記号の入口と出口につなぐ（moveWithInsert）。
 *    つながっている記号を、別の線の上へ動かしたときは、元の場所の上下の線を、先に1本につなぐ。
 *    線の長さが足りないときは、割った場所より下（右）のものを、足りないぶんだけ、まとめて動かして、場所を空ける。
 * ③ 余計な線（長さのない線・二重になった線）を残さない（cleanupWires）。
 *
 * いずれも、新しい Doc を返す（「操作を戻す」では、1つの操作として戻る）。
 * 斜めの線は作らない。少しでも条件に合わないときは、何もしない（これまでの動きのまま）。
 */
import { rotatedBox } from '@zumen/layout';
import { defOf, groupOf, newWireId, portsOf } from './doc.ts';
import type { Anchor, Doc, DocItem, DocSymbol, DocWire } from './doc.ts';

/** 線の上に離したと見なす、横（縦）のずれの範囲 */
export const INSERT_RANGE = 10;
/** 記号を入れたあとの、記号と、上下（左右）の線の端との、最低限のあき（自動レイアウトの間隔と同じ） */
const MIN_ROOM = 16;
const EPS = 0.5;

type Axis = 'v' | 'h';

/** 記号が「上と下（左と右）に、接続点が1つずつ」の形か。そうなら、その2つの接続点（座標の小さい順）と向き */
function throughPorts(it: DocSymbol): { a: { id: string; x: number; y: number }; b: { id: string; x: number; y: number }; axis: Axis } | null {
  const def = defOf(it);
  const abs = portsOf(it);
  const lines = def.ports.map((p, i) => ({ role: p.role, abs: abs[i]! })).filter((p) => p.role === undefined || p.role === 'line');
  if (lines.length !== 2) return null;
  const [p, q] = [lines[0]!.abs, lines[1]!.abs];
  if (Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) >= 1) return p.y < q.y ? { a: p, b: q, axis: 'v' } : { a: q, b: p, axis: 'v' };
  if (Math.abs(p.y - q.y) < EPS && Math.abs(p.x - q.x) >= 1) return p.x < q.x ? { a: p, b: q, axis: 'h' } : { a: q, b: p, axis: 'h' };
  return null;
}

const wiresOf = (doc: Doc): DocWire[] => doc.items.filter((i): i is DocWire => i.kind === 'wire');
const isVert = (w: DocWire) => Math.abs(w.x1 - w.x2) < EPS && Math.abs(w.y1 - w.y2) >= EPS;
const isHorz = (w: DocWire) => Math.abs(w.y1 - w.y2) < EPS && Math.abs(w.x1 - w.x2) >= EPS;
const straightOn = (w: DocWire, axis: Axis) => (axis === 'v' ? isVert(w) : isHorz(w));
const attachedTo = (w: DocWire, id: string, port?: string): 1 | 2 | null => {
  if (w.at1 && w.at1.item === id && (port === undefined || w.at1.port === port)) return 1;
  if (w.at2 && w.at2.item === id && (port === undefined || w.at2.port === port)) return 2;
  return null;
};
/** 記号に（どの接続点でも）つながっている線 */
const wiresAttachedTo = (doc: Doc, id: string): DocWire[] => wiresOf(doc).filter((w) => attachedTo(w, id) !== null);

/** 線の、記号につながっていない側の端（座標とつなぎ先） */
function otherEnd(w: DocWire, thisEnd: 1 | 2): { x: number; y: number; at?: Anchor } {
  return thisEnd === 1 ? { x: w.x2, y: w.y2, at: w.at2 } : { x: w.x1, y: w.y1, at: w.at1 };
}

/* ------------------------------------------------------------------ */
/* ① 消すとき                                                          */
/* ------------------------------------------------------------------ */

/**
 * 記号を消す前に、つないである線を整える。
 * - 上下（左右）に1本ずつ、まっすぐ同じ位置の線があるとき：2本を、1本の直線につなぐ
 * - 線が1本だけ（鎖の端）のとき：その線が、行き止まりの垂れ下がりなら、消す
 * 内蔵品のある記号（PAS）・つなぎ方が複雑な記号・斜めの線・点線は、何もしない
 */
export function healBeforeRemove(doc: Doc, id: string): Doc {
  const it = doc.items.find((x) => x.id === id);
  if (!it || it.kind !== 'symbol' || groupOf(doc, id).length !== 1 || it.parent) return doc;

  // 連動の点線（TC→開閉器）で、消す記号の中で止まっているものは、つなぎ先が無くなるので、消す
  const rb = rotatedBox(defOf(it).box, it.rotate);
  const inBox = (x: number, y: number) => x > it.x + rb.dx && x < it.x + rb.dx + rb.w && y > it.y + rb.dy && y < it.y + rb.dy + rb.h;
  const links = new Set(wiresOf(doc).filter((w) => w.dashed && ((!w.at1 && inBox(w.x1, w.y1)) || (!w.at2 && inBox(w.x2, w.y2)))).map((w) => w.id));
  if (links.size > 0) doc = { ...doc, items: doc.items.filter((x) => !links.has(x.id)) };

  const attached = wiresAttachedTo(doc, id);
  if (attached.length === 0) return doc;
  const tp = throughPorts(it);

  // 上下（左右）の接続点に、1本ずつ、まっすぐ同じ位置の線があるとき：2本を、1本の直線につなぐ
  if (tp) {
    const onA = attached.filter((w) => attachedTo(w, id, tp.a.id));
    const onB = attached.filter((w) => attachedTo(w, id, tp.b.id));
    if (onA.length === 1 && onB.length === 1 && onA.length + onB.length === attached.length) {
      const wa = onA[0]!;
      const wb = onB[0]!;
      if (wa.id !== wb.id && !wa.dashed && !wb.dashed && straightOn(wa, tp.axis) && straightOn(wb, tp.axis)) {
        const ea = attachedTo(wa, id, tp.a.id)!;
        const eb = attachedTo(wb, id, tp.b.id)!;
        const oa = otherEnd(wa, ea);
        const ob = otherEnd(wb, eb);
        const same = tp.axis === 'v' ? Math.abs(oa.x - ob.x) < EPS : Math.abs(oa.y - ob.y) < EPS;
        if (same) {
          return {
            ...doc,
            items: doc.items
              .filter((x) => x.id !== wb.id)
              .map((x) => (x.id === wa.id ? { ...wa, ...(ea === 1 ? { x1: ob.x, y1: ob.y, at1: ob.at } : { x2: ob.x, y2: ob.y, at2: ob.at }) } : x)) as DocItem[],
          };
        }
      }
    }
    // 上下の両方に線があるのに、位置がずれている：自動ではつながない（つなぎ先を失った線として残す。あとで、利用者が結ぶ）
    if (onA.length > 0 && onB.length > 0) return doc;
  }

  // 鎖の端（記号の片側にだけ線がある）：行き止まりになる線を、一緒に消す。
  // 線の途中に、ほかの線の端・記号の接続点が乗っているとき、斜めの線のときは、その線は消さない
  const removable = (w: DocWire): boolean => {
    if (!isVert(w) && !isHorz(w)) return false;
    const v = isVert(w);
    const lo = v ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
    const hi = v ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
    const onInterior = (x: number, y: number) => (v ? Math.abs(x - w.x1) < EPS && y > lo + 1 && y < hi - 1 : Math.abs(y - w.y1) < EPS && x > lo + 1 && x < hi - 1);
    for (const x of doc.items) {
      if (x.kind === 'wire' && x.id !== w.id) {
        if (onInterior(x.x1, x.y1) || onInterior(x.x2, x.y2)) return false;
      } else if (x.kind === 'symbol' && x.id !== id) {
        if (portsOf(x).some((p) => onInterior(p.x, p.y))) return false;
      }
    }
    return true;
  };
  const gone = new Set(attached.filter(removable).map((w) => w.id));
  if (gone.size === 0) return doc;
  let items = doc.items.filter((x) => !gone.has(x.id));
  // 消した線の先（つなぎ先の無い側の端）に、ほかの線の、つなぎ先の無い端だけが残るときは、その線も、行き止まりになるので、一緒に消す
  for (const w of attached.filter((x) => gone.has(x.id))) {
    const o = otherEnd(w, attachedTo(w, id)!);
    if (o.at) continue;
    const here = (x: number, y: number) => Math.abs(x - o.x) < EPS && Math.abs(y - o.y) < EPS;
    const touching = items.filter((x) => (x.kind === 'wire' && (here(x.x1, x.y1) || here(x.x2, x.y2))) || (x.kind === 'symbol' && portsOf(x).some((pp) => here(pp.x, pp.y))));
    const dangling = touching.filter((x): x is DocWire => x.kind === 'wire' && ((here(x.x1, x.y1) && !x.at1) || (here(x.x2, x.y2) && !x.at2)));
    // その点に、ほかのものが何も触れていなければ（その線の先端だけが、そこにある）、行き止まり
    if (touching.length === 1 && dangling.length === 1 && !dangling[0]!.dashed) items = items.filter((x) => x.id !== dangling[0]!.id);
  }
  return { ...doc, items };
}

/* ------------------------------------------------------------------ */
/* ② 線の上に離したとき                                                */
/* ------------------------------------------------------------------ */

export interface InsertTarget {
  /** 割る線 */
  wire: string;
  axis: Axis;
}

/**
 * 1つだけ動かしている記号が、離したとき、入る線。無ければ null。
 * 条件：記号が（上下か左右に）接続点を1つずつ持つ／その記号につながっていない、まっすぐな実線の上／
 * 記号の中心が、線の長さの範囲に入り、線との横（縦）のずれが INSERT_RANGE 以内
 */
export function insertTarget(doc: Doc, id: string, dx: number, dy: number): InsertTarget | null {
  const it = doc.items.find((x) => x.id === id);
  if (!it || it.kind !== 'symbol' || it.parent || groupOf(doc, id).length !== 1) return null;
  const moved: DocSymbol = { ...it, x: it.x + dx, y: it.y + dy };
  const tp = throughPorts(moved);
  if (!tp) return null;
  const cx = (tp.a.x + tp.b.x) / 2;
  const cy = (tp.a.y + tp.b.y) / 2;
  let best: { wire: string; d: number } | null = null;
  for (const w of wiresOf(doc)) {
    if (w.dashed || attachedTo(w, id) !== null || !straightOn(w, tp.axis)) continue;
    const lateral = tp.axis === 'v' ? Math.abs(cx - w.x1) : Math.abs(cy - w.y1);
    if (lateral > INSERT_RANGE) continue;
    const along = tp.axis === 'v' ? cy : cx;
    const lo = tp.axis === 'v' ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
    const hi = tp.axis === 'v' ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
    if (along <= lo || along >= hi) continue;
    if (!best || lateral < best.d) best = { wire: w.id, d: lateral };
  }
  return best ? { wire: best.wire, axis: tp.axis } : null;
}

/** 下（右）にあるものを、delta だけ動かす（from より下・右の記号・文字・枠。線は、端ごとに見る） */
function shiftFrom(doc: Doc, axis: Axis, from: number, delta: number): Doc {
  const mv = (v: number) => (v >= from - EPS ? v + delta : v);
  return {
    ...doc,
    items: doc.items.map((it): DocItem => {
      if (it.kind === 'wire') return axis === 'v' ? { ...it, y1: mv(it.y1), y2: mv(it.y2) } : { ...it, x1: mv(it.x1), x2: mv(it.x2) };
      return axis === 'v' ? { ...it, y: mv(it.y) } : { ...it, x: mv(it.x) };
    }),
  };
}

/** 記号 id を、線 target の上へ入れる（記号は、すでに動かし終えた位置にある）。入れられなければ doc のまま */
function insertInto(doc: Doc, id: string, targetId: string): Doc {
  const it = doc.items.find((x) => x.id === id);
  const w0 = doc.items.find((x) => x.id === targetId);
  if (!it || it.kind !== 'symbol' || !w0 || w0.kind !== 'wire') return doc;
  const tp = throughPorts(it);
  if (!tp) return doc;
  const axis = tp.axis;
  let cur = doc;
  // 線の両端（座標の小さい側を lo、大きい側を hi とする）
  const ends = (w: DocWire) => {
    const first = axis === 'v' ? w.y1 <= w.y2 : w.x1 <= w.x2;
    return first
      ? { lo: { x: w.x1, y: w.y1, at: w.at1 }, hi: { x: w.x2, y: w.y2, at: w.at2 }, loEnd: 1 as const }
      : { lo: { x: w.x2, y: w.y2, at: w.at2 }, hi: { x: w.x1, y: w.y1, at: w.at1 }, loEnd: 2 as const };
  };
  const e = ends(w0);
  const span = axis === 'v' ? tp.b.y - tp.a.y : tp.b.x - tp.a.x;
  const wlo = axis === 'v' ? e.lo.y : e.lo.x;
  const whi = axis === 'v' ? e.hi.y : e.hi.x;
  const need = span + MIN_ROOM * 2;
  let shift = 0;
  if (whi - wlo < need) {
    shift = need - (whi - wlo);
    // 割る線の下端（右端）より下・右のものを、足りないぶん動かす。この記号と、割る線の上端側は、動かさない
    cur = shiftFrom(cur, axis, whi, shift);
  }
  const hiNow = whi + shift;
  // 記号を置く位置：落とした位置に近く、上下（左右）に MIN_ROOM 以上あく範囲
  const here = axis === 'v' ? tp.a.y : tp.a.x;
  const place = Math.max(wlo + MIN_ROOM, Math.min(hiNow - MIN_ROOM - span, here));
  const line = axis === 'v' ? e.lo.x : e.lo.y;
  const itNow = cur.items.find((x) => x.id === id) as DocSymbol;
  const nx = axis === 'v' ? itNow.x + (line - tp.a.x) : itNow.x + (place - tp.a.x);
  const ny = axis === 'v' ? itNow.y + (place - tp.a.y) : itNow.y + (line - tp.a.y);
  const placed: DocSymbol = { ...itNow, x: nx, y: ny };
  const tp2 = throughPorts(placed)!;
  const wNow = cur.items.find((x) => x.id === targetId) as DocWire;
  const e2 = ends(wNow);
  const a: Anchor = { item: id, port: tp2.a.id };
  const b: Anchor = { item: id, port: tp2.b.id };
  // 上（左）の半分は、もとの線を縮め、下（右）の半分は、新しい線にする
  const topPart: DocWire = { ...wNow, ...(e2.loEnd === 1 ? { x2: tp2.a.x, y2: tp2.a.y, at2: a } : { x1: tp2.a.x, y1: tp2.a.y, at1: a }) };
  const botPart: DocWire = {
    kind: 'wire',
    id: newWireId(),
    x1: tp2.b.x,
    y1: tp2.b.y,
    x2: e2.hi.x,
    y2: e2.hi.y,
    at1: b,
    ...(e2.hi.at ? { at2: e2.hi.at } : {}),
  };
  return cleanupWires({
    ...cur,
    items: [...cur.items.map((x) => (x.id === id ? placed : x.id === targetId ? topPart : x)), botPart],
  });
}

/**
 * 動かし終えた結果を、図面に入れる。1つの記号が、別の線の上で離されたときは、線を割って入れる。
 * - つながっている記号のときは、元の場所の上下（左右）の線を、先に1本につなぐ（別の線の上へ動かしたときだけ）
 * - それ以外は、これまでの動かし方（moveItem・moveItems）のまま
 * noAuto が true（Alt キーを押しながら離したとき）は、くっつけない
 */
export function moveWithInsert(
  doc: Doc,
  ids: string[],
  dx: number,
  dy: number,
  plain: (d: Doc) => Doc,
  noAuto = false,
): Doc {
  if (noAuto || ids.length !== 1) return plain(doc);
  const id = ids[0]!;
  const target = insertTarget(doc, id, dx, dy);
  if (!target) return plain(doc);
  // 元の場所の上下の線を、1本につなぐ（つながっていないときは、何も変わらない）。つなぐ形でなければ、これまでどおり動かすだけ
  const attached = wiresAttachedTo(doc, id);
  let base = doc;
  if (attached.length > 0) {
    const healed = healBeforeRemove(doc, id);
    // 鎖の端（線が1本）のときは、healBeforeRemove は線を消すので、ここでは使わない
    const merged = wiresAttachedTo(healed, id).length === 0;
    if (!merged) return plain(doc);
    base = healed;
  }
  // 割る線は、つなぎ直したあとにも残っているものだけ
  if (!base.items.some((x) => x.id === target.wire)) return plain(doc);
  const it = base.items.find((x) => x.id === id) as DocSymbol;
  const moved: Doc = { ...base, items: base.items.map((x) => (x.id === id ? { ...it, x: it.x + dx, y: it.y + dy } : x)) };
  const result = insertInto(moved, id, target.wire);
  return result === moved ? plain(doc) : result;
}

/* ------------------------------------------------------------------ */
/* ③ 余計な線                                                          */
/* ------------------------------------------------------------------ */

/** 長さのない線と、まったく同じ位置の二重の線を消す */
export function cleanupWires(doc: Doc): Doc {
  const seen = new Set<string>();
  const items = doc.items.filter((it) => {
    if (it.kind !== 'wire') return true;
    if (Math.hypot(it.x1 - it.x2, it.y1 - it.y2) < EPS) return false;
    const a = `${Math.round(it.x1 * 2)},${Math.round(it.y1 * 2)}`;
    const b = `${Math.round(it.x2 * 2)},${Math.round(it.y2 * 2)}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return items.length === doc.items.length ? doc : { ...doc, items };
}
