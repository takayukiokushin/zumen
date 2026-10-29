import { fillLabelLines, getSymbol, initialLabelValues } from '@zumen/symbols';
import type { SymbolDef } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, labelRect, labelWidth, rotatedBox, rotatedPort, snap, straighten } from '@zumen/layout';
import type { DrawingLayout, Orientation, PaperSize } from '@zumen/layout';

/**
 * 編集中の図面。自動レイアウトの結果をここに取り込んでから、自由に動かせるようにする。
 * 記号・線・文字をそれぞれ独立した要素として持つので、記号を差し替えても結線は残る。
 *
 * 結線は「だいたい近い場所」ではなく、つなぐ相手（記号とその接続点）で覚える。
 * こうしておくと、記号を動かしても差し替えても線の端が必ず接続点の真上に来るので、
 * 画面でも印刷でもずれない。
 */

export interface DocSymbol {
  kind: 'symbol';
  id: string;
  symbolId: string;
  /**
   * 親の記号のid。PASに内蔵するZCT・VT・LAのように、親と一体で扱うもの。
   * 親を動かすと一緒に動き、親を消すと一緒に消える。
   */
  parent?: string;
  /** 親のどのスロットに入っているか。親を差し替えたときの置き直しに使う */
  slot?: string;
  x: number;
  y: number;
  rotate: number;
  label: string[];
  /**
   * 定格電圧・定格電流などの入力値（キーは記号定義の fields）。
   * あるときは、label を入力値から作り直す（足した記号の、数字の入力欄に使う）。
   * 文字を手で書き換えたときは無くなる
   */
  values?: Record<string, string>;
  labelDx: number;
  labelDy: number;
  labelAnchor: 'start' | 'middle' | 'end';
}

/** 線の端がつながっている先。位置ではなく相手で覚える */
export interface Anchor {
  /** 記号の id */
  item: string;
  /** その記号の接続点の id */
  port: string;
}

export interface DocWire {
  kind: 'wire';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
  /** 始点のつなぎ先。つないでいなければ無し */
  at1?: Anchor;
  /** 終点のつなぎ先 */
  at2?: Anchor;
  /**
   * つないでいた記号が消されて、つなぎ先を失った線。
   * 「結線を整える」で、つなぎ直せなかった行き止まりの線を見分けて消すための印
   */
  orphan?: boolean;
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
  /**
   * この図面を組み立てたときの、ヒアリング回答の印。
   * 回答が変わったかどうかを、これで見分ける。
   */
  basis?: string;
  /**
   * 人が手で直したか。false のままなら、回答が変われば作り直してよい。
   * true のものを勝手に作り直すと、直した内容が消えてしまう。
   */
  edited?: boolean;
  /** 印刷する用紙。既定はA4の縦 */
  paper?: PaperSize;
  orientation?: Orientation;
}

/**
 * 文字列を短い印にする（FNV-1a）。
 * ヒアリングの回答から組み立てた構成が変わったかどうかを見分けるためだけに使う。
 * 暗号用途ではない。
 */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** 自動レイアウトの結果を、編集できる形に取り込む */
export function fromLayout(drawing: DrawingLayout, basis?: string): Doc {
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
      parent: s.parent,
      slot: s.slot,
      x: s.x,
      y: s.y,
      rotate: s.rotate,
      label: s.label,
      labelDx: s.labelAt.x - s.x,
      labelDy: s.labelAt.y - s.y,
      labelAnchor: s.labelAt.anchor,
    });
  }
  // 受電設備エリアをつなぐケーブルの文字など
  for (const t of drawing.texts ?? []) {
    items.push({ kind: 'text', id: nextId('text'), x: t.x, y: t.y, lines: t.lines, anchor: t.anchor });
  }
  // 作りたてなので edited は false。回答が変われば作り直してよい印
  return tidyDoc({ items, basis, edited: false });
}

/* ------------------------------------------------------------------ */
/* 接続点とつなぎ先                                                     */
/* ------------------------------------------------------------------ */

/** 線の端がこの距離より近ければ「その接続点につないだ」とみなす */
const ATTACH_RADIUS = 6;

/** 動かしている途中、この距離まで近づいたら、まっすぐになる位置に吸い寄せる */
const ASSIST_RANGE = 10;

/** 記号の接続点の絶対座標 */
export function portsOf(it: DocSymbol): { id: string; x: number; y: number }[] {
  const def = getSymbol(it.symbolId);
  return def.ports.map((p) => {
    const [px, py] = rotatedPort(def.box, p.x, p.y, it.rotate);
    return { id: p.id, x: it.x + px, y: it.y + py };
  });
}

/** つなぎ先の、いまの座標。記号が消えていれば null */
function portAt(doc: Doc, a: Anchor | undefined): { x: number; y: number } | null {
  if (!a) return null;
  const it = doc.items.find((i) => i.id === a.item);
  if (!it || it.kind !== 'symbol') return null;
  return portsOf(it).find((p) => p.id === a.port) ?? null;
}

/** その座標にいちばん近い接続点。radius より遠ければ null */
export function nearestPort(
  doc: Doc,
  x: number,
  y: number,
  radius = ATTACH_RADIUS,
): { item: string; port: string; x: number; y: number } | null {
  let best: { item: string; port: string; x: number; y: number } | null = null;
  let bestD = radius;
  for (const it of doc.items) {
    if (it.kind !== 'symbol') continue;
    for (const p of portsOf(it)) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        bestD = d;
        best = { item: it.id, port: p.id, x: p.x, y: p.y };
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 親子（PASとその内蔵品のように、ひとかたまりで扱うもの）                */
/* ------------------------------------------------------------------ */

/** その記号に内蔵されているもの（孫まで）のid */
export function descendantsOf(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const it of doc.items) {
      if (it.kind !== 'symbol' || !it.parent) continue;
      if (frontier.includes(it.parent) && !out.includes(it.id)) {
        out.push(it.id);
        next.push(it.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** その記号を含む「かたまり」のいちばん外側。内蔵品でなければ自分自身 */
export function groupRootOf(doc: Doc, id: string): string {
  const byId = new Map(doc.items.map((it) => [it.id, it]));
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && cur.kind === 'symbol' && cur.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    const up = byId.get(cur.parent);
    if (!up) break;
    cur = up;
  }
  return cur?.id ?? id;
}

/** かたまり全体（自分＋内蔵品）のid */
export const groupOf = (doc: Doc, id: string): string[] => [id, ...descendantsOf(doc, id)];

/** まだつなぎ先が無い線の端を、近くの接続点に結びつける */
export function linkWires(doc: Doc): Doc {
  return {
    ...doc,
    items: doc.items.map((it) => {
      if (it.kind !== 'wire') return it;
      if (it.at1 && it.at2) return it;
      const w = { ...it };
      // 両端を同じ接続点につないではいけない。線の長さがゼロになって消えてしまう。
      // （PASの中のLA・VTのように、記号の近くから出る短い分岐線で起きていた）
      const same = (p: { item: string; port: string }, other: DocWire['at1']) =>
        other !== undefined && other.item === p.item && other.port === p.port;
      /**
       * まっすぐな線を、斜めにしてしまうつなぎ方はしない。
       * 横の線の端を、少し上下にずれた接続点に寄せると線が斜めになってしまう。
       * （PASの中で、LAへの横線の端がすぐ上のVTの接続点に吸い寄せられていた）
       */
      const keepsStraight = (p: { x: number; y: number }): boolean => {
        if (w.y1 === w.y2) return Math.abs(p.y - w.y1) <= 1.5;
        if (w.x1 === w.x2) return Math.abs(p.x - w.x1) <= 1.5;
        return true;
      };
      const pick = (x: number, y: number) => {
        const p = nearestPort(doc, x, y);
        return p && keepsStraight(p) ? p : null;
      };
      const p1 = w.at1 ? null : pick(w.x1, w.y1);
      const p2 = w.at2 ? null : pick(w.x2, w.y2);
      if (p1 && p2 && p1.item === p2.item && p1.port === p2.port) {
        // 両端が同じ接続点を指した。接続点に近いほうだけをつなぎ、反対の端は自由にする
        const d1 = Math.hypot(w.x1 - p1.x, w.y1 - p1.y);
        const d2 = Math.hypot(w.x2 - p2.x, w.y2 - p2.y);
        if (d1 <= d2) w.at1 = { item: p1.item, port: p1.port };
        else w.at2 = { item: p2.item, port: p2.port };
      } else {
        if (p1 && !same(p1, w.at2)) w.at1 = { item: p1.item, port: p1.port };
        if (p2 && !same(p2, w.at1)) w.at2 = { item: p2.item, port: p2.port };
      }
      return w;
    }),
  };
}

/**
 * つないである端を、接続点の真上にぴったり置き直す。
 * 片側だけつないでいる線は、縦なら縦、横なら横のまま伸び縮みさせる。
 */
export function applyAnchors(doc: Doc): Doc {
  return {
    ...doc,
    items: doc.items.map((it) => {
      if (it.kind !== 'wire') return it;
      if (!it.at1 && !it.at2) return it;
      const p1 = portAt(doc, it.at1);
      const p2 = portAt(doc, it.at2);
      const w = { ...it };
      // 記号ごと消えていたら、つなぎ先の印も外す
      if (it.at1 && !p1) w.at1 = undefined;
      if (it.at2 && !p2) w.at2 = undefined;
      if (!p1 && !p2) return w;

      // いまの向き（縦か横か）を覚えてから動かす
      const vertical = Math.abs(it.x2 - it.x1) <= Math.abs(it.y2 - it.y1);
      if (p1) {
        w.x1 = p1.x;
        w.y1 = p1.y;
      }
      if (p2) {
        w.x2 = p2.x;
        w.y2 = p2.y;
      }
      // 反対側が自由なら、まっすぐのまま伸び縮みさせる
      if (p1 && !p2) {
        if (vertical) w.x2 = w.x1;
        else w.y2 = w.y1;
      } else if (p2 && !p1) {
        if (vertical) w.x1 = w.x2;
        else w.y1 = w.y2;
      }
      return w;
    }),
  };
}

/** 結線を整える。つなぎ忘れを結び直し、端を接続点にぴったり合わせる */
export function tidyDoc(doc: Doc): Doc {
  return applyAnchors(linkWires(doc));
}

/* ------------------------------------------------------------------ */
/* 編集操作（いずれも新しい Doc を返す）                                 */
/* ------------------------------------------------------------------ */

/**
 * 要素を動かす。記号を動かすと、つないである線の端も接続点について回る。
 *
 * dx・dy は呼ぶ側で決めた値をそのまま使う（assistMove が格子合わせと
 * 吸い寄せを済ませている）。ここで丸め直すと、せっかく揃えた位置がずれる。
 */
export const moveItem = (doc: Doc, id: string, dx: number, dy: number): Doc => {
  if (dx === 0 && dy === 0) return doc;
  const target = doc.items.find((it) => it.id === id);
  if (!target) return doc;

  // 記号を動かすときは、内蔵しているもの（PASのZCT・VT・LAなど）も一緒に動かす
  const moving = new Set(target.kind === 'symbol' ? groupOf(doc, id) : [id]);

  const moved: Doc = {
    ...doc,
    items: doc.items.map((it) => {
      if (!moving.has(it.id)) return it;
      if (it.kind === 'wire') {
        // 線そのものを動かしたときは、つないであった印をいったん外す
        return {
          ...it,
          x1: it.x1 + dx,
          y1: it.y1 + dy,
          x2: it.x2 + dx,
          y2: it.y2 + dy,
          at1: undefined,
          at2: undefined,
          orphan: undefined,
        };
      }
      return { ...it, x: it.x + dx, y: it.y + dy };
    }),
  };

  // 線を動かしたときだけ、行き先の接続点に結び直す
  return target.kind === 'wire' ? tidyDoc(moved) : applyAnchors(moved);
};

/** 点 (px,py) は動かさずに、点 (qx,qy) を縦か横に揃えた座標 */
function alignTo(px: number, py: number, qx: number, qy: number): [number, number] {
  const [, , nx, ny] = straighten(px, py, qx, qy);
  return [nx, ny];
}

/** 線の端だけを動かして伸縮する。縦か横のどちらかに自動で揃える */
export const moveWireEnd = (doc: Doc, id: string, end: 1 | 2, dx: number, dy: number): Doc => {
  const next: Doc = {
    ...doc,
    items: doc.items.map((it) => {
      if (it.kind !== 'wire' || it.id !== id) return it;
      const w = { ...it, orphan: undefined };
      const nx = (end === 1 ? w.x1 : w.x2) + dx;
      const ny = (end === 1 ? w.y1 : w.y2) + dy;
      if (end === 1) {
        w.x1 = nx;
        w.y1 = ny;
        w.at1 = undefined;
      } else {
        w.x2 = nx;
        w.y2 = ny;
        w.at2 = undefined;
      }

      // 接続点にぴったり乗ったなら、そこを動かさずに残す
      if (nearestPort(doc, nx, ny, 0.5)) return w;

      const fixedX = end === 1 ? w.x2 : w.x1;
      const fixedY = end === 1 ? w.y2 : w.y1;
      if (end === 1 ? w.at2 : w.at1) {
        // 反対側はつないであって動かせないので、持っている側を揃える
        const [ax, ay] = alignTo(fixedX, fixedY, nx, ny);
        if (end === 1) {
          w.x1 = ax;
          w.y1 = ay;
        } else {
          w.x2 = ax;
          w.y2 = ay;
        }
      } else {
        // 反対側が自由なら、持っている側を活かして反対側を揃える
        const [ax, ay] = alignTo(nx, ny, fixedX, fixedY);
        if (end === 1) {
          w.x2 = ax;
          w.y2 = ay;
        } else {
          w.x1 = ax;
          w.y1 = ay;
        }
      }
      return w;
    }),
  };
  return tidyDoc(next);
};

/** 線を追加する。始点と終点から縦か横に揃えて引く */
export const addWire = (
  doc: Doc,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { doc: Doc; id: string } => {
  // 引き始め・引き終わりが接続点の近くなら、そこにぴったり合わせる
  const a = nearestPort(doc, x1, y1, ASSIST_RANGE) ?? { x: snap(x1), y: snap(y1) };
  const b = nearestPort(doc, x2, y2, ASSIST_RANGE) ?? { x: snap(x2), y: snap(y2) };
  const [ax, ay, bx, by] = straighten(a.x, a.y, b.x, b.y);
  const id = nextId('wire');
  return {
    doc: tidyDoc({ ...doc, items: [...doc.items, { kind: 'wire', id, x1: ax, y1: ay, x2: bx, y2: by }] }),
    id,
  };
};

/** 選んでいる線を、いちばん近い記号の接続点にきっちり合わせる */
export const snapWireToPorts = (doc: Doc, id: string): Doc => {
  const wire = doc.items.find((it) => it.id === id);
  if (!wire || wire.kind !== 'wire') return doc;
  const a = nearestPort(doc, wire.x1, wire.y1, 12);
  const b = nearestPort(doc, wire.x2, wire.y2, 12);
  const linked: Doc = {
    ...doc,
    items: doc.items.map((it) =>
      it.id !== id
        ? it
        : {
            ...wire,
            at1: a ? { item: a.item, port: a.port } : wire.at1,
            at2: b ? { item: b.item, port: b.port } : wire.at2,
          },
    ),
  };
  return applyAnchors(linked);
};

/** 要素を消す。記号を消すと、内蔵しているものも一緒に消える */
export const removeItem = (doc: Doc, id: string): Doc => {
  const gone = new Set(groupOf(doc, id));
  return {
    ...doc,
    items: doc.items
      .filter((it) => !gone.has(it.id))
      .map((it) => {
        if (it.kind !== 'wire') return it;
        const a1 = it.at1 && gone.has(it.at1.item);
        const a2 = it.at2 && gone.has(it.at2.item);
        if (!a1 && !a2) return it;
        return { ...it, at1: a1 ? undefined : it.at1, at2: a2 ? undefined : it.at2, orphan: true };
      }),
  };
};

/**
 * 記号を別の記号に差し替える。
 * つないである接続点がその場に残るように置き直し、まわりの線は自動で伸び縮みする。
 */
export const replaceSymbol = (doc: Doc, id: string, symbolId: string): Doc => {
  const old = doc.items.find((it) => it.id === id);
  if (!old || old.kind !== 'symbol' || old.symbolId === symbolId) return doc;

  const oldPorts = portsOf(old);
  const { values: oldValues, ...oldRest } = old;
  // 入力欄から文字を作っていた記号は、差し替え先の記号の入力欄で作り直す
  const next: DocSymbol = { ...oldRest, symbolId, ...(oldValues ? labelFromFields(getSymbol(symbolId)) : {}) };
  const newPorts = portsOf(next);
  if (oldPorts.length === 0 || newPorts.length === 0) {
    return applyAnchors({ ...doc, items: doc.items.map((it) => (it.id === id ? next : it)) });
  }

  // 線がつながっている接続点を基準にする。無ければ最初の接続点
  const used = new Set<string>();
  for (const it of doc.items) {
    if (it.kind !== 'wire') continue;
    if (it.at1?.item === id) used.add(it.at1.port);
    if (it.at2?.item === id) used.add(it.at2.port);
  }
  const keyIndex = Math.max(
    0,
    oldPorts.findIndex((p) => used.has(p.id)),
  );
  const from = oldPorts[keyIndex]!;
  const to = newPorts[Math.min(keyIndex, newPorts.length - 1)]!;
  next.x = old.x + (from.x - to.x);
  next.y = old.y + (from.y - to.y);

  // 古い接続点の名前を、新しい記号のどれに読み替えるか決める
  const remap = new Map<string, string>();
  oldPorts.forEach((p, i) => {
    const same = newPorts.find((q) => q.id === p.id);
    remap.set(p.id, (same ?? newPorts[Math.min(i, newPorts.length - 1)]!).id);
  });

  // 内蔵しているもの（PASのZCT・VT・LAなど）を、新しい記号のスロットに置き直す。
  // 同じ名前のスロットが無ければ、その内蔵品は一緒に消える
  const newDef = getSymbol(symbolId);
  const dropped = new Set<string>();
  const reseated = new Map<string, { x: number; y: number }>();
  for (const it of doc.items) {
    if (it.kind !== 'symbol' || it.parent !== id) continue;
    const slot = it.slot ? newDef.slots?.find((s2) => s2.id === it.slot) : undefined;
    if (!slot) {
      for (const g of groupOf(doc, it.id)) dropped.add(g);
      continue;
    }
    // 内蔵品の入り口を、新しいスロットの位置に合わせる
    const entry = portsOf(it)[0];
    if (!entry) continue;
    reseated.set(it.id, { x: it.x + (next.x + slot.x - entry.x), y: it.y + (next.y + slot.y - entry.y) });
  }

  const items = doc.items
    .filter((it) => !dropped.has(it.id))
    .map((it) => {
      if (it.id === id) return next;
      const seat = it.kind === 'symbol' ? reseated.get(it.id) : undefined;
      if (seat) return { ...it, x: seat.x, y: seat.y };
      if (it.kind !== 'wire') return it;
      const a1 = it.at1 && dropped.has(it.at1.item);
      const a2 = it.at2 && dropped.has(it.at2.item);
      const w = { ...it };
      if (a1) w.at1 = undefined;
      if (a2) w.at2 = undefined;
      if (w.at1?.item === id) w.at1 = { item: id, port: remap.get(w.at1.port) ?? w.at1.port };
      if (w.at2?.item === id) w.at2 = { item: id, port: remap.get(w.at2.port) ?? w.at2.port };
      return w;
    });
  return applyAnchors({ ...doc, items });
};

/** 雛形のある記号は、足した直後から「V」「A」などの文字を出す。無い記号は何も書かない */
const labelFromFields = (def: SymbolDef): Pick<DocSymbol, 'label' | 'values'> => {
  if (!def.labelLines) return { label: [] };
  const values = initialLabelValues(def);
  return { label: fillLabelLines(def, values), values };
};

export const addSymbol = (doc: Doc, symbolId: string, x: number, y: number): { doc: Doc; id: string } => {
  const def = getSymbol(symbolId);
  const id = nextId('sym');
  const item: DocSymbol = {
    kind: 'symbol',
    id,
    symbolId,
    x: snap(x - def.box.w / 2),
    y: snap(y - def.box.h / 2),
    rotate: 0,
    ...labelFromFields(def),
    labelDx: def.box.w + 10,
    labelDy: 10,
    labelAnchor: 'start',
  };
  return { doc: { ...doc, items: [...doc.items, item] }, id };
};

export const addText = (doc: Doc, x: number, y: number, text: string): { doc: Doc; id: string } => {
  const id = nextId('text');
  return { doc: { ...doc, items: [...doc.items, { kind: 'text', id, x, y, lines: text.split('\n'), anchor: 'start' }] }, id };
};

export const setLabel = (doc: Doc, id: string, lines: string[]): Doc => ({
  ...doc,
  items: doc.items.map((it) => {
    if (it.id !== id) return it;
    if (it.kind === 'symbol') {
      // 文字を直接書き換えたら、入力欄から文字を作り直さない（書き換えた内容を消さないため）
      const { values: _manual, ...rest } = it;
      return { ...rest, label: lines };
    }
    return it.kind === 'text' ? { ...it, lines } : it;
  }),
});

/** 定格などの入力欄を1つ変えて、図面に書く文字を作り直す */
export const setLabelValue = (doc: Doc, id: string, key: string, value: string): Doc => ({
  ...doc,
  items: doc.items.map((it) => {
    if (it.id !== id || it.kind !== 'symbol' || !it.values) return it;
    const values = { ...it.values };
    if (value.trim() === '') delete values[key];
    else values[key] = value;
    return { ...it, values, label: fillLabelLines(getSymbol(it.symbolId), values) };
  }),
});

/** 手で書き換えた文字を捨てて、入力欄から作る形に戻す */
export const resetLabelFromFields = (doc: Doc, id: string): Doc => ({
  ...doc,
  items: doc.items.map((it) => (it.id === id && it.kind === 'symbol' ? { ...it, ...labelFromFields(getSymbol(it.symbolId)) } : it)),
});

/** 記号を回す。つないである線の端も、回ったあとの接続点について回る */
export const rotateSymbol = (doc: Doc, id: string, delta: number): Doc =>
  applyAnchors({
    ...doc,
    items: doc.items.map((it) =>
      it.kind === 'symbol' && it.id === id ? { ...it, rotate: (it.rotate + delta + 360) % 360 } : it,
    ),
  });

/* ------------------------------------------------------------------ */
/* 動かすときの手助け                                                   */
/* ------------------------------------------------------------------ */

/** 動かしている途中の、吸い寄せ後のずらし量と、目安の線 */
export interface MoveAssist {
  dx: number;
  dy: number;
  /** 縦に揃った位置（目安の線を引くため） */
  guideX?: number;
  /** 横に揃った位置 */
  guideY?: number;
}

/** 吸い寄せ先の候補。d はずらし量、at は揃う座標 */
interface Candidate {
  d: number;
  at: number;
}

/** 候補のうち、いま指している量にいちばん近いもの。遠ければ null */
function pick(raw: number, cands: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let bestGap = ASSIST_RANGE;
  for (const c of cands) {
    const gap = Math.abs(c.d - raw);
    if (gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}

/**
 * 記号を動かしている途中、結線がまっすぐになる位置に軽く吸い寄せる。
 * 先に「つないである線がまっすぐになる位置」、次に「ほかの記号と揃う位置」を見る。
 */
export function assistMove(doc: Doc, id: string, rawDx: number, rawDy: number): MoveAssist {
  const target = doc.items.find((it) => it.id === id);
  if (!target || target.kind !== 'symbol') return { dx: snap(rawDx), dy: snap(rawDy) };

  const pts = portsOf(target);
  const wantX: Candidate[] = [];
  const wantY: Candidate[] = [];

  // ① つないである線が、まっすぐになる位置
  for (const it of doc.items) {
    if (it.kind !== 'wire') continue;
    for (const end of [1, 2] as const) {
      const here = end === 1 ? it.at1 : it.at2;
      const there = end === 1 ? it.at2 : it.at1;
      if (here?.item !== id) continue;
      if (there?.item === id) continue; // 同じ記号の中で閉じている線は対象外
      const p = pts.find((q) => q.id === here.port);
      if (!p) continue;
      const ox = end === 1 ? it.x2 : it.x1;
      const oy = end === 1 ? it.y2 : it.y1;
      if (Math.abs(it.x2 - it.x1) <= Math.abs(it.y2 - it.y1)) wantX.push({ d: ox - p.x, at: ox });
      else wantY.push({ d: oy - p.y, at: oy });
    }
  }

  // ② ほかの記号の接続点と、たて・よこが揃う位置
  for (const it of doc.items) {
    if (it.kind !== 'symbol' || it.id === id) continue;
    for (const q of portsOf(it)) {
      for (const p of pts) {
        wantX.push({ d: q.x - p.x, at: q.x });
        wantY.push({ d: q.y - p.y, at: q.y });
      }
    }
  }

  const bx = pick(rawDx, wantX);
  const by = pick(rawDy, wantY);
  return {
    dx: bx ? bx.d : snap(rawDx),
    dy: by ? by.d : snap(rawDy),
    guideX: bx?.at,
    guideY: by?.at,
  };
}

/** 線の端を動かしている途中、近くの接続点に吸い寄せる */
export function assistWireEnd(doc: Doc, id: string, end: 1 | 2, rawDx: number, rawDy: number): MoveAssist {
  const w = doc.items.find((it) => it.id === id);
  if (!w || w.kind !== 'wire') return { dx: snap(rawDx), dy: snap(rawDy) };
  const fromX = end === 1 ? w.x1 : w.x2;
  const fromY = end === 1 ? w.y1 : w.y2;
  const p = nearestPort(doc, fromX + rawDx, fromY + rawDy, ASSIST_RANGE);
  if (!p) return { dx: snap(rawDx), dy: snap(rawDy) };
  return { dx: p.x - fromX, dy: p.y - fromY, guideX: p.x, guideY: p.y };
}

/* ------------------------------------------------------------------ */

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
    const w = labelWidth(it.lines);
    return { x0: it.x, y0: it.y - LABEL_FONT, x1: it.x + w, y1: it.y + it.lines.length * LABEL_LINE };
  }
  const def = getSymbol(it.symbolId);
  const rb = rotatedBox(def.box, it.rotate);
  return { x0: it.x + rb.dx, y0: it.y + rb.dy, x1: it.x + rb.dx + rb.w, y1: it.y + rb.dy + rb.h };
}

export function docBounds(doc: Doc): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const ext = (a: number, b: number, c: number, d: number) => {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  };
  for (const it of doc.items) {
    const b = itemBounds(it);
    ext(b.x0, b.y0, b.x1, b.y1);
    // 記号の横の文字も、図面の範囲に入れる（枠が無いとき、左端の文字が画面や用紙で切れないように）
    if (it.kind === 'symbol' && it.label.length > 0) {
      const r = labelRect({ x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor }, it.label);
      ext(r.x0, r.y0, r.x1, r.y1);
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  return { x0, y0, x1, y1 };
}
