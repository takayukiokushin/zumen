import { FIXED_LAYERS, MAX_CUSTOM_LAYERS, MAX_LAYER_ITEMS_PER_KIND, MAX_TEXT_LENGTH, isFixedLayerId } from '@zumen/knowledge';
import type { Orientation } from '@zumen/layout';
import { clampTextSize } from '@zumen/layout';
import { defOf, freshId, sameName } from './doc.ts';
import type { Doc, DocText } from './doc.ts';

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

/** レイヤーに置くもの。×印・接地・枠などの種類は、これから足していく */
export type LayerItem = LayerText;

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
  return (layerOf(doc, layerId)?.items ?? []).map((t): DocText => {
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
      if (t.id !== id) return t;
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
      if (!ids.includes(t.id)) return t;
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
  return setLayerItems(doc, layerId, items.filter((t) => !ids.includes(t.id)));
}
