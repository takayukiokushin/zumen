/**
 * 赤いレイヤー（停電範囲図・絶縁耐力試験範囲図・追加したレイヤー）の見本を作る部分。
 *
 * 架空の現場（cases.ts）の図面の上に、赤い印（文字・×印・接地・枠・斜線・点・矢印・渡り線）を決まった手順で置いて、
 * そのレイヤーの印刷（画面の「印刷プレビュー」と同じ1枚の絵）を、docs/golden/ に保存する。
 * 印の置き方・形・色・重なりを変えたときに、意図しない変化が出ていないかを、1文字ずつ比べて知らせる。
 *
 * 置く場所は、図面の記号（VCB など）の位置から決める。図面の作り方が変わって記号の位置が動けば、赤い印も一緒に動くので、
 * 見本は「元の図面が変わった」ことでも変わる（そのときは、変わった図面を目で見て確かめてから、`pnpm golden` で保存し直す）。
 */
import { portsOf, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { addLayer, addLayerArea, addLayerArrow, addLayerCross, addLayerDot, addLayerGround, addLayerLink, addLayerText, editArea, editArrow, editLink, updateLayerText } from '../../apps/web/src/editor/layers.ts';

export interface LayerStep {
  /** 見本の図面に重ねるレイヤーを作る（置いたあとの図面と、そのレイヤーの id） */
  (doc: Doc): { doc: Doc; layerId: string };
}

const syms = (doc: Doc) => doc.items.filter((i): i is DocSymbol => i.kind === 'symbol');
const must = <T>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined) throw new Error(`見本の作成に失敗：${what}`);
  return v;
};

/** 停電範囲図：メモ・開放の×印・接地・停電範囲の枠・点と印加点の矢印・渡り線を、1枚に */
export const outageLayer: LayerStep = (d0) => {
  const L = 'outage';
  const vcb = must(syms(d0).find((s) => s.symbolId === 'vcb'), 'VCB');
  const port = must(portsOf(vcb)[0], 'VCB の接続点');
  let d = must(addLayerText(d0, L, vcb.x - 300, vcb.y + 30, '作業停電範囲\n（第1変電所）'), 'メモ').doc;
  d = must(addLayerCross(d, L, vcb.id, 'M'), '×印').doc;
  d = must(addLayerGround(d, L, { kind: 'port', item: sameName(vcb.id), port: port.id }, port.x - 50, port.y + 50), '接地').doc;
  const frame = must(addLayerArea(d, L, { x: vcb.x - 60, y: vcb.y - 50, w: 220, h: 200 }, 'outage'), '停電範囲の枠');
  d = frame.doc;
  const a = must(addLayerDot(d, L, vcb.x + 200, vcb.y + 40, true), '点1');
  const b = must(addLayerDot(a.doc, L, vcb.x + 260, vcb.y + 120, true), '点2');
  d = must(addLayerArrow(b.doc, L, a.id), '印加点の矢印').doc;
  d = must(addLayerLink(d, L, a.id, b.id, 'normal'), '渡り線').doc;
  return { doc: d, layerId: L };
};

/** 絶縁耐力試験範囲図：充電範囲（斜線）・印加範囲・点4つを4つの形の渡り線で結び、印加点の矢印を付ける */
export const withstandLayer: LayerStep = (d0) => {
  const L = 'withstand';
  const vcb = must(syms(d0).find((s) => s.symbolId === 'vcb'), 'VCB');
  let d = must(addLayerArea(d0, L, { x: vcb.x - 80, y: vcb.y - 40, w: 260, h: 220 }, 'live'), '充電範囲の枠').doc;
  const ap = must(addLayerArea(d, L, { x: vcb.x + 220, y: vcb.y - 40, w: 120, h: 120 }, 'applied'), '印加範囲の枠');
  d = editArea(ap.doc, L, ap.id, { labelPos: 'br', bold: true });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = must(addLayerDot(d, L, vcb.x + 240 + (i % 2) * 60, vcb.y + 160 + Math.floor(i / 2) * 80, true), `点${i + 1}`);
    d = r.doc;
    ids.push(r.id);
  }
  const shapes = ['straight', 'gentle', 'normal'] as const;
  for (let i = 0; i < 3; i++) d = must(addLayerLink(d, L, ids[i]!, ids[i + 1]!, shapes[i]!), `渡り線${i + 1}`).doc;
  const round = must(addLayerLink(d, L, ids[0]!, ids[3]!, 'round'), '渡り線4');
  d = editLink(round.doc, L, round.id, { flip: true });
  const arrow = must(addLayerArrow(d, L, ids[0]!), '矢印');
  d = editArrow(arrow.doc, L, arrow.id, { dir: 'nw', len: 60, label: ['印加点', '（R相）'], size: 2 });
  return { doc: d, layerId: L };
};

/** 追加したレイヤー「作業停電図」：文字の大きさ・太字・複数の枠と矢印 */
export const customLayer: LayerStep = (d0) => {
  const added = must(addLayer(d0, '作業停電図'), 'レイヤーの追加');
  const L = added.id;
  const vcb = must(syms(d0).find((s) => s.symbolId === 'vcb'), 'VCB');
  const t = must(addLayerText(added.doc, L, vcb.x - 120, vcb.y - 80, '作業範囲'), 'メモ');
  let d = updateLayerText(t.doc, L, t.id, { size: 3, bold: true });
  for (let i = 0; i < 2; i++) d = must(addLayerArea(d, L, { x: vcb.x - 60 + i * 140, y: vcb.y + 20, w: 100, h: 90 }, i === 0 ? 'outage' : 'live'), `枠${i + 1}`).doc;
  const a = must(addLayerDot(d, L, vcb.x + 20, vcb.y + 160, true), '点');
  d = must(addLayerArrow(a.doc, L, a.id), '矢印').doc;
  return { doc: d, layerId: L };
};
