import type { PaperSize, Orientation, TitleBlock } from '@zumen/layout';
import { buildSheetSvg } from './exportSheet.ts';
import { chooseSheet } from './inspect.ts';
import { layerItemsAsDocItems, layerOf, resolveAreas, resolveArrows, resolveCrosses, resolveDots, resolveGrounds, resolveLinks } from './layers.ts';
import type { Doc } from './doc.ts';

/**
 * 選んだレイヤーの印刷用の1枚の絵（SVG）を、画面を使わずに作る。
 * 画面（Editor.tsx）の「印刷プレビュー」と同じ手順（元の図面＋そのレイヤーの文字 → 赤い×印・接地・枠・点・矢印・渡り線を重ねる）。
 * 図面の見本（scripts/golden/layers.ts）と、自動の検査で、レイヤーの印刷を確かめるのに使う。
 */
export function buildLayerSheetSvg(doc: Doc, layerId: string, title: TitleBlock): { svg: string; paper: PaperSize; orientation: Orientation } {
  const texts = layerItemsAsDocItems(doc, layerId);
  const view: Doc = texts.length > 0 ? { ...doc, items: [...doc.items, ...texts] } : doc;
  const want = layerOf(doc, layerId)?.orientation;
  const { paper, orientation } = chooseSheet(view, title, want);
  const crosses = resolveCrosses(doc, layerId).map((c) => ({ x: c.x, y: c.y, size: c.size, thickness: c.thickness }));
  const grounds = resolveGrounds(doc, layerId).map((g) => ({ x: g.x, y: g.y, lead: g.lead, drop: g.drop, ...(g.label ? { label: g.label } : {}) }));
  const areas = resolveAreas(doc, layerId).map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h, hatch: a.hatch, ...(a.label ? { label: a.label } : {}) }));
  const dots = resolveDots(doc, layerId).map((d) => ({ x: d.x, y: d.y }));
  const arrows = resolveArrows(doc, layerId).map((a) => ({ x: a.x, y: a.y, dir: a.dir, len: a.len, ...(a.label ? { label: a.label } : {}) }));
  const links = resolveLinks(doc, layerId).map((k) => ({ x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2, shape: k.shape, flip: k.flip }));
  return { svg: buildSheetSvg(view, title, paper, orientation, crosses, grounds, areas, { dots, arrows, links }), paper, orientation };
}
