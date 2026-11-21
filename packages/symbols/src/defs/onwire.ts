import type { SymbolDef } from '../types.ts';
import { circle, hline, line, path, rect, text } from '../shape.ts';

/**
 * 線の上に乗せる記号（VCT・CT・ZCT）。第20弾 項目2。
 *
 * 以前は、記号の中に、主回路を表す縦線があり、入口・出口の接続点があった（記号が「線の途中の部品」だった）。
 * 縦線と入口・出口をなくし、記号は、図面の上の線に重ねて置く（線は、ふつうの線として、記号の丸や枠の中を通る）。
 * 記号の大きさも、本体（丸・枠・巻き線）だけに縮めた。自動作図は、以前と同じ位置に本体を置く（形・位置は、見た目が変わらない）。
 *
 * 以前の形（縦線・入口・出口あり）は、自動作図が、位置を決めるのに使うため、`CHAIN_SYMBOLS`（index.ts）に残している。
 * 以前の記号の左上から、新しい記号の左上までのずれが `ON_WIRE_ORIGIN`。
 */
export const ON_WIRE_ORIGIN = {
  vct: { x: 6, y: 8 },
  ct: { x: 12, y: 14 },
  zct: { x: 9, y: 11 },
  /** PAS・PGS・UGSの中に入るZCT（ZCTを、PAS_SCALE 倍に縮めたもの） */
  'zct-pas': { x: 5.4, y: 4.2 },
} as const;

/** ZCTの円と、その中に引く斜線（円の外へ出さず、ふちから1だけ内側で終わらせる） */
const ZCT = { cx: 11, cy: 11, r: 11 };
const ZCT_SLASH = (ZCT.r - 1) / Math.SQRT2;

export function onWireDefs(old: { vct: SymbolDef; ct: SymbolDef; zct: SymbolDef }): { vct: SymbolDef; ct: SymbolDef; zct: SymbolDef } {
  const o = ON_WIRE_ORIGIN;
  return {
    vct: {
      ...old.vct,
      box: { w: 66, h: 48 },
      shapes: [
        rect(0, 0, 56, 48),
        hline(16, 16, 26),
        circle(34, 16, 8),
        circle(44, 16, 8),
        hline(16, 52, 66),
        circle(16, 34, 9),
        hline(34, 25, 66),
      ],
      ports: [
        { id: 'sec-vt', x: 66, y: 16, dir: 'right', role: 'secondary', label: 'VT二次' },
        { id: 'sec-ct', x: 66, y: 34, dir: 'right', role: 'secondary', label: 'CT二次' },
      ],
      onWire: { x: 22 - o.vct.x, y: -o.vct.y, y2: old.vct.box.h - o.vct.y },
    },
    ct: {
      ...old.ct,
      box: { w: 44, h: 16 },
      shapes: [
        hline(0, 4, 28),
        hline(16, 4, 28),
        hline(8, 4, 44),
        path('M 4 0 A 4 4 0 0 0 4 8'),
        path('M 4 8 A 4 4 0 0 0 4 16'),
      ],
      ports: [{ id: 'sec', x: 44, y: 8, dir: 'right', role: 'secondary', label: '試験端子・OCRへ' }],
      onWire: { x: 24 - o.ct.x, y: -o.ct.y, y2: old.ct.box.h - o.ct.y },
    },
    zct: {
      ...old.zct,
      box: { w: 43, h: 22 },
      shapes: [
        circle(ZCT.cx, ZCT.cy, ZCT.r),
        line(ZCT.cx - ZCT_SLASH, ZCT.cy + ZCT_SLASH, ZCT.cx + ZCT_SLASH, ZCT.cy - ZCT_SLASH),
        // 「3」は円の内側に収める。縦の導体と斜線のどちらにも触れない、円の右下のすきまに置いている
        text(15.75, 14, '3', { size: 9 }),
        hline(11, 22, 43),
      ],
      ports: [{ id: 'sec', x: 43, y: 11, dir: 'right', role: 'control', label: 'GR/DGRへ' }],
      onWire: { x: 20 - o.zct.x, y: -o.zct.y, y2: old.zct.box.h - o.zct.y },
    },
  };
}
