import { CHAIN_SYMBOLS, ON_WIRE_ORIGIN, getSymbol, isOnWireId } from '@zumen/symbols';
import type { DrawingLayout, PlacedSymbol, Wire } from './layout.ts';
import { rotatedPort } from './layout.ts';

/**
 * 自動作図の結果のうち、VCT・CT・ZCT（線の上に乗せる記号。第20弾 項目2）を、新しい形に直す。
 *
 * 自動作図は、以前の形（記号の中に縦線・入口・出口の接続点がある）で位置を決める。ここで、
 *  1. 記号の左上を、新しい（小さな）記号の左上に動かす（本体は、同じ場所のまま）
 *  2. 以前の入口・出口につながっていた線を、記号の中を通る1本の線にする（同じ種類（実線・点線）で、まっすぐつながるものは、1本にまとめる）
 * 見た目は、以前と変わらない。記号の文字の位置・二次側の接続点の位置も、そのまま。
 */
const NEAR = 0.01;
const near = (a: number, b: number): boolean => Math.abs(a - b) < NEAR;

export function convertOnWire(d: DrawingLayout): DrawingLayout {
  const targets = d.symbols.filter((s) => isOnWireId(s.symbolId));
  if (targets.length === 0) return d;
  let wires: Wire[] = d.wires.map((w) => ({ ...w }));
  // 以前の入口・出口の位置（絶対座標）。記号を動かす前の位置から求める
  const through: { a: [number, number]; b: [number, number] }[] = [];
  const symbols: PlacedSymbol[] = d.symbols.map((s) => {
    const origin = isOnWireId(s.symbolId) ? ON_WIRE_ORIGIN[s.symbolId as keyof typeof ON_WIRE_ORIGIN] : undefined;
    if (!origin) return s;
    const old = CHAIN_SYMBOLS[s.symbolId]!;
    const now = getSymbol(s.symbolId);
    const pin = old.ports.find((p) => p.id === 'in')!;
    const pout = old.ports.find((p) => p.id === 'out')!;
    const [ix, iy] = rotatedPort(old.box, pin.x, pin.y, s.rotate);
    const [ox, oy] = rotatedPort(old.box, pout.x, pout.y, s.rotate);
    // PAS・PGS・UGSの中に入るもの（親がある）は、区分開閉器の枠が、中を通る主回路の線を引いているので、線は足さない
    if (!s.parent) through.push({ a: [s.x + ix, s.y + iy], b: [s.x + ox, s.y + oy] });
    // 新しい記号の中心が、以前の記号の中心から見てどこにあるか（回してあるときも、回した向きで）
    const [cx, cy] = rotatedPort(old.box, origin.x + now.box.w / 2, origin.y + now.box.h / 2, s.rotate);
    return { ...s, x: s.x + cx - now.box.w / 2, y: s.y + cy - now.box.h / 2 };
  });

  // 記号の中を通る線を、以前の縦線と同じ位置に足し、入口・出口につながっていた線と、1本にまとめる
  for (const t of through) wires.push({ x1: t.a[0], y1: t.a[1], x2: t.b[0], y2: t.b[1] });
  const points = through.flatMap((t) => [t.a, t.b]);
  const vertical = (w: Wire) => near(w.x1, w.x2);
  const horizontal = (w: Wire) => near(w.y1, w.y2);
  for (const [px, py] of points) {
    for (let guard = 0; guard < 8; guard++) {
      const at = wires.filter((w) => (near(w.x1, px) && near(w.y1, py)) || (near(w.x2, px) && near(w.y2, py)));
      if (at.length !== 2) break;
      const [a, b] = at as [Wire, Wire];
      if (!!a.dashed !== !!b.dashed) break;
      // 点から、反対の向きへ出ている、まっすぐな線どうしだけ
      const far = (w: Wire): [number, number] => (near(w.x1, px) && near(w.y1, py) ? [w.x2, w.y2] : [w.x1, w.y1]);
      const fa = far(a);
      const fb = far(b);
      const straight = (vertical(a) && vertical(b) && near(fa[0], fb[0]) && (fa[1] - py) * (fb[1] - py) < 0) || (horizontal(a) && horizontal(b) && near(fa[1], fb[1]) && (fa[0] - px) * (fb[0] - px) < 0);
      if (!straight) break;
      wires = wires.filter((w) => w !== a && w !== b);
      wires.push({ x1: fa[0], y1: fa[1], x2: fb[0], y2: fb[1], ...(a.dashed ? { dashed: true } : {}) });
    }
  }
  return { ...d, symbols, wires };
}
