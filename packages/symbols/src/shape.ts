/**
 * 図記号を「データ」として持つための図形プリミティブ。
 *
 * 記号をReactコンポーネントとして直接書かず、純粋なデータ（Shape[]）として定義している理由:
 *  - 画面描画(React) / PDF出力 / サーバー側レンダリング / このリポジトリのカタログHTML生成 を
 *    すべて同じ定義から行えるようにするため
 *  - 新しい記号の追加が「データを1件足すだけ」で済むようにするため（拡張性要件）
 *
 * 座標系: 記号ごとのローカル座標（左上原点、Y下向き）。単位はmm相当の内部単位。
 * 慣習: 主回路(縦に流れる線)は原則 x = box.w / 2 を通す。
 */

export type Fill = 'none' | 'solid';

export interface ShapeCommon {
  /** 線幅（省略時 1）。母線など太線は 3 */
  sw?: number;
  /** 破線パターン（例: '4 3'） */
  dash?: string;
}

export interface LineShape extends ShapeCommon {
  k: 'line';
  x1: number; y1: number; x2: number; y2: number;
}

export interface PolyShape extends ShapeCommon {
  k: 'poly';
  /** [x1,y1,x2,y2,...] */
  pts: number[];
  close?: boolean;
  fill?: Fill;
}

export interface CircleShape extends ShapeCommon {
  k: 'circle';
  cx: number; cy: number; r: number;
  fill?: Fill;
}

export interface RectShape extends ShapeCommon {
  k: 'rect';
  x: number; y: number; w: number; h: number;
  /** 角丸 */
  rx?: number;
  fill?: Fill;
}

export interface PathShape extends ShapeCommon {
  k: 'path';
  d: string;
  fill?: Fill;
}

export interface TextShape {
  k: 'text';
  x: number; y: number;
  s: string;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  /** 垂直位置。既定は中央 */
  vAlign?: 'middle' | 'baseline';
  italic?: boolean;
  bold?: boolean;
  /** 字間（図面では継電器の文字を「U V R」のように空けて書く） */
  tracking?: number;
}

export type Shape =
  | LineShape
  | PolyShape
  | CircleShape
  | RectShape
  | PathShape
  | TextShape;

/* ------------------------------------------------------------------ */
/* 生成ヘルパー（戻り値は純粋なデータ）                                  */
/* ------------------------------------------------------------------ */

export const line = (x1: number, y1: number, x2: number, y2: number, o: ShapeCommon = {}): LineShape =>
  ({ k: 'line', x1, y1, x2, y2, ...o });

/** 垂直線 */
export const vline = (x: number, y1: number, y2: number, o: ShapeCommon = {}): LineShape =>
  ({ k: 'line', x1: x, y1, x2: x, y2, ...o });

/** 水平線 */
export const hline = (y: number, x1: number, x2: number, o: ShapeCommon = {}): LineShape =>
  ({ k: 'line', x1, y1: y, x2, y2: y, ...o });

export const poly = (pts: number[], o: ShapeCommon & { close?: boolean; fill?: Fill } = {}): PolyShape =>
  ({ k: 'poly', pts, ...o });

export const circle = (cx: number, cy: number, r: number, o: ShapeCommon & { fill?: Fill } = {}): CircleShape =>
  ({ k: 'circle', cx, cy, r, ...o });

export const rect = (x: number, y: number, w: number, h: number, o: ShapeCommon & { fill?: Fill; rx?: number } = {}): RectShape =>
  ({ k: 'rect', x, y, w, h, ...o });

export const path = (d: string, o: ShapeCommon & { fill?: Fill } = {}): PathShape =>
  ({ k: 'path', d, ...o });

export const text = (
  x: number,
  y: number,
  s: string,
  o: Omit<TextShape, 'k' | 'x' | 'y' | 's'> = {},
): TextShape => ({ k: 'text', x, y, s, ...o });

/** 接点（小さな白丸） */
export const contact = (cx: number, cy: number, r = 1.8): CircleShape =>
  circle(cx, cy, r, { fill: 'none' });

/** 接続点（黒丸） */
export const dot = (cx: number, cy: number, r = 2.2): CircleShape =>
  circle(cx, cy, r, { fill: 'solid' });

/**
 * 開閉器の可動刃（ブレード）。
 * 下側の固定接点を支点に、右上がりに開いた状態で描く（JISの開閉器記号の標準的な表現）。
 */
export const blade = (x: number, yTop: number, yBottom: number, reach = 11): Shape[] => [
  contact(x, yTop),
  contact(x, yBottom),
  line(x, yBottom - 1.8, x + reach, yTop + 2),
];

/** 接地記号（3本の横線）。(x, y) は最上段の線の中心 */
export const earth = (x: number, y: number, scale = 1): Shape[] => [
  hline(y, x - 9 * scale, x + 9 * scale),
  hline(y + 4 * scale, x - 5.5 * scale, x + 5.5 * scale),
  hline(y + 8 * scale, x - 2.5 * scale, x + 2.5 * scale),
];

/** 矢じり（下向き） */
export const arrowDown = (x: number, yTip: number, size = 3.2): PolyShape =>
  poly([x - size, yTip - size * 1.6, x, yTip, x + size, yTip - size * 1.6], { close: true, fill: 'solid' });

/**
 * 紡錘形（限流ヒューズをLBSの可動刃の上に描くときの形）。
 * (x1,y1)-(x2,y2) を軸とする細長い六角形を返す。
 */
export const spindle = (
  x1: number, y1: number, x2: number, y2: number, w = 5,
): PolyShape => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const at = (t: number, side: number): [number, number] => [
    x1 + ux * len * t + px * w * side,
    y1 + uy * len * t + py * w * side,
  ];
  const pts = [at(0, 0), at(0.24, 1), at(0.76, 1), at(1, 0), at(0.76, -1), at(0.24, -1)];
  return poly(pts.flat(), { close: true, fill: 'none' });
};

/**
 * 傾いた長方形（LBS・PCの可動刃の上に描くヒューズの形）。
 * (x1,y1)-(x2,y2) を長辺の中心軸とする幅 2w の長方形を返す。
 */
export const tiltedBar = (
  x1: number, y1: number, x2: number, y2: number, w = 5,
): PolyShape => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * w;
  const py = (dx / len) * w;
  return poly(
    [x1 + px, y1 + py, x2 + px, y2 + py, x2 - px, y2 - py, x1 - px, y1 - py],
    { close: true, fill: 'none' },
  );
};

/** 巻線結線マーク: スター(Y)結線 */
export const starMark = (cx: number, cy: number, r = 5): Shape[] => {
  const pt = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const a = pt(-90), b = pt(30), c = pt(150);
  return [
    line(cx, cy, a[0], a[1]),
    line(cx, cy, b[0], b[1]),
    line(cx, cy, c[0], c[1]),
  ];
};

/** 巻線結線マーク: デルタ(Δ)結線 */
export const deltaMark = (cx: number, cy: number, r = 5.4): PolyShape => {
  const pt = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const a = pt(-90), b = pt(30), c = pt(150);
  return poly([a[0], a[1], b[0], b[1], c[0], c[1]], { close: true, fill: 'none' });
};

/* ------------------------------------------------------------------ */
/* SVG文字列化（React非依存。カタログ生成・PDF出力でも同じ関数を使う）      */
/* ------------------------------------------------------------------ */

/**
 * 図面の文字はすべてゴシック体で統一する。
 * 日本語フォントを明示しないと環境によって中国語フォントに落ち、漢字の字形が変わる。
 */
export const FONT_FAMILY =
  "IPAGothic, 'IPAゴシック', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif";

const n = (v: number): string => (Math.round(v * 1000) / 1000).toString();

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const common = (s: ShapeCommon): string => {
  const parts: string[] = [`stroke-width="${n(s.sw ?? 1)}"`];
  if (s.dash) parts.push(`stroke-dasharray="${s.dash}"`);
  return parts.join(' ');
};

const fillAttr = (f: Fill | undefined): string =>
  f === 'solid' ? 'fill="currentColor"' : 'fill="none"';

/** 1つの図形をSVG要素文字列に変換する */
export function shapeToSvg(s: Shape): string {
  switch (s.k) {
    case 'line':
      return `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" ${common(s)} />`;
    case 'poly': {
      const pts = s.pts.reduce<string[]>((acc, v, i) => {
        if (i % 2 === 0) acc.push(n(v));
        else acc[acc.length - 1] += `,${n(v)}`;
        return acc;
      }, []).join(' ');
      const tag = s.close ? 'polygon' : 'polyline';
      return `<${tag} points="${pts}" ${fillAttr(s.fill)} ${common(s)} />`;
    }
    case 'circle':
      return `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" ${fillAttr(s.fill)} ${common(s)} />`;
    case 'rect':
      return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}"${
        s.rx ? ` rx="${n(s.rx)}"` : ''
      } ${fillAttr(s.fill)} ${common(s)} />`;
    case 'path':
      return `<path d="${s.d}" ${fillAttr(s.fill)} ${common(s)} />`;
    case 'text':
      return `<text x="${n(s.x)}" y="${n(s.y)}" font-size="${n(s.size ?? 9)}" text-anchor="${
        s.anchor ?? 'middle'
      }" dominant-baseline="${s.vAlign === 'baseline' ? 'auto' : 'central'}"${
        s.italic ? ' font-style="italic"' : ''
      }${s.bold ? ' font-weight="600"' : ''} font-family="${FONT_FAMILY}"${
        s.tracking ? ` letter-spacing="${n(s.tracking)}"` : ''
      } fill="currentColor" stroke="none">${esc(s.s)}</text>`;
  }
}

export function shapesToSvg(shapes: readonly Shape[], indent = '    '): string {
  return shapes.map((s) => indent + shapeToSvg(s)).join('\n');
}
