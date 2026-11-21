import { healBeforeRemove } from './rewire.ts';
import { clampSize, fillLabelLines, getSymbol, initialLabelValues, sideLabelOrigin, sizedSymbol } from '@zumen/symbols';
import type { SizeRange, SymbolDef } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, clampTextSize, labelRect, labelWidth, rotatedBox, rotatedPort, snap, straighten } from '@zumen/layout';
import type { DrawingLayout, Orientation } from '@zumen/layout';
import type { GroundAnchor, Layer } from './layers.ts';

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
   * 図面の上で決めた幅・高さ（外箱・エリアの区分枠のように、大きさを変えられる記号だけ）。
   * 無ければ、記号定義の大きさ
   */
  w?: number;
  h?: number;
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
  /**
   * 「結線」で引いた線の印。1つの結線（元の記号から、下の機器たちへ）は、縦線（trunk）・横の母線（bus）・各機器への縦線（drop）の
   * 組で、同じ id（fan.id）を持つ。記号を動かす・消す・足すたびに、この組全体を引き直す（refreshFans）。
   * item・port は、trunk は元の記号と接続点、drop は下の機器と接続点
   */
  fan?: FanTag;
}

export interface FanTag {
  id: string;
  role: 'trunk' | 'bus' | 'drop';
  item?: string;
  port?: string;
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
  /** 文字の大きさ。記号の横の文字を1倍とした倍率（1〜5）。縦横の比は変えない。無ければ1倍 */
  size?: number;
  bold?: boolean;
  /** 赤い文字（レイヤーに置いた文字だけ。元の図面では使わない） */
  red?: boolean;
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
  /** 自動で作った枠（キュービクルなどの外枠）の、位置と幅。並び順で、同じ枠を見分ける */
  frames?: { x: number; y: number; w: number }[];
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

/** 手で直した枠の、自動の位置・幅からの違い */
export interface FrameEdit {
  dx: number;
  dy: number;
  dw: number;
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
  /** 手で動かした・幅を変えた枠（自動で作った枠の並び順 → 違い）。無い（古い記録）ときは、無し */
  frames?: Record<string, FrameEdit>;
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
  const frames = doc.items.filter((i): i is DocFrame => i.kind === 'frame').map((f) => ({ x: f.x, y: f.y, w: f.w }));
  return { symbols, wires, wireIds, textIds, frames };
}

/** 新しい要素の id（保存してある id とぶつからないように、読み込んだ図面の分は避ける） */
export function freshId(prefix: string, taken?: Set<string>): string {
  let id = nextId(prefix);
  while (taken?.has(id)) id = nextId(prefix);
  return id;
}

/** この図面の中で、まだ使われていない id（読み込んだ図面の id と、ぶつからない） */
export const freshIdIn = (doc: Doc, prefix: string): string => freshId(prefix, new Set(doc.items.map((i) => i.id)));

/**
 * 図面の中で、同じ id が2つ以上の要素に付いているとき、あとのほうを、新しい id に付け替える。
 * （以前は、画面を読み込み直すと、id の番号が最初から数え直されて、保存してある図面の id と重なることがあった）
 * つなぎ先（線の端）が付け替えた記号を指していたかは、位置で見分ける（記号の接続点に近いほうへ付ける）。
 * 重なりが無ければ、そのまま返す。
 */
export function dedupeIds(doc: Doc): Doc {
  const first = new Map<string, DocItem>();
  const dups: DocItem[] = [];
  for (const it of doc.items) {
    if (first.has(it.id)) dups.push(it);
    else first.set(it.id, it);
  }
  if (dups.length === 0) return doc;
  const taken = new Set(doc.items.map((i) => i.id));
  const renamed = new Map<DocItem, string>();
  for (const it of dups) {
    const id = freshId(it.kind === 'symbol' ? 'sym' : it.kind, taken);
    taken.add(id);
    renamed.set(it, id);
  }
  const items = doc.items.map((it) => (renamed.has(it) ? ({ ...it, id: renamed.get(it)! } as DocItem) : it));
  // 線の端が、付け替えた記号を指しているか（元の id の2つの記号のうち、端に近い接続点のほう）
  const symsById = new Map<string, DocSymbol[]>();
  for (const it of items) if (it.kind === 'symbol') symsById.set(it.id, [it]);
  for (const [orig, newId] of [...renamed].map(([o, n]) => [o, n] as const)) {
    if (orig.kind !== 'symbol') continue;
    const a = first.get(orig.id) as DocSymbol;
    const b = items.find((i) => i.id === newId) as DocSymbol;
    symsById.set(orig.id, [a, b]);
  }
  const fix = (an: Anchor | undefined, x: number, y: number): Anchor | undefined => {
    if (!an) return an;
    const cands = symsById.get(an.item);
    if (!cands || cands.length < 2) return an;
    let best = cands[0]!;
    let bd = Infinity;
    for (const c of cands) {
      const p = portsOf(c).find((q) => q.id === an.port);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return { item: best.id, port: an.port };
  };
  return {
    ...doc,
    items: items.map((it) => {
      if (it.kind !== 'wire' || (!it.at1 && !it.at2)) return it;
      const at1 = fix(it.at1, it.x1, it.y1);
      const at2 = fix(it.at2, it.x2, it.y2);
      return at1 === it.at1 && at2 === it.at2 ? it : { ...it, at1, at2 };
    }),
  };
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
  vacated?: { y0: number; y1: number; x0?: number; x1?: number }[];
  /** 自動で作った図面の控え。手で直した内容を取り出す基準になる */
  base?: Baseline;
  /** 手で直した内容の記録（作り直すたびに更新する）。対象の機器がいまの入力に無いものも、ここに残る */
  overrides?: Overrides;
  /** 印刷する向き。利用者が選んだとき（縦・横のボタン）だけ入る。無ければ、図面の形に合わせて自動で決まる */
  orientation?: Orientation;
  /**
   * レイヤー（停電範囲図など）。元の図面（items）とは別に持つ。
   * 元の図面を作り直しても、「操作を戻す」を押しても、引き継ぐ（layers.ts の carryLayers）。
   * 無ければ、レイヤーを使っていない図面
   */
  layers?: Layer[];
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

/** 図面の上の記号の定義。幅・高さを変えた記号は、その大きさで作り直したもの */
export const defOf = (it: { symbolId: string; w?: number; h?: number }): SymbolDef =>
  sizedSymbol(getSymbol(it.symbolId), it);

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;
/** 新しい線のid（rewire.ts が、線を割るときに使う） */
export const newWireId = (): string => nextId('wire');

/** 接続点どうしをつなぐ、まっすぐな線を1本作る（「結線を整える」が、つなぎ忘れの隙間を埋めるのに使う） */
export function makeWire(x1: number, y1: number, x2: number, y2: number, at1: Anchor, at2: Anchor): DocWire {
  return { kind: 'wire', id: nextId('wire'), x1, y1, x2, y2, at1, at2 };
}

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
      ...(s.w !== undefined ? { w: s.w } : {}),
      ...(s.h !== undefined ? { h: s.h } : {}),
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

/**
 * 記号の種類・大きさ・向きから決まる、接続点の、記号の原点からの位置。
 * 同じ組み合わせは、何度も同じ答えになるので、覚えておく（「結線を整える」や確認で、1本ずつの線の端について、
 * 全部の記号の接続点を調べるため、記号が多いと、ここが一番時間を使っていた）
 */
interface PortOffsets {
  offs: { id: string; px: number; py: number }[];
  /** 原点から、いちばん遠い接続点までの距離（この記号が、ある点から遠いかを、すぐ判断するため） */
  reach: number;
}
const PORT_OFFSETS = new Map<string, PortOffsets>();
/** 覚えておく組み合わせの上限（図面の上で大きさを変え続けても、覚える量が増え続けないように） */
const PORT_OFFSETS_MAX = 2000;
/** 記号1つずつに、いまの種類・大きさ・向きで調べた結果を、紐づけて覚える（記号を書き換えたら、条件が合わず、調べ直す） */
const PORTS_OF_ITEM = new WeakMap<DocSymbol, { symbolId: string; w: number | undefined; h: number | undefined; rotate: number; po: PortOffsets }>();

function portOffsetsOf(it: DocSymbol): PortOffsets {
  const c = PORTS_OF_ITEM.get(it);
  if (c && c.symbolId === it.symbolId && c.w === it.w && c.h === it.h && c.rotate === it.rotate) return c.po;
  const key = `${it.symbolId}|${it.w ?? ''}|${it.h ?? ''}|${it.rotate}`;
  let po = PORT_OFFSETS.get(key);
  if (!po) {
    const def = defOf(it);
    const offs = def.ports.map((p) => {
      const [px, py] = rotatedPort(def.box, p.x, p.y, it.rotate);
      return { id: p.id, px, py };
    });
    po = { offs, reach: offs.reduce((m, o) => Math.max(m, Math.hypot(o.px, o.py)), 0) };
    if (PORT_OFFSETS.size >= PORT_OFFSETS_MAX) PORT_OFFSETS.clear();
    PORT_OFFSETS.set(key, po);
  }
  PORTS_OF_ITEM.set(it, { symbolId: it.symbolId, w: it.w, h: it.h, rotate: it.rotate, po });
  return po;
}

/** 記号の接続点の絶対座標 */
export function portsOf(it: DocSymbol): { id: string; x: number; y: number }[] {
  return portOffsetsOf(it).offs.map((o) => ({ id: o.id, x: it.x + o.px, y: it.y + o.py }));
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
export function outwardOf(doc: Doc, a: Anchor | undefined): { dx: number; dy: number } | null {
  if (!a) return null;
  const it = doc.items.find((i) => i.id === a.item);
  if (!it || it.kind !== 'symbol') return null;
  const port = defOf(it).ports.find((p) => p.id === a.port);
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
    const { offs, reach } = portOffsetsOf(it);
    // この記号の接続点は、どれも、原点から reach 以内。点が、それより遠ければ、1つずつ調べるまでもない
    if (Math.hypot(it.x - x, it.y - y) > reach + bestD) continue;
    for (const o of offs) {
      const px = it.x + o.px;
      const py = it.y + o.py;
      const d = Math.hypot(px - x, py - y);
      if (d <= bestD) {
        bestD = d;
        best = { item: it.id, port: o.id, x: px, y: py };
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
  return along && reach < -FOLD_TOLERANCE;
}

/**
 * つないである端を、接続点の真上にぴったり置き直す。
 * 片側だけつないでいる線は、縦なら縦、横なら横のまま伸び縮みさせる。
 */
export function applyAnchors(doc: Doc): Doc {
  return refreshFans({
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
  });
}

/* ------------------------------------------------------------------ */
/* 結線（元の記号から、下の機器たちへ、縦線・母線・縦線で結ぶ）            */
/* ------------------------------------------------------------------ */

/** 母線と、元の記号・下の機器との、最低限の間隔 */
const FAN_GAP = 12;
/** 結線の母線を、元の記号の下端から、最低でもこれだけ離す（機器が近い・高さが同じなどで、ふつうの間隔が取れないときの、最低の間隔） */
export const FAN_MIN = 6;

/** 元の記号の、いちばん下の接続点（結線の出口） */
export function fanSourcePort(it: DocSymbol): { id: string; x: number; y: number } | null {
  const ps = portsOf(it);
  return ps.length === 0 ? null : ps.reduce((a, b) => (b.y > a.y ? b : a));
}

/** 下の機器の、いちばん上の接続点（結線の入口） */
export function fanTargetPort(it: DocSymbol): { id: string; x: number; y: number } | null {
  const ps = portsOf(it);
  return ps.length === 0 ? null : ps.reduce((a, b) => (b.y < a.y ? b : a));
}

/** 同じ元の記号から出ている結線（あれば、その id） */
export function fanIdOf(doc: Doc, sourceId: string): string | null {
  const t = doc.items.find((it): it is DocWire => it.kind === 'wire' && it.fan?.role === 'trunk' && it.fan.item === sourceId);
  return t?.fan?.id ?? null;
}

/**
 * 結線を作る・足す。元の記号から、下の機器（childIds）へ。
 * 同じ元の記号から出る結線が、もうあるときは、その母線に合流する（母線の高さは、そのまま）。
 * 記号の位置は動かさない。引き直したあとの図面と、足した機器の数を返す
 */
export function addFan(doc: Doc, sourceId: string, childIds: string[]): { doc: Doc; added: number; fanId: string | null } {
  const src = doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === sourceId);
  const sp = src ? fanSourcePort(src) : null;
  if (!src || !sp) return { doc, added: 0, fanId: null };
  const existing = fanIdOf(doc, sourceId);
  const fanId = existing ?? `fan-${freshId('g', new Set(doc.items.flatMap((i) => (i.kind === 'wire' && i.fan ? [i.fan.id.replace(/^fan-/, '')] : []))))}`;
  const have = new Set(
    doc.items.flatMap((it) => (it.kind === 'wire' && it.fan?.id === fanId && it.fan.role === 'drop' ? [it.fan.item ?? ''] : [])),
  );
  const add: DocWire[] = [];
  // すでに、元の記号の出口と、その機器の入口が、1本の線で直接つながっているときは、新しい線を作らない（線が二重に重なるため）
  const joined = (cid: string, cpId: string) =>
    doc.items.some(
      (w) =>
        w.kind === 'wire' &&
        !w.fan &&
        ((w.at1?.item === sourceId && w.at1.port === sp.id && w.at2?.item === cid && w.at2.port === cpId) ||
          (w.at2?.item === sourceId && w.at2.port === sp.id && w.at1?.item === cid && w.at1.port === cpId)),
    );
  for (const cid of childIds) {
    const c = doc.items.find((it): it is DocSymbol => it.kind === 'symbol' && it.id === cid);
    const cp = c ? fanTargetPort(c) : null;
    if (!c || !cp || cid === sourceId || have.has(cid) || joined(cid, cp.id)) continue;
    have.add(cid);
    add.push({ kind: 'wire', id: freshIdIn(doc, 'wire'), x1: cp.x, y1: cp.y, x2: cp.x, y2: cp.y, at2: { item: cid, port: cp.id }, fan: { id: fanId, role: 'drop', item: cid, port: cp.id } });
  }
  if (add.length === 0) return { doc, added: 0, fanId: existing };
  const hasTrunk = doc.items.some((it) => it.kind === 'wire' && it.fan?.id === fanId && it.fan.role === 'trunk');
  if (!hasTrunk) {
    add.unshift({ kind: 'wire', id: freshIdIn(doc, 'wire'), x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y, at1: { item: sourceId, port: sp.id }, fan: { id: fanId, role: 'trunk', item: sourceId, port: sp.id } });
  }
  return { doc: refreshFans({ ...doc, items: [...doc.items, ...add] }), added: add.filter((w) => w.fan?.role === 'drop').length, fanId };
}

/**
 * 結線の線を、いまの記号の位置に合わせて、引き直す（記号を動かす・消す・足すたびに呼ぶ）。
 * - 元の記号から、母線の高さまで縦線。母線は、元の記号と下の機器の、いちばん左〜いちばん右。各機器へ、母線から縦線
 * - 母線の高さは、いまの高さを保つ。元の記号・下の機器に近すぎるとき（動かしたなど）は、元の記号の下端と、
 *   いちばん上の機器の上端の、ちょうど真ん中にする
 * - 機器が近すぎる・同じ高さ・上にあるときも、母線は、元の記号の下端から FAN_MIN（6）以上、下に置く（縦線が逆向きにならない）
 * - 下の機器が消えたら、その縦線も消す。最後の1台が消えたら、元の記号から出ている縦線・母線も消す
 * - 元の記号が消えたら、元の記号から出ている縦線を消す（母線と、残った機器への縦線は残す）
 * - 下の機器の途中の記号を消して、つなぎ直されたとき（つなぎ先が変わったとき）は、新しいつなぎ先に付け替える
 */
export function refreshFans(doc: Doc): Doc {
  if (!doc.items.some((it) => it.kind === 'wire' && it.fan)) return doc;
  const syms = new Map(doc.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => [i.id, i]));
  const portOf = (item: string | undefined, port: string | undefined) => {
    const s = item ? syms.get(item) : undefined;
    return s ? (portsOf(s).find((p) => p.id === port) ?? null) : null;
  };
  const groups = new Map<string, DocWire[]>();
  for (const it of doc.items) if (it.kind === 'wire' && it.fan) groups.set(it.fan.id, [...(groups.get(it.fan.id) ?? []), it]);
  const drop = new Set<string>();
  const patch = new Map<string, DocWire>();
  const extra: DocWire[] = [];
  for (const [fid, ws] of groups) {
    const trunk = ws.find((w) => w.fan!.role === 'trunk');
    const bus = ws.find((w) => w.fan!.role === 'bus');
    const drops = ws.filter((w) => w.fan!.role === 'drop');
    // 下の機器（つなぎ先が変わっていれば、新しいつなぎ先）
    const members: { w: DocWire; item: string; port: string; x: number; y: number }[] = [];
    for (const d of drops) {
      const cand = d.at2 && syms.has(d.at2.item) ? d.at2 : d.fan!.item && syms.has(d.fan!.item) ? { item: d.fan!.item, port: d.fan!.port ?? '' } : null;
      const p = cand ? portOf(cand.item, cand.port) : null;
      if (!cand || !p) drop.add(d.id);
      else members.push({ w: d, item: cand.item, port: cand.port, x: p.x, y: p.y });
    }
    if (members.length === 0) {
      for (const w of ws) drop.add(w.id);
      continue;
    }
    // 元の記号
    const srcCand = trunk ? (trunk.at1 && syms.has(trunk.at1.item) ? trunk.at1 : trunk.fan!.item && syms.has(trunk.fan!.item) ? { item: trunk.fan!.item, port: trunk.fan!.port ?? '' } : null) : null;
    const sp = srcCand ? portOf(srcCand.item, srcCand.port) : null;
    if (trunk && !sp) drop.add(trunk.id);
    const minTop = Math.min(...members.map((m) => m.y));
    const lo = sp ? sp.y + FAN_GAP : -Infinity;
    const hi = minTop - FAN_GAP;
    const prev = bus ? bus.y1 : trunk && Math.abs(trunk.y2 - trunk.y1) > 0.01 ? trunk.y2 : NaN;
    let busY = Number.isFinite(prev) && prev >= lo && prev <= hi ? prev : Math.round(sp ? (sp.y + minTop) / 2 : minTop - 40);
    // 近すぎる・同じ高さのときも、母線は、元の記号の下端から FAN_MIN 以上、下に置く（記号の中や、縦線の逆向きにならないように）
    if (sp) busY = Math.max(busY, sp.y + FAN_MIN);
    const xs = members.map((m) => m.x);
    const x0 = Math.min(...xs, ...(sp ? [sp.x] : []));
    const x1 = Math.max(...xs, ...(sp ? [sp.x] : []));
    if (trunk && sp && srcCand) {
      patch.set(trunk.id, { ...trunk, x1: sp.x, y1: sp.y, x2: sp.x, y2: busY, at1: { item: srcCand.item, port: srcCand.port }, at2: undefined, fan: { id: fid, role: 'trunk', item: srcCand.item, port: srcCand.port } });
    }
    if (x1 - x0 > 0.5) {
      const b: DocWire = { kind: 'wire', id: bus?.id ?? freshIdIn(doc, 'wire'), x1: x0, y1: busY, x2: x1, y2: busY, at1: undefined, at2: undefined, fan: { id: fid, role: 'bus' }, ...(trunk?.dashed ? { dashed: true } : {}) };
      if (bus) patch.set(bus.id, b);
      else extra.push(b);
    } else if (bus) drop.add(bus.id);
    for (const m of members) {
      patch.set(m.w.id, { ...m.w, x1: m.x, y1: busY, x2: m.x, y2: m.y, at1: undefined, at2: { item: m.item, port: m.port }, fan: { id: fid, role: 'drop', item: m.item, port: m.port } });
    }
  }
  return {
    ...doc,
    items: [...doc.items.filter((it) => !drop.has(it.id)).map((it) => patch.get(it.id) ?? it), ...extra],
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

  const rb = rotatedBox(defOf(parent).box, parent.rotate);
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
/**
 * 要素を動かす（つないである線の結び直しは、しない）。moveItem と moveItems が使う。
 * 動かしたあとに、結線を、つなぎ先の記号に合わせる処理が必要
 */
function shiftItem(doc: Doc, id: string, dx: number, dy: number): { doc: Doc; wire: boolean; covered: Set<string>; wires: Set<string> } {
  const target = doc.items.find((it) => it.id === id);
  if (!target) return { doc, wire: false, covered: new Set(), wires: new Set() };

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

  return { doc: moved, wire: target.kind === 'wire', covered: moving, wires: follow.wires };
}

export const moveItem = (doc: Doc, id: string, dx: number, dy: number): Doc => {
  if (dx === 0 && dy === 0) return doc;
  const r = shiftItem(doc, id, dx, dy);
  if (r.doc === doc) return doc;
  // 線を動かしたときだけ、行き先の接続点に結び直す
  return r.wire ? tidyDoc(r.doc) : applyAnchors(r.doc);
};

/**
 * 選んでいる複数の要素を、まとめて動かす。
 * - 記号・文字・枠は、それぞれ、1つずつ動かすのと同じ動かし方（つないである線は、伸び縮みしてついていく）。
 *   PASなどの内蔵品は、親の記号と一緒に選ばれているときは、親と一緒に動く（二重に動かさない）
 * - 選ばれている線は、記号と一緒に平行に動かす。つないである端は、動かしたあとに、つなぎ先の接続点に合わせ直す
 *   （つなぎ先が選ばれていなければ、つなぎ先は動かず、線が伸び縮みする）
 */
export const moveItems = (doc: Doc, ids: string[], dx: number, dy: number): Doc => {
  if (dx === 0 && dy === 0) return doc;
  const picked = new Set(ids);
  // 記号・文字・枠は、まず、位置だけを動かす（つないである線の結び直しは、全部動かしたあとに、1回だけ行う）。
  // 親の記号（PASなど）と一緒に動くもの（内蔵品・付属のGR・DGRと、その線）は、二度動かさない
  let cur: Doc = doc;
  const done = new Set<string>();
  const doneWires = new Set<string>();
  for (const id of ids) {
    const it = cur.items.find((x) => x.id === id);
    if (!it || it.kind === 'wire' || done.has(id)) continue;
    const root = groupRootOf(cur, id);
    if (root !== id && picked.has(root)) continue;
    const r = shiftItem(cur, id, dx, dy);
    cur = r.doc;
    for (const c of r.covered) done.add(c);
    for (const w of r.wires) doneWires.add(w);
  }
  // 選ばれている線も、記号と同じだけ平行に動かす（縦・横の向きは、そのまま）。
  // つないである端は、最後に、つなぎ先の接続点にぴったり合わせ直す（つなぎ先も動いていれば、ついていく）
  cur = {
    ...cur,
    items: cur.items.map((it) =>
      it.kind === 'wire' && picked.has(it.id) && !doneWires.has(it.id) ? { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy } : it,
    ),
  };
  return applyAnchors(cur);
};

/** 選んでいる複数の要素を、まとめて消す */
export const removeItems = (doc: Doc, ids: string[]): Doc => {
  let cur = doc;
  // 記号を先に消し、そのあとで、選ばれている線を消す（記号を消すと、つないであった線が、つなぎ先を失った印になる）
  const order = [...ids].sort((a, b) => Number(cur.items.find((x) => x.id === a)?.kind === 'wire') - Number(cur.items.find((x) => x.id === b)?.kind === 'wire'));
  const picked = new Set(ids);
  for (const id of order) {
    if (!cur.items.some((x) => x.id === id)) continue;
    // 選んだ線も一緒に消すときは、その線を、つなぎ直さない（利用者が、消すと決めた線）
    const noHeal = cur.items.some((x) => x.kind === 'wire' && picked.has(x.id) && ((x.at1 && x.at1.item === id) || (x.at2 && x.at2.item === id)));
    cur = removeItem(cur, id, { noHeal });
  }
  return cur;
};

/**
 * ドラッグで囲んだ範囲（図面の座標）の中に、まるごと入っている要素を選ぶ。
 * 内蔵品のある記号（PAS）は、かたまりのすべてが範囲に入っているときだけ、かたまりごと選ぶ（内蔵品だけは選ばない）。
 */
export function itemsInRange(doc: Doc, r: { x0: number; y0: number; x1: number; y1: number }): string[] {
  const inside = (it: DocItem) => {
    const b = itemBounds(it);
    return b.x0 >= r.x0 && b.y0 >= r.y0 && b.x1 <= r.x1 && b.y1 <= r.y1;
  };
  const insideIds = new Set(doc.items.filter(inside).map((it) => it.id));
  const out: string[] = [];
  for (const it of doc.items) {
    if (!insideIds.has(it.id)) continue;
    const root = groupRootOf(doc, it.id);
    if (root === it.id) {
      // かたまりの親は、内蔵品もすべて範囲に入っているときだけ
      if (groupOf(doc, it.id).every((g) => insideIds.has(g))) out.push(it.id);
    }
  }
  return out;
}

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
  opts: { assist?: boolean; range?: number; dashed?: boolean } = {},
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
  const id = freshIdIn(doc, 'wire');
  return {
    doc: tidyDoc({ ...doc, items: [...doc.items, { kind: 'wire', id, x1: ax, y1: ay, x2: bx, y2: by, ...(opts.dashed ? { dashed: true } : {}) }] }),
    id,
  };
};

/** 要素を消す。記号を消すと、内蔵しているものも一緒に消える */
/**
 * 区分開閉器の「制御線」（内蔵機器・継電器へ向かう線、その途中の曲がり角の線）を見つける（第20弾 項目6）。
 * members の記号につながっている線から、つなぎ先の無い端どうしがつながっている線をたどる。
 * 外の記号（members・継電器以外）につながっている線は、対象にしない（区分開閉器の上下の主回路の線など）。
 * allowRelays が true のときは、members から線でつながっている継電器（GR・DGR）も、仲間として見つけて返す。
 */
export function controlNet(doc: Doc, members: Set<string>, allowRelays: boolean): { wires: Set<string>; relays: Set<string> } {
  const wires = doc.items.filter((w): w is DocWire => w.kind === 'wire');
  const isRelay = (id: string) => doc.items.some((i) => i.kind === 'symbol' && i.id === id && /^relay-(gr|dgr)$/.test(i.symbolId));
  const relays = new Set<string>();
  // 継電器を見つける：members の記号から、線で直接つながっている継電器（途中の曲がり角の線は、あとでたどる）
  const ends = (w: DocWire) => [[w.at1, w.x1, w.y1], [w.at2, w.x2, w.y2]] as const;
  const near = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01;
  const known = (id: string) => members.has(id) || relays.has(id);
  const outside = (w: DocWire) => [w.at1, w.at2].some((a) => a && !known(a.item));
  const own = new Set<string>();
  const queue: DocWire[] = [];
  const take = (w: DocWire) => {
    if (own.has(w.id)) return;
    own.add(w.id);
    queue.push(w);
  };
  if (allowRelays) {
    // 区分開閉器の内蔵機器とつながる線をたどり、その先の継電器を、仲間に入れる
    let grew = true;
    const seen = new Set<string>();
    const net: DocWire[] = [];
    const q2: DocWire[] = wires.filter((w) => [w.at1, w.at2].some((a) => a && members.has(a.item)));
    while (q2.length > 0) {
      const w = q2.pop()!;
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      net.push(w);
      for (const o of wires) {
        if (seen.has(o.id)) continue;
        if (ends(w).some(([a, x, y]) => !a && ends(o).some(([b, ox, oy]) => !b && near(x, y, ox, oy)))) q2.push(o);
      }
    }
    while (grew) {
      grew = false;
      for (const w of net) for (const a of [w.at1, w.at2]) if (a && !members.has(a.item) && isRelay(a.item) && !relays.has(a.item)) { relays.add(a.item); grew = true; }
    }
  }
  for (const w of wires) {
    if (outside(w)) continue;
    const a1 = !!w.at1 && known(w.at1.item);
    const a2 = !!w.at2 && known(w.at2.item);
    if ((a1 && a2) || (a1 && !w.at2) || (a2 && !w.at1)) take(w);
  }
  while (queue.length > 0) {
    const w = queue.pop()!;
    for (const o of wires) {
      if (own.has(o.id) || outside(o)) continue;
      // つなぎ先の無い端どうしが、同じ点にあるときだけ
      if (ends(w).some(([a, x, y]) => !a && ends(o).some(([b, ox, oy]) => !b && near(x, y, ox, oy)))) take(o);
    }
  }
  return { wires: own, relays };
}

export const removeItem = (doc: Doc, id: string, opts: { noHeal?: boolean } = {}): Doc => {
  // 「結線」の下の機器を消すとき：その機器の下に、つながる記号が1つだけあれば、母線から、その記号へ付け替える。
  // 下に何も無い（または、枝分かれしている）ときは、母線からの縦線ごと消す（上下のつなぎ直しはしない）
  const dropW = doc.items.find((w): w is DocWire => w.kind === 'wire' && w.fan?.role === 'drop' && w.at2?.item === id);
  if (dropW) {
    const below = doc.items.filter((w): w is DocWire => w.kind === 'wire' && !w.fan && ((w.at1?.item === id) !== (w.at2?.item === id)));
    const far = below.length === 1 ? (below[0]!.at1?.item === id ? below[0]!.at2 : below[0]!.at1) : undefined;
    if (far && far.item !== id && doc.items.some((i) => i.id === far.item && i.kind === 'symbol') && !below[0]!.dashed) {
      doc = {
        ...doc,
        items: doc.items
          .filter((w) => w.id !== below[0]!.id)
          .map((w) => (w.id === dropW.id ? ({ ...dropW, at2: { ...far }, fan: { ...dropW.fan!, item: far.item, port: far.port } } as DocWire) : w)),
      };
    }
    opts = { ...opts, noHeal: true };
  }
  // 消す前に、上下の線を1本につなぐ（鎖の端なら、行き止まりの線も消す）（第13弾 項目55 修正18／B-10）
  if (!opts.noHeal) doc = healBeforeRemove(doc, id);
  const gone = new Set(groupOf(doc, id));
  // 消す記号（と文字）が占めていた高さを覚えておく。あとで、ここに残った余白を詰める
  const freed: { y0: number; y1: number; x0: number; x1: number }[] = [];
  for (const it of doc.items) {
    if (it.kind !== 'symbol' || !gone.has(it.id)) continue;
    const rb = rotatedBox(defOf(it).box, it.rotate);
    let y0 = it.y + rb.dy;
    let y1 = it.y + rb.dy + rb.h;
    if (it.label.length > 0) {
      const r = labelRect({ x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor }, it.label);
      y0 = Math.min(y0, r.y0);
      y1 = Math.max(y1, r.y1);
    }
    freed.push({ y0, y1, x0: it.x + rb.dx, x1: it.x + rb.dx + rb.w });
  }
  // 「区分開閉器」リストで足したセット（区分開閉器＋内蔵機器＋継電器）を消すとき：継電器へ向かう制御線・内蔵機器への枝線も、一緒に消す
  // （第20弾 項目6）。継電器が子になっているもの（セット）だけ。自動作図の区分開閉器は、これまでどおり
  const isSet = doc.items.some((i) => i.kind === 'symbol' && gone.has(i.id) && i.parent === id && !i.slot && /^relay-(gr|dgr)$/.test(i.symbolId));
  const own = isSet ? controlNet(doc, gone, false).wires : new Set<string>();
  return refreshFans({
    ...doc,
    ...(freed.length > 0 ? { vacated: [...(doc.vacated ?? []), ...freed] } : {}),
    items: doc.items
      .filter((it) => !gone.has(it.id) && !own.has(it.id))
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
            const rb = rotatedBox(defOf(o).box, o.rotate);
            return x > o.x + rb.dx && x < o.x + rb.dx + rb.w && y > o.y + rb.dy && y < o.y + rb.dy + rb.h;
          });
        const e1 = !it.at1 && inGone(it.x1, it.y1);
        const e2 = !it.at2 && inGone(it.x2, it.y2);
        if (!a1 && !a2 && !e1 && !e2) return it;
        return { ...it, at1: a1 ? undefined : it.at1, at2: a2 ? undefined : it.at2, orphan: true };
      }),
  });
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
    // スロットの無い子（「区分開閉器」リストで足したセットの継電器）は、置き直さず、そのまま残す
    if (!it.slot) continue;
    const slot = newDef.slots?.find((s2) => s2.id === it.slot);
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
  const id = freshIdIn(doc, 'sym');
  const item: DocSymbol = {
    kind: 'symbol',
    id,
    symbolId,
    x: snap(x - def.box.w / 2),
    y: snap(y - def.box.h / 2),
    rotate: 0,
    ...labelFromFields(def),
    // 本体の枠（labelBody）があれば、その真横に、枠の上の辺へ文字の上端をそろえる
    labelDx: sideLabelOrigin(def, 'right', 10, LABEL_FONT * 0.85).x,
    labelDy: sideLabelOrigin(def, 'right', 10, LABEL_FONT * 0.85).y,
    labelAnchor: 'start',
  };
  return { doc: { ...doc, items: [...doc.items, item] }, id };
};

export const addText = (doc: Doc, x: number, y: number, text: string): { doc: Doc; id: string } => {
  const id = freshIdIn(doc, 'text');
  return { doc: { ...doc, items: [...doc.items, { kind: 'text', id, x, y, lines: text.split('\n'), anchor: 'start' }] }, id };
};

/** 自動で作る枠（「コ」の字）の、両端の縦線の長さと、幅を変えられる範囲 */
export const FRAME_H = 26;
export const FRAME_W_RANGE: SizeRange = { min: 60, max: 1200, step: 10 };

/** 図面の上で、端や角をつかんで大きさを変えられる要素の、いまの範囲と、変えられる向き・範囲 */
export interface ResizeInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 幅を変えられるか／高さを変えられるか */
  w2: SizeRange | null;
  h2: SizeRange | null;
}

/**
 * つかんで大きさを変えられる要素なら、その情報を返す（変えられなければ null）。
 * 記号は、回していない（0°）ものだけ。回していると、つかむ向きが分かりにくいので、変えられない
 */
export function resizeInfoOf(it: DocItem): ResizeInfo | null {
  // 自動で作った枠（「コ」の字）：幅だけ、左右の端をつかんで変えられる（外箱と同じ）
  if (it.kind === 'frame') return { x: it.x, y: it.y, w: it.w, h: FRAME_H, w2: FRAME_W_RANGE, h2: null };
  if (it.kind !== 'symbol') return null;
  const def = getSymbol(it.symbolId);
  if (!def.resizable || (it.rotate % 360) !== 0) return null;
  const now = clampSize(def, it);
  return { x: it.x, y: it.y, w: now.w, h: now.h, w2: def.resizable.w ?? null, h2: def.resizable.h ?? null };
}

/**
 * つかんで変えた結果（左上の位置と大きさ）を、図面に入れる。大きさは、変えられる範囲に収める。
 * 変えられない向きは、そのまま。もとの大きさと同じなら、大きさの値は持たない
 */
export const setItemRect = (doc: Doc, id: string, rect: { x: number; y: number; w: number; h: number }): Doc => ({
  ...doc,
  items: doc.items.map((it) => {
    if (it.kind === 'frame' && it.id === id) {
      const r = FRAME_W_RANGE;
      return { ...it, x: rect.x, w: Math.max(r.min, Math.min(r.max, rect.w)) };
    }
    if (it.kind !== 'symbol' || it.id !== id) return it;
    const info = resizeInfoOf(it);
    if (!info) return it;
    const def = getSymbol(it.symbolId);
    const next = clampSize(def, { w: info.w2 ? rect.w : info.w, h: info.h2 ? rect.h : info.h });
    const { w: _w, h: _h, ...rest } = it;
    return {
      ...rest,
      // 右端・下端をつかんだときは、左上は動かさない。左端・上端をつかんだときは、反対側を動かさない
      x: info.w2 ? rect.x : it.x,
      y: info.h2 ? rect.y : it.y,
      ...(next.w !== def.box.w ? { w: next.w } : {}),
      ...(next.h !== def.box.h ? { h: next.h } : {}),
    };
  }),
});

/** 選んだ線の種類を、実線／点線に変える（線以外は、そのまま） */
export const setWireKind = (doc: Doc, ids: string[], dashed: boolean): Doc => ({
  ...doc,
  items: doc.items.map((it) => {
    if (it.kind !== 'wire' || !ids.includes(it.id)) return it;
    if (dashed) return { ...it, dashed: true };
    const { dashed: _off, ...rest } = it;
    return rest;
  }),
});

/** 手で足した文字（メモ）の、大きさ・太字を変える。大きさは、1〜5倍の範囲に収める */
export const setTextStyle = (doc: Doc, id: string, patch: { size?: number; bold?: boolean }): Doc => ({
  ...doc,
  items: doc.items.map((it) => {
    if (it.kind !== 'text' || it.id !== id) return it;
    const next: DocText = { ...it };
    if (patch.size !== undefined) next.size = clampTextSize(patch.size);
    if (patch.bold !== undefined) {
      if (patch.bold) next.bold = true;
      else delete next.bold;
    }
    return next;
  }),
});

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

/**
 * 接地のマークをつなぐ場所の候補。近くの「記号の接続点」か「線（母線など）の途中」だけに吸い寄せる
 * （枠の端・記号の形の端などには、つなげない）。近くに何も無ければ null。
 * 線の途中は、線の方向に格子に合わせた位置を取り、線からずれないようにする（assistPoint と同じ）。
 */
export function assistGroundPoint(
  doc: Doc,
  x: number,
  y: number,
  range = ASSIST_RANGE,
): { x: number; y: number; anchor: GroundAnchor } | null {
  const port = nearestPort(doc, x, y, range);
  if (port) return { x: port.x, y: port.y, anchor: { kind: 'port', item: sameName(port.item), port: port.port } };
  let best: { x: number; y: number; anchor: GroundAnchor } | null = null;
  let bestD = range;
  for (const it of doc.items) {
    if (it.kind !== 'wire') continue;
    const vertical = isVerticalWire(it);
    const a0 = vertical ? it.y1 : it.x1;
    const a1 = vertical ? it.y2 : it.x2;
    if (Math.abs(a1 - a0) < 0.01) continue;
    const along = Math.max(Math.min(a0, a1), Math.min(Math.max(a0, a1), snap(vertical ? y : x)));
    const px = vertical ? it.x1 : along;
    const py = vertical ? along : it.y1;
    const d = Math.hypot(px - x, py - y);
    if (d <= bestD) {
      bestD = d;
      const key = wireKey(it);
      best = { x: px, y: py, anchor: { kind: 'wire', ...(key ? { key } : {}), id: it.id, t: (along - a0) / (a1 - a0) } };
    }
  }
  return best;
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
    const k = clampTextSize(it.size);
    const w = labelWidth(it.lines, LABEL_FONT * k);
    return { x0: it.x, y0: it.y - LABEL_FONT * k, x1: it.x + w, y1: it.y + it.lines.length * LABEL_LINE * k };
  }
  const def = defOf(it);
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
