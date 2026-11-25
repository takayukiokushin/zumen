import { overviewCaption, sheetLabel, tileCaption } from '@zumen/ai';
import { MAX_SEND_IMAGES, PX_PER_PT, planSheet, tilesPerSheet } from './tiles.ts';
import type { SheetPlan } from './tiles.ts';

/**
 * 読み取りに出す前の、図面の準備（ブラウザの中で、自動で行う。利用者の操作は増えない）。
 *
 * 大きな図面（A1・A3 などの PDF、大きな写真・スキャン）は、そのまま AI に渡すと、細かい文字がつぶれて読めない（「解像度が低い」）。
 * そこで、文字が読める大きさに拡大して、縦横に分け（つなぎ目は少し重ねる）、全体の縮小図といっしょに渡す。
 * 小さい図面・普通の写真は、これまでどおり、そのまま渡す。
 * 準備に失敗したとき（ブラウザが対応していない・壊れた PDF など）も、これまでどおり、元のファイルを、そのまま渡す。
 */

export interface SourceFile {
  file: File;
  mediaType: string;
  /** base64（データURLの接頭辞は付けない） */
  data: string;
}

export interface PreparedImage {
  mediaType: string;
  data: string;
  /** AI に、この画像が何かを伝える文（画像の前に添える）。そのまま渡す画像には、付けない */
  caption?: string;
}

/** 送る画像の、base64 の合計の上限（サーバーの上限 30MB より、少し小さく） */
const MAX_TOTAL_BASE64 = 24 * 1024 * 1024;
/** PDF は、このページ数までを準備する（これを超えるときは、元の PDF をそのまま渡す。サーバーが、ページ数の多さを断る） */
const MAX_PDF_PAGES = 10;

/** base64 の文字数から、おおよその合計を出す */
const sizeOf = (list: PreparedImage[]) => list.reduce((n, i) => n + i.data.length, 0);

const fromCanvas = (canvas: HTMLCanvasElement, mediaType: 'image/png' | 'image/jpeg') =>
  canvas.toDataURL(mediaType, 0.92).split(',')[1] ?? '';

function whiteCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** 画像（または、1ページ）を、割り付けどおりに、全体の縮小図と、分けた画像にする */
async function renderSheet(
  plan: SheetPlan,
  label: string,
  kind: 'png' | 'jpeg',
  draw: (ctx: CanvasRenderingContext2D, scale: number, x: number, y: number, w: number, h: number) => Promise<void>,
): Promise<PreparedImage[]> {
  const mediaType = kind === 'jpeg' ? 'image/jpeg' : 'image/png';
  const out: PreparedImage[] = [];
  if (!plan.tiled) {
    const { canvas, ctx } = whiteCanvas(plan.width, plan.height);
    await draw(ctx, plan.scale, 0, 0, plan.width, plan.height);
    out.push({ mediaType, data: fromCanvas(canvas, mediaType) });
    return out;
  }
  {
    const w = Math.round((plan.width / plan.scale) * plan.overviewScale);
    const h = Math.round((plan.height / plan.scale) * plan.overviewScale);
    const { canvas, ctx } = whiteCanvas(w, h);
    await draw(ctx, plan.overviewScale, 0, 0, w, h);
    out.push({
      mediaType,
      data: fromCanvas(canvas, mediaType),
      caption: overviewCaption(label),
    });
  }
  for (const t of plan.tiles) {
    const { canvas, ctx } = whiteCanvas(t.w, t.h);
    await draw(ctx, plan.scale, t.x, t.y, t.w, t.h);
    out.push({
      mediaType,
      data: fromCanvas(canvas, mediaType),
      caption: tileCaption(label, t),
    });
  }
  return out;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
/** PDF を描く部品。PDF を使うときだけ、読み込む（ふだんは読み込まない） */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJs;
    const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')) as { default: string };
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjsPromise;
}

interface Sheet {
  label: (n: number) => string;
  w0: number;
  h0: number;
  target: number;
  kind: 'png' | 'jpeg';
  draw: (ctx: CanvasRenderingContext2D, scale: number, x: number, y: number, w: number, h: number) => Promise<void>;
  /** 小さくて、分ける必要がないとき、そのまま渡す元のファイル（これまでどおり） */
  asIs?: PreparedImage;
}

/** 元のファイルの、図（PDF のページ・画像）の一覧を作る（大きさだけ調べる。まだ描かない） */
async function sheetsOf(src: SourceFile, fileNo: number, onlyOneFile: boolean): Promise<Sheet[] | null> {
  if (src.mediaType === 'application/pdf') {
    const pdfjs = await loadPdfJs();
    const bytes = Uint8Array.from(atob(src.data), (c) => c.charCodeAt(0));
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    if (doc.numPages > MAX_PDF_PAGES) return null;
    const sheets: Sheet[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      sheets.push({
        label: () => sheetLabel(fileNo, onlyOneFile, { no: p, of: doc.numPages }),
        w0: vp.width,
        h0: vp.height,
        target: PX_PER_PT,
        kind: 'png',
        draw: async (ctx, scale, x, y) => {
          await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x, -y] }).promise;
        },
      });
    }
    return sheets;
  }
  // 画像
  const bmp = await createImageBitmap(src.file);
  const long = Math.max(bmp.width, bmp.height);
  const isJpeg = src.mediaType === 'image/jpeg';
  const sheet: Sheet = {
    label: () => sheetLabel(fileNo, onlyOneFile),
    w0: bmp.width,
    h0: bmp.height,
    target: 1,
    kind: isJpeg ? 'jpeg' : 'png',
    draw: async (ctx, scale, x, y, w, h) => {
      // 全体を scale 倍にしたときの、(x, y) から w×h の部分を、描く
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, x / scale, y / scale, w / scale, h / scale, 0, 0, w, h);
    },
    ...(long <= 1568 ? { asIs: { mediaType: src.mediaType, data: src.data } } : {}),
  };
  return [sheet];
}

/**
 * 読み取りに出す画像を作る。大きな図面は、拡大して分けた画像と、全体の縮小図になる。
 * 何かあれば（準備できない・枚数や大きさが上限を超える）、これまでどおり、元のファイルを、そのまま返す。
 */
export async function prepareImages(sources: SourceFile[]): Promise<PreparedImage[]> {
  const original = (): PreparedImage[] => sources.map((s) => ({ mediaType: s.mediaType, data: s.data }));
  try {
    const sheets: Sheet[] = [];
    for (let i = 0; i < sources.length; i++) {
      const s = await sheetsOf(sources[i]!, i + 1, sources.length === 1);
      if (!s) return original();
      sheets.push(...s);
    }
    for (let maxTiles = tilesPerSheet(sheets.length); maxTiles >= 1; maxTiles = Math.floor(maxTiles / 2)) {
      const out: PreparedImage[] = [];
      for (const sh of sheets) {
        const plan = planSheet(sh.w0, sh.h0, sh.target, maxTiles);
        // 小さい図面・普通の写真は、これまでどおり、元のファイルをそのまま
        if (!plan.tiled && sh.asIs) {
          out.push(sh.asIs);
          continue;
        }
        out.push(...(await renderSheet(plan, sh.label(0), sh.kind, sh.draw)));
      }
      if (out.length <= MAX_SEND_IMAGES && sizeOf(out) <= MAX_TOTAL_BASE64) return out;
      if (maxTiles === 1) break;
    }
    return original();
  } catch {
    return original();
  }
}
