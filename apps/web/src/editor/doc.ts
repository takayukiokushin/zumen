import { getSymbol } from '@zumen/symbols';
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

export const moveItem = (doc: Doc, id: string, dx: number, dy: number): Doc => ({
  items: doc.items.map((it) => {
    if (it.id !== id) return it;
    if (it.kind === 'wire') return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
    return { ...it, x: it.x + dx, y: it.y + dy };
  }),
});

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
