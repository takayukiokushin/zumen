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

/**
 * 自動で作った図面の控え（手で直す前の姿）。
 * 手で直した内容を、あとで取り出すための基準にする（手で直した内容 ＝ いまの図面と、この控えとの違い）。
 */
export interface Baseline {
  symbols: Record<
    string,
    { symbolId: string; x: number; y: number; rotate: number; label: string[]; labelDx: number; labelDy: number; values?: Record<string, string> }
  >;
  /** つなぎ先が両端にある線の印（wireKey） */
  wires: string[];
  /** 自動で作った線・文字の id。これに無いものは、手で足したもの */
  wireIds: string[];
  textIds: string[];
}

/** 手で直した記号の、自動の位置・状態からの違い */
export interface SymbolEdit {
  /** 自動の位置からのずれ */
  dx: number;
  dy: number;
  rotate?: number;
  /** 文字の位置のずれ */
  dLabelDx?: number;
  dLabelDy?: number;
  label?: string[];
  values?: Record<string, string>;
  symbolId?: string;
}

/** 手で足したものを置く場所。近くの機器（near）からのずれで覚えるので、機器が動いても、ついていく */
export interface Placement {
  near?: string;
  ndx: number;
  ndy: number;
}

export type AddedItem =
  | { kind: 'symbol'; item: DocSymbol; at: Placement }
  | { kind: 'text'; item: DocText; at: Placement }
  | { kind: 'wire'; item: DocWire; at: Placement };

/**
 * 手で直した内容の記録。入力内容が変わって図面を作り直すとき、自動の図面の上に、これを重ねる。
 * 対象の機器がいまの入力に無いもの（「LAなし」にしたときのLAの移動など）は、捨てずに取っておく。
 */
export interface Overrides {
  moved: Record<string, SymbolEdit>;
  /** 手で消した記号の id */
  removed: string[];
  /** 手で消した線（wireKey） */
  wiresRemoved: string[];
  added: AddedItem[];
}

/**
 * 機器の id の「同じ機器」としての名前。台数が1台のときは変圧器が `transformer`、2台以上のときは
 * `transformer-1`・`transformer-2` になる（自動で作る図面の id の付け方）。入力で台数が変わっても、
 * 1台目を「同じ機器」と見なすため、末尾の `-1` を外した名前で比べる。
 */
export const sameName = (id: string): string => id.replace(/-1$/, '');

/** 線の両端のつなぎ先から作る印（向きは問わない）。片方でも欠けていれば、null */
export function wireKey(w: { at1?: Anchor; at2?: Anchor }): string | null {
  if (!w.at1 || !w.at2) return null;
  return [`${sameName(w.at1.item)}.${w.at1.port}`, `${sameName(w.at2.item)}.${w.at2.port}`].sort().join('>');
}

/** いまの図面を、自動で作った図面の控えにする */
export function baselineOf(doc: Doc): Baseline {
  const symbols: Baseline['symbols'] = {};
  const wires: string[] = [];
  const wireIds: string[] = [];
  const textIds: string[] = [];
  for (const it of doc.items) {
    if (it.kind === 'symbol') {
      symbols[sameName(it.id)] = {
        symbolId: it.symbolId,
        x: it.x,
        y: it.y,
        rotate: it.rotate,
        label: [...it.label],
        labelDx: it.labelDx,
        labelDy: it.labelDy,
        ...(it.values ? { values: { ...it.values } } : {}),
      };
    } else if (it.kind === 'wire') {
      wireIds.push(it.id);
      const k = wireKey(it);
      if (k) wires.push(k);
    } else if (it.kind === 'text') {
      textIds.push(it.id);
    }
  }
  return { symbols, wires, wireIds, textIds };
}

/** 新しい要素の id（保存してある id とぶつからないように、読み込んだ図面の分は避ける） */
export function freshId(prefix: string, taken?: Set<string>): string {
  let id = nextId(prefix);
  while (taken?.has(id)) id = nextId(prefix);
  return id;
}

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
  /**
   * 記号を消して空いた、縦の範囲（記号と文字が占めていた高さ）。
   * 「結線を整える」で、ここに残った余白を詰めるのに使う（詰めたら、ここから外す）
   */
  vacated?: { y0: number; y1: number }[];
  /** 自動で作った図面の控え。手で直した内容を取り出す基準になる */
  base?: Baseline;
  /** 手で直した内容の記録（作り直すたびに更新する）。対象の機器がいまの入力に無いものも、ここに残る */
  overrides?: Overrides;
  /** 印刷する向き。利用者が選んだとき（縦・横のボタン）だけ入る。無ければ、図面の形に合わせて自動で決まる */
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
  const doc = tidyDoc({ items, basis, edited: false });
  return { ...doc, base: baselineOf(doc) };
}

/* ------------------------------------------------------------------ */
/* 接続点とつなぎ先                                                     */
/* ------------------------------------------------------------------ */

/** 線の端がこの距離より近ければ「その接続点につないだ」とみなす */
const ATTACH_RADIUS = 6;

/** 線が、接続点の出ていく向きと逆へ、これ以上伸びていたら「折り返し」とみなす距離 */
const FOLD_TOLERANCE = 1.5;
/** 折り返して描かない線の、残しておく長さ（見えないほど短い。縦横の向きを覚えておくための値） */
const COLLAPSED = 0.001;

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

/**
 * 接続点から、線が出ていく向き（記号を回していれば、回したあとの向き）。
 * 上＝(0,-1)、下＝(0,1)、左＝(-1,0)、右＝(1,0)。無ければ null
 */
function outwardOf(doc: Doc, a: Anchor | undefined): { dx: number; dy: number } | null {
  if (!a) return null;
  const it = doc.items.find((i) => i.id === a.item);
  if (!it || it.kind !== 'symbol') return null;
  const port = getSymbol(it.symbolId).ports.find((p) => p.id === a.port);
  if (!port) return null;
  const base = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[port.dir];
  // 時計まわりに rotate 度回す
  const turns = (((Math.round(it.rotate / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  let [x, y] = base as [number, number];
  for (let i = 0; i < turns; i++) [x, y] = [-y, x];
  return { dx: x, dy: y };
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

/** 両端がつないである線が、どちらかの接続点から、出ていく向きと逆向きに伸びているか（折り返し） */
function foldsBack(
  doc: Doc,
  w: DocWire,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): boolean {
  const fold = (from: { x: number; y: number }, to: { x: number; y: number }, out: { dx: number; dy: number } | null) =>
    out !== null && (to.x - from.x) * out.dx + (to.y - from.y) * out.dy < -FOLD_TOLERANCE;
  return fold(p1, p2, outwardOf(doc, w.at1)) || fold(p2, p1, outwardOf(doc, w.at2));
}

/**
 * 片側だけつないである線で、自由な端が、つなぎ先の接続点から見て、出ていく向きと逆側にあるか。
 * 自由な端は動かさない（縦なら縦、横なら横のまま伸び縮みする）ので、元の向き（縦／横）で測る。
 */
function freeEndFolds(
  doc: Doc,
  w: DocWire,
  orig: DocWire,
  anchor: Anchor | undefined,
  p: { x: number; y: number },
  end: 1 | 2,
): boolean {
  const out = outwardOf(doc, anchor);
  if (!out) return false;
  const fx = end === 1 ? orig.x2 : orig.x1;
  const fy = end === 1 ? orig.y2 : orig.y1;
  const vertical = Math.abs(orig.x2 - orig.x1) <= Math.abs(orig.y2 - orig.y1);
  const reach = vertical ? (fy - p.y) * out.dy : (fx - p.x) * out.dx;
  // つなぎ先の向きが、線の縦横と合っていないときは、判断しない
  const along = vertical ? out.dy !== 0 : out.dx !== 0;
  void w;
  return along && reach < -FOLD_TOLERANCE;
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
      /*
       * 両端がつないである線が、記号を動かしたせいで、つなぎ先の記号の中へ折り返してしまうとき
       * （たとえば、LBSを下へ動かして、下の機器の接続点より下に行った）は、線を描かない。
       * 折り返した線が、記号の真ん中を貫く縦の線に見えてしまうため。
       * つなぎ先の印は残しておくので、記号を元の位置へ戻せば、線は元どおりに出る。
       */
      if (p1 && p2 && foldsBack(doc, it, p1, p2)) {
        w.x2 = p1.x;
        w.y2 = p1.y;
        w.x1 = p1.x;
        w.y1 = p1.y;
        return w;
      }

      // 片側だけつないである線でも、自由な端がつなぎ先の記号の後ろ側へ回り込むなら、同じく描かない
      // （自由な端の位置と、縦横の向きは覚えておく。つなぎ先を元に戻せば、線は元どおりに出る）
      if (p1 && !p2 && freeEndFolds(doc, w, it, w.at1, p1, 1)) {
        const vertical = Math.abs(it.x2 - it.x1) <= Math.abs(it.y2 - it.y1);
        w.x1 = it.x2 + (vertical ? 0 : COLLAPSED);
        w.y1 = it.y2 + (vertical ? COLLAPSED : 0);
        return w;
      }
      if (p2 && !p1 && freeEndFolds(doc, w, it, w.at2, p2, 2)) {
        const vertical = Math.abs(it.x2 - it.x1) <= Math.abs(it.y2 - it.y1);
        w.x2 = it.x1 + (vertical ? 0 : COLLAPSED);
        w.y2 = it.y1 + (vertical ? COLLAPSED : 0);
        return w;
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
 * 親の記号（PAS）を動かすときに、一緒に動かすもの。
 *
 * PASの中は、記号の絵（主回路の縦線）と、細かい線に分かれている。内蔵品（ZCT・VT・LA）へ向かう枝線は、
 * 一方の端がPASの枠の中（絵の上）にあって、つなぎ先を持たない。これを動かさないと、PASを動かしたとき、
 * 枝線の端だけが取り残されて、線が自由に伸びてしまう。
 * さらに、内蔵品から出て、GR・DGR（地絡継電器）へ向かう線（途中で曲がる）と、GR・DGRそのものも、
 * PASに付いているものなので、一緒に動かす。
 *
 *   inside … 動かす線（両端が、PASの内蔵品か、PASの枠の中にあるもの）
 *   relays … 一緒に動かす継電器（GR・DGR）と、そこへ向かう線
 *
 * GR・DGRへ向かう線をたどった先に、ほかの記号があったり、GR・DGR以外の継電器だったりするときは、
 * どこまでが付属品か分からないので、動かさない（これまでどおり、線が伸びるだけ）。
 */
function followersOf(doc: Doc, parentId: string): { wires: Set<string>; symbols: Set<string> } {
  const wires = new Set<string>();
  const symbols = new Set<string>();
  const parent = doc.items.find((i) => i.id === parentId);
  if (!parent || parent.kind !== 'symbol') return { wires, symbols };
  const kids = new Set(descendantsOf(doc, parentId));
  if (kids.size === 0) return { wires, symbols };
  const group = new Set([parentId, ...kids]);

  const rb = rotatedBox(getSymbol(parent.symbolId).box, parent.rotate);
  const box = { x0: parent.x + rb.dx - 0.5, y0: parent.y + rb.dy - 0.5, x1: parent.x + rb.dx + rb.w + 0.5, y1: parent.y + rb.dy + rb.h + 0.5 };
  const inBox = (x: number, y: number) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
  const allWires = doc.items.filter((i): i is DocWire => i.kind === 'wire');

  // 1 PASの中の枝線：端が、内蔵品につながっているか、PASの枠の中にある
  for (const w of allWires) {
    const ok1 = w.at1 ? kids.has(w.at1.item) : inBox(w.x1, w.y1);
    const ok2 = w.at2 ? kids.has(w.at2.item) : inBox(w.x2, w.y2);
    if (ok1 && ok2 && (w.at1 || w.at2 || (inBox(w.x1, w.y1) && inBox(w.x2, w.y2)))) {
      // 内蔵品につながっていて、反対の端が枠の外（GR・DGRへ向かう線）のものは、次で調べる
      wires.add(w.id);
    }
  }

  // 2 内蔵品からGR・DGRへ向かう線をたどる（端どうしが触れている線を、つなぎ先を持たないまま、たどっていく）
  const touches = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= 1.5;
  for (const start of allWires) {
    if (wires.has(start.id)) continue;
    const fromKid = (start.at1 && kids.has(start.at1.item)) || (start.at2 && kids.has(start.at2.item));
    if (!fromKid) continue;
    const chain = new Set<string>([start.id]);
    const relays = new Set<string>();
    let bad = false;
    for (const queue = [start]; queue.length > 0 && !bad; ) {
      const w = queue.pop()!;
      for (const [a, x, y] of [[w.at1, w.x1, w.y1], [w.at2, w.x2, w.y2]] as const) {
        if (a) {
          if (kids.has(a.item) || group.has(a.item)) continue;
          const sym = doc.items.find((i) => i.id === a.item);
          if (sym && sym.kind === 'symbol' && /^relay-(gr|dgr)$/.test(sym.symbolId)) relays.add(sym.id);
          else bad = true;
          continue;
        }
        // つなぎ先を持たない端：同じ点で触れているほかの線へ
        for (const o of allWires) {
          if (chain.has(o.id) || wires.has(o.id)) continue;
          if (touches(x, y, o.x1, o.y1) || touches(x, y, o.x2, o.y2)) {
            chain.add(o.id);
            queue.push(o);
          }
        }
      }
    }
    if (bad || relays.size !== 1) continue;
    for (const id of chain) wires.add(id);
    for (const id of relays) symbols.add(id);
  }
  return { wires, symbols };
}

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
  // 親の記号（PAS）を動かすときは、PASの中の枝線と、付属のGR・DGR（とそこへ向かう線）も一緒に動かす。
  // 内蔵品だけを動かすときは、これまでどおり、その部品だけが動く
  const follow = target.kind === 'symbol' ? followersOf(doc, id) : { wires: new Set<string>(), symbols: new Set<string>() };
  for (const sid of follow.symbols) moving.add(sid);

  const moved: Doc = {
    ...doc,
    items: doc.items.map((it) => {
      if (!moving.has(it.id) && !follow.wires.has(it.id)) return it;
      if (it.kind === 'wire' && follow.wires.has(it.id)) {
        // 一緒に動かす線は、つなぎ先の印を残したまま、平行に動かす
        return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
      }
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

/**
 * 線を追加する。始点と終点から縦か横に揃えて引く。
 * 近くの接続点・線の端・線の上には、軽く吸い寄せる（assist: false なら、格子に合わせるだけ。意図して離したいとき）。
 */
export const addWire = (
  doc: Doc,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { assist?: boolean; range?: number } = {},
): { doc: Doc; id: string } => {
  const assist = opts.assist !== false;
  const range = opts.range ?? ASSIST_RANGE;
  const a = assist ? assistPoint(doc, x1, y1, undefined, range) : { x: snap(x1), y: snap(y1) };
  const [ax, ay, bx, by] = assist
    ? (() => {
        const e = assistWireNew(doc, a.x, a.y, x2, y2, undefined, range);
        return [a.x, a.y, e.x, e.y] as [number, number, number, number];
      })()
    : straighten(a.x, a.y, snap(x2), snap(y2));
  const id = nextId('wire');
  return {
    doc: tidyDoc({ ...doc, items: [...doc.items, { kind: 'wire', id, x1: ax, y1: ay, x2: bx, y2: by }] }),
    id,
  };
};

/** 要素を消す。記号を消すと、内蔵しているものも一緒に消える */
export const removeItem = (doc: Doc, id: string): Doc => {
  const gone = new Set(groupOf(doc, id));
  // 消す記号（と文字）が占めていた高さを覚えておく。あとで、ここに残った余白を詰める
  const freed: { y0: number; y1: number }[] = [];
  for (const it of doc.items) {
    if (it.kind !== 'symbol' || !gone.has(it.id)) continue;
    const rb = rotatedBox(getSymbol(it.symbolId).box, it.rotate);
    let y0 = it.y + rb.dy;
    let y1 = it.y + rb.dy + rb.h;
    if (it.label.length > 0) {
      const r = labelRect({ x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor }, it.label);
      y0 = Math.min(y0, r.y0);
      y1 = Math.max(y1, r.y1);
    }
    freed.push({ y0, y1 });
  }
  return {
    ...doc,
    ...(freed.length > 0 ? { vacated: [...(doc.vacated ?? []), ...freed] } : {}),
    items: doc.items
      .filter((it) => !gone.has(it.id))
      .map((it) => {
        if (it.kind !== 'wire') return it;
        const a1 = it.at1 && gone.has(it.at1.item);
        const a2 = it.at2 && gone.has(it.at2.item);
        // 連動の点線（TC→開閉器）は、開閉器の図記号の中（刃に触れた点）で止まっていて、記号の接続点にはつながっていない。
        // 消した記号の中で止まっていた点線も、つなぎ先を失った線として扱う
        const inGone = (x: number, y: number) =>
          !!it.dashed &&
          doc.items.some((o) => {
            if (o.kind !== 'symbol' || !gone.has(o.id)) return false;
            const rb = rotatedBox(getSymbol(o.symbolId).box, o.rotate);
            return x > o.x + rb.dx && x < o.x + rb.dx + rb.w && y > o.y + rb.dy && y < o.y + rb.dy + rb.h;
          });
        const e1 = !it.at1 && inGone(it.x1, it.y1);
        const e2 = !it.at2 && inGone(it.x2, it.y2);
        if (!a1 && !a2 && !e1 && !e2) return it;
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
function pick(raw: number, cands: Candidate[], range = ASSIST_RANGE): Candidate | null {
  let best: Candidate | null = null;
  let bestGap = range;
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
export function assistMove(doc: Doc, id: string, rawDx: number, rawDy: number, range = ASSIST_RANGE): MoveAssist {
  const target = doc.items.find((it) => it.id === id);
  if (target?.kind === 'wire') return assistWireMove(doc, target, rawDx, rawDy, range);
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

  // ③ ほかの線と、たて・よこが揃う位置（縦の線なら x、横の線なら y）。この記号につながっている線は、一緒に動くので対象外
  for (const it of doc.items) {
    if (it.kind !== 'wire' || it.at1?.item === id || it.at2?.item === id) continue;
    for (const p of pts) {
      if (isVerticalWire(it)) wantX.push({ d: it.x1 - p.x, at: it.x1 });
      else wantY.push({ d: it.y1 - p.y, at: it.y1 });
    }
  }

  const bx = pick(rawDx, wantX, range);
  const by = pick(rawDy, wantY, range);
  return {
    dx: bx ? bx.d : snap(rawDx),
    dy: by ? by.d : snap(rawDy),
    guideX: bx?.at,
    guideY: by?.at,
  };
}

/**
 * 既存の線そのものを動かしている途中の手助け。次の位置に、軽く吸い寄せる。
 * ① 線の端が、記号の接続点・ほかの線の端に重なる位置
 * ② 線の端が、直角に交わる線の上に乗る位置（枝分かれ・そこで止まる）
 * ③ 平行な線と、同じ線上（横線なら同じ高さ、縦線なら同じ左右位置）に並ぶ位置
 * 離せば吸い付かないので、わざとずらして置くこともできる。
 */
function assistWireMove(doc: Doc, w: DocWire, rawDx: number, rawDy: number, range: number): MoveAssist {
  const vertical = isVerticalWire(w);
  const ends = [
    { x: w.x1, y: w.y1 },
    { x: w.x2, y: w.y2 },
  ];
  const tol = Math.max(ATTACH_RADIUS, range * 0.6);
  const wantX: Candidate[] = [];
  const wantY: Candidate[] = [];

  const targets: { x: number; y: number }[] = wireEndsOf(doc, w.id);
  for (const it of doc.items) if (it.kind === 'symbol') targets.push(...portsOf(it));
  for (const e of ends) {
    for (const t of targets) {
      wantX.push({ d: t.x - e.x, at: t.x });
      wantY.push({ d: t.y - e.y, at: t.y });
    }
  }
  for (const o of doc.items) {
    if (o.kind !== 'wire' || o.id === w.id) continue;
    const ov = isVerticalWire(o);
    for (const e of ends) {
      if (ov) {
        if (e.y >= Math.min(o.y1, o.y2) - tol && e.y <= Math.max(o.y1, o.y2) + tol) wantX.push({ d: o.x1 - e.x, at: o.x1 });
      } else if (e.x >= Math.min(o.x1, o.x2) - tol && e.x <= Math.max(o.x1, o.x2) + tol) {
        wantY.push({ d: o.y1 - e.y, at: o.y1 });
      }
    }
    if (ov === vertical) {
      if (vertical) wantX.push({ d: o.x1 - w.x1, at: o.x1 });
      else wantY.push({ d: o.y1 - w.y1, at: o.y1 });
    }
  }
  const bx = pick(rawDx, wantX, range);
  const by = pick(rawDy, wantY, range);
  return { dx: bx ? bx.d : snap(rawDx), dy: by ? by.d : snap(rawDy), guideX: bx?.at, guideY: by?.at };
}

/** 線の端を動かしている途中、近くの接続点・線の端・線の上に軽く吸い寄せる */
export function assistWireEnd(doc: Doc, id: string, end: 1 | 2, rawDx: number, rawDy: number, range = ASSIST_RANGE): MoveAssist {
  const w = doc.items.find((it) => it.id === id);
  if (!w || w.kind !== 'wire') return { dx: snap(rawDx), dy: snap(rawDy) };
  const fromX = end === 1 ? w.x1 : w.x2;
  const fromY = end === 1 ? w.y1 : w.y2;
  const fixedX = end === 1 ? w.x2 : w.x1;
  const fixedY = end === 1 ? w.y2 : w.y1;
  const rawX = fromX + rawDx;
  const rawY = fromY + rawDy;
  // 反対側がつないであって動かせないときは、そこから縦か横に伸ばした線の上で吸い寄せる。
  // 反対側が自由なら、持っている点そのものを吸い寄せる
  const p = (end === 1 ? w.at2 : w.at1) ? assistWireNew(doc, fixedX, fixedY, rawX, rawY, id, range) : assistPoint(doc, rawX, rawY, id, range);
  return { dx: p.x - fromX, dy: p.y - fromY, guideX: p.guideX ?? (p.kind === 'grid' || p.kind === 'align' ? undefined : p.x), guideY: p.guideY ?? (p.kind === 'grid' || p.kind === 'align' ? undefined : p.y) };
}

/* ------------------------------------------------------------------ */
/* 線を引くときの手助け                                                 */
/* ------------------------------------------------------------------ */

/**
 * 吸い付いた先の種類。
 * port＝記号の接続点、end＝ほかの線の端、wire＝ほかの線の上（枝分かれ）、align＝ほかと揃う位置、grid＝格子（吸い付いていない）
 */
export type AssistKind = 'port' | 'end' | 'wire' | 'align' | 'grid';

export interface PointAssist {
  x: number;
  y: number;
  kind: AssistKind;
  /** 揃った位置に引く目安の線（kind が align のとき） */
  guideX?: number;
  guideY?: number;
}

/** 縦の線か（縦横の差が同じなら縦。straighten と同じ決め方） */
function isVerticalWire(w: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return Math.abs(w.x2 - w.x1) <= Math.abs(w.y2 - w.y1);
}

/** 自分以外の線の端 */
function wireEndsOf(doc: Doc, exclude?: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const it of doc.items) {
    if (it.kind !== 'wire' || it.id === exclude) continue;
    out.push({ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 });
  }
  return out;
}

/** ある1点を、近くの接続点・線の端・線の上に吸い寄せる。何も近くになければ、格子に合わせるだけ */
export function assistPoint(doc: Doc, x: number, y: number, exclude?: string, range = ASSIST_RANGE): PointAssist {
  const port = nearestPort(doc, x, y, range);
  if (port) return { x: port.x, y: port.y, kind: 'port' };

  let best: { x: number; y: number } | null = null;
  let bestD = range;
  for (const e of wireEndsOf(doc, exclude)) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) return { x: best.x, y: best.y, kind: 'end' };

  // 線の上（途中）。線の方向には、格子に合わせた位置を取り、線からずれないようにする
  let on: { x: number; y: number } | null = null;
  bestD = range;
  for (const it of doc.items) {
    if (it.kind !== 'wire' || it.id === exclude) continue;
    const vertical = isVerticalWire(it);
    const lo = vertical ? Math.min(it.y1, it.y2) : Math.min(it.x1, it.x2);
    const hi = vertical ? Math.max(it.y1, it.y2) : Math.max(it.x1, it.x2);
    const along = Math.max(lo, Math.min(hi, snap(vertical ? y : x)));
    const px = vertical ? it.x1 : along;
    const py = vertical ? along : it.y1;
    const d = Math.hypot(px - x, py - y);
    if (d <= bestD) {
      bestD = d;
      on = { x: px, y: py };
    }
  }
  if (on) return { x: on.x, y: on.y, kind: 'wire' };
  return { x: snap(x), y: snap(y), kind: 'grid' };
}

/** 「ほかと揃う位置」に吸い寄せる範囲（つなぐ先への吸い付きより、控えめにする） */
const ALIGN_RANGE = 5;

/**
 * 新しい線の終点。始点 (sx,sy) から縦か横に伸ばした線の上で、
 * 近くの 接続点 ＞ ほかの線の端 ＞ ほかの線（そこで止まる・枝分かれ） に軽く吸い寄せ、
 * 無ければ、ほかの接続点・線の端と揃う位置、それも無ければ格子に合わせる。
 * 吸い寄せは、近づいたときだけ。離れていれば、ほかの線を突き抜けて引ける。
 */
export function assistWireNew(doc: Doc, sx: number, sy: number, rawX: number, rawY: number, exclude?: string, range = ASSIST_RANGE): PointAssist {
  // この線の延長上とみなす、横方向のずれの許容。範囲に合わせて広げる（画面で、狙いやすいように）
  const perpTol = Math.max(ATTACH_RADIUS, range * 0.6);
  const horizontal = Math.abs(rawX - sx) > Math.abs(rawY - sy);
  const raw = horizontal ? rawX : rawY;
  const perp = horizontal ? sy : sx;
  const at = (along: number): [number, number] => (horizontal ? [along, sy] : [sx, along]);

  /** 吸い寄せ先の候補。score は、遠さに、種類ごとの優先（小さいほど優先）を足したもの */
  const cands: { along: number; kind: AssistKind; score: number }[] = [];
  const consider = (px: number, py: number, kind: AssistKind, pri: number) => {
    const a = horizontal ? px : py;
    const off = Math.abs((horizontal ? py : px) - perp);
    if (off > perpTol) return; // この線の延長上にない
    const gap = Math.abs(a - raw);
    if (gap <= range) cands.push({ along: a, kind, score: gap + pri * 0.4 });
  };
  for (const it of doc.items) {
    if (it.kind === 'symbol') for (const p of portsOf(it)) consider(p.x, p.y, 'port', 0);
  }
  for (const e of wireEndsOf(doc, exclude)) consider(e.x, e.y, 'end', 1);
  // 直角に交わる線：その線のところで止める（突き抜けも、離せば可能）
  for (const it of doc.items) {
    if (it.kind !== 'wire' || it.id === exclude) continue;
    if (isVerticalWire(it) !== horizontal) continue; // 同じ向きの線は、端だけ（上で見ている）
    const lo = horizontal ? Math.min(it.y1, it.y2) : Math.min(it.x1, it.x2);
    const hi = horizontal ? Math.max(it.y1, it.y2) : Math.max(it.x1, it.x2);
    if (perp < lo - perpTol || perp > hi + perpTol) continue; // その線の長さの範囲に入っていない
    const a = horizontal ? it.x1 : it.y1;
    const gap = Math.abs(a - raw);
    if (gap <= range) cands.push({ along: a, kind: 'wire', score: gap + 2 * 0.4 });
  }
  cands.sort((a, b) => a.score - b.score);
  const hit = cands[0];
  if (hit) {
    const [x, y] = at(hit.along);
    return { x, y, kind: hit.kind };
  }

  // 揃う位置（ほかの接続点・線の端と、たて・よこが同じ）
  let align: number | null = null;
  let alignGap = Math.max(ALIGN_RANGE, range);
  const alignWith = (px: number, py: number) => {
    const a = horizontal ? px : py;
    const gap = Math.abs(a - raw);
    if (gap <= alignGap) {
      alignGap = gap;
      align = a;
    }
  };
  for (const it of doc.items) {
    if (it.kind === 'symbol') for (const p of portsOf(it)) alignWith(p.x, p.y);
  }
  for (const e of wireEndsOf(doc, exclude)) alignWith(e.x, e.y);
  // 平行な線と、同じ長さになる位置（前に引いた線と、長さをそろえて並べるとき）
  const dir = Math.sign(raw - (horizontal ? sx : sy));
  if (dir !== 0) {
    for (const it of doc.items) {
      if (it.kind !== 'wire' || it.id === exclude || isVerticalWire(it) === horizontal) continue;
      const len = horizontal ? Math.abs(it.x2 - it.x1) : Math.abs(it.y2 - it.y1);
      if (len < 1) continue;
      const a = (horizontal ? sx : sy) + dir * len;
      const gap = Math.abs(a - raw);
      if (gap <= alignGap) {
        alignGap = gap;
        align = a;
      }
    }
  }
  if (align !== null) {
    const [x, y] = at(align);
    return horizontal ? { x, y, kind: 'align', guideX: align } : { x, y, kind: 'align', guideY: align };
  }
  const [x, y] = at(snap(raw));
  return { x, y, kind: 'grid' };
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
