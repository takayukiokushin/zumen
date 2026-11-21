import type { Shape } from './shape.ts';
import type { SymbolDef } from './types.ts';

/** 小数の誤差（0.6 倍で出る 1e-15 など）を落とす */
const r = (v: number): number => Math.round(v * 1000) / 1000;

/** パス（d）の数値を、まとめて倍にする。使うのは、絶対座標の M L H V C Z のみ（弧 A は、旗の値があるので扱わない） */
function scalePath(d: string, k: number): string {
  if (/[AaQqSsTt]/.test(d)) throw new Error(`scaleSymbol: パスの命令に対応していません: ${d}`);
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (m) => String(r(Number(m) * k)));
}

function scaleShape(s: Shape, k: number): Shape {
  switch (s.k) {
    case 'line':
      return { ...s, x1: r(s.x1 * k), y1: r(s.y1 * k), x2: r(s.x2 * k), y2: r(s.y2 * k) };
    case 'poly':
      return { ...s, pts: s.pts.map((v) => r(v * k)) };
    case 'circle':
      return { ...s, cx: r(s.cx * k), cy: r(s.cy * k), r: r(s.r * k) };
    case 'rect':
      return { ...s, x: r(s.x * k), y: r(s.y * k), w: r(s.w * k), h: r(s.h * k), ...(s.rx !== undefined ? { rx: r(s.rx * k) } : {}) };
    case 'path':
      return { ...s, d: scalePath(s.d, k) };
    case 'text':
      return { ...s, x: r(s.x * k), y: r(s.y * k), ...(s.size !== undefined ? { size: r(s.size * k) } : {}), ...(s.tracking !== undefined ? { tracking: r(s.tracking * k) } : {}) };
  }
}

/**
 * 図記号を、同じ形のまま、k 倍に縮める（拡大もできる）。
 * 形・接続点・内蔵の置き場所（slots）・外枠の中央（markCenter）・文字の基準枠（labelBody）が、同じ比率で動く。
 * 線の太さ（sw）は変えない（縮めても細くならない）。
 * PAS・PGS・UGS と、その中に入る機器（第20弾 項目7）が使う。
 */
export function scaleSymbol(def: SymbolDef, k: number, over: Partial<SymbolDef> = {}): SymbolDef {
  return {
    ...def,
    box: { w: r(def.box.w * k), h: r(def.box.h * k) },
    shapes: def.shapes.map((s) => scaleShape(s, k)),
    ports: def.ports.map((p) => ({ ...p, x: r(p.x * k), y: r(p.y * k) })),
    ...(def.slots ? { slots: def.slots.map((s) => ({ ...s, x: r(s.x * k), y: r(s.y * k) })) } : {}),
    ...(def.markCenter ? { markCenter: { x: r(def.markCenter.x * k), y: r(def.markCenter.y * k) } } : {}),
    ...(def.labelBody ? { labelBody: { x0: r(def.labelBody.x0 * k), x1: r(def.labelBody.x1 * k), top: r(def.labelBody.top * k) } } : {}),
    ...over,
  };
}
