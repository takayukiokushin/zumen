import { getSymbol } from '@zumen/symbols';
import { renderSvg } from '@zumen/layout';
import type { DrawingLayout, TitleBlock } from '@zumen/layout';
import type { Doc } from './doc.ts';

/** 編集中の図面を、図枠・表題欄つきの1枚のSVGにする */
export function buildSheetSvg(doc: Doc, title: TitleBlock): string {
  const drawing: DrawingLayout = {
    symbols: [],
    wires: [],
    frames: [],
    texts: [],
    bounds: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  };

  for (const it of doc.items) {
    if (it.kind === 'wire') {
      drawing.wires.push({ x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, dashed: it.dashed });
    } else if (it.kind === 'frame') {
      drawing.frames.push({ x: it.x, y: it.y, w: it.w, label: it.label });
    } else if (it.kind === 'text') {
      drawing.texts!.push({ x: it.x, y: it.y, lines: it.lines, anchor: it.anchor });
    } else {
      drawing.symbols.push({
        id: it.id,
        role: it.id,
        symbolId: it.symbolId,
        x: it.x,
        y: it.y,
        rotate: it.rotate,
        label: it.label,
        labelAt: { x: it.x + it.labelDx, y: it.y + it.labelDy, anchor: it.labelAnchor },
      });
    }
  }

  // 外形を求める（図枠に収めるために使う）
  const b = drawing.bounds;
  const ext = (x0: number, y0: number, x1: number, y1: number) => {
    b.x0 = Math.min(b.x0, x0);
    b.y0 = Math.min(b.y0, y0);
    b.x1 = Math.max(b.x1, x1);
    b.y1 = Math.max(b.y1, y1);
  };
  for (const s of drawing.symbols) {
    const def = getSymbol(s.symbolId);
    ext(s.x, s.y, s.x + def.box.w, s.y + def.box.h);
    if (s.label.length) {
      const w = Math.max(...s.label.map((l) => l.length)) * 6;
      const lx = s.labelAt.anchor === 'start' ? s.labelAt.x : s.labelAt.anchor === 'end' ? s.labelAt.x - w : s.labelAt.x - w / 2;
      ext(lx, s.labelAt.y - 8, lx + w, s.labelAt.y + s.label.length * 10);
    }
  }
  for (const w of drawing.wires) {
    ext(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2));
  }
  for (const f of drawing.frames) ext(f.x, f.y - 14, f.x + f.w, f.y + 26);
  for (const t of drawing.texts!) {
    const w = Math.max(...t.lines.map((l) => l.length)) * 6;
    ext(t.x, t.y - 9, t.x + w, t.y + t.lines.length * 10);
  }
  if (!Number.isFinite(b.x0)) Object.assign(b, { x0: 0, y0: 0, x1: 100, y1: 100 });

  return renderSvg(drawing, title);
}

/** SVGをPNGにして保存する */
export async function downloadPng(svg: string, fileName: string, scale = 2): Promise<void> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('図面を画像にできませんでした'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = (img.width || 760) * scale;
    canvas.height = (img.height || 1080) * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNGを作れませんでした');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SVGをそのまま保存する（他のソフトで開きたいとき用） */
export function downloadSvg(svg: string, fileName: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
