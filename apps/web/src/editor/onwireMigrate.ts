import { CHAIN_SYMBOLS, ON_WIRE_ORIGIN, getSymbol, isOnWireId } from '@zumen/symbols';
import { rotatedPort } from '@zumen/layout';
import { LAYOUT_V, ONWIRE_V, sameName } from './doc.ts';
import type { Doc, DocItem, DocSymbol, DocWire } from './doc.ts';
import { rebuildWithOverrides } from './overrides.ts';
import type { AddedItem, Overrides } from './doc.ts';

/**
 * 保存してある図面（VCT・CT・ZCTが、縦線と入口・出口を持っていた古い形）を、新しい形（線の上に乗せる記号。第20弾 項目2）に直す。
 *
 * 見た目は、変わらない。記号の本体は同じ場所に置き、以前の縦線は、記号の中を通る線として足す。
 * 手で直した内容は、残す（自動で作った図面を、いまの形で作り直し、手で直した内容を、その上に重ねる。入力が変わったときと同じ仕組み）。
 */
const isOn = (symbolId: string): boolean => isOnWireId(symbolId);
const originOf = (symbolId: string) => ON_WIRE_ORIGIN[symbolId as keyof typeof ON_WIRE_ORIGIN];

/** 新しい形が必要な図面か（版が古く、直す記号がある） */
export function needsOnWireMigration(doc: Doc): boolean {
  return (doc.layoutV ?? 1) < ONWIRE_V && doc.items.some((i) => i.kind === 'symbol' && isOn(i.symbolId));
}

/** 古い形の記号 s が、新しい形では、どこに置かれるか（本体は同じ場所）。以前の入口・出口の位置も返す */
function convertedOf(s: DocSymbol): { x: number; y: number; a: [number, number]; b: [number, number] } {
  const o = originOf(s.symbolId)!;
  const old = CHAIN_SYMBOLS[s.symbolId]!;
  const now = getSymbol(s.symbolId);
  const pin = old.ports.find((p) => p.id === 'in')!;
  const pout = old.ports.find((p) => p.id === 'out')!;
  const [ix, iy] = rotatedPort(old.box, pin.x, pin.y, s.rotate);
  const [ox, oy] = rotatedPort(old.box, pout.x, pout.y, s.rotate);
  const [cx, cy] = rotatedPort(old.box, o.x + now.box.w / 2, o.y + now.box.h / 2, s.rotate);
  return { x: s.x + cx - now.box.w / 2, y: s.y + cy - now.box.h / 2, a: [s.x + ix, s.y + iy], b: [s.x + ox, s.y + oy] };
}

/** ひとつの図面の中で、まったく同じ線（両端・実線／点線が同じ）が重なっているときは、1本にする */
function dedupeWires(doc: Doc): Doc {
  const seen = new Set<string>();
  const key = (w: DocWire) => {
    const a = `${w.x1.toFixed(2)},${w.y1.toFixed(2)}`;
    const b = `${w.x2.toFixed(2)},${w.y2.toFixed(2)}`;
    return `${[a, b].sort().join('|')}|${w.dashed ? 1 : 0}`;
  };
  return {
    ...doc,
    items: doc.items.filter((it) => {
      if (it.kind !== 'wire') return true;
      const k = key(it);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}

/**
 * 手で直した内容を、取り出せない古い図面（自動で作った図面の控えが無い）を、そのまま直す。
 * 記号の位置を、新しい形の位置に動かし、入口・出口につながっていた線は、つなぎ先を外して（位置は、そのまま）、
 * 記号の中を通る線を、足す。
 */
export function convertDocOnWire(doc: Doc): Doc {
  const through: DocWire[] = [];
  const ids = new Set(doc.items.map((i) => i.id));
  const onIds = new Set(doc.items.filter((i): i is DocSymbol => i.kind === 'symbol' && isOn(i.symbolId)).map((i) => i.id));
  const items: DocItem[] = doc.items.map((it): DocItem => {
    if (it.kind === 'symbol' && isOn(it.symbolId)) {
      const c = convertedOf(it);
      if (!it.parent) {
        let id = `wire-th-${it.id}`;
        while (ids.has(id)) id += '_';
        ids.add(id);
        through.push({ kind: 'wire', id, x1: c.a[0], y1: c.a[1], x2: c.b[0], y2: c.b[1] });
      }
      return { ...it, x: c.x, y: c.y };
    }
    if (it.kind !== 'wire') return it;
    const strip = (a: DocWire['at1']) => (a && onIds.has(a.item) && (a.port === 'in' || a.port === 'out') ? undefined : a);
    return { ...it, at1: strip(it.at1), at2: strip(it.at2) };
  });
  return { ...doc, items: [...items, ...through], layoutV: ONWIRE_V };
}

/**
 * 手で直した内容を残して、新しい形に直す。generated は、いまの入力から、新しい形で作った図面。
 * 戻り値の doc は、手で直した内容を重ねた、新しい形の図面。
 */
export function migrateOnWire(old: Doc, generated: Doc): Doc {
  const base = old.base!;
  // 古い形の記号の名前（自動で作った図面にあったもの）と、手で足したもの（id）
  const onNames = new Set(Object.entries(base.symbols).filter(([, b]) => isOn(b.symbolId)).map(([n]) => n));
  const addedOn = new Map(old.items.filter((i): i is DocSymbol => i.kind === 'symbol' && isOn(i.symbolId) && !base.symbols[sameName(i.id)]).map((s) => [s.id, s]));
  const nearShift = (near: string | undefined): { x: number; y: number } => {
    const b = near ? base.symbols[near] : undefined;
    const o = b && isOn(b.symbolId) ? originOf(b.symbolId) : undefined;
    return o ? { x: o.x, y: o.y } : { x: 0, y: 0 };
  };
  const adjust = (ov: Overrides): Overrides => {
    const gone = ov.wiresRemoved.filter((k) => !k.split('>').some((e) => onNames.has(e.split('.')[0]!)));
    const strip = (a: DocWire['at1']) => (a && (onNames.has(sameName(a.item)) || addedOn.has(a.item)) && (a.port === 'in' || a.port === 'out') ? undefined : a);
    const added: AddedItem[] = [];
    for (const a of ov.added) {
      const sh = nearShift(a.at.near);
      if (a.kind === 'symbol') {
        const own = isOn(a.item.symbolId) ? convertedOf(a.item) : null;
        const o = isOn(a.item.symbolId) ? originOf(a.item.symbolId)! : { x: 0, y: 0 };
        // 位置：近くの機器からのずれ、または、場所そのもの
        const at = a.at.near ? { ...a.at, ndx: a.at.ndx + o.x - sh.x, ndy: a.at.ndy + o.y - sh.y } : { ...a.at, ndx: a.at.ndx + o.x, ndy: a.at.ndy + o.y };
        added.push({ ...a, item: own ? { ...a.item, x: own.x, y: own.y } : a.item, at });
        if (own && !a.item.parent) {
          // 以前の縦線の代わりに、記号の中を通る線を足す（記号の近くからのずれで、位置を覚える）
          const w: DocWire = { kind: 'wire', id: `wire-th-${a.item.id}`, x1: own.a[0], y1: own.a[1], x2: own.b[0], y2: own.b[1] };
          added.push({ kind: 'wire', item: w, at: a.at.near ? { near: a.at.near, ndx: a.at.ndx + (own.a[0] - a.item.x) - sh.x, ndy: a.at.ndy + (own.a[1] - a.item.y) - sh.y } : { ndx: own.a[0], ndy: own.a[1] } });
        }
      } else if (a.kind === 'wire') {
        const w = { ...a.item, at1: strip(a.item.at1), at2: strip(a.item.at2) };
        added.push({ ...a, item: w, at: a.at.near ? { ...a.at, ndx: a.at.ndx - sh.x, ndy: a.at.ndy - sh.y } : a.at });
      } else {
        added.push({ ...a, at: a.at.near ? { ...a.at, ndx: a.at.ndx - sh.x, ndy: a.at.ndy - sh.y } : a.at });
      }
    }
    return { ...ov, wiresRemoved: gone, added };
  };
  const r = rebuildWithOverrides(generated, old, adjust);
  return dedupeWires({ ...r.doc, layoutV: LAYOUT_V });
}

/* ------------------------------------------------------------------ */
/* 蓄電池ユニット（第20弾 項目4）                                        */
/* ------------------------------------------------------------------ */

/** 蓄電池ユニットの外形を、横96から56に縮めた。接続点（上の縦棒）の位置が、中心の 48 から 28 に動くので、記号を右へ動かして、同じ場所に直す */
const BATTERY_SHIFT = 20;

/** 古い形の蓄電池ユニットが入った図面か */
export function needsBatteryMigration(doc: Doc): boolean {
  return (doc.layoutV ?? 1) < LAYOUT_V && doc.items.some((i) => i.kind === 'symbol' && i.symbolId === 'battery-unit');
}

/**
 * 蓄電池ユニットを、新しい外形（横56）に直す。記号を右へ 20 動かして、上の縦棒の位置を変えない（つないだ線は、そのまま）。
 * 文字は、標準の位置にあったもの（長方形の真横）は、新しい長方形の真横に直し、手で動かしたものは、いまの場所のまま残す。
 * 手で直した内容の記録（自動で作った図面の控え）も、同じ形に直す（直さないと、動かしたことになってしまう）。
 */
export function migrateBattery(doc: Doc): Doc {
  const fix = <T extends { x: number; labelDx: number; labelAnchor?: 'start' | 'middle' | 'end' }>(s: T, anchor: 'start' | 'middle' | 'end'): T => {
    // 以前の標準の位置：左に置く（anchor が end）なら、長方形の左（x＝4）から10離す＝-6。右に置く（start）なら、長方形の右（x＝92）から10離す＝102
    const wasStd = anchor === 'end' ? s.labelDx === -6 : anchor === 'start' ? s.labelDx === 102 : false;
    const stdNow = anchor === 'end' ? -8 : 64;
    return { ...s, x: s.x + BATTERY_SHIFT, labelDx: wasStd ? stdNow : s.labelDx - BATTERY_SHIFT };
  };
  const items: DocItem[] = doc.items.map((it): DocItem => (it.kind === 'symbol' && it.symbolId === 'battery-unit' ? fix(it, it.labelAnchor) : it));
  let base = doc.base;
  if (base) {
    const symbols = { ...base.symbols };
    for (const [name, b] of Object.entries(symbols)) {
      if (b.symbolId !== 'battery-unit') continue;
      // 控えには、文字の向き（anchor）が無いので、いまの図面の同じ記号の向きを使う
      const cur = doc.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
      symbols[name] = fix(b, cur?.labelAnchor ?? 'end');
    }
    base = { ...base, symbols };
  }
  return { ...doc, items, ...(base ? { base } : {}), layoutV: LAYOUT_V };
}
