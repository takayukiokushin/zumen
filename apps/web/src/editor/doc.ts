import { getSymbol } from '@zumen/symbols';
import { snap, straighten } from '@zumen/layout';
import type { DrawingLayout } from '@zumen/layout';

/**
 * 編集中の図面。自動レイアウトの結果をここに取り込んでから、自由に動かせるようにする。
 * 記号・線・文字をそれぞれ独立した要素として持つので、記号を差し替えても結線は残る。
 */

export interface DocSymbol {
  kind: 'symbol';
  id: string;
  symbolId: string;
  x: number;
  y: number;
  rotate: number;
  label: string[];
  labelDx: number;
  labelDy: number;
  labelAnchor: 'start' | 'middle' | 'end';
}

export interface DocWire {
  kind: 'wire';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
}

export interface DocFrame {
  kind: 'frame';
  id: string;
  x: number;
  y: number;
  w: number;
  label?: string;
}

export interface DocText {
  kind: 'text';
  id: string;
  x: number;
  y: number;
  lines: string[];
  anchor: 'start' | 'middle' | 'end';
}

export type DocItem = DocSymbol | DocWire | DocFrame | DocText;

export interface Doc {
  items: DocItem[];
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** 自動レイアウトの結果を、編集できる形に取り込む */
export function fromLayout(drawing: DrawingLayout): Doc {
  const items: DocItem[] = [];
  for (const f of drawing.frames) {
    items.push({ kind: 'frame', id: nextId('frame'), x: f.x, y: f.y, w: f.w, label: f.label });
  }
  for (const w of drawing.wires) {
    items.push({ kind: 'wire', id: nextId('wire'), x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, dashed: w.dashed });
  }
  for (const s of drawing.symbols) {
    items.push({
      kind: 'symbol',
      id: s.id || nextId('sym'),
      symbolId: s.symbolId,
      x: s.x,
      y: s.y,
      rotate: s.rotate,
      label: s.label,
      labelDx: s.labelAt.x - s.x,
      labelDy: s.labelAt.y - s.y,
      labelAnchor: s.labelAt.anchor,
    });
  }
  return { items };
}

/* ------------------------------------------------------------------ */
/* 編集操作（いずれも新しい Doc を返す）                                 */
/* ------------------------------------------------------------------ */

/** 線の端が、この距離より近ければ「つながっている」とみなす */
const SNAP_RADIUS = 4;

/** 記号の接続点の絶対座標 */
function portPoints(it: DocSymbol): { x: number; y: number }[] {
  const def = getSymbol(it.symbolId);
  const cx = def.box.w / 2;
  const cy = def.box.h / 2;
  const rad = (it.rotate * Math.PI) / 180;
  return def.ports.map((p) => ({
    x: it.x + cx + (p.x - cx) * Math.cos(rad) - (p.y - cy) * Math.sin(rad),
    y: it.y + cy + (p.x - cx) * Math.sin(rad) + (p.y - cy) * Math.cos(rad),
  }));
}

/**
 * 要素を動かす。記号を動かしたときは、その接続点につながっている線の端も
 * 一緒に動かして、線が切れないようにする。
 */
export const moveItem = (doc: Doc, id: string, rawDx: number, rawDy: number): Doc => {
  const dx = snap(rawDx);
  const dy = snap(rawDy);
  const target = doc.items.find((it) => it.id === id);
  if (!target) return doc;

  // 記号なら、つながっている線の端を拾っておく
  const attached: { wireId: string; end: 1 | 2 }[] = [];
  if (target.kind === 'symbol') {
    const pts = portPoints(target);
    for (const it of doc.items) {
      if (it.kind !== 'wire') continue;
      for (const end of [1, 2] as const) {
        const wx = end === 1 ? it.x1 : it.x2;
        const wy = end === 1 ? it.y1 : it.y2;
        if (pts.some((p) => Math.hypot(p.x - wx, p.y - wy) <= SNAP_RADIUS)) {
          attached.push({ wireId: it.id, end });
        }
      }
    }
  }

  return {
    items: doc.items.map((it) => {
      if (it.id === id) {
        if (it.kind === 'wire') {
          return { ...it, x1: snap(it.x1 + dx), y1: snap(it.y1 + dy), x2: snap(it.x2 + dx), y2: snap(it.y2 + dy) };
        }
        return { ...it, x: snap(it.x + dx), y: snap(it.y + dy) };
      }
      if (it.kind === 'wire') {
        const ends = attached.filter((a) => a.wireId === it.id);
        if (ends.length === 0) return it;
        const next = { ...it };
        for (const a of ends) {
          if (a.end === 1) {
            next.x1 = snap(next.x1 + dx);
            next.y1 = snap(next.y1 + dy);
          } else {
            next.x2 = snap(next.x2 + dx);
            next.y2 = snap(next.y2 + dy);
          }
        }
        return next;
      }
      return it;
    }),
  };
};

/** 線の端だけを動かして伸縮する。縦か横のどちらかに自動で揃える */
export const moveWireEnd = (doc: Doc, id: string, end: 1 | 2, dx: number, dy: number): Doc => ({
  items: doc.items.map((it) => {
    if (it.kind !== 'wire' || it.id !== id) return it;
    const nx = snap((end === 1 ? it.x1 : it.x2) + dx);
    const ny = snap((end === 1 ? it.y1 : it.y2) + dy);
    const [ax, ay, bx, by] =
      end === 1 ? straighten(nx, ny, it.x2, it.y2) : straighten(it.x1, it.y1, nx, ny);
    return end === 1
      ? { ...it, x1: ax, y1: ay, x2: bx, y2: by }
      : { ...it, x1: ax, y1: ay, x2: bx, y2: by };
  }),
});

/** 線を追加する。始点と終点から縦か横に揃えて引く */
export const addWire = (
  doc: Doc,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { doc: Doc; id: string } => {
  const [ax, ay, bx, by] = straighten(snap(x1), snap(y1), snap(x2), snap(y2));
  const id = nextId('wire');
  return { doc: { items: [...doc.items, { kind: 'wire', id, x1: ax, y1: ay, x2: bx, y2: by }] }, id };
};

/** 選んでいる線を、いちばん近い記号の接続点にきっちり合わせる */
export const snapWireToPorts = (doc: Doc, id: string): Doc => {
  const wire = doc.items.find((it) => it.id === id);
  if (!wire || wire.kind !== 'wire') return doc;
  const pts = doc.items.filter((it): it is DocSymbol => it.kind === 'symbol').flatMap(portPoints);
  const nearest = (x: number, y: number) => {
    let best: { x: number; y: number } | null = null;
    let bestD = 12;
    for (const p of pts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ?? { x: snap(x), y: snap(y) };
  };
  const a = nearest(wire.x1, wire.y1);
  const b = nearest(wire.x2, wire.y2);
  const [ax, ay, bx, by] = straighten(a.x, a.y, b.x, b.y);
  return { items: doc.items.map((it) => (it.id === id ? { ...it, x1: ax, y1: ay, x2: bx, y2: by } : it)) };
};

export const removeItem = (doc: Doc, id: string): Doc => ({ items: doc.items.filter((it) => it.id !== id) });

/** 記号を別の記号に差し替える。位置と文字、まわりの結線はそのまま残る */
export const replaceSymbol = (doc: Doc, id: string, symbolId: string): Doc => ({
  items: doc.items.map((it) => (it.kind === 'symbol' && it.id === id ? { ...it, symbolId } : it)),
});

export const addSymbol = (doc: Doc, symbolId: string, x: number, y: number): { doc: Doc; id: string } => {
  const def = getSymbol(symbolId);
  const id = nextId('sym');
  const item: DocSymbol = {
    kind: 'symbol',
    id,
    symbolId,
    x: x - def.box.w / 2,
    y: y - def.box.h / 2,
    rotate: 0,
    label: [],
    labelDx: def.box.w + 10,
    labelDy: 10,
    labelAnchor: 'start',
  };
  return { doc: { items: [...doc.items, item] }, id };
};

export const addText = (doc: Doc, x: number, y: number, text: string): { doc: Doc; id: string } => {
  const id = nextId('text');
  return { doc: { items: [...doc.items, { kind: 'text', id, x, y, lines: text.split('\n'), anchor: 'start' }] }, id };
};

export const setLabel = (doc: Doc, id: string, lines: string[]): Doc => ({
  items: doc.items.map((it) =>
    it.id !== id ? it : it.kind === 'symbol' ? { ...it, label: lines } : it.kind === 'text' ? { ...it, lines } : it,
  ),
});

export const rotateSymbol = (doc: Doc, id: string, delta: number): Doc => ({
  items: doc.items.map((it) =>
    it.kind === 'symbol' && it.id === id ? { ...it, rotate: (it.rotate + delta + 360) % 360 } : it,
  ),
});

/** 要素の外形（選択枠の表示と、図枠に収める計算に使う） */
export function itemBounds(it: DocItem): { x0: number; y0: number; x1: number; y1: number } {
  if (it.kind === 'wire') {
    return {
      x0: Math.min(it.x1, it.x2),
      y0: Math.min(it.y1, it.y2),
      x1: Math.max(it.x1, it.x2),
      y1: Math.max(it.y1, it.y2),
    };
  }
  if (it.kind === 'frame') return { x0: it.x, y0: it.y - 14, x1: it.x + it.w, y1: it.y + 26 };
  if (it.kind === 'text') {
    const w = Math.max(...it.lines.map((l) => l.length)) * 6;
    return { x0: it.x, y0: it.y - 9, x1: it.x + w, y1: it.y + it.lines.length * 10 };
  }
  const def = getSymbol(it.symbolId);
  return { x0: it.x, y0: it.y, x1: it.x + def.box.w, y1: it.y + def.box.h };
}

export function docBounds(doc: Doc): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of doc.items) {
    const b = itemBounds(it);
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  return { x0, y0, x1, y1 };
}
