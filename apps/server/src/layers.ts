import { isFixedLayerId } from '@zumen/knowledge';
import { isPlainObject } from './input.ts';

/**
 * 図面に重ねるレイヤー（停電範囲図など）の、サーバー側の扱い。
 * 図面は丸ごと1つの JSON で保存してあり、レイヤーは、その中の `layers` に入っている（画面側は apps/web/src/editor/layers.ts）。
 * サーバーは、中身の細かいところは見ず、「どんなレイヤーがあるか」と「どれを残すか」だけを扱う。
 */

interface RawLayer {
  id: string;
  name?: string;
  items: unknown[];
}

function rawLayers(drawing: unknown): RawLayer[] {
  if (!isPlainObject(drawing) || !Array.isArray(drawing.layers)) return [];
  return drawing.layers.filter(isPlainObject).map((l) => ({
    id: String(l.id ?? ''),
    name: typeof l.name === 'string' ? l.name : undefined,
    items: Array.isArray(l.items) ? l.items : [],
  })).filter((l) => l.id !== '');
}

function parse(drawing: string | null): unknown {
  if (!drawing) return null;
  try {
    return JSON.parse(drawing);
  } catch {
    return null;
  }
}

export interface LayerSummary {
  id: string;
  /** 追加したレイヤーの名前。固定のレイヤー（停電範囲図など）は null（名前は画面が持つ） */
  name: string | null;
  /** 置いてあるものの数 */
  count: number;
}

/**
 * 複製のときに「このレイヤーも複製しますか？」と尋ねる対象。
 * 追加したレイヤーは、置いたものが無くても入れる（名前を持っているので）。固定のレイヤーは、置いたものがあるときだけ
 */
export function summarizeLayers(drawing: string | null): LayerSummary[] {
  return rawLayers(parse(drawing))
    .filter((l) => !isFixedLayerId(l.id) || l.items.length > 0)
    .map((l) => ({ id: l.id, name: isFixedLayerId(l.id) ? null : (l.name ?? ''), count: l.items.length }));
}

/** 図面から、選んだレイヤーだけを残す（ほかのレイヤーは、置いたものごと外す）。1つも残らなければ、layers の項目ごと無くす */
export function keepOnlyLayers(drawing: string | null, ids: string[]): string | null {
  if (!drawing) return drawing;
  const doc = parse(drawing);
  if (!isPlainObject(doc) || doc.layers === undefined) return drawing;
  const keep = new Set(ids);
  const kept = rawLayers(doc).length === 0 ? [] : (doc.layers as unknown[]).filter((l) => isPlainObject(l) && keep.has(String(l.id)));
  if (kept.length === 0) delete doc.layers;
  else doc.layers = kept;
  return JSON.stringify(doc);
}

/**
 * 保存しようとしている図面が、いま保存してある図面のレイヤーを、知らずに落としてしまうか。
 * バージョンアップ前の古い画面は `layers` を知らないので、そのまま保存すると、レイヤーが消える。
 * 保存してある図面にレイヤーがあるのに、届いた図面に `layers` の項目が無ければ、落とす
 * （画面でレイヤーを全部消したときは、`layers: []` が届くので、落とす扱いにはしない）。
 */
export function wouldDropLayers(stored: string | null, incoming: unknown): boolean {
  if (!isPlainObject(incoming) || incoming.layers !== undefined) return false;
  return rawLayers(parse(stored)).length > 0;
}
