import { defOf, portsOf } from './doc.ts';
import type { Doc, DocSymbol, DocWire } from './doc.ts';

/**
 * 高圧ケーブル（遮蔽層のある電線）の途中には、ZCT 以外を接続しない（第18弾 D）。
 *
 * 図面では、ケーブルは、「ケーブルヘッド（端末）の2つ」と、そのあいだの線で表す。
 * このあいだに入れてよいのは ZCT だけ（ケーブルに通して付ける）。VCB・DS・VT・LA など、ほかの機器や、
 * 別の線をつなぐことはできない（ケーブルの外側＝ケーブルヘッドの先でつなぐ）。
 * 低圧には、遮蔽層のあるケーブルは無く、通常の電線なので、この決まりの対象に入れない。
 * 停電範囲図の印（×・●・矢印など）は、機器ではなく、利用者が決める目印なので、ケーブルの途中にあってもよい（図面とは別の層なので、ここでは見ない）。
 */

export interface HvStretch {
  /** 2つのケーブルヘッド */
  heads: [string, string];
  /** あいだの線（つなぎ先の記号が決まっている線） */
  wires: string[];
  /** あいだにある記号 */
  mid: string[];
}

/** ケーブルの途中に入れてよい記号 */
export const isZctSymbol = (symbolId: string): boolean => /(^|-)zct($|-)/.test(symbolId);

const lineRole = (role: string | undefined) => role === undefined || role === 'line';

/** 図面の ID から、エリアの接頭辞（a2: など）と、役割の名前に分ける */
const splitId = (id: string): { area: boolean; base: string } => {
  const m = /^a\d+:(.*)$/.exec(id);
  return { area: !!m, base: (m ? m[1]! : id).replace(/-\d+$/, '') };
};

/** 引込・途中の開閉器の前後のケーブル・変圧器／コンデンサ／発電機の電源側のケーブルは、必ず高圧 */
const HV_BASES = new Set(['cable-head-source', 'cable-head-site', 'pre-cable-source', 'pre-cable-site', 'mid-cable-source', 'mid-cable-site', 'tr-cable-source', 'tr-cable-site', 'cap-cable-source', 'cap-cable-site', 'gen-cable-source', 'gen-cable-site']);

/** ケーブルヘッドの文字に、1000V 以上の定格電圧が書いてあるか */
function labelVoltage(h: DocSymbol): number | null {
  const text = h.label.join(' ');
  const kv = /(\d+(?:\.\d+)?)\s*kV/i.exec(text);
  if (kv) return Number(kv[1]) * 1000;
  const v = /(\d{3,5})\s*V\b/.exec(text);
  return v ? Number(v[1]) : null;
}

/** そのケーブル（2つのヘッド）が、高圧か。高圧と分かるものだけ true（低圧・分からないものは false） */
function isHighVoltage(a: DocSymbol, b: DocSymbol): boolean {
  for (const h of [a, b]) {
    const v = labelVoltage(h);
    if (v !== null) return v >= 1000;
  }
  return [a, b].some((h) => {
    const s = splitId(h.id);
    return !s.area && HV_BASES.has(s.base);
  });
}

/** 図面にある、高圧ケーブル（ヘッド2つと、そのあいだ）をすべて見つける */
export function hvStretches(doc: Doc): HvStretch[] {
  const sym = new Map(doc.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((s) => [s.id, s]));
  const wires = doc.items.filter((i): i is DocWire => i.kind === 'wire' && !!i.at1 && !!i.at2);
  const at = new Map<string, DocWire[]>();
  for (const w of wires) {
    for (const a of [w.at1!, w.at2!]) {
      const k = `${a.item}\u0000${a.port}`;
      at.set(k, [...(at.get(k) ?? []), w]);
    }
  }
  const out: HvStretch[] = [];
  const heads = [...sym.values()].filter((s) => s.symbolId === 'cable-head');
  for (const h of heads) {
    // ケーブルの側の接続点は、どちらのヘッドも out
    let from = { item: h.id, port: 'out' };
    const here = at.get(`${from.item}\u0000${from.port}`) ?? [];
    if (here.length !== 1) continue;
    let w = here[0]!;
    const ws: string[] = [];
    const mid: string[] = [];
    let end: DocSymbol | null = null;
    for (let step = 0; step < 14; step++) {
      ws.push(w.id);
      const far = w.at1!.item === from.item && w.at1!.port === from.port ? w.at2! : w.at1!;
      const s = sym.get(far.item);
      if (!s) break;
      if (s.symbolId === 'cable-head') {
        if (far.port === 'out') end = s;
        break;
      }
      // 記号を通り抜けて、反対側の、線の接続点へ
      const def = defOf(s);
      const ports = portsOf(s)
        .map((p, i) => ({ ...p, role: def.ports[i]?.role as string | undefined }))
        .filter((p) => lineRole(p.role) && p.id !== far.port);
      if (ports.length !== 1) break;
      const next = at.get(`${s.id}\u0000${ports[0]!.id}`) ?? [];
      if (next.length !== 1) break;
      mid.push(s.id);
      from = { item: s.id, port: ports[0]!.id };
      w = next[0]!;
    }
    if (end && end.id !== h.id && h.id < end.id && isHighVoltage(h, end)) out.push({ heads: [h.id, end.id], wires: ws, mid });
  }
  return out;
}

const onSegmentInterior = (x: number, y: number, w: DocWire, tol = 1.5): boolean => {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return false;
  const t = ((x - w.x1) * dx + (y - w.y1) * dy) / len2;
  const len = Math.sqrt(len2);
  if (t * len <= tol || (1 - t) * len <= tol) return false; // 端（ヘッド・記号につながるところ）は、途中ではない
  const px = w.x1 + t * dx;
  const py = w.y1 + t * dy;
  return Math.hypot(x - px, y - py) <= tol;
};

export interface CableViolation {
  kind: 'symbol' | 'wire';
  /** 図面の上の位置（印を出す） */
  x: number;
  y: number;
  /** 入っている記号、または、つないでいる線 */
  itemId: string;
  /** 記号のときは、その名前（図記号の ID） */
  symbolId?: string;
}

/** いま、高圧ケーブルの途中にある、ZCT 以外の記号と、途中につないである線 */
export function cableViolations(doc: Doc): CableViolation[] {
  const sts = hvStretches(doc);
  if (sts.length === 0) return [];
  const out: CableViolation[] = [];
  const sym = new Map(doc.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((s) => [s.id, s]));
  const byId = new Map(doc.items.filter((i): i is DocWire => i.kind === 'wire').map((w) => [w.id, w]));
  const cableWires = new Set(sts.flatMap((s) => s.wires));
  for (const st of sts) {
    for (const id of st.mid) {
      const s = sym.get(id)!;
      if (isZctSymbol(s.symbolId)) continue;
      const b = portsOf(s);
      const cx = b.reduce((a, p) => a + p.x, 0) / Math.max(1, b.length);
      const cy = b.reduce((a, p) => a + p.y, 0) / Math.max(1, b.length);
      out.push({ kind: 'symbol', x: cx, y: cy, itemId: s.id, symbolId: s.symbolId });
    }
  }
  // ケーブルの線の途中に、端がついている、ほかの線
  for (const w of doc.items) {
    if (w.kind !== 'wire' || cableWires.has(w.id)) continue;
    for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]] as const) {
      for (const cw of cableWires) {
        const c = byId.get(cw);
        if (c && onSegmentInterior(x, y, c)) {
          out.push({ kind: 'wire', x, y, itemId: w.id });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * 手で直したあとの図面 next に、前の図面 prev には無かった、「ケーブルの途中への接続」が増えていないか。
 * 増えていれば、その1つ目を返す（手で線を引いたり、線の端を動かしたりしたときの、断る判断に使う）。
 */
export function newCableViolation(prev: Doc, next: Doc): CableViolation | null {
  const before = new Set(cableViolations(prev).map((v) => `${v.kind}:${v.itemId}:${Math.round(v.x)}:${Math.round(v.y)}`));
  return cableViolations(next).find((v) => !before.has(`${v.kind}:${v.itemId}:${Math.round(v.x)}:${Math.round(v.y)}`)) ?? null;
}

/** 線 id の線が、高圧ケーブルの線か（記号を、ここへ動かして離すと、線を割って入る。その判断に使う） */
export function isHvCableWire(doc: Doc, wireId: string): boolean {
  return hvStretches(doc).some((s) => s.wires.includes(wireId));
}
