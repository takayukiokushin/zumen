import { SECTIONALIZER_SETS, setComposition } from '@zumen/knowledge';
import type { SectionalizerSet } from '@zumen/knowledge';
import { layout, snap } from '@zumen/layout';
import { getSymbol, shapesToSvg } from '@zumen/symbols';
import { docBounds, freshId, fromLayout } from './doc.ts';
import type { Doc, DocItem, DocSymbol, DocWire } from './doc.ts';

/**
 * 「記号を追加・差し替え」の「区分開閉器」リスト（第20弾 項目6）：セットを、図面に足す。
 *
 * 区分開閉器（PAS・PGS・UGS）・内蔵機器・継電器（GR または DGR）・制御線を、自動作図と同じ形で、ひとまとめで足す。
 * 継電器は、区分開閉器の「子」にする（区分開閉器と一緒に動き、一緒に消える）。
 * 区分開閉器を、ほかの記号に差し替えたときは、継電器は、そのまま残る。
 * 足す位置は、ふつうの「記号を追加」と同じ（図面の下の、横の真ん中）。
 */
export function addSectionalizerSet(doc: Doc, set: SectionalizerSet): { doc: Doc; id: string } {
  const { items, answers } = setComposition(set);
  const made = fromLayout(layout(items, answers));
  const taken = new Set(doc.items.map((i) => i.id));
  const rename = new Map<string, string>();
  const pasOld = 'pas';
  const pasNew = freshId('sym', taken);
  taken.add(pasNew);
  rename.set(pasOld, pasNew);
  for (const it of made.items) {
    if (it.kind !== 'symbol' || it.id === pasOld) continue;
    // 例：pas-zct → sym-12-zct
    let id = `${pasNew}-${it.id.replace(/^pas-/, '')}`;
    while (taken.has(id)) id += '_';
    taken.add(id);
    rename.set(it.id, id);
  }
  const ren = (id: string): string => rename.get(id) ?? id;

  const cb = docBounds(made);
  const b = docBounds(doc);
  const has = Number.isFinite(b.x0);
  // 既にある図面の、横の真ん中・下の端から60下に、セットの上端の中央を合わせる（ふつうの「記号を追加」と同じ）
  const dx = snap((has ? (b.x0 + b.x1) / 2 : 0) - (cb.x0 + cb.x1) / 2);
  const dy = snap((has ? b.y1 + 60 : 0) - cb.y0);

  const out: DocItem[] = [];
  for (const it of made.items) {
    if (it.kind === 'symbol') {
      const s: DocSymbol = { ...it, id: ren(it.id), x: it.x + dx, y: it.y + dy };
      // 継電器（GR・DGR）は、区分開閉器の子にする（スロットは無い）
      if (/^relay-(gr|dgr)$/.test(it.symbolId)) s.parent = pasNew;
      else if (it.parent) s.parent = ren(it.parent);
      out.push(s);
    } else if (it.kind === 'wire') {
      const w: DocWire = {
        ...it,
        id: freshId('wire', taken),
        x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy,
        ...(it.at1 ? { at1: { ...it.at1, item: ren(it.at1.item) } } : {}),
        ...(it.at2 ? { at2: { ...it.at2, item: ren(it.at2.item) } } : {}),
      };
      taken.add(w.id);
      out.push(w);
    }
  }
  return { doc: { ...doc, items: [...doc.items, ...out] }, id: pasNew };
}

/** 一覧に出す、小さな見本の絵（SVG）。セットごとに、1回だけ作って覚える */
const THUMBS = new Map<string, { svg: string; w: number; h: number }>();
export function setThumb(set: SectionalizerSet): { svg: string; w: number; h: number } {
  const c = THUMBS.get(set.id);
  if (c) return c;
  const { items, answers } = setComposition(set);
  const d = layout(items, answers);
  const pad = 4;
  const parts: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of d.symbols) {
    const def = getSymbol(s.symbolId);
    parts.push(`<g transform="translate(${s.x} ${s.y})">${shapesToSvg(def.shapes)}</g>`);
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + def.box.w); y1 = Math.max(y1, s.y + def.box.h);
  }
  for (const w of d.wires) {
    parts.push(`<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"/>`);
    x0 = Math.min(x0, w.x1, w.x2); x1 = Math.max(x1, w.x1, w.x2);
    y0 = Math.min(y0, w.y1, w.y2); y1 = Math.max(y1, w.y1, w.y2);
  }
  const w = x1 - x0 + pad * 2;
  const h = y1 - y0 + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 0.5}" height="${h * 0.5}" aria-hidden="true"><g transform="translate(${pad - x0} ${pad - y0})" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g></svg>`;
  const r = { svg, w, h };
  THUMBS.set(set.id, r);
  return r;
}

export { SECTIONALIZER_SETS };
