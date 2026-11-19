import { rotatedBox } from '@zumen/layout';
import { followAutoWires } from './wireFollow.ts';
import { applyAnchors, baselineOf, defOf, freshId, moveItem, moveItems, removeItem, replaceSymbol, sameName, wireKey } from './doc.ts';
import type { AddedItem, Doc, DocFrame, DocItem, DocSymbol, DocText, DocWire, FrameEdit, Overrides, Placement, SymbolEdit } from './doc.ts';

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
  return !!o && (Object.keys(o.moved).length > 0 || o.removed.length > 0 || o.wiresRemoved.length > 0 || o.added.length > 0 || Object.keys(o.frames ?? {}).length > 0);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 近くの機器（自動で作った図面にあるもの）からのずれ。近くに無ければ、場所だけで覚える */
function placementOf(doc: Doc, x: number, y: number): Placement {
  const base = doc.base?.symbols ?? {};
  let best: { id: string; d: number; sx: number; sy: number } | null = null;
  for (const it of doc.items) {
    if (it.kind !== 'symbol' || !base[sameName(it.id)]) continue;
    const def = defOf(it);
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
  // 手で動かした・幅を変えた枠。自動で作った枠の並び順で、同じ枠を見分ける
  const frames: Record<string, FrameEdit> = {};
  if (base.frames) {
    const cur = doc.items.filter((i): i is DocFrame => i.kind === 'frame');
    base.frames.forEach((b, i) => {
      const c = cur[i];
      if (!c) return;
      const e = { dx: c.x - b.x, dy: c.y - b.y, dw: c.w - b.w };
      if (e.dx !== 0 || e.dy !== 0 || e.dw !== 0) frames[String(i)] = e;
    });
    // いまの入力に無い（枠の数が減った）ものの記録は、取っておく
    for (const [k, e] of Object.entries(prev.frames ?? {})) if (!(Number(k) < base.frames.length) && !frames[k]) frames[k] = e;
  } else if (prev.frames) {
    Object.assign(frames, prev.frames);
  }
  return { moved, removed, wiresRemoved, added, ...(Object.keys(frames).length > 0 ? { frames } : {}) };
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
  const rb = rotatedBox(defOf(it).box, it.rotate);
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
export function rebuildWithOverrides(
  generated: Doc,
  current: Doc | null,
  /** 手で直した内容を、重ねる前に、差し引く・直すとき（図面の変更を入力に書き戻したぶんを、外すのに使う） */
  adjust?: (ov: Overrides) => Overrides,
): { doc: Doc; report: RebuildReport } {
  const ov0 = current?.base ? collectOverrides(current) : EMPTY;
  const ov = adjust ? adjust(ov0) : ov0;
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
  // 新しく増えた機器（入力で足した機器）：手で直した内容の記録が無いので、作り直した、元の位置に置かれる。
  // 縮小・拡大や手の移動で、まわりの機器が動いていると、そこだけ取り残されて、重なる・離れすぎる。
  // そこで、いちばん近い（作り直した図面で、近い）、もとからある機器と、同じ量だけ、動かす
  if (current?.base) {
    const known = new Set(Object.keys(current.base.symbols));
    const top = [...gen.values()].filter((g) => !g.parent);
    const olds = top.filter((g) => known.has(sameName(g.id)));
    const centre = (g: DocSymbol) => ({ x: g.x + defOf(g).box.w / 2, y: g.y + defOf(g).box.h / 2 });
    const news = top.filter((g) => !known.has(sameName(g.id)));
    // 線でつながっている新しい機器（ZCT と、その横の GR・DGR など）は、1つの組にして、同じ量だけ動かす。
    // 別々に動かすと、動かす量がわずかにずれて、2つをつなぐ線が、斜めになる（第17弾 項目7の調査2）
    const group = new Map<string, string>(news.map((g) => [sameName(g.id), sameName(g.id)]));
    const find = (n: string): string => {
      while (group.get(n) !== n) n = group.get(n)!;
      return n;
    };
    // 線のつなぎ先が、PASの中の機器（ZCT など）のときは、その入れ物（PAS）の名前で見る
    const topName = (n: string): string => {
      let g = gen.get(n);
      for (let i = 0; g?.parent && i < 5; i++) g = gen.get(sameName(g.parent));
      return g ? sameName(g.id) : n;
    };
    for (const it of generated.items) {
      if (it.kind !== 'wire' || !it.at1 || !it.at2) continue;
      const a = topName(sameName(it.at1.item));
      const b = topName(sameName(it.at2.item));
      if (group.has(a) && group.has(b)) group.set(find(a), find(b));
    }
    // 組に、線でつながっているもとからある機器（主回路の上下の機器など）があれば、その機器の動きに合わせる
    // （近いだけで選ぶと、横に出た枝の機器が選ばれ、主回路の機器と動き方が違って、縦の線が斜めになる）
    const linkedOld = new Map<string, Set<string>>();
    for (const it of generated.items) {
      if (it.kind !== 'wire' || !it.at1 || !it.at2) continue;
      const a = topName(sameName(it.at1.item));
      const b = topName(sameName(it.at2.item));
      for (const [n, o] of [[a, b], [b, a]] as const) {
        if (!group.has(n) || !known.has(o)) continue;
        const k = find(n);
        linkedOld.set(k, (linkedOld.get(k) ?? new Set()).add(o));
      }
    }
    const members = new Map<string, DocSymbol[]>();
    for (const n of news) members.set(find(sameName(n.id)), [...(members.get(find(sameName(n.id))) ?? []), n]);
    for (const [key, list] of members.entries()) {
      // 組の中で、もとからある機器にいちばん近いものを探し、その機器と同じ量だけ、組ぜんぶを動かす
      let best: { g: DocSymbol; d: number } | null = null;
      const linked = linkedOld.get(key);
      const candidates = linked ? olds.filter((o) => linked.has(sameName(o.id))) : olds;
      for (const n of list) {
        const c = centre(n);
        for (const o of candidates.length > 0 ? candidates : olds) {
          const oc = centre(o);
          const d = Math.hypot(oc.x - c.x, oc.y - c.y);
          if (!best || d < best.d) best = { g: o, d };
        }
      }
      const w = best ? actual(sameName(best.g.id)) : undefined;
      if (!best || !w) continue;
      const dx = w.x - best.g.x;
      const dy = w.y - best.g.y;
      // 組をまとめて動かす（PASについている GR・DGR は、PASと一緒に動くので、1つずつ動かすと二重に動いてしまう）
      if (dx !== 0 || dy !== 0) work = moveItems(work, list.map((n) => n.id), dx, dy);
    }
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
  // 記号につないでいない線（自動で作った、途中の折れ線・低圧の母線・PASの内蔵品の中の線など）を、記号の動きに合わせて動かし直す
  if (current?.base) work = followAutoWires(generated, work);
  // 計算の端数（0.0000000001 など）で、まっすぐな線が、斜めと判定されないよう、線の端を、1000分の1までに丸める
  work = { ...work, items: work.items.map((it): DocItem => (it.kind === 'wire' ? { ...it, x1: r3(it.x1), y1: r3(it.y1), x2: r3(it.x2), y2: r3(it.y2) } : it)) };

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

  // 手で動かした・幅を変えた枠を、自動で作った枠の上に重ねる
  const frameEdits = ov.frames ?? {};
  if (Object.keys(frameEdits).length > 0) {
    let n = -1;
    work = {
      ...work,
      items: work.items.map((it): DocItem => {
        if (it.kind !== 'frame') return it;
        n++;
        const e = frameEdits[String(n)];
        if (!e) return it;
        return { ...it, x: it.x + e.dx, y: it.y + e.dy, w: it.w + e.dw };
      }),
    };
  }

  const kept = hasOverrides(ov);
  const doc: Doc = {
    ...work,
    basis: generated.basis,
    edited: kept,
    base: baselineOf(generated),
    overrides: kept ? ov : undefined,
    ...(current?.orientation ? { orientation: current.orientation } : {}),
    // レイヤー（停電範囲図など）は、元の図面を作り直しても、そのまま引き継ぐ
    ...(current?.layers !== undefined ? { layers: current.layers } : {}),
  };
  return { doc, report: { kept, dormant, overlaps } };
}
