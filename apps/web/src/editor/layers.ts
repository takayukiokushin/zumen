import { ARROW_LABEL_DEFAULT, AREA_KINDS, FIXED_LAYERS, MAX_CUSTOM_LAYERS, MAX_LAYER_ITEMS_PER_KIND, MAX_TEXT_LENGTH, isFixedLayerId } from '@zumen/knowledge';
import type { AreaKindDef } from '@zumen/knowledge';
import type { Orientation } from '@zumen/layout';
import { CROSS_SPECS, GROUND_HALF_WIDTH, GROUND_LEAD_DEFAULT, clampDrop, clampLead, clampTextSize, groundBounds, groundFromTip, groundLabelBounds, labelRect, labelWidth, rotatedBox, rotatedPort } from '@zumen/layout';
import { AREA_MIN, ARROW_DIR_DEFAULT, ARROW_LEN_DEFAULT, arrowFromTail, clampArrowLen } from '@zumen/layout';
import type { AreaLabel, AreaLabelPos, AreaRect, ArrowDir, ArrowLabel, CrossSize, GroundLabel } from '@zumen/layout';
import { assistGroundPoint, defOf, freshId, portsOf, sameName, wireKey } from './doc.ts';
import type { Doc, DocSymbol, DocText } from './doc.ts';

/**
 * 図面のレイヤー（停電範囲図・絶縁耐力試験範囲図・追加したレイヤー）。
 *
 * レイヤーに置くもの（赤い×印・接地・枠など）は、元の図面（Doc.items）とは別に、レイヤーごとに持つ。
 * そのため、レイヤーを使わない図面は、これまでと1文字も変わらない。
 * 固定の2つは、何か置いたとき（向きを決めたときなど）に、初めて記録ができる。追加したレイヤーは、作ったときから記録がある。
 */

/**
 * レイヤーに置いた文字（テキストボックス）。
 * 近くの機器（near）からのずれ（ndx・ndy）で覚えるので、その機器が動けば、一緒に動く。
 * 機器が無くなったときは、文字は消さずに、最後に置いた場所（x・y）に残す（書いた内容が、気づかないうちに消えないように）。
 */
export interface LayerText {
  kind: 'text';
  id: string;
  /** 最後に置いた場所（近くの機器が見つからないときに使う） */
  x: number;
  y: number;
  lines: string[];
  anchor: 'start' | 'middle' | 'end';
  /** 文字の大きさ（記号の横の文字を1倍とした倍率）。無ければ1倍 */
  size?: number;
  bold?: boolean;
  /** 赤い文字か。レイヤーに置く文字は、ふつう赤 */
  red?: boolean;
  /** 近くの機器と、そこからのずれ */
  near?: string;
  ndx: number;
  ndy: number;
}

/**
 * レイヤーに置いた、開放の赤い×印。
 * 付けた開閉器（target）に付いて、その機器が動けば、一緒に動く。その機器が無くなったら、×印も消える
 * （画面にも印刷にも出さず、保存するときに、データからも外す）。
 */
export interface LayerCross {
  kind: 'cross';
  id: string;
  /** 付けた開閉器の id（sameName） */
  target: string;
  /** 大きさ（小・中・大）。形と寸法は packages/layout/src/cross.ts */
  size: CrossSize;
  /** 開閉器の中央からのずれ（図面の座標）。無ければ、中央。ずらしても、付けた開閉器について動く */
  dx?: number;
  dy?: number;
}

/** 接地のマークをつなぐ場所：記号の接続点、または、線（母線など）の途中 */
export type GroundAnchor =
  | { kind: 'port'; item: string; port: string }
  /** 線の途中。線は、両端が記号につながっていれば、その印（key）で探し、無ければ id で探す。t は、始点から終点までの割合（0〜1） */
  | { kind: 'wire'; key?: string; id?: string; t: number };

/**
 * レイヤーに置いた、赤い接地のマーク（短絡接地器具を取り付ける場所）。
 * つなぐ場所（anchor：母線の途中・記号の接続点）から、横棒（lead）と縦の線（drop）を引いて、下向きのマークを付ける
 * （形は packages/layout/src/ground.ts）。つないだ母線・記号が動けば、一緒に動く。
 * つないだ母線・記号が無くなったら、接地のマークも消える（画面にも印刷にも出さず、保存するときに、データからも外す）。
 * 横に、番号・回路名などの文字（label）を、任意で付けられる（大きさ・太字は、テキストボックスと同じ。色は、いつも接地のマークと同じ赤）。
 *
 * anchor が無いのは、古い版のデータ（置いた場所と近くの機器だけを覚えたもの）。横棒なし・縦10のマークとして出す。
 */
export interface LayerGround {
  kind: 'ground';
  id: string;
  anchor?: GroundAnchor;
  /** 横棒の長さ（右が正・左が負）。0 または無ければ、横棒なし */
  lead?: number;
  /** つなぐ場所から、マークまでの縦の長さ */
  drop?: number;
  /** 横に付ける文字（1行ずつ） */
  label?: string[];
  size?: number;
  bold?: boolean;
  /** 古い版のデータ：置いた場所と、近くの機器からのずれ */
  x?: number;
  y?: number;
  rotate?: number;
  near?: string;
  ndx?: number;
  ndy?: number;
}

/**
 * レイヤーに置いた、赤い枠（範囲を囲む四角）。停電範囲・充電範囲（斜線つき）・印加範囲など。
 * 左上の位置を、近くの機器（near）からのずれで覚えるので、その機器が動けば、位置は一緒に動く（大きさは、自動では変わらない）。
 * 機器が無くなっても、枠は消さずに、最後に置いた場所（x・y）に残す（複数の機器を囲む枠が、1台を消しただけで消えないように）。
 * 近くに、文字（label）を、任意で付けられる。斜線（hatch）は、充電範囲の枠に入れる。
 */
export interface LayerArea {
  kind: 'area';
  id: string;
  /** 左上の、最後に置いた場所と、大きさ */
  x: number;
  y: number;
  w: number;
  h: number;
  near?: string;
  ndx: number;
  ndy: number;
  hatch?: boolean;
  label?: string[];
  size?: number;
  bold?: boolean;
  /** 文字を書く位置（枠の四隅の外側）。無ければ、左上 */
  labelPos?: AreaLabelPos;
}

/**
 * レイヤーに置いた、赤い丸い点。母線（線）の途中や記号の接続点の近くに置くと、そこに吸い付く（anchor）。
 * どこにも吸い付かないときは、近くの機器（near）からのずれ（ndx・ndy）で覚える。
 * 吸い付いた先・近くの機器が無くなったら、点も消える（画面にも印刷にも出さず、保存するときに、データからも外す）。
 */
export interface LayerDot {
  kind: 'dot';
  id: string;
  anchor?: GroundAnchor;
  /** 最後に置いた場所（吸い付いていないときの、機器が無いときの置き場所） */
  x: number;
  y: number;
  near?: string;
  ndx: number;
  ndy: number;
}

/**
 * レイヤーに置いた、印加点の矢印。丸い点（dot）を指す。1つの点に、1本まで。
 * 尾の向き（dir：8方向）と長さ（len）を持ち、尾の側に文字（label。最初は「印加点」）を付ける。
 * 指している点が無くなったら、矢印も消える。
 */
export interface LayerArrow {
  kind: 'arrow';
  id: string;
  /** 指している丸い点の id */
  dot: string;
  dir?: ArrowDir;
  len?: number;
  label?: string[];
  size?: number;
  bold?: boolean;
}

/** レイヤーに置くもの。渡り線などの種類は、これから足していく */
export type LayerItem = LayerText | LayerCross | LayerGround | LayerArea | LayerDot | LayerArrow;

export interface Layer {
  /** 固定のレイヤーは 'outage'・'withstand'。追加したものは 'custom-1' など */
  id: string;
  /** 追加したレイヤーの名前（固定のレイヤーは、名前を持たない） */
  name?: string;
  /** このレイヤーに置いたもの */
  items: LayerItem[];
  /** このレイヤーを印刷するときの向き。無ければ、図面の形に合わせて自動で決まる */
  orientation?: Orientation;
}

/** 画面の一覧に出すための、レイヤーの情報 */
export interface LayerInfo {
  id: string;
  /** 印刷のタイトルに入る名前 */
  title: string;
  /** 固定のレイヤーか（名前の変更・削除ができない） */
  fixed: boolean;
}

export const layersOf = (doc: Doc): Layer[] => (Array.isArray(doc.layers) ? doc.layers : []);

export const layerOf = (doc: Doc, id: string): Layer | undefined => layersOf(doc).find((l) => l.id === id);

/** 一覧に出すレイヤー：固定の2つ → 追加した順 */
export function layerInfos(doc: Doc): LayerInfo[] {
  const custom = layersOf(doc)
    .filter((l) => !isFixedLayerId(l.id))
    .map((l): LayerInfo => ({ id: l.id, title: l.name ?? '', fixed: false }));
  return [...FIXED_LAYERS.map((f): LayerInfo => ({ id: f.id, title: f.title, fixed: true })), ...custom];
}

/** 印刷のタイトルに入る、そのレイヤーの名前。知らないレイヤーは null */
export const layerTitle = (doc: Doc, id: string): string | null => layerInfos(doc).find((l) => l.id === id)?.title ?? null;

/** 追加したレイヤーの数 */
export const customCount = (doc: Doc): number => layersOf(doc).filter((l) => !isFixedLayerId(l.id)).length;

/** 名前に問題があるときの、画面の言葉の鍵（問題なければ null） */
export type LayerNameProblem = 'layer.err.empty' | 'layer.err.tooLong' | 'layer.err.taken';

/** 名前が使えるか。固定のレイヤーの名前や、すでにある名前とは重ねない（exceptId は、名前を変えるレイヤー自身） */
export function layerNameProblem(doc: Doc, name: string, exceptId?: string): LayerNameProblem | null {
  const n = name.trim();
  if (n === '') return 'layer.err.empty';
  if (n.length > MAX_TEXT_LENGTH) return 'layer.err.tooLong';
  if (layerInfos(doc).some((l) => l.id !== exceptId && l.title.trim() === n)) return 'layer.err.taken';
  return null;
}

/** 追加したレイヤーの、まだ使っていない id */
function freshCustomId(doc: Doc): string {
  const taken = new Set(layersOf(doc).map((l) => l.id));
  for (let i = 1; ; i++) if (!taken.has(`custom-${i}`)) return `custom-${i}`;
}

/** レイヤーを1つ追加する。名前が使えない・上限を超えるときは null */
export function addLayer(doc: Doc, name: string): { doc: Doc; id: string } | null {
  if (customCount(doc) >= MAX_CUSTOM_LAYERS || layerNameProblem(doc, name)) return null;
  const id = freshCustomId(doc);
  return { doc: { ...doc, layers: [...layersOf(doc), { id, name: name.trim(), items: [] }] }, id };
}

/** 追加したレイヤーの名前を変える（固定のレイヤーは変えられない） */
export function renameLayer(doc: Doc, id: string, name: string): Doc | null {
  if (isFixedLayerId(id) || !layerOf(doc, id) || layerNameProblem(doc, name, id)) return null;
  return { ...doc, layers: layersOf(doc).map((l) => (l.id === id ? { ...l, name: name.trim() } : l)) };
}

/** 追加したレイヤーを消す。置いたものも一緒に消える（固定のレイヤーは消せない） */
export function removeLayer(doc: Doc, id: string): Doc | null {
  if (isFixedLayerId(id) || !layerOf(doc, id)) return null;
  return { ...doc, layers: layersOf(doc).filter((l) => l.id !== id) };
}

/** そのレイヤーを印刷するときの向きを決める。固定のレイヤーは、このとき初めて記録ができる */
export function setLayerOrientation(doc: Doc, id: string, orientation: Orientation): Doc {
  if (!layerInfos(doc).some((l) => l.id === id)) return doc;
  const has = !!layerOf(doc, id);
  const layers = has
    ? layersOf(doc).map((l) => (l.id === id ? { ...l, orientation } : l))
    : [...layersOf(doc), { id, items: [], orientation }];
  return { ...doc, layers };
}

/**
 * 元の図面を作り直した・戻したときに、レイヤーだけは、いまのものを引き継ぐ。
 * 「操作を戻す」の履歴は、元の図面だけのもの（レイヤーを、昔の状態に戻してはいけない）
 */
export function carryLayers(next: Doc, from: Doc): Doc {
  const { layers: _drop, ...rest } = next;
  return from.layers !== undefined ? { ...rest, layers: from.layers } : rest;
}

/* ---------------- レイヤーに置いた文字 ---------------- */

/** 近くの機器と、そこからのずれ。近くに機器が無ければ、場所だけで覚える */
function anchorFor(doc: Doc, x: number, y: number): Pick<LayerText, 'near' | 'ndx' | 'ndy'> {
  let best: { id: string; d: number; sx: number; sy: number } | null = null;
  for (const it of doc.items) {
    if (it.kind !== 'symbol') continue;
    const def = defOf(it);
    const d = Math.hypot(it.x + def.box.w / 2 - x, it.y + def.box.h / 2 - y);
    if (!best || d < best.d) best = { id: sameName(it.id), d, sx: it.x, sy: it.y };
  }
  if (best && best.d < 400) return { near: best.id, ndx: x - best.sx, ndy: y - best.sy };
  return { ndx: x, ndy: y };
}

/** いまの場所。近くの機器があれば、その機器の位置からのずれ。機器が無くなっていれば、最後に置いた場所 */
export function resolveText(doc: Doc, t: LayerText): { x: number; y: number } {
  if (t.near !== undefined) {
    for (const it of doc.items) {
      if (it.kind === 'symbol' && sameName(it.id) === t.near) return { x: it.x + t.ndx, y: it.y + t.ndy };
    }
  }
  return { x: t.x, y: t.y };
}

/** レイヤーに置いた文字を、図面の文字として使える形にする（画面と印刷で、元の図面の文字と同じように描くため） */
export function layerItemsAsDocItems(doc: Doc, layerId: string): DocText[] {
  return (layerOf(doc, layerId)?.items ?? []).filter((t): t is LayerText => t.kind === 'text').map((t): DocText => {
    const { x, y } = resolveText(doc, t);
    return {
      kind: 'text',
      id: t.id,
      x,
      y,
      lines: t.lines,
      anchor: t.anchor,
      ...(t.size !== undefined ? { size: t.size } : {}),
      ...(t.bold ? { bold: true } : {}),
      ...(t.red ? { red: true } : {}),
    };
  });
}

/** そのレイヤーに、置いたものを入れ替える（固定のレイヤーは、このとき初めて記録ができる） */
export function setLayerItems(doc: Doc, layerId: string, items: LayerItem[]): Doc {
  if (!layerInfos(doc).some((l) => l.id === layerId)) return doc;
  const has = !!layerOf(doc, layerId);
  const layers = has
    ? layersOf(doc).map((l) => (l.id === layerId ? { ...l, items } : l))
    : [...layersOf(doc), { id: layerId, items }];
  return { ...doc, layers };
}

/** 文字を足せるか（1つのレイヤーに置ける数には、上限がある） */
export const canAddLayerText = (doc: Doc, layerId: string): boolean =>
  (layerOf(doc, layerId)?.items ?? []).filter((i) => i.kind === 'text').length < MAX_LAYER_ITEMS_PER_KIND;

/** ×印を足せるか（1つのレイヤーに置ける数には、上限がある） */
export const canAddLayerCross = (doc: Doc, layerId: string): boolean =>
  (layerOf(doc, layerId)?.items ?? []).filter((i) => i.kind === 'cross').length < MAX_LAYER_ITEMS_PER_KIND;

/** レイヤーに文字を足す。上限を超えるときは null。置く場所の近くの機器を覚える */
export function addLayerText(doc: Doc, layerId: string, x: number, y: number, text: string, red = true): { doc: Doc; id: string } | null {
  if (!layerInfos(doc).some((l) => l.id === layerId) || !canAddLayerText(doc, layerId)) return null;
  const items = layerOf(doc, layerId)?.items ?? [];
  const id = freshId('ltext', new Set(items.map((i) => i.id)));
  const t: LayerText = { kind: 'text', id, x, y, lines: text.split('\n'), anchor: 'start', ...(red ? { red: true } : {}), ...anchorFor(doc, x, y) };
  return { doc: setLayerItems(doc, layerId, [...items, t]), id };
}

/** 文字の中身・大きさ・太字・色を変える */
export function updateLayerText(doc: Doc, layerId: string, id: string, patch: { lines?: string[]; size?: number; bold?: boolean; red?: boolean }): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((t) => {
      if (t.kind !== 'text' || t.id !== id) return t;
      const n: LayerText = { ...t };
      if (patch.lines !== undefined) n.lines = patch.lines;
      if (patch.size !== undefined) n.size = clampTextSize(patch.size);
      if (patch.bold !== undefined) {
        if (patch.bold) n.bold = true;
        else delete n.bold;
      }
      if (patch.red !== undefined) {
        if (patch.red) n.red = true;
        else delete n.red;
      }
      return n;
    }),
  );
}

/** 置いたものを動かす（動かしたあとの場所の近くの機器から、覚え直す） */
export function moveLayerItems(doc: Doc, layerId: string, ids: string[], dx: number, dy: number): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((t) => {
      // 動かせるのは文字だけ（×印・接地のマークは、つないだ開閉器・母線について動く）
      if (t.kind !== 'text' || !ids.includes(t.id)) return t;
      const p = resolveText(doc, t);
      const x = p.x + dx;
      const y = p.y + dy;
      return { ...t, x, y, ...anchorFor(doc, x, y) };
    }),
  );
}

/** 置いたものを消す */
export function removeLayerItems(doc: Doc, layerId: string, ids: string[]): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  // 丸い点を外したら、その点を指していた矢印も、一緒に外す
  const left = items.filter((t) => !ids.includes(t.id));
  return setLayerItems(doc, layerId, left.filter((t) => t.kind !== 'arrow' || !ids.includes(t.dot)));
}

/* ---------------- 開放の赤い×印 ---------------- */

/** ×印を付けられる開閉器か（記号の定義に、×印の位置が決めてあるもの） */
export const canMark = (sym: DocSymbol): boolean => defOf(sym).markCenter !== undefined;

/** ×印の中心（図面の座標）。PAS は外枠の中央、そのほかは記号の中央。記号を回していても、その位置に付く */
export function markPoint(sym: DocSymbol): { x: number; y: number } | null {
  const def = defOf(sym);
  if (!def.markCenter) return null;
  const [rx, ry] = rotatedPort(def.box, def.markCenter.x, def.markCenter.y, sym.rotate);
  return { x: sym.x + rx, y: sym.y + ry };
}

/** 画面と印刷に出す×印（付けた開閉器が図面にあるものだけ） */
export interface ResolvedCross {
  id: string;
  target: string;
  /** 付けた開閉器の、いまの id */
  symbolId: string;
  x: number;
  y: number;
  /** 一辺と太さ */
  size: number;
  thickness: number;
  sizeId: CrossSize;
  /** 開閉器の中央からのずれ（中央なら 0） */
  dx: number;
  dy: number;
}

const symbolByTarget = (doc: Doc, target: string): DocSymbol | undefined => {
  for (const it of doc.items) if (it.kind === 'symbol' && sameName(it.id) === target) return it;
  return undefined;
};

export function resolveCrosses(doc: Doc, layerId: string): ResolvedCross[] {
  const out: ResolvedCross[] = [];
  for (const c of layerOf(doc, layerId)?.items ?? []) {
    if (c.kind !== 'cross') continue;
    const sym = symbolByTarget(doc, c.target);
    const at = sym ? markPoint(sym) : null;
    if (!sym || !at) continue;
    const spec = CROSS_SPECS[c.size] ?? CROSS_SPECS.M;
    const dx = c.dx ?? 0;
    const dy = c.dy ?? 0;
    out.push({ id: c.id, target: c.target, symbolId: sym.id, x: at.x + dx, y: at.y + dy, size: spec.size, thickness: spec.thickness, sizeId: c.size, dx, dy });
  }
  return out;
}

/** ずらしていない（開閉器の中央にある）×印か */
const atCenter = (c: LayerCross): boolean => !c.dx && !c.dy;

/** その開閉器の中央に付いている×印（ずらした×印は含めない）。開閉器をクリックしたときに、付ける・外すのは、これ */
export const crossOn = (doc: Doc, layerId: string, symbolId: string): LayerCross | undefined => {
  const target = sameName(symbolId);
  return (layerOf(doc, layerId)?.items ?? []).find((i): i is LayerCross => i.kind === 'cross' && i.target === target && atCenter(i));
};

/** ずらした位置が、中央にこれより近ければ、中央に戻す（図面の座標。矢印キーの1回ぶんより小さい） */
export const CROSS_CENTER_SNAP = 3;

/** ×印を動かす（開閉器の中央からのずれを変える。中央の近くまで来たら、中央に戻る） */
export function moveLayerCrosses(doc: Doc, layerId: string, ids: string[], dx: number, dy: number): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return setLayerItems(
    doc,
    layerId,
    items.map((c) => {
      if (c.kind !== 'cross' || !ids.includes(c.id)) return c;
      const nx = r2((c.dx ?? 0) + dx);
      const ny = r2((c.dy ?? 0) + dy);
      const { dx: _x, dy: _y, ...rest } = c;
      return Math.abs(nx) < CROSS_CENTER_SNAP && Math.abs(ny) < CROSS_CENTER_SNAP ? rest : { ...rest, dx: nx, dy: ny };
    }),
  );
}

/** ×印を、開閉器の中央に戻す */
export function resetCross(doc: Doc, layerId: string, id: string): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((c) => {
      if (c.kind !== 'cross' || c.id !== id) return c;
      const { dx: _x, dy: _y, ...rest } = c;
      return rest;
    }),
  );
}

/** 選んだ×印と同じ開閉器・同じ大きさで、×印をもう1つ足す（右へ、重ならないだけずらして置く）。上限を超えるときは null */
export function addExtraCross(doc: Doc, layerId: string, fromId: string): { doc: Doc; id: string } | null {
  const items = layerOf(doc, layerId)?.items ?? [];
  const from = items.find((i): i is LayerCross => i.kind === 'cross' && i.id === fromId);
  if (!from || !canAddLayerCross(doc, layerId)) return null;
  const id = freshId('lcross', new Set(items.map((i) => i.id)));
  const shift = (CROSS_SPECS[from.size] ?? CROSS_SPECS.M).size + 8;
  const extra: LayerCross = { kind: 'cross', id, target: from.target, size: from.size, dx: (from.dx ?? 0) + shift, dy: from.dy ?? 0 };
  return { doc: setLayerItems(doc, layerId, [...items, extra]), id };
}

/** 開閉器の中央に×印を付ける。付けられない記号・上限を超えるとき・中央にすでに付いているときは null */
export function addLayerCross(doc: Doc, layerId: string, symbolId: string, size: CrossSize): { doc: Doc; id: string } | null {
  const sym = symbolByTarget(doc, sameName(symbolId));
  if (!sym || !canMark(sym) || !layerInfos(doc).some((l) => l.id === layerId)) return null;
  if (crossOn(doc, layerId, symbolId) || !canAddLayerCross(doc, layerId)) return null;
  const items = layerOf(doc, layerId)?.items ?? [];
  const id = freshId('lcross', new Set(items.map((i) => i.id)));
  return { doc: setLayerItems(doc, layerId, [...items, { kind: 'cross', id, target: sameName(symbolId), size }]), id };
}

/** ×印の大きさを変える */
export function setCrossSize(doc: Doc, layerId: string, id: string, size: CrossSize): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(doc, layerId, items.map((i) => (i.kind === 'cross' && i.id === id ? { ...i, size } : i)));
}

/**
 * 付けた開閉器・近くの機器が、図面から無くなった×印・接地のマークを、データから外す（保存するときに行う）。
 * それまでは、画面にも印刷にも出さずに、取っておく（「操作を戻す」で機器が戻れば、×印も戻るように）。
 */
export function purgeOrphanMarks(doc: Doc): Doc {
  if (!doc.layers) return doc;
  let changed = false;
  const layers = doc.layers.map((l) => {
    const items = l.items.filter((i) => {
      if (i.kind === 'cross') return symbolByTarget(doc, i.target) !== undefined;
      if (i.kind === 'ground') return resolveGroundPoint(doc, i) !== null;
      if (i.kind === 'dot') return resolveDotPoint(doc, i) !== null;
      return true;
    });
    // 点が無くなった矢印も、外す
    const dotIds = new Set(items.filter((i) => i.kind === 'dot').map((i) => i.id));
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k]!;
      if (it.kind === 'arrow' && !dotIds.has(it.dot)) items.splice(k, 1);
    }
    if (items.length === l.items.length) return l;
    changed = true;
    return { ...l, items };
  });
  return changed ? { ...doc, layers } : doc;
}

/* ---------------- 赤い接地のマーク ---------------- */

/** 古い版のデータの、縦の長さ */
const LEGACY_DROP = 10;

/** つなぐ場所の、いまの座標。つないだ記号・線が無くなっていれば null */
export function resolveGroundAnchor(doc: Doc, a: GroundAnchor): { x: number; y: number } | null {
  if (a.kind === 'port') {
    for (const it of doc.items) {
      if (it.kind === 'symbol' && sameName(it.id) === a.item) return portsOf(it).find((p) => p.id === a.port) ?? null;
    }
    return null;
  }
  const w = doc.items.find((it) => it.kind === 'wire' && ((a.key !== undefined && wireKey(it) === a.key) || (a.id !== undefined && it.id === a.id)));
  if (!w || w.kind !== 'wire') return null;
  return { x: w.x1 + (w.x2 - w.x1) * a.t, y: w.y1 + (w.y2 - w.y1) * a.t };
}

/** 接地のマークの、つなぐ場所。無くなっていれば null（出さない）。古い版のデータは、近くの機器からのずれで求める */
export function resolveGroundPoint(doc: Doc, g: LayerGround): { x: number; y: number } | null {
  if (g.anchor) return resolveGroundAnchor(doc, g.anchor);
  if (g.near !== undefined) {
    for (const it of doc.items) {
      if (it.kind === 'symbol' && sameName(it.id) === g.near) return { x: it.x + (g.ndx ?? 0), y: it.y + (g.ndy ?? 0) };
    }
    return null;
  }
  return { x: g.x ?? 0, y: g.y ?? 0 };
}

/** 画面と印刷に出す接地のマーク（つなぐ場所が図面にあるもの） */
export interface ResolvedGround {
  id: string;
  /** つなぐ場所 */
  x: number;
  y: number;
  lead: number;
  drop: number;
  label?: GroundLabel;
  /** 他の図記号にかかっているか（かかっていても置けるが、知らせる） */
  overlaps: boolean;
}

/** 文字の、見えている大きさの見積もり */
const widthOfLines = (lines: string[], size: number): number => labelWidth(lines, size);

/** 接地のマークの部品ごとの外形（横棒・縦の線・マーク・文字）。他の図記号にかかっているかの確認に使う */
function groundParts(g: Pick<ResolvedGround, 'x' | 'y' | 'lead' | 'drop' | 'label'>): { x0: number; y0: number; x1: number; y1: number }[] {
  const cx = g.x + g.lead;
  const all = groundBounds(g.x, g.y, g.lead, g.drop);
  const parts = [
    // 縦の線
    { x0: cx - 1, y0: g.y, x1: cx + 1, y1: g.y + g.drop },
    // マーク（3本の横線）
    { x0: cx - GROUND_HALF_WIDTH, y0: g.y + g.drop, x1: cx + GROUND_HALF_WIDTH, y1: all.y1 },
  ];
  if (g.lead !== 0) parts.push({ x0: Math.min(g.x, cx), y0: g.y - 1, x1: Math.max(g.x, cx), y1: g.y + 1 });
  const lb = groundLabelBounds(g.x, g.y, g.lead, g.drop, g.label, widthOfLines);
  if (lb) parts.push(lb);
  return parts;
}

/**
 * 他の図記号（記号の枠と、記号の横の文字）にかかっているか。つなぐ記号（接続点につないだとき）と、外枠（キュービクルなど）は、かかっていても気にしない。
 * 「かからないようにする」ための目安で、かかっていても置ける。
 */
export function groundOverlapsSymbols(doc: Doc, g: Pick<ResolvedGround, 'x' | 'y' | 'lead' | 'drop' | 'label'>, anchor: GroundAnchor | undefined): boolean {
  const parts = groundParts(g);
  const hit = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    parts.some((p) => p.x0 < b.x1 - 1 && p.x1 > b.x0 + 1 && p.y0 < b.y1 - 1 && p.y1 > b.y0 + 1);
  for (const it of doc.items) {
    if (it.kind !== 'symbol') continue;
    const def = defOf(it);
    if (def.category === 'enclosure') continue;
    if (anchor?.kind === 'port' && sameName(it.id) === anchor.item) continue;
    const rb = rotatedBox(def.box, it.rotate);
    if (hit({ x0: it.x + rb.dx, y0: it.y + rb.dy, x1: it.x + rb.dx + rb.w, y1: it.y + rb.dy + rb.h })) return true;
    if (it.label.length > 0 && hit(labelRect({ x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor }, it.label))) return true;
  }
  return false;
}

export function resolveGrounds(doc: Doc, layerId: string): ResolvedGround[] {
  const out: ResolvedGround[] = [];
  for (const g of layerOf(doc, layerId)?.items ?? []) {
    if (g.kind !== 'ground') continue;
    const at = resolveGroundPoint(doc, g);
    if (!at) continue;
    const lead = clampLead(g.lead ?? 0);
    const drop = clampDrop(g.drop ?? LEGACY_DROP);
    const label: GroundLabel | undefined =
      g.label && g.label.some((l) => l !== '')
        ? { lines: g.label, ...(g.size !== undefined ? { size: g.size } : {}), ...(g.bold ? { bold: true } : {}), red: true }
        : undefined;
    const r = { id: g.id, x: at.x, y: at.y, lead, drop, ...(label ? { label } : {}) };
    out.push({ ...r, overlaps: groundOverlapsSymbols(doc, r, g.anchor) });
  }
  return out;
}

/** 接地のマークを足せるか（1つのレイヤーに置ける数には、上限がある） */
export const canAddLayerGround = (doc: Doc, layerId: string): boolean =>
  (layerOf(doc, layerId)?.items ?? []).filter((i) => i.kind === 'ground').length < MAX_LAYER_ITEMS_PER_KIND;

/** つなぐ場所（anchor）と、マークを置く場所（縦の線の先 tx・ty）から、接地のマークを置く。つなぐ場所が無い・上限を超えるときは null */
export function addLayerGround(doc: Doc, layerId: string, anchor: GroundAnchor, tx: number, ty: number): { doc: Doc; id: string } | null {
  if (!layerInfos(doc).some((l) => l.id === layerId) || !canAddLayerGround(doc, layerId)) return null;
  const at = resolveGroundAnchor(doc, anchor);
  if (!at) return null;
  const { lead, drop } = groundFromTip(at.x, at.y, tx, ty);
  const items = layerOf(doc, layerId)?.items ?? [];
  const id = freshId('lground', new Set(items.map((i) => i.id)));
  const g: LayerGround = { kind: 'ground', id, anchor, ...(lead !== 0 ? { lead } : {}), drop };
  return { doc: setLayerItems(doc, layerId, [...items, g]), id };
}

/** 接地のマークを直す。横棒・縦の長さは、範囲に収める。つなぎ直し（anchor）は、つなぐ場所が見つかるときだけ。文字は、空にすると外れる */
export function editGround(
  doc: Doc,
  layerId: string,
  id: string,
  patch: { lead?: number; drop?: number; anchor?: GroundAnchor; label?: string[]; size?: number; bold?: boolean },
): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  if (patch.anchor && !resolveGroundAnchor(doc, patch.anchor)) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((g) => {
      if (g.kind !== 'ground' || g.id !== id) return g;
      const n: LayerGround = { ...g };
      // 古い版のデータは、新しい形に直す（つなぐ場所を、いまの位置で、近くの機器から決め直すことはしない。横棒・縦の長さだけ持たせる）
      if (patch.anchor) {
        n.anchor = patch.anchor;
        delete n.near;
        delete n.ndx;
        delete n.ndy;
        delete n.x;
        delete n.y;
        delete n.rotate;
      }
      if (patch.lead !== undefined) {
        const l = clampLead(patch.lead);
        if (l === 0) delete n.lead;
        else n.lead = l;
      }
      if (patch.drop !== undefined) n.drop = clampDrop(patch.drop);
      if (patch.label !== undefined) {
        if (patch.label.every((l) => l === '')) delete n.label;
        else n.label = patch.label;
      }
      if (patch.size !== undefined) n.size = clampTextSize(patch.size);
      if (patch.bold !== undefined) {
        if (patch.bold) n.bold = true;
        else delete n.bold;
      }
      return n;
    }),
  );
}

/** マークを置く場所（縦の線の先）を、図面の座標で指定して、横棒・縦の長さを決め直す（ドラッグ・矢印キーで動かしたとき） */
export function setGroundTip(doc: Doc, layerId: string, id: string, tx: number, ty: number): Doc {
  const g = resolveGrounds(doc, layerId).find((r) => r.id === id);
  if (!g) return doc;
  const { lead, drop } = groundFromTip(g.x, g.y, tx, ty);
  return editGround(doc, layerId, id, { lead, drop });
}

/** 横棒の向きを、左右反転する（横棒なしのときは、何もしない） */
export function flipGround(doc: Doc, layerId: string, id: string): Doc {
  const g = resolveGrounds(doc, layerId).find((r) => r.id === id);
  return g && g.lead !== 0 ? editGround(doc, layerId, id, { lead: -g.lead }) : doc;
}

/** 横棒を付ける（右へ、初めの長さで）／なくす */
export function toggleGroundLead(doc: Doc, layerId: string, id: string): Doc {
  const g = resolveGrounds(doc, layerId).find((r) => r.id === id);
  if (!g) return doc;
  return editGround(doc, layerId, id, { lead: g.lead === 0 ? GROUND_LEAD_DEFAULT : 0 });
}

/* ---------------- 赤い枠（範囲を囲む四角） ---------------- */

/** 画面と印刷に出す赤い枠（いまの位置と大きさ） */
export interface ResolvedArea extends AreaRect {
  id: string;
  hatch: boolean;
  label?: AreaLabel;
}

/** 枠の左上の、いまの位置。近くの機器があれば、その機器の位置からのずれ。機器が無くなっていれば、最後に置いた場所 */
function resolveAreaOrigin(doc: Doc, a: LayerArea): { x: number; y: number } {
  if (a.near !== undefined) {
    for (const it of doc.items) {
      if (it.kind === 'symbol' && sameName(it.id) === a.near) return { x: it.x + a.ndx, y: it.y + a.ndy };
    }
  }
  return { x: a.x, y: a.y };
}

export function resolveAreas(doc: Doc, layerId: string): ResolvedArea[] {
  const out: ResolvedArea[] = [];
  for (const a of layerOf(doc, layerId)?.items ?? []) {
    if (a.kind !== 'area') continue;
    const o = resolveAreaOrigin(doc, a);
    const label: AreaLabel | undefined =
      a.label && a.label.some((l) => l !== '')
        ? { lines: a.label, pos: a.labelPos ?? 'tl', ...(a.size !== undefined ? { size: a.size } : {}), ...(a.bold ? { bold: true } : {}) }
        : undefined;
    out.push({ id: a.id, x: o.x, y: o.y, w: a.w, h: a.h, hatch: !!a.hatch, ...(label ? { label } : {}) });
  }
  return out;
}

/** 枠を足せるか（1つのレイヤーに置ける数には、上限がある） */
export const canAddLayerArea = (doc: Doc, layerId: string): boolean =>
  (layerOf(doc, layerId)?.items ?? []).filter((i) => i.kind === 'area').length < MAX_LAYER_ITEMS_PER_KIND;

/** 枠の種類（停電範囲・充電範囲・印加範囲）に応じて、文字と斜線の有無を決める */
export const areaKindOf = (id: string): AreaKindDef => AREA_KINDS.find((k) => k.id === id) ?? AREA_KINDS[0]!;

/** 四角の向かい合う2つの角から、左上と大きさにする。格子（2）に合わせる */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): AreaRect {
  const sn = (v: number) => Math.round(v / 2) * 2;
  const x = sn(Math.min(x0, x1));
  const y = sn(Math.min(y0, y1));
  return { x, y, w: sn(Math.max(x0, x1)) - x, h: sn(Math.max(y0, y1)) - y };
}

/** 枠を置く。小さすぎる（AREA_MIN 未満）・上限を超えるときは null。種類に応じた文字・斜線が、最初に入る */
export function addLayerArea(doc: Doc, layerId: string, rect: AreaRect, kindId: string): { doc: Doc; id: string } | null {
  if (!layerInfos(doc).some((l) => l.id === layerId) || !canAddLayerArea(doc, layerId)) return null;
  if (rect.w < AREA_MIN || rect.h < AREA_MIN) return null;
  const kind = areaKindOf(kindId);
  const items = layerOf(doc, layerId)?.items ?? [];
  const id = freshId('larea', new Set(items.map((i) => i.id)));
  const a: LayerArea = {
    kind: 'area',
    id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    ...anchorFor(doc, rect.x, rect.y),
    ...(kind.hatch ? { hatch: true } : {}),
    label: [kind.label],
  };
  return { doc: setLayerItems(doc, layerId, [...items, a]), id };
}

/** 枠を直す。kind を渡すと、その種類の文字・斜線にする。位置と大きさ（rect）は、近くの機器から覚え直す */
export function editArea(
  doc: Doc,
  layerId: string,
  id: string,
  patch: { rect?: AreaRect; kind?: string; hatch?: boolean; label?: string[]; size?: number; bold?: boolean; labelPos?: AreaLabelPos },
): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((a) => {
      if (a.kind !== 'area' || a.id !== id) return a;
      const n: LayerArea = { ...a };
      if (patch.rect) {
        if (patch.rect.w < AREA_MIN || patch.rect.h < AREA_MIN) return a;
        Object.assign(n, { x: patch.rect.x, y: patch.rect.y, w: patch.rect.w, h: patch.rect.h }, anchorFor(doc, patch.rect.x, patch.rect.y));
      }
      if (patch.kind !== undefined) {
        const k = areaKindOf(patch.kind);
        n.label = [k.label];
        if (k.hatch) n.hatch = true;
        else delete n.hatch;
      }
      if (patch.hatch !== undefined) {
        if (patch.hatch) n.hatch = true;
        else delete n.hatch;
      }
      if (patch.label !== undefined) {
        if (patch.label.every((l) => l === '')) delete n.label;
        else n.label = patch.label;
      }
      if (patch.size !== undefined) n.size = clampTextSize(patch.size);
      if (patch.bold !== undefined) {
        if (patch.bold) n.bold = true;
        else delete n.bold;
      }
      if (patch.labelPos !== undefined) n.labelPos = patch.labelPos;
      return n;
    }),
  );
}

/** 枠を動かす（大きさは、そのまま）。動かしたあとの場所の近くの機器から、覚え直す */
export function moveAreas(doc: Doc, layerId: string, ids: string[], dx: number, dy: number): Doc {
  const cur = resolveAreas(doc, layerId);
  let n = doc;
  for (const a of cur) {
    if (ids.includes(a.id)) n = editArea(n, layerId, a.id, { rect: { x: a.x + dx, y: a.y + dy, w: a.w, h: a.h } });
  }
  return n;
}

/* ---------------- 赤い丸い点・印加点の矢印 ---------------- */

/** 丸い点の、いまの位置。吸い付いた先・近くの機器が無くなっていれば null（出さない） */
export function resolveDotPoint(doc: Doc, d: LayerDot): { x: number; y: number } | null {
  if (d.anchor) return resolveGroundAnchor(doc, d.anchor);
  if (d.near !== undefined) {
    for (const it of doc.items) {
      if (it.kind === 'symbol' && sameName(it.id) === d.near) return { x: it.x + d.ndx, y: it.y + d.ndy };
    }
    return null;
  }
  return { x: d.x, y: d.y };
}

export interface ResolvedDot {
  id: string;
  x: number;
  y: number;
}

export function resolveDots(doc: Doc, layerId: string): ResolvedDot[] {
  const out: ResolvedDot[] = [];
  for (const d of layerOf(doc, layerId)?.items ?? []) {
    if (d.kind !== 'dot') continue;
    const at = resolveDotPoint(doc, d);
    if (at) out.push({ id: d.id, x: at.x, y: at.y });
  }
  return out;
}

export interface ResolvedArrow {
  id: string;
  /** 指している丸い点の id と、その中心 */
  dot: string;
  x: number;
  y: number;
  dir: ArrowDir;
  len: number;
  label?: ArrowLabel;
}

export function resolveArrows(doc: Doc, layerId: string): ResolvedArrow[] {
  const dots = new Map(resolveDots(doc, layerId).map((d) => [d.id, d]));
  const out: ResolvedArrow[] = [];
  for (const a of layerOf(doc, layerId)?.items ?? []) {
    if (a.kind !== 'arrow') continue;
    const d = dots.get(a.dot);
    if (!d) continue;
    const label: ArrowLabel | undefined =
      a.label && a.label.some((l) => l !== '')
        ? { lines: a.label, ...(a.size !== undefined ? { size: a.size } : {}), ...(a.bold ? { bold: true } : {}) }
        : undefined;
    out.push({ id: a.id, dot: a.dot, x: d.x, y: d.y, dir: a.dir ?? ARROW_DIR_DEFAULT, len: clampArrowLen(a.len ?? ARROW_LEN_DEFAULT), ...(label ? { label } : {}) });
  }
  return out;
}

export const canAddLayerDot = (doc: Doc, layerId: string): boolean =>
  (layerOf(doc, layerId)?.items ?? []).filter((i) => i.kind === 'dot').length < MAX_LAYER_ITEMS_PER_KIND;

export const canAddLayerArrow = (doc: Doc, layerId: string): boolean =>
  (layerOf(doc, layerId)?.items ?? []).filter((i) => i.kind === 'arrow').length < MAX_LAYER_ITEMS_PER_KIND;

/** 場所（x・y）から、丸い点の置き場所を決める。線の途中・接続点の近くなら、そこに吸い付く。それ以外は、格子（2）に合わせて、その場所に置く */
function dotPlacement(doc: Doc, x: number, y: number, free = false): Pick<LayerDot, 'anchor' | 'x' | 'y' | 'near' | 'ndx' | 'ndy'> {
  const hit = free ? null : assistGroundPoint(doc, x, y);
  if (hit) return { anchor: hit.anchor, x: hit.x, y: hit.y, ...anchorFor(doc, hit.x, hit.y) };
  const sn = (v: number) => Math.round(v / 2) * 2;
  const px = sn(x);
  const py = sn(y);
  return { x: px, y: py, ...anchorFor(doc, px, py) };
}

/** 丸い点を置く。上限を超えるときは null */
export function addLayerDot(doc: Doc, layerId: string, x: number, y: number, free = false): { doc: Doc; id: string } | null {
  if (!layerInfos(doc).some((l) => l.id === layerId) || !canAddLayerDot(doc, layerId)) return null;
  const items = layerOf(doc, layerId)?.items ?? [];
  const id = freshId('ldot', new Set(items.map((i) => i.id)));
  const d: LayerDot = { kind: 'dot', id, ...dotPlacement(doc, x, y, free) };
  return { doc: setLayerItems(doc, layerId, [...items, d]), id };
}

/** 丸い点の場所を決め直す（ドラッグしたとき。線の途中・接続点の近くなら、吸い付く） */
export function setDotPoint(doc: Doc, layerId: string, id: string, x: number, y: number, free = false): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((d) => {
      if (d.kind !== 'dot' || d.id !== id) return d;
      const n: LayerDot = { kind: 'dot', id: d.id, ...dotPlacement(doc, x, y, free) };
      return n;
    }),
  );
}

/** 丸い点を、矢印キーなどで動かす（吸い付きは外れ、動かした場所に置く） */
export function moveLayerDots(doc: Doc, layerId: string, ids: string[], dx: number, dy: number): Doc {
  const cur = resolveDots(doc, layerId);
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  const at = new Map(cur.map((d) => [d.id, d]));
  return setLayerItems(
    doc,
    layerId,
    items.map((d) => {
      if (d.kind !== 'dot' || !ids.includes(d.id)) return d;
      const p = at.get(d.id);
      if (!p) return d;
      const x = p.x + dx;
      const y = p.y + dy;
      return { kind: 'dot', id: d.id, x, y, ...anchorFor(doc, x, y) } as LayerDot;
    }),
  );
}

/** その丸い点を指している矢印 */
export const arrowOn = (doc: Doc, layerId: string, dotId: string): LayerArrow | undefined =>
  (layerOf(doc, layerId)?.items ?? []).find((i): i is LayerArrow => i.kind === 'arrow' && i.dot === dotId);

/** 丸い点に、印加点の矢印を付ける（1つの点に1本まで。すでに付いているとき・上限を超えるときは null） */
export function addLayerArrow(doc: Doc, layerId: string, dotId: string): { doc: Doc; id: string } | null {
  if (!layerInfos(doc).some((l) => l.id === layerId) || !canAddLayerArrow(doc, layerId)) return null;
  if (!resolveDots(doc, layerId).some((d) => d.id === dotId) || arrowOn(doc, layerId, dotId)) return null;
  const items = layerOf(doc, layerId)?.items ?? [];
  const id = freshId('larrow', new Set(items.map((i) => i.id)));
  const a: LayerArrow = { kind: 'arrow', id, dot: dotId, label: [ARROW_LABEL_DEFAULT] };
  return { doc: setLayerItems(doc, layerId, [...items, a]), id };
}

/** 矢印を直す（向き・長さ・文字・大きさ・太字）。文字は、空にすると外れる */
export function editArrow(doc: Doc, layerId: string, id: string, patch: { dir?: ArrowDir; len?: number; label?: string[]; size?: number; bold?: boolean }): Doc {
  const items = layerOf(doc, layerId)?.items;
  if (!items) return doc;
  return setLayerItems(
    doc,
    layerId,
    items.map((a) => {
      if (a.kind !== 'arrow' || a.id !== id) return a;
      const n: LayerArrow = { ...a };
      if (patch.dir !== undefined) n.dir = patch.dir;
      if (patch.len !== undefined) n.len = clampArrowLen(patch.len);
      if (patch.label !== undefined) {
        if (patch.label.every((l) => l === '')) delete n.label;
        else n.label = patch.label;
      }
      if (patch.size !== undefined) n.size = clampTextSize(patch.size);
      if (patch.bold !== undefined) {
        if (patch.bold) n.bold = true;
        else delete n.bold;
      }
      return n;
    }),
  );
}

/** 尾の端を、図面の座標で指定して、向き（8方向）と長さを決め直す（ドラッグしたとき） */
export function setArrowTail(doc: Doc, layerId: string, id: string, tx: number, ty: number): Doc {
  const a = resolveArrows(doc, layerId).find((r) => r.id === id);
  if (!a) return doc;
  const { dir, len } = arrowFromTail(tx - a.x, ty - a.y);
  return editArrow(doc, layerId, id, { dir, len });
}
