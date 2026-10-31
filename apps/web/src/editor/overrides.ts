import { getSymbol } from '@zumen/symbols';
import { rotatedBox } from '@zumen/layout';
import { applyAnchors, baselineOf, freshId, moveItem, removeItem, replaceSymbol, sameName, wireKey } from './doc.ts';
import type { AddedItem, Doc, DocItem, DocSymbol, DocText, DocWire, Overrides, Placement, SymbolEdit } from './doc.ts';

/**
 * 手で直した内容を、入力内容が変わっても残す。
 *
 * - 自動で作った図面の「控え」（Doc.base）と、いまの図面との違いが、手で直した内容。
 * - 入力内容が変わったら、まず自動で図面を作り、その上に、手で直した内容を重ねる。
 *   記号の移動は、自動の位置からの「ずれの量」で覚えるので、自動の配置が変わっても、ずらした分だけが残る。
 * - 手で足した記号・文字・線は、近くの機器からのずれで覚える（その機器が動けば、ついていく）。
 * - 対象の機器が、いまの入力に無いもの（「LAなし」にしたときの、LAの移動など）は、捨てずに取っておき、
 *   機器が戻ったときに、また重ねる。
 */

const EMPTY: Overrides = { moved: {}, removed: [], wiresRemoved: [], added: [] };

/** 手で直した内容があるか */
export function hasOverrides(o: Overrides | undefined): boolean {
  return !!o && (Object.keys(o.moved).length > 0 || o.removed.length > 0 || o.wiresRemoved.length > 0 || o.added.length > 0);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 近くの機器（自動で作った図面にあるもの）からのずれ。近くに無ければ、場所だけで覚える */
function placementOf(doc: Doc, x: number, y: number): Placement {
  const base = doc.base?.symbols ?? {};
  let best: { id: string; d: number; sx: number; sy: number } | null = null;
  for (const it of doc.items) {
    if (it.kind !== 'symbol' || !base[sameName(it.id)]) continue;
    const def = getSymbol(it.symbolId);
    const cx = it.x + def.box.w / 2;
    const cy = it.y + def.box.h / 2;
    const d = Math.hypot(cx - x, cy - y);
    if (!best || d < best.d) best = { id: sameName(it.id), d, sx: it.x, sy: it.y };
  }
  if (best && best.d < 400) return { near: best.id, ndx: x - best.sx, ndy: y - best.sy };
  return { ndx: x, ndy: y };
}

/** いまの図面と控えの違いから、手で直した内容を取り出す。前回の記録のうち、いまは対象が無いものも引き継ぐ */
export function collectOverrides(doc: Doc): Overrides {
  const base = doc.base;
  if (!base) return doc.overrides ?? EMPTY;
  const prev = doc.overrides ?? EMPTY;

  const syms = new Map<string, DocSymbol>();
  for (const it of doc.items) if (it.kind === 'symbol') syms.set(sameName(it.id), it);

  const moved: Record<string, SymbolEdit> = {};
  const removed: string[] = [];
  for (const [id, b] of Object.entries(base.symbols)) {
    const cur = syms.get(id);
    if (!cur) {
      removed.push(id);
      continue;
    }
    const e: SymbolEdit = { dx: cur.x - b.x, dy: cur.y - b.y };
    if (cur.rotate !== b.rotate) e.rotate = cur.rotate;
    if (cur.labelDx !== b.labelDx) e.dLabelDx = cur.labelDx - b.labelDx;
    if (cur.labelDy !== b.labelDy) e.dLabelDy = cur.labelDy - b.labelDy;
    if (!same(cur.label, b.label)) e.label = [...cur.label];
    if (!same(cur.values, b.values)) e.values = cur.values ? { ...cur.values } : undefined;
    if (cur.symbolId !== b.symbolId) e.symbolId = cur.symbolId;
    const plain = e.dx === 0 && e.dy === 0 && Object.keys(e).length === 2;
    if (!plain) moved[id] = e;
  }
  // いまの入力に無い機器の記録は、取っておく
  for (const [id, e] of Object.entries(prev.moved)) if (!base.symbols[id]) moved[id] = e;
  for (const id of prev.removed) if (!base.symbols[id] && !removed.includes(id)) removed.push(id);

  const keys = new Set<string>();
  for (const it of doc.items) {
    if (it.kind !== 'wire') continue;
    const k = wireKey(it);
    if (k) keys.add(k);
  }
  const wiresRemoved = base.wires.filter((k) => !keys.has(k));
  // 両方の端が、いまの入力に無い機器の線の記録も、取っておく
  for (const k of prev.wiresRemoved) if (!base.wires.includes(k) && !wiresRemoved.includes(k)) wiresRemoved.push(k);

  const baseWireIds = new Set(base.wireIds);
  const baseTextIds = new Set(base.textIds);
  const baseWireKeys = new Set(base.wires);
  const added: AddedItem[] = [];
  for (const it of doc.items) {
    if (it.kind === 'symbol' && !base.symbols[sameName(it.id)]) {
      added.push({ kind: 'symbol', item: it, at: placementOf(doc, it.x, it.y) });
    } else if (it.kind === 'text' && !baseTextIds.has(it.id)) {
      added.push({ kind: 'text', item: it, at: placementOf(doc, it.x, it.y) });
    } else if (it.kind === 'wire') {
      const k = wireKey(it);
      // 自動で作った線と同じつなぎ先の線は、記録しない
      if (k && baseWireKeys.has(k)) continue;
      // 自動で作った線のうち、つなぎ先を持たないもの（途中の折れ線など）は、手で直しても、記録しない
      if (baseWireIds.has(it.id) && !k) continue;
      // それ以外（手で足した線・つなぎ先を変えた線）は、手で足した線として覚える
      added.push({ kind: 'wire', item: it, at: placementOf(doc, it.x1, it.y1) });
    }
  }
  return { moved, removed, wiresRemoved, added };
}

export interface RebuildReport {
  /** 手で直した内容を重ねたか */
  kept: boolean;
  /** いまの入力に当てはまらないので、取っておいたもの（件数） */
  dormant: number;
  /** 重ねたあと、ほかの記号と重なっている、手で動かした（足した）記号の数 */
  overlaps: number;
}

/** 記号の絵が占める範囲 */
function boxOf(it: DocSymbol) {
  const rb = rotatedBox(getSymbol(it.symbolId).box, it.rotate);
  return { x0: it.x + rb.dx, y0: it.y + rb.dy, x1: it.x + rb.dx + rb.w, y1: it.y + rb.dy + rb.h };
}

/** 親から先に並べる */
function parentsFirst(doc: Doc, ids: string[]): string[] {
  const parent = new Map<string, string | undefined>();
  for (const it of doc.items) if (it.kind === 'symbol') parent.set(it.id, it.parent);
  const depth = (id: string): number => {
    let d = 0;
    for (let p = parent.get(id); p && d < 20; p = parent.get(p)) d++;
    return d;
  };
  return [...ids].sort((a, b) => depth(a) - depth(b));
}

/**
 * 自動で作った図面（generated）の上に、いまの図面（current）の手で直した内容を重ねる。
 * 重ねた図面には、新しい控え（generated）と、手で直した内容の記録がつく。
 */
export function rebuildWithOverrides(generated: Doc, current: Doc | null): { doc: Doc; report: RebuildReport } {
  const ov = current?.base ? collectOverrides(current) : EMPTY;
  const gen = new Map<string, DocSymbol>();
  for (const it of generated.items) if (it.kind === 'symbol') gen.set(sameName(it.id), it);

  let dormant = 0;
  let work: Doc = generated;

  // 手で消したもの
  for (const id of ov.removed) {
    const g = gen.get(id);
    if (g) work = removeItem(work, g.id);
    else dormant++;
  }
  // 手で消した線
  const goneKeys = new Set(ov.wiresRemoved);
  if (goneKeys.size > 0) {
    work = { ...work, items: work.items.filter((it) => it.kind !== 'wire' || !goneKeys.has(wireKey(it) ?? '')) };
  }

  // 記号の差し替え → 位置 → 回転・文字
  /** 同じ機器の、いまの図面での id */
  const actual = (name: string) => work.items.find((it): it is DocSymbol => it.kind === 'symbol' && sameName(it.id) === name);
  const movedNames = Object.keys(ov.moved).filter((name) => {
    const ok = actual(name) !== undefined;
    if (!ok && !ov.removed.includes(name)) dormant++;
    return ok;
  });
  for (const name of movedNames) {
    const e = ov.moved[name]!;
    const w = actual(name);
    if (e.symbolId && w) work = replaceSymbol(work, w.id, e.symbolId);
  }
  for (const id of parentsFirst(work, movedNames.map((n) => actual(n)!.id))) {
    const name = sameName(id);
    const e = ov.moved[name]!;
    const g = gen.get(name);
    const w = work.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === id);
    if (!g || !w) continue;
    const dx = g.x + e.dx - w.x;
    const dy = g.y + e.dy - w.y;
    if (dx !== 0 || dy !== 0) work = moveItem(work, id, dx, dy);
  }
  const movedIds = movedNames.map((n) => actual(n)!.id);
  if (movedNames.some((n) => ov.moved[n]!.rotate !== undefined || ov.moved[n]!.dLabelDx !== undefined || ov.moved[n]!.dLabelDy !== undefined || ov.moved[n]!.label || ov.moved[n]!.values)) {
    work = applyAnchors({
      ...work,
      items: work.items.map((it): DocItem => {
        if (it.kind !== 'symbol' || !ov.moved[sameName(it.id)]) return it;
        const e = ov.moved[sameName(it.id)]!;
        const g = gen.get(sameName(it.id));
        const next: DocSymbol = { ...it };
        if (e.rotate !== undefined) next.rotate = e.rotate;
        if (g && e.dLabelDx !== undefined) next.labelDx = g.labelDx + e.dLabelDx;
        if (g && e.dLabelDy !== undefined) next.labelDy = g.labelDy + e.dLabelDy;
        if (e.label) next.label = [...e.label];
        if (e.values) next.values = { ...e.values };
        else if (e.label) delete next.values;
        return next;
      }),
    });
  }

  // 手で足したもの。新しい id をつける（記号の親や、線のつなぎ先は、読み替える）
  const taken = new Set(work.items.map((it) => it.id));
  const idMap = new Map<string, string>();
  const itemsNow = () => new Map(work.items.map((it) => [it.id, it]));
  const symAdds = ov.added.filter((a): a is Extract<AddedItem, { kind: 'symbol' }> => a.kind === 'symbol');
  // 親（PASなど）から先に足す
  const addedParent = new Map(symAdds.map((a) => [a.item.id, a.item.parent]));
  const depthOf = (id: string): number => {
    let d = 0;
    for (let p = addedParent.get(id); p && addedParent.has(p) && d < 20; p = addedParent.get(p)) d++;
    return d;
  };
  const ordered = [...symAdds].sort((x, y) => depthOf(x.item.id) - depthOf(y.item.id));
  const newSymbols: DocSymbol[] = [];
  for (const a of [...ordered, ...ov.added.filter((x) => x.kind !== 'symbol')]) {
    const now = itemsNow();
    const nearSym = a.at.near ? actual(a.at.near) : undefined;
    const pos = (x: number, y: number): [number, number] =>
      nearSym && nearSym.kind === 'symbol' ? [nearSym.x + a.at.ndx, nearSym.y + a.at.ndy] : [x, y];
    if (a.kind === 'symbol') {
      const id = freshId('sym', taken);
      taken.add(id);
      idMap.set(a.item.id, id);
      const [x, y] = pos(a.item.x, a.item.y);
      const parent = a.item.parent ? (idMap.get(a.item.parent) ?? actual(sameName(a.item.parent))?.id) : undefined;
      const sym: DocSymbol = { ...a.item, id, x, y, parent: parent, slot: parent ? a.item.slot : undefined };
      newSymbols.push(sym);
      work = { ...work, items: [...work.items, sym] };
    } else if (a.kind === 'text') {
      const id = freshId('text', taken);
      taken.add(id);
      const [x, y] = pos(a.item.x, a.item.y);
      const t: DocText = { ...a.item, id, x, y };
      work = { ...work, items: [...work.items, t] };
    } else {
      const id = freshId('wire', taken);
      taken.add(id);
      const w0 = a.item;
      const map = (an: DocWire['at1']) => {
        if (!an) return undefined;
        const item = idMap.get(an.item) ?? actual(sameName(an.item))?.id;
        return item ? { item, port: an.port } : { item: '', port: an.port };
      };
      const at1 = map(w0.at1);
      const at2 = map(w0.at2);
      const exists = (an: DocWire['at1']) => !an || now.has(an.item);
      if (!exists(at1) || !exists(at2)) {
        // つなぐ相手の機器が、いまの入力に無い。線だけ残さない
        dormant++;
        continue;
      }
      let dx = 0;
      let dy = 0;
      if (!at1 && !at2 && nearSym && nearSym.kind === 'symbol') {
        [dx, dy] = [nearSym.x + a.at.ndx - w0.x1, nearSym.y + a.at.ndy - w0.y1];
      }
      const w: DocWire = { ...w0, id, x1: w0.x1 + dx, y1: w0.y1 + dy, x2: w0.x2 + dx, y2: w0.y2 + dy, at1, at2, orphan: undefined };
      work = { ...work, items: [...work.items, w] };
    }
  }
  work = applyAnchors(work);

  // 重なりの知らせ（勝手には動かさない）
  const touched = new Set<string>([...movedIds, ...newSymbols.map((s) => s.id)]);
  const all = work.items.filter((it): it is DocSymbol => it.kind === 'symbol' && !it.parent);
  let overlaps = 0;
  for (const s of all) {
    if (!touched.has(s.id)) continue;
    const a = boxOf(s);
    if (all.some((o) => o.id !== s.id && (() => {
      const b = boxOf(o);
      return a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;
    })())) overlaps++;
  }

  const kept = hasOverrides(ov);
  const doc: Doc = {
    ...work,
    basis: generated.basis,
    edited: kept,
    base: baselineOf(generated),
    overrides: kept ? ov : undefined,
    ...(current?.orientation ? { orientation: current.orientation } : {}),
  };
  return { doc, report: { kept, dormant, overlaps } };
}
