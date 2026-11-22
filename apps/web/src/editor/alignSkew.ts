import { followAutoWires } from './wireFollow.ts';
import { groupRootOf, isHorizontal, isVertical, moveItems, outwardOf, sameName } from './doc.ts';
import type { Doc, DocWire } from './doc.ts';

/**
 * 作り直しで、新しく斜めになった線を、機器を横に動かして、まっすぐにそろえる（第20弾・案2）。
 *
 * 手で動かした機器と、作り直しで新しく入った機器のあいだは、横の位置が違うことがあり、線が斜めになる。
 * 線の下側の機器（と、その先に続く機器のかたまり）を、横に動かして、上側に合わせる。上側（分岐の元）は、動かさない。
 *
 * ・横のずれが、ALIGN_MAX 以下のときだけ。それより大きいずれは、手で大きく動かしたものとみなして、そのまま残す（斜めの線の知らせが出る）
 * ・作り直す前から斜めだった線は、そのまま（利用者が、そうしたもの）
 * ・動かすかたまりが、上側に回り込むとき・大きすぎるとき（分岐の元までつながっているとき）は、動かさない
 * ・動かして、斜めの線が、かえって増えるときは、動かさない
 */
export const ALIGN_MAX = 30;
const BLOCK_MAX = 8;

const wireKey = (w: DocWire): string =>
  w.at1 && w.at2 ? `${sameName(w.at1.item)}.${w.at1.port}>${sameName(w.at2.item)}.${w.at2.port}` : '';

/** 両端をつないである、斜めの線（作り直す前から斜めだったものは、除く） */
function skewed(doc: Doc, before: Set<string>): DocWire[] {
  return doc.items.filter(
    (it): it is DocWire => it.kind === 'wire' && !!it.at1 && !!it.at2 && !isVertical(it) && !isHorizontal(it) && !before.has(wireKey(it)),
  );
}

/** 両端をつないである、斜めの線の、キーの一覧（作り直す前の図面から取る） */
export function skewKeys(doc: Doc): Set<string> {
  return new Set(
    doc.items
      .filter((it): it is DocWire => it.kind === 'wire' && !!it.at1 && !!it.at2 && !isVertical(it) && !isHorizontal(it))
      .map(wireKey),
  );
}

export function alignSkewedColumns(work: Doc, before: Set<string>): { doc: Doc; moved: string[] } {
  let cur = work;
  const moved: string[] = [];
  for (let pass = 0; pass < 8; pass++) {
    // 縦の線にするはずの線は横にずらし、横の線にするはずの線は縦にずらす。ずれが ALIGN_MAX 以下のものだけ
    const list = skewed(cur, before).filter((w) => {
      const v = intendedVertical(cur, w);
      return v === null ? false : (v ? Math.abs(w.x2 - w.x1) : Math.abs(w.y2 - w.y1)) <= ALIGN_MAX;
    });
    if (list.length === 0) break;
    let progress = false;
    for (const w0 of list) {
      // ほかの線を動かしたあとで、もう直っているかもしれない
      const w = cur.items.find((it): it is DocWire => it.kind === 'wire' && it.id === w0.id);
      if (!w || !w.at1 || !w.at2 || isVertical(w) || isHorizontal(w)) continue;
      const r1 = groupRootOf(cur, w.at1.item);
      const r2 = groupRootOf(cur, w.at2.item);
      if (r1 === r2) continue;
      const vertical = intendedVertical(cur, w)!;
      // 動かす向きと量：縦に近い線は横（dx）、横に近い線は縦（dy）。端1を、端2に合わせる量
      const d1 = vertical ? w.x2 - w.x1 : w.y2 - w.y1;
      const adj = adjacency(cur, w.id);
      const b1 = blockFrom(adj, r1, r2);
      const b2 = blockFrom(adj, r2, r1);
      // 動かす側の決め方：縦に近い線は、下側（分岐の元ではないほう）。横に近い線は、動かすかたまりが小さいほう
      const cands: { block: Set<string>; shift: number }[] = [];
      if (b1) cands.push({ block: b1, shift: d1 });
      if (b2) cands.push({ block: b2, shift: -d1 });
      if (vertical) {
        const lowIs1 = w.y1 > w.y2;
        cands.sort((x, y) => (x.block === (lowIs1 ? b1 : b2) ? -1 : 0) - (y.block === (lowIs1 ? b1 : b2) ? -1 : 0));
      } else cands.sort((x, y) => x.block.size - y.block.size);
      for (const c of cands) {
        const trial = followAutoWires(cur, moveItems(cur, [...c.block], vertical ? c.shift : 0, vertical ? 0 : c.shift));
        // 斜めの線が、減るときだけ、動かす
        if (skewed(trial, before).length >= skewed(cur, before).length) continue;
        cur = trial;
        for (const b of c.block) moved.push(sameName(b));
        progress = true;
        break;
      }
    }
    if (!progress) break;
  }
  return { doc: cur, moved: [...new Set(moved)] };
}

/**
 * この線は、縦の線にするはずか（true）、横の線にするはずか（false）。接続点の出る向き（上下か、左右か）で決める。
 * 両端で向きが食い違うとき（折れ線にするはずの線）は、null（そろえない）。
 * （短い縦の線は、横のずれが長さを超えることがある。線の長さでは、決められない）
 */
function intendedVertical(doc: Doc, w: DocWire): boolean | null {
  const dirs = [outwardOf(doc, w.at1), outwardOf(doc, w.at2)].filter((o): o is { dx: number; dy: number } => o !== null).map((o) => o.dy !== 0);
  if (dirs.length === 0) return Math.abs(w.x2 - w.x1) <= Math.abs(w.y2 - w.y1);
  return dirs.every((d) => d === dirs[0]) ? dirs[0]! : null;
}

/** 機器（かたまりの親）どうしのつながり。この線（skip）は、たどらない */
function adjacency(doc: Doc, skip: string): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const it of doc.items) {
    if (it.kind !== 'wire' || it.id === skip || !it.at1 || !it.at2) continue;
    const a = groupRootOf(doc, it.at1.item);
    const b = groupRootOf(doc, it.at2.item);
    if (a === b) continue;
    adj.set(a, (adj.get(a) ?? new Set()).add(b));
    adj.set(b, (adj.get(b) ?? new Set()).add(a));
  }
  return adj;
}

/** start から、つながっている機器をたどって、動かすかたまりを決める。stop に回り込むとき・大きすぎるときは null */
function blockFrom(adj: Map<string, Set<string>>, start: string, stop: string): Set<string> | null {
  const block = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (m === stop) return null;
      if (block.has(m)) continue;
      block.add(m);
      queue.push(m);
      if (block.size > BLOCK_MAX) return null;
    }
  }
  return block;
}
