import { SECTIONALIZER_SETS, isBuiltinTextLine, setComposition } from '@zumen/knowledge';
import type { SectionalizerSet } from '@zumen/knowledge';
import { layout, snap } from '@zumen/layout';
import { getSymbol, shapesToSvg } from '@zumen/symbols';
import { applyAnchors, controlNet, docBounds, freshId, fromLayout } from './doc.ts';
import type { Doc, DocItem, DocSymbol, DocWire } from './doc.ts';

/**
 * 「記号を追加・差し替え」の「区分開閉器」リスト（第20弾 項目6）：セットを、図面に足す。
 *
 * 区分開閉器（PAS・PGS・UGS）・内蔵機器・継電器（GR または DGR）・制御線を、自動作図と同じ形で、ひとまとめで足す。
 * 継電器は、区分開閉器の「子」にする（区分開閉器と一緒に動き、一緒に消える）。
 * 区分開閉器を、ほかの記号に差し替えたときは、継電器は、そのまま残る。
 * 足す位置は、ふつうの「記号を追加」と同じ（図面の下の、横の真ん中）。
 */
/**
 * セットを、図面に入れる形（記号・線。id は、図面の中で重ならないものに付け替え済み）にする。
 * placeAt は、移動量を決める関数（セットだけの図面での、範囲と、区分開閉器の位置が引数）
 */
function buildSetItems(
  set: SectionalizerSet,
  pasNew: string,
  placeAt: (made: Doc, pas: DocSymbol) => { dx: number; dy: number },
  taken: Set<string>,
): DocItem[] {
  const { items, answers } = setComposition(set);
  const made = fromLayout(layout(items, answers));
  const pasOld = 'pas';
  const rename = new Map<string, string>([[pasOld, pasNew]]);
  for (const it of made.items) {
    if (it.kind !== 'symbol' || it.id === pasOld) continue;
    // 例：pas-zct → sym-12-zct
    let id = `${pasNew}-${it.id.replace(/^pas-/, '')}`;
    while (taken.has(id)) id += '_';
    taken.add(id);
    rename.set(it.id, id);
  }
  const ren = (id: string): string => rename.get(id) ?? id;
  const pasMade = made.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === pasOld)!;
  const { dx, dy } = placeAt(made, pasMade);
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
  return out;
}

export function addSectionalizerSet(doc: Doc, set: SectionalizerSet): { doc: Doc; id: string } {
  const taken = new Set(doc.items.map((i) => i.id));
  const pasNew = freshId('sym', taken);
  taken.add(pasNew);
  const out = buildSetItems(set, pasNew, (made) => {
    const cb = docBounds(made);
    const b = docBounds(doc);
    const has = Number.isFinite(b.x0);
    // 既にある図面の、横の真ん中・下の端から60下に、セットの上端の中央を合わせる（ふつうの「記号を追加」と同じ）
    return { dx: snap((has ? (b.x0 + b.x1) / 2 : 0) - (cb.x0 + cb.x1) / 2), dy: snap((has ? b.y1 + 60 : 0) - cb.y0) };
  }, taken);
  return { doc: { ...doc, items: [...doc.items, ...out] }, id: pasNew };
}

const PAS_FAMILY = new Set(['pas', 'pgs', 'ugs']);

/** 区分開閉器（PAS・PGS・UGS）の記号か。内蔵を入れ替えられるのは、これだけ */
export function isSectionalizer(it: DocItem | null | undefined): it is DocSymbol {
  if (!it || it.kind !== 'symbol') return false;
  const def = getSymbol(it.symbolId);
  return PAS_FAMILY.has(def.altOf ?? def.id);
}

/**
 * 選んでいる区分開閉器の、中身（ZCT・VT・LA・ZPD）と、継電器（GR・DGR）・制御線を、セットのものに入れ替える（第20弾 項目6 の続き）。
 * 区分開閉器の位置（入口の接続点）・上下につながっている線は、そのまま。名前の文字（PAS・PGS・UGS）と、「〜内蔵型」の行は、セットに合わせ、
 * そのほかの行（定格など、手で書いた文字）は、残す。回してある区分開閉器は、入れ替えない（null を返す）。
 */
export function swapSectionalizerSet(doc: Doc, pasId: string, set: SectionalizerSet): Doc | null {
  const pas = doc.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === pasId);
  if (!pas || !isSectionalizer(pas) || pas.rotate % 360 !== 0) return null;
  // いまの中身：スロットに入っている子と、継電器（子、または、制御線の先にあるもの）、制御線
  const kids = doc.items.filter((i): i is DocSymbol => i.kind === 'symbol' && i.parent === pasId);
  const members = new Set([pasId, ...kids.map((k) => k.id)]);
  const net = controlNet(doc, members, true);
  const goneSyms = new Set([...kids.map((k) => k.id), ...net.relays]);
  // 制御線は、継電器・子が消えてからも、見つけられるように、先に調べた結果（net.wires）を使う
  const taken = new Set(doc.items.filter((i) => !goneSyms.has(i.id) && !net.wires.has(i.id)).map((i) => i.id));
  const inOld = getSymbol(pas.symbolId).ports.find((p) => p.id === 'in')!;
  let pasMade: DocSymbol | undefined;
  const out = buildSetItems(set, pasId, (_made, pm) => {
    pasMade = { ...pm };
    const inNew = getSymbol(pm.symbolId).ports.find((p) => p.id === 'in')!;
    // 区分開閉器の入口の接続点が、いまと同じ場所になるように、セット全体を動かす
    return { dx: pas.x + inOld.x - (pm.x + inNew.x), dy: pas.y + inOld.y - (pm.y + inNew.y) };
  }, taken);
  const madePas = out.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === pasId)!;
  if (!pasMade) return null;
  // 名前の文字と「〜内蔵型」の行だけ、セットに合わせる。ほかの行は、残す
  const head = madePas.label[0] ?? '';
  const tail = madePas.label.filter(isBuiltinTextLine);
  const old = pas.label;
  const keep = old.filter((l, i) => !(i === 0 && /^(PAS|PGS|UGS)$/.test(l)) && !isBuiltinTextLine(l));
  const label = [...(/^(PAS|PGS|UGS)$/.test(old[0] ?? '') || old.length === 0 ? [head] : []), ...keep, ...tail];
  const newPas: DocSymbol = { ...pas, symbolId: madePas.symbolId, x: madePas.x, y: madePas.y, label, labelDx: madePas.labelDx, labelDy: madePas.labelDy, labelAnchor: madePas.labelAnchor };
  // 入力欄から作った文字（values）は、文字を作り直したので、持ち越さない
  delete (newPas as { values?: unknown }).values;
  const items: DocItem[] = [
    ...doc.items.filter((i) => !goneSyms.has(i.id) && !net.wires.has(i.id)).map((i) => (i.id === pasId ? newPas : i)),
    ...out.filter((i) => i.id !== pasId),
  ];
  return applyAnchors({ ...doc, items });
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
