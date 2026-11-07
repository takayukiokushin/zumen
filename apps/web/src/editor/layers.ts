import { FIXED_LAYERS, MAX_CUSTOM_LAYERS, MAX_TEXT_LENGTH, isFixedLayerId } from '@zumen/knowledge';
import type { Orientation } from '@zumen/layout';
import type { Doc } from './doc.ts';

/**
 * 図面のレイヤー（停電範囲図・絶縁耐力試験範囲図・追加したレイヤー）。
 *
 * レイヤーに置くもの（赤い×印・接地・枠など）は、元の図面（Doc.items）とは別に、レイヤーごとに持つ。
 * そのため、レイヤーを使わない図面は、これまでと1文字も変わらない。
 * 固定の2つは、何か置いたとき（向きを決めたときなど）に、初めて記録ができる。追加したレイヤーは、作ったときから記録がある。
 */

/** レイヤーに置くもの。×印・接地・枠などの種類は、これから足していく */
export interface LayerItem {
  id: string;
  kind: string;
}

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
