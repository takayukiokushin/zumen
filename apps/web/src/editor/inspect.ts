import { getSymbol } from '@zumen/symbols';
import { sheetSize } from '@zumen/layout';
import type { Orientation, PaperSize } from '@zumen/layout';
import type { Doc, DocItem, DocSymbol, DocText, DocWire } from './doc.ts';
import { applyAnchors, descendantsOf, docBounds, linkWires, nearestPort, portsOf } from './doc.ts';

/**
 * 図面全体を見まわして、おかしなところを直す。
 *
 * これまでの「結線を整える」は、線の端を接続点に合わせるだけだった。
 * ここでは、それに加えて次のことをする。
 *
 *   1. 余分な線（長さ0・まったく同じ線）を消す
 *   2. 宙に浮いた線の端を、近くの接続点につなぐ
 *   3. 記号の中を突き抜けている線を、記号の手前で止める
 *   4. 文字どうし・文字と記号・文字と線の重なりを、文字をずらして解く
 *   5. 用紙に対して図面が大きすぎないか見る
 *
 * 直したあとにもう一度調べ直して、残った問題を返す。
 * 直しきれなかったものは、図面の上に印を出して知らせる。
 */

export type IssueKind = 'floating' | 'stray' | 'through' | 'overlap' | 'paper';

export interface Issue {
  kind: IssueKind;
  /** 画面に出す説明 */
  message: string;
  /** 図面のどこの話か（印を出す位置） */
  x: number;
  y: number;
  itemId?: string;
}

export interface TidyResult {
  doc: Doc;
  /** 直した件数 */
  fixed: Record<IssueKind, number>;
  /** 直しきれずに残ったもの */
  issues: Issue[];
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  floating: 'つながっていない線',
  stray: '余分な線',
  through: '記号を突き抜けている線',
  overlap: '重なっている文字',
  paper: '用紙に収まりきらない',
};

/**
 * 線の端を、この距離まで探して接続点につなぐ。
 * 広げすぎると、関係のない接続点に勝手につないでしまうので、
 * 記号の枠の半分ほど（＝明らかにそこへつなぐつもりだった距離）にしてある。
 */
const REACH = 24;
/** 点が線や接続点の上にあるとみなす距離 */
const TOUCH = 1.5;
/**
 * 文字をずらしてよい限界（元の位置からの距離）。
 * 3行の文字は高さ30・幅60ほどあるので、これより小さいと重なりを解けない。
 */
const NUDGE_LIMIT = 64;
/** ずらす刻み */
const NUDGE_STEP = 8;

const emptyCount = (): Record<IssueKind, number> => ({
  floating: 0,
  stray: 0,
  through: 0,
  overlap: 0,
  paper: 0,
});

/* ------------------------------------------------------------------ */
/* 寸法まわりの細かい道具                                               */
/* ------------------------------------------------------------------ */

/** 図面の文字の横幅。全角は1文字ぶん、半角は約半分で数える */
export function textWidth(line: string, size = 8): number {
  let n = 0;
  for (const ch of line) n += /[\x20-\x7E｡-ﾟ]/.test(ch) ? 0.54 : 1;
  return n * size;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box, gap = 0): boolean =>
  a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1;

/** 文字の並びが占める範囲 */
function textBox(x: number, y: number, lines: string[], anchor: 'start' | 'middle' | 'end'): Box {
  const w = Math.max(0, ...lines.map((l) => textWidth(l)));
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  // yは1行目のベースライン。上に文字の高さぶん、下に行数ぶん
  return { x0, y0: y - 8, x1: x0 + w, y1: y + (lines.length - 1) * 10 + 3 };
}

/** 記号が占める範囲（絵のぶんだけ。文字は別に数える） */
function symbolBox(it: DocSymbol): Box {
  const def = getSymbol(it.symbolId);
  return { x0: it.x, y0: it.y, x1: it.x + def.box.w, y1: it.y + def.box.h };
}

/** 点と線分の距離 */
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 線分が四角の中を通るか（ふちに触れるだけは数えない） */
function segmentEntersBox(w: DocWire, b: Box, inset = 1): boolean {
  const box = { x0: b.x0 + inset, y0: b.y0 + inset, x1: b.x1 - inset, y1: b.y1 - inset };
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return false;
  const inside = (x: number, y: number) => x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
  if (inside(w.x1, w.y1) || inside(w.x2, w.y2)) return true;
  // 縦横の線しか使わないので、またいでいるかだけ見ればよい
  if (w.x1 === w.x2) {
    return w.x1 > box.x0 && w.x1 < box.x1 && Math.min(w.y1, w.y2) < box.y0 && Math.max(w.y1, w.y2) > box.y1;
  }
  if (w.y1 === w.y2) {
    return w.y1 > box.y0 && w.y1 < box.y1 && Math.min(w.x1, w.x2) < box.x0 && Math.max(w.x1, w.x2) > box.x1;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 本体                                                                 */
/* ------------------------------------------------------------------ */

const wiresOf = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
const symbolsOf = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
const textsOf = (d: Doc) => d.items.filter((i): i is DocText => i.kind === 'text');

/** その線が、どの記号につながっているか（親子もひとかたまりとして数える） */
function relatedSymbols(doc: Doc, w: DocWire): Set<string> {
  const out = new Set<string>();
  for (const a of [w.at1, w.at2]) {
    if (!a) continue;
    out.add(a.item);
    const it = doc.items.find((i) => i.id === a.item);
    if (it && it.kind === 'symbol' && it.parent) out.add(it.parent);
    for (const kid of descendantsOf(doc, a.item)) out.add(kid);
    // 同じ親を持つ兄弟も、ひとかたまりとみなす
    if (it && it.kind === 'symbol' && it.parent) {
      for (const kid of descendantsOf(doc, it.parent)) out.add(kid);
    }
  }
  return out;
}

/** 1 余分な線を消す */
function dropStrayWires(doc: Doc): { doc: Doc; removed: number } {
  const seen = new Set<string>();
  const keep: DocItem[] = [];
  let removed = 0;
  for (const it of doc.items) {
    if (it.kind !== 'wire') {
      keep.push(it);
      continue;
    }
    const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
    if (len < 0.5) {
      removed++;
      continue;
    }
    // 向きが逆なだけの同じ線は1本にまとめる
    const a = `${it.x1},${it.y1}`;
    const b = `${it.x2},${it.y2}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    keep.push(it);
  }
  return { doc: { ...doc, items: keep }, removed };
}

/** 2 宙に浮いた端を、近くの接続点につなぐ */
function attachFloatingEnds(doc: Doc): { doc: Doc; fixed: number; issues: Issue[] } {
  const issues: Issue[] = [];
  let fixed = 0;
  const all = wiresOf(doc);

  const touchesOtherWire = (self: DocWire, x: number, y: number): boolean =>
    all.some((o) => o.id !== self.id && distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= TOUCH);

  const items = doc.items.map((it) => {
    if (it.kind !== 'wire') return it;
    const w = { ...it };
    for (const end of [1, 2] as const) {
      if (end === 1 ? w.at1 : w.at2) continue;
      const x = end === 1 ? w.x1 : w.x2;
      const y = end === 1 ? w.y1 : w.y2;
      // すでに接続点の上、または他の線とつながっているなら、浮いていない
      if (nearestPort(doc, x, y, TOUCH)) continue;
      if (touchesOtherWire(it, x, y)) continue;

      const p = nearestPort(doc, x, y, REACH);
      if (p) {
        if (end === 1) w.at1 = { item: p.item, port: p.port };
        else w.at2 = { item: p.item, port: p.port };
        fixed++;
      } else {
        issues.push({
          kind: 'floating',
          message: '線の端がどこにもつながっていません。近くに接続点が見つかりませんでした',
          x,
          y,
          itemId: it.id,
        });
      }
    }
    return w;
  });
  return { doc: { ...doc, items }, fixed, issues };
}

/** 3 記号の中を突き抜けている線を、記号の手前で止める */
function trimThroughSymbols(doc: Doc): { doc: Doc; fixed: number; issues: Issue[] } {
  const issues: Issue[] = [];
  let fixed = 0;
  const symbols = symbolsOf(doc);

  const items = doc.items.map((it) => {
    if (it.kind !== 'wire') return it;
    const w = { ...it };
    const related = relatedSymbols(doc, it);
    for (const s of symbols) {
      if (related.has(s.id)) continue;
      const box = symbolBox(s);
      if (!segmentEntersBox(w, box)) continue;

      const inside = (x: number, y: number) => x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
      const end1In = inside(w.x1, w.y1);
      const end2In = inside(w.x2, w.y2);

      if (end1In !== end2In) {
        // 片側だけ中に入っている → 記号のふちまで引っ込める
        const moveEnd = end1In ? 1 : 2;
        if (w.x1 === w.x2) {
          const other = moveEnd === 1 ? w.y2 : w.y1;
          const edge = other < box.y0 ? box.y0 : box.y1;
          if (moveEnd === 1) w.y1 = edge;
          else w.y2 = edge;
        } else {
          const other = moveEnd === 1 ? w.x2 : w.x1;
          const edge = other < box.x0 ? box.x0 : box.x1;
          if (moveEnd === 1) w.x1 = edge;
          else w.x2 = edge;
        }
        fixed++;
      } else {
        // 通り抜けている → 2本に割らないと直せないので、印だけ付ける
        issues.push({
          kind: 'through',
          message: `線が記号（${getSymbol(s.symbolId).abbr}）を突き抜けています`,
          x: (box.x0 + box.x1) / 2,
          y: (box.y0 + box.y1) / 2,
          itemId: it.id,
        });
      }
    }
    return w;
  });
  return { doc: { ...doc, items }, fixed, issues };
}

/**
 * 文字のぶつかり具合を点数にする。小さいほどよい。
 * 文字どうしの重なりがいちばん困るので重くし、
 * 細い線をまたぐのは図面では普通なので軽く見る。
 */
const CLASH_TEXT = 10;
const CLASH_SYMBOL = 4;
const CLASH_WIRE = 1;

function clashScore(box: Box, placed: Box[], symbols: Box[], wires: DocWire[]): number {
  let n = 0;
  for (const o of placed) if (overlaps(box, o, 1)) n += CLASH_TEXT;
  for (const s of symbols) if (overlaps(box, s, 0)) n += CLASH_SYMBOL;
  for (const w of wires) if (segmentEntersBox(w, box, 0)) n += CLASH_WIRE;
  return n;
}

/** 4 重なっている文字をずらす */
function spreadLabels(doc: Doc): { doc: Doc; fixed: number; issues: Issue[] } {
  const issues: Issue[] = [];
  let fixed = 0;
  const symbols = symbolsOf(doc);
  const symBoxes = symbols.map(symbolBox);
  const wires = wiresOf(doc);

  /** いま決まっている文字の置き場所 */
  const placed: Box[] = [];
  const items: DocItem[] = doc.items.map((it) => ({ ...it }));

  // 文字を持つものを、上から順に決めていく
  const targets = items
    .filter((it): it is DocSymbol | DocText => (it.kind === 'symbol' && it.label.length > 0) || it.kind === 'text')
    .sort((a, b) => (a.kind === 'symbol' ? a.y : a.y) - (b.kind === 'symbol' ? b.y : b.y));

  for (const it of targets) {
    const lines = it.kind === 'symbol' ? it.label : it.lines;
    const anchor = it.kind === 'symbol' ? it.labelAnchor : it.anchor;
    const baseX = it.kind === 'symbol' ? it.x + it.labelDx : it.x;
    const baseY = it.kind === 'symbol' ? it.y + it.labelDy : it.y;
    // 自分の記号そのものとは重なってよい扱いにする（文字は記号の横に出すため）
    const others = symbols
      .map((s2, i2) => ({ id: s2.id, box: symBoxes[i2]! }))
      .filter((e) => e.id !== it.id)
      .map((e) => e.box);

    let best = { dx: 0, dy: 0, bad: clashScore(textBox(baseX, baseY, lines, anchor), placed, others, wires) };
    // 文字どうしが重なっているときだけ動かす（線をまたぐだけなら動かさない）
    if (best.bad >= CLASH_TEXT) {
      // 右・下・上・左の順に、少しずつ離して空いているところを探す
      const step = NUDGE_STEP;
      outer: for (let r = 1; r * step <= NUDGE_LIMIT; r++) {
        for (const [ux, uy] of [
          [1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 0], [-1, 1], [-1, -1],
        ] as const) {
          const dx = ux * r * step;
          const dy = uy * r * step;
          const bad = clashScore(textBox(baseX + dx, baseY + dy, lines, anchor), placed, others, wires);
          if (bad < best.bad) best = { dx, dy, bad };
          if (bad < CLASH_TEXT) break outer;
        }
      }
      if (best.dx !== 0 || best.dy !== 0) {
        if (it.kind === 'symbol') {
          it.labelDx += best.dx;
          it.labelDy += best.dy;
        } else {
          it.x += best.dx;
          it.y += best.dy;
        }
        fixed++;
      }
      if (best.bad >= CLASH_TEXT) {
        issues.push({
          kind: 'overlap',
          message: `文字「${lines[0] ?? ''}」が、ほかのものと重なっています`,
          x: baseX + best.dx,
          y: baseY + best.dy,
          itemId: it.id,
        });
      }
    }
    placed.push(textBox(baseX + best.dx, baseY + best.dy, lines, anchor));
  }

  return { doc: { ...doc, items }, fixed, issues };
}

/** 5 用紙に対して図面が大きすぎないか */
function checkPaper(doc: Doc, paper: PaperSize, orientation: Orientation): Issue[] {
  const b = docBounds(doc);
  const s = sheetSize(paper, orientation);
  // renderSvg と同じ余白の取り方
  const areaW = s.w - 24 * 2 - 12 * 2;
  const areaH = s.h - 24 * 2 - 44 - 12 * 2 - 18;
  const scale = Math.min(areaW / Math.max(b.x1 - b.x0, 1), areaH / Math.max(b.y1 - b.y0, 1), 1);
  if (scale >= 0.45) return [];
  const other = orientation === 'portrait' ? '横向き' : '縦向き';
  return [
    {
      kind: 'paper',
      message:
        `図面が用紙（${paper} ${orientation === 'portrait' ? '縦' : '横'}）に対して大きく、` +
        `${Math.round(scale * 100)}% まで縮めて収めています。` +
        `${paper === 'A4' ? 'A3にするか、' : ''}${other}にすると読みやすくなります`,
      x: (b.x0 + b.x1) / 2,
      y: b.y0,
    },
  ];
}

/** 直さずに調べるだけ（直したあとの確かめにも使う） */
export function inspectDrawing(doc: Doc, paper: PaperSize, orientation: Orientation): Issue[] {
  const issues: Issue[] = [];
  const symbols = symbolsOf(doc);
  const wires = wiresOf(doc);

  // つながっていない端
  for (const w of wires) {
    for (const end of [1, 2] as const) {
      if (end === 1 ? w.at1 : w.at2) continue;
      const x = end === 1 ? w.x1 : w.x2;
      const y = end === 1 ? w.y1 : w.y2;
      if (nearestPort(doc, x, y, TOUCH)) continue;
      if (wires.some((o) => o.id !== w.id && distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= TOUCH)) continue;
      issues.push({ kind: 'floating', message: '線の端がどこにもつながっていません', x, y, itemId: w.id });
    }
  }

  // 記号を突き抜けている線
  for (const w of wires) {
    const related = relatedSymbols(doc, w);
    for (const s of symbols) {
      if (related.has(s.id)) continue;
      const box = symbolBox(s);
      if (!segmentEntersBox(w, box)) continue;
      issues.push({
        kind: 'through',
        message: `線が記号（${getSymbol(s.symbolId).abbr}）を突き抜けています`,
        x: (box.x0 + box.x1) / 2,
        y: (box.y0 + box.y1) / 2,
        itemId: w.id,
      });
    }
  }

  // 文字の重なり
  const boxes: { box: Box; id: string; head: string }[] = [];
  for (const it of symbols) {
    if (it.label.length === 0) continue;
    boxes.push({
      box: textBox(it.x + it.labelDx, it.y + it.labelDy, it.label, it.labelAnchor),
      id: it.id,
      head: it.label[0] ?? '',
    });
  }
  for (const it of textsOf(doc)) {
    boxes.push({ box: textBox(it.x, it.y, it.lines, it.anchor), id: it.id, head: it.lines[0] ?? '' });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!overlaps(boxes[i]!.box, boxes[j]!.box, 1)) continue;
      issues.push({
        kind: 'overlap',
        message: `文字「${boxes[i]!.head}」と「${boxes[j]!.head}」が重なっています`,
        x: boxes[i]!.box.x0,
        y: boxes[i]!.box.y0 + 8,
        itemId: boxes[i]!.id,
      });
    }
  }

  issues.push(...checkPaper(doc, paper, orientation));
  return issues;
}

/**
 * 図面を整える。直したうえで、残った問題を返す。
 * 元に戻せるよう、呼ぶ側で履歴に積むこと。
 */
export function tidyDrawing(doc: Doc, paper: PaperSize = 'A4', orientation: Orientation = 'portrait'): TidyResult {
  const fixed = emptyCount();

  // 線の端を接続点に結び直す（これまでの「整える」と同じ）
  let next = applyAnchors(linkWires(doc));

  const a = dropStrayWires(next);
  next = a.doc;
  fixed.stray += a.removed;

  const b = attachFloatingEnds(next);
  next = applyAnchors(b.doc);
  fixed.floating += b.fixed;

  const c = trimThroughSymbols(next);
  next = c.doc;
  fixed.through += c.fixed;

  // 引っ込めたことで端が浮いた線を、もう一度つなぎ直す
  const b2 = attachFloatingEnds(next);
  next = applyAnchors(b2.doc);
  fixed.floating += b2.fixed;

  const d = spreadLabels(next);
  next = d.doc;
  fixed.overlap += d.fixed;

  // 直したあと、もう一度調べ直す
  const issues = inspectDrawing(next, paper, orientation);
  return { doc: next, fixed, issues };
}

/** 接続点の一覧（検査の説明に使う） */
export const portCount = (doc: Doc): number =>
  symbolsOf(doc).reduce((n, s) => n + portsOf(s).length, 0);
