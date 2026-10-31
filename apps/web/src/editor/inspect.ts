import { getSymbol } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, SHEET_MARGIN, SHEET_PAD, layoutTitle, rotatedBox, sheetSize } from '@zumen/layout';
import type { Orientation, PaperSize, TitleBlock } from '@zumen/layout';
import type { Doc, DocItem, DocSymbol, DocText, DocWire } from './doc.ts';
import { applyAnchors, descendantsOf, docBounds, groupOf, groupRootOf, linkWires, moveItem, nearestPort, portsOf } from './doc.ts';

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

export type IssueKind = 'floating' | 'stray' | 'through' | 'overlap' | 'skew' | 'paper' | 'gap';

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
  skew: '斜めになっている線',
  paper: '用紙に収まりきらない',
  gap: '整えた間隔',
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
  skew: 0,
  paper: 0,
  gap: 0,
});

/* ------------------------------------------------------------------ */
/* 寸法まわりの細かい道具                                               */
/* ------------------------------------------------------------------ */

/** 図面の文字の横幅。全角は1文字ぶん、半角は約半分で数える */
export function textWidth(line: string, size = LABEL_FONT): number {
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
  return { x0, y0: y - LABEL_FONT, x1: x0 + w, y1: y + (lines.length - 1) * LABEL_LINE + 3 };
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

/**
 * PASの中のLA・VTのような内蔵機器は、親の記号の中に描かれた主回路から
 * 横に分かれている。その分岐点は親の記号の上にあるので、浮いてはいない。
 *
 * これを「浮いている」と見なすと、分岐線が内蔵機器のほうへ吸い寄せられて
 * 長さがゼロになり、「LAが母線につながっていない」状態になってしまう。
 */
function branchesInsideParent(doc: Doc, w: DocWire, x: number, y: number): boolean {
  for (const a of [w.at1, w.at2]) {
    if (!a) continue;
    const kid = doc.items.find((i) => i.id === a.item);
    if (!kid || kid.kind !== 'symbol' || !kid.parent) continue;
    const parent = doc.items.find((i) => i.id === kid.parent);
    if (!parent || parent.kind !== 'symbol') continue;
    const b = symbolBox(parent);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return true;
  }
  return false;
}

/** 途切れた線を、向かい合う端どうしでつなぐときの、いちばん長い隙間（これより離れたものは、別の線とみなす） */
const BRIDGE_REACH = 400;
/** 向かい合う2本が「同じ直線の上」とみなす、横（縦）のずれ */
const BRIDGE_SKEW = 1.5;

interface FreeEnd {
  wire: DocWire;
  end: 1 | 2;
  x: number;
  y: number;
  /** 線の向き（反対の端から、この端へ向かう単位ベクトル） */
  dx: number;
  dy: number;
}

/** 宙に浮いている線の端（縦横のまっすぐな線だけ）。どこにもつながっていないもの */
function freeEnds(doc: Doc): FreeEnd[] {
  const all = wiresOf(doc);
  const out: FreeEnd[] = [];
  for (const w of all) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const straight = w.x1 === w.x2 || w.y1 === w.y2;
    if (len < 0.5 || !straight) continue;
    for (const end of [1, 2] as const) {
      if (end === 1 ? w.at1 : w.at2) continue;
      const x = end === 1 ? w.x1 : w.x2;
      const y = end === 1 ? w.y1 : w.y2;
      if (nearestPort(doc, x, y, TOUCH)) continue;
      // ほかの線が、この点を通り抜けている（T字につながっている）なら、浮いていない。
      // 線の端どうしが触れているだけのときは、記号を消した跡（もとは接続点だった所）なので、浮いているとみなす
      const passesThrough = (o: DocWire) =>
        o.id !== w.id &&
        distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= TOUCH &&
        Math.hypot(x - o.x1, y - o.y1) > TOUCH &&
        Math.hypot(x - o.x2, y - o.y2) > TOUCH;
      if (all.some(passesThrough)) continue;
      // 線の端が3本以上、同じ点に集まっているのは、分岐の結び目（つながっている）
      const meeting = all.filter(
        (o) => o.id !== w.id && (Math.hypot(x - o.x1, y - o.y1) <= TOUCH || Math.hypot(x - o.x2, y - o.y2) <= TOUCH),
      );
      if (meeting.length >= 2) continue;
      // 同じ直線の上で、端と端がぴったり続いている（1本の線が2本に分かれているだけ）なら、つながっている
      const continues = meeting.some((o) =>
        w.x1 === w.x2 ? o.x1 === o.x2 && Math.abs(o.x1 - w.x1) <= TOUCH : w.y1 === w.y2 && o.y1 === o.y2 && Math.abs(o.y1 - w.y1) <= TOUCH,
      );
      if (continues) continue;
      if (branchesInsideParent(doc, w, x, y)) continue;
      const fromX = end === 1 ? w.x2 : w.x1;
      const fromY = end === 1 ? w.y2 : w.y1;
      out.push({ wire: w, end, x, y, dx: Math.sign(x - fromX), dy: Math.sign(y - fromY) });
    }
  }
  return out;
}

/** 向かい合って、同じ直線の上にあり、間に記号が無い端（つなぎ直せる相手の候補） */
function bridgeCandidates(doc: Doc, e: FreeEnd, ends: FreeEnd[]): FreeEnd[] {
  const symbols = symbolsOf(doc);
  return ends.filter((f) => {
    if (f.wire.id === e.wire.id) return false;
    if (f.dx !== -e.dx || f.dy !== -e.dy) return false;
    // e から見て、進む向きの前にある
    const ahead = (f.x - e.x) * e.dx + (f.y - e.y) * e.dy;
    if (ahead < 0.5 || ahead > BRIDGE_REACH) return false;
    // 同じ直線の上
    const off = e.dx !== 0 ? Math.abs(f.y - e.y) : Math.abs(f.x - e.x);
    if (off > BRIDGE_SKEW) return false;
    // 間に記号があれば、つなぐと突き抜けてしまう
    const probe: DocWire = { kind: 'wire', id: '', x1: e.x, y1: e.y, x2: f.x, y2: f.y };
    return !symbols.some((s) => segmentEntersBox(probe, symbolBox(s)));
  });
}

/**
 * 0 記号を消して途切れた線を、つなぎ直す。
 *
 * 記号を消すと、その上と下（分岐なら手前と先）の線が、記号のあった場所で途切れる。
 * 向かい合う2本の端が、同じ直線の上にあって、間に何も無く、相手がほかに無いときだけ、1本の線につなぐ
 * （両端のつなぎ先は引き継ぐ）。
 * 相手が2つ以上あって一つに決まらないときは、勝手につながず、印を出して確認してもらう。
 */
function bridgeBrokenWires(doc: Doc): { doc: Doc; fixed: number; unsure: { x: number; y: number }[] } {
  let cur = doc;
  let fixed = 0;
  // つなぐたびに状況が変わるので、つなげるものが無くなるまで繰り返す
  for (let guard = 0; guard < 200; guard++) {
    const ends = freeEnds(cur);
    let pair: [FreeEnd, FreeEnd] | null = null;
    for (const e of ends) {
      const mine = bridgeCandidates(cur, e, ends);
      if (mine.length !== 1) continue;
      const f = mine[0]!;
      const theirs = bridgeCandidates(cur, f, ends);
      if (theirs.length === 1 && theirs[0]!.wire.id === e.wire.id) {
        pair = [e, f];
        break;
      }
    }
    if (!pair) break;
    const [e, f] = pair;
    // e の線の浮いた端を、f の線の反対の端まで延ばして、f の線は1本にまとめて消す
    const fFarX = f.end === 1 ? f.wire.x2 : f.wire.x1;
    const fFarY = f.end === 1 ? f.wire.y2 : f.wire.y1;
    const fFar = f.end === 1 ? f.wire.at2 : f.wire.at1;
    cur = {
      ...cur,
      items: cur.items
        .filter((it) => it.id !== f.wire.id)
        .map((it) => {
          if (it.id !== e.wire.id || it.kind !== 'wire') return it;
          // つなぎ直した線は、もう行き止まりではないので、「消した記号につながっていた」印は外す
          const w: DocWire = { ...it, dashed: it.dashed || f.wire.dashed, orphan: undefined };
          if (e.end === 1) {
            w.x1 = fFarX;
            w.y1 = fFarY;
            w.at1 = fFar;
          } else {
            w.x2 = fFarX;
            w.y2 = fFarY;
            w.at2 = fFar;
          }
          return w;
        }),
    };
    fixed++;
  }

  // 残った浮いた端のうち、相手の候補があるのに一つに決まらなかったもの
  const ends = freeEnds(cur);
  const unsure = ends.filter((e) => bridgeCandidates(cur, e, ends).length > 0).map((e) => ({ x: e.x, y: e.y }));
  return { doc: cur, fixed, unsure };
}

/**
 * 記号を消して行き止まりになった線を消す。
 *
 * 消した記号につないであった線のうち、つなぎ直しても、まだ端が宙に浮いているものは、
 * 何にもつながらない線（たとえば、消したZPDへの枝線）なので、一緒に消す。
 * 手で引いた線や、もともと浮いていた線は消さない（消した記号につながっていた線にだけ印が付いている）。
 * 相手が一つに決まらず、確認してもらうことにした端は、残す。
 * 印は、ここで外す（つなぎ直せたものは、そのまま残る）。
 */
function dropDeadEnds(doc: Doc, keep: { x: number; y: number }[]): { doc: Doc; removed: number } {
  const near = (px: number, py: number, qx: number, qy: number) => Math.hypot(px - qx, py - qy) < 1;
  let cur = doc;
  let removed = 0;
  // 1本消すと、その先につながっていた線（折れ曲がりの途中など）も行き止まりになるので、なくなるまで繰り返す
  for (let guard = 0; guard < 50; guard++) {
    const points: { x: number; y: number }[] = [];
    const items: DocItem[] = [];
    let any = false;
    for (const it of cur.items) {
      if (it.kind !== 'wire' || !it.orphan) {
        items.push(it);
        continue;
      }
      const dangling = !it.at1 || !it.at2;
      const asked = keep.some((k) => near(k.x, k.y, it.x1, it.y1) || near(k.x, k.y, it.x2, it.y2));
      if (dangling && !asked) {
        any = true;
        removed++;
        points.push({ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 });
        continue;
      }
      // 残す線は、印を外す（確認を頼んだ線は、次の「整える」でも消さない）
      items.push({ ...it, orphan: asked ? true : undefined });
    }
    cur = { ...cur, items };
    if (!any) break;
    // 消した線の端につながっていて、これで行き止まりになった線に、印を付けて、もう一度
    const newlyFree = freeEnds(cur).filter((e) => points.some((p) => near(p.x, p.y, e.x, e.y)));
    const mark = new Set(newlyFree.map((e) => e.wire.id));
    cur = { ...cur, items: cur.items.map((it) => (it.kind === 'wire' && mark.has(it.id) ? { ...it, orphan: true } : it)) };
  }
  return { doc: cur, removed };
}

/** 余白を詰めたあとの、上の機器の下端から、下の機器の上端までの距離（自動レイアウトの、主回路の機器どうしの間隔と同じ） */
const GAP_AFTER_DELETE = 16;

/** 記号の絵が占める範囲（回していれば、回したあとの範囲） */
function drawnBox(it: DocSymbol): Box {
  const rb = rotatedBox(getSymbol(it.symbolId).box, it.rotate);
  return { x0: it.x + rb.dx, y0: it.y + rb.dy, x1: it.x + rb.dx + rb.w, y1: it.y + rb.dy + rb.h };
}

/**
 * 帯（上の機器の下端 lo と、下の機器の上端 hi の間）より下のものを、shift だけ上へ動かす（マイナスなら下へ）。
 * 記号・文字・枠は、hi より下にあるものをまとめて動かす。線は、端ごとに見る（帯をまたいでいる縦線は、伸び縮みする）。
 */
function shiftBelow(doc: Doc, lo: number, hi: number, shift: number): Doc {
  const mid = (lo + hi) / 2;
  const up = (y: number) => (y >= mid ? y - shift : y);
  return {
    ...doc,
    items: doc.items.map((it): DocItem => {
      if (it.kind === 'wire') return { ...it, y1: up(it.y1), y2: up(it.y2) };
      if (it.kind === 'symbol') return drawnBox(it).y0 >= hi - 0.5 ? { ...it, y: it.y - shift } : it;
      if (it.kind === 'text') return textBox(it.x, it.y, it.lines, it.anchor).y0 >= hi - 0.5 ? { ...it, y: it.y - shift } : it;
      return it.y >= hi - 0.5 ? { ...it, y: it.y - shift } : it;
    }),
  };
}

/**
 * 横幅いっぱいに何も無い帯のうち、長すぎるものは縮め、狭すぎるものは広げて、機器どうしの間隔を整える。
 *
 * 自動で作った図面に出てくる帯（いちばん長いもので 55 ほど）は、そのままにする。
 * - BAND_LONG より長い帯 → BAND_LONG_TO に縮める
 * - BAND_NARROW より狭い帯 → BAND_NARROW_TO に広げる
 * 帯の上と下が同じ高さに並んだほかの機器や文字があるところは、帯にならないので動かさない。
 * 下の帯から順に直す（上の帯の位置が、動かなくて済む）。
 */
const BAND_LONG = 64;
const BAND_LONG_TO = 40;
const BAND_NARROW = 4;
const BAND_NARROW_TO = 12;
function balanceBands(doc: Doc): { doc: Doc; fixed: number } {
  let cur = doc;
  let fixed = 0;
  for (const band of [...emptyBands(doc)].reverse()) {
    const g = band.y1 - band.y0;
    const want = g > BAND_LONG ? BAND_LONG_TO : g < BAND_NARROW ? BAND_NARROW_TO : g;
    if (Math.abs(want - g) < 0.5) continue;
    cur = shiftBelow(cur, band.y0, band.y1, g - want);
    fixed++;
  }
  return { doc: applyAnchors(cur), fixed };
}

/** 図面に描かれているもの（記号・文字・枠・横の線）の範囲。縦の線は、動かすと伸び縮みするので数えない */
function contentBoxes(doc: Doc, joinLabels = false, skipCables = false): Box[] {
  const boxes: Box[] = [];
  for (const it of doc.items) {
    if (it.kind === 'symbol') {
      const body = drawnBox(it);
      if (it.label.length === 0) {
        boxes.push(body);
        continue;
      }
      const lb = textBox(it.x + it.labelDx, it.y + it.labelDy, it.label, it.labelAnchor);
      // 記号と文字を1つのかたまりとして数えると、文字だけが帯の向こう側に取り残されない
      if (joinLabels) boxes.push({ x0: Math.min(body.x0, lb.x0), y0: Math.min(body.y0, lb.y0), x1: Math.max(body.x1, lb.x1), y1: Math.max(body.y1, lb.y1) });
      else boxes.push(body, lb);
    } else if (it.kind === 'text') {
      boxes.push(textBox(it.x, it.y, it.lines, it.anchor));
    } else if (it.kind === 'frame') {
      boxes.push({ x0: it.x, y0: it.y - 1, x1: it.x + it.w, y1: it.y + 26 });
    } else if (it.y1 === it.y2 && it.x1 !== it.x2 && !(skipCables && it.dashed)) {
      boxes.push({ x0: Math.min(it.x1, it.x2), y0: it.y1 - 0.5, x1: Math.max(it.x1, it.x2), y1: it.y1 + 0.5 });
    }
  }
  return boxes;
}

/** 横幅いっぱいに、何も描かれていない横の帯（上端・下端）。上から順 */
export function emptyBands(doc: Doc): { y0: number; y1: number }[] {
  // エリアをつなぐケーブルの横線（点線）は、機器どうしの間隔には数えない（別の列の文字と、たまたま同じ高さになることがあるため）
  const spans = contentBoxes(doc, true, true).map((b) => [b.y0, b.y1] as const).sort((a, b) => a[0] - b[0]);
  const bands: { y0: number; y1: number }[] = [];
  let reach = -Infinity;
  for (const [a, b] of spans) {
    if (reach > -Infinity && a > reach + 0.5) bands.push({ y0: reach, y1: a });
    reach = Math.max(reach, b);
  }
  return bands;
}

/**
 * 4 記号を消して空いた余白を詰める。
 *
 * 消した記号が占めていた高さ（Doc.vacated）のまわりを見て、横幅いっぱいに何も無い帯になっていれば、
 * その帯を、上と下の機器の間隔が決まった広さ（GAP_AFTER_DELETE）になるまで詰めて、
 * 帯より下のもの（記号・文字・線・枠）を、まとめて上へ動かす。主回路の縦線は、動かした分だけ縮む。
 * 同じ高さに、ほかの機器（横に並んだ変圧器など）や文字が残っているときは、動かさない。
 * 詰める高さは、消した範囲を覚えているところだけ（もともとの余白は触らない）。
 */
function closeVacatedBands(doc: Doc): { doc: Doc; closed: number } {
  const vacated = doc.vacated ?? [];
  if (vacated.length === 0) return { doc, closed: 0 };
  let cur: Doc = { ...doc, vacated: undefined };
  let closed = 0;

  // 下のものから順に詰める（上のものの座標が、動かなくて済む）
  for (const v of [...vacated].sort((a, b) => b.y0 - a.y0)) {
    // 横幅いっぱいを見て、その高さに残っているもの（縦の線は、伸び縮みするので数えない）
    const boxes = contentBoxes(cur);
    if (boxes.some((b) => b.y0 < v.y1 - 0.5 && b.y1 > v.y0 + 0.5)) continue;
    const lo = Math.max(-Infinity, ...boxes.filter((b) => b.y1 <= v.y0 + 0.5).map((b) => b.y1));
    const hi = Math.min(Infinity, ...boxes.filter((b) => b.y0 >= v.y1 - 0.5).map((b) => b.y0));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const shift = hi - lo - GAP_AFTER_DELETE;
    if (shift < 1) continue;

    cur = shiftBelow(cur, lo, hi, shift);
    closed++;
  }
  return { doc: applyAnchors(cur), closed };
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
      if (branchesInsideParent(doc, w, x, y)) continue;

      const p = nearestPort(doc, x, y, REACH);
      // 反対の端がつながっている接続点に寄せると、線が消えてしまう
      const other = end === 1 ? w.at2 : w.at1;
      if (p && other && p.item === other.item && p.port === other.port) continue;
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
        // 片側だけ中に入っている → 記号のふちまで引っ込める。
        // ただし、その端が他の線とつながっているなら動かさない。
        // 動かすと線どうしが離れて、1本の線が途中で途切れて見えてしまう
        const moveEnd = end1In ? 1 : 2;
        const mx = moveEnd === 1 ? w.x1 : w.x2;
        const my = moveEnd === 1 ? w.y1 : w.y2;
        const joined = wiresOf(doc).some(
          (o) => o.id !== it.id && distToSegment(mx, my, o.x1, o.y1, o.x2, o.y2) <= TOUCH,
        );
        if (joined) continue;
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

/**
 * つなぎ先が1つも無い斜めの線を、まっすぐにする。
 *
 * 接続点に結びついている線は applyAnchors が面倒を見てくれるが、
 * どこにも結びついていない線は誰も直さず、斜めのまま残っていた。
 * 短い斜めがいくつもつながると、稲妻のようなギザギザになる。
 *
 * 端を動かすときは、**同じ場所にあった他の線の端も一緒に動かす**。
 * そうしないと、つながっていた鎖が切れてしまう。
 */
function straightenFreeWires(doc: Doc): { doc: Doc; fixed: number } {
  const near = (a: number, b: number) => Math.abs(a - b) <= TOUCH;
  let items = doc.items.map((it) => ({ ...it }));
  let fixed = 0;

  for (let pass = 0; pass < 3; pass++) {
    const bent = items.filter(
      (it): it is DocWire => it.kind === 'wire' && !it.at1 && !it.at2 && it.x1 !== it.x2 && it.y1 !== it.y2,
    );
    if (bent.length === 0) break;

    for (const w of bent) {
      // 接続点に乗っている端は動かさない。両方乗っていなければ終点を動かす
      const onPort1 = nearestPort({ items }, w.x1, w.y1, TOUCH) !== null;
      const onPort2 = nearestPort({ items }, w.x2, w.y2, TOUCH) !== null;
      const moveEnd: 1 | 2 = onPort2 && !onPort1 ? 1 : 2;

      const fx = moveEnd === 1 ? w.x2 : w.x1;
      const fy = moveEnd === 1 ? w.y2 : w.y1;
      const ox = moveEnd === 1 ? w.x1 : w.x2;
      const oy = moveEnd === 1 ? w.y1 : w.y2;
      // ずれが小さいほうの向きに合わせる（縦長なら縦、横長なら横）
      const vertical = Math.abs(w.x2 - w.x1) <= Math.abs(w.y2 - w.y1);
      const nx = vertical ? fx : ox;
      const ny = vertical ? oy : fy;
      if (nx === ox && ny === oy) continue;

      // 同じ場所にあった他の線の端も、一緒に連れていく
      for (const other of items) {
        if (other.kind !== 'wire') continue;
        if (other.id === w.id) {
          if (moveEnd === 1) {
            other.x1 = nx;
            other.y1 = ny;
          } else {
            other.x2 = nx;
            other.y2 = ny;
          }
          continue;
        }
        if (!other.at1 && near(other.x1, ox) && near(other.y1, oy)) {
          other.x1 = nx;
          other.y1 = ny;
        }
        if (!other.at2 && near(other.x2, ox) && near(other.y2, oy)) {
          other.x2 = nx;
          other.y2 = ny;
        }
      }
      fixed++;
    }
  }
  return { doc: { ...doc, items }, fixed };
}

/**
 * 斜めになっている線を、まっすぐ（縦か横）に直す。
 *
 * 両端ともつないである線は、片方の機器が動くと斜めになる。
 * このとき線のほうを曲げるのではなく、**機器を動かして線に合わせる**。
 * 母線はたいてい何本もの線がぶら下がっていて動かしにくいので、
 * つないでいる線が少ないほうの機器を動かす。
 */
function straightenWires(doc: Doc): { doc: Doc; fixed: number; issues: Issue[] } {
  let next = doc;
  let fixed = 0;

  /** その記号（かたまり）につながっている線の本数。動かす側を決めるのに使う */
  const weightOf = (d: Doc, symbolId: string): number => {
    const group = new Set(groupOf(d, symbolId));
    return wiresOf(d).filter((w) => (w.at1 && group.has(w.at1.item)) || (w.at2 && group.has(w.at2.item))).length;
  };

  // 1本直すと別の線に影響することがあるので、何度か繰り返す
  for (let pass = 0; pass < 4; pass++) {
    const skewed = wiresOf(next).filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2 && w.at1 && w.at2);
    if (skewed.length === 0) break;
    let movedSomething = false;

    for (const w of skewed) {
      const a1 = w.at1!;
      const a2 = w.at2!;
      if (a1.item === a2.item) continue;
      const root1 = groupRootOf(next, a1.item);
      const root2 = groupRootOf(next, a2.item);
      if (root1 === root2) continue;

      // 縦の線にするか、横の線にするか。ずれが小さいほうに合わせる
      const vertical = Math.abs(w.x2 - w.x1) <= Math.abs(w.y2 - w.y1);
      // つないでいる線が少ないほうを動かす（母線側は動かさない）
      const move2 = weightOf(next, root2) <= weightOf(next, root1);
      const target = move2 ? root2 : root1;
      const dx = vertical ? (move2 ? w.x1 - w.x2 : w.x2 - w.x1) : 0;
      const dy = vertical ? 0 : move2 ? w.y1 - w.y2 : w.y2 - w.y1;
      if (dx === 0 && dy === 0) continue;

      next = moveItem(next, target, dx, dy);
      fixed++;
      movedSomething = true;
    }
    if (!movedSomething) break;
  }

  const left = wiresOf(next)
    .filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2)
    .map(
      (w): Issue => ({
        kind: 'skew',
        message: '線が斜めになっています。両端とも別の機器につながっているため、動かして直せませんでした',
        x: (w.x1 + w.x2) / 2,
        y: (w.y1 + w.y2) / 2,
        itemId: w.id,
      }),
    );
  return { doc: next, fixed, issues: left };
}

/** 表題まわりの高さの既定値（1行のとき）。2行のときは呼ぶ側が渡す（layoutTitle の titleH） */
const DEFAULT_TITLE_H = 44;

/** 用紙に収めるときの倍率（renderSvg と同じ計算） */
function fitScale(doc: Doc, paper: PaperSize, orientation: Orientation, titleH = DEFAULT_TITLE_H): number {
  const b = docBounds(doc);
  const s = sheetSize(paper, orientation);
  const areaW = s.w - SHEET_MARGIN * 2 - SHEET_PAD * 2;
  const areaH = s.h - SHEET_MARGIN * 2 - titleH - SHEET_PAD * 2 - 18;
  return Math.min(areaW / Math.max(b.x1 - b.x0, 1), areaH / Math.max(b.y1 - b.y0, 1), 1);
}

/** 用紙を自動で決めるとき、「このくらいの大きさで出せれば読める」とする倍率（これ以上で収まる、いちばん小さい用紙を選ぶ） */
export const SHEET_READABLE = 0.8;

/**
 * 図面の大きさに合わせて、図面を描く台紙の大きさ（A4 か A3）と向きを自動で決める。
 * 台紙の大きさは、画面には出さない（印刷するときの実際の用紙は、印刷の設定画面で選ぶ。台紙は A 判と同じ縦横比なので、
 * どの用紙でも、図面は用紙いっぱいに拡大・縮小されて収まる）。台紙は、図面が大きいときに、文字や線が小さくなりすぎないための内部の都合。
 * 小さい台紙（A4 → A3）から順に、縦と横の両方を試し、読める大きさ（80%以上）で出せる台紙があれば、そこで決める
 * （縦と横で差があるときは、大きく出せるほう。ほぼ同じなら縦）。
 * どの台紙でも収まらなければ、いちばん大きく出せるもの（同じくらいなら、小さい台紙）。
 * `only` を渡すと、その向きだけで決める（利用者が向きを選んだとき）。
 * 表題の高さは、事業場名称が長いと2行になるので、台紙ごとに計算する。
 */
export function chooseSheet(
  doc: Doc,
  title: TitleBlock,
  only?: Orientation,
): { paper: PaperSize; orientation: Orientation; scale: number } {
  let best: { paper: PaperSize; orientation: Orientation; scale: number } | null = null;
  for (const paper of ['A4', 'A3'] as PaperSize[]) {
    const tries = (only ? [only] : (['portrait', 'landscape'] as Orientation[])).map((orientation) => {
      const titleH = layoutTitle(title, sheetSize(paper, orientation).w, SHEET_MARGIN).titleH;
      return { paper, orientation, scale: fitScale(doc, paper, orientation, titleH) };
    });
    // 縦と横で、ほぼ同じなら縦
    const pick = tries.length === 2 && tries[1]!.scale > tries[0]!.scale + 0.02 ? tries[1]! : tries[0]!;
    if (pick.scale >= SHEET_READABLE) return pick;
    if (!best || pick.scale > best.scale + 0.02) best = pick;
  }
  return best!;
}

const ORIENT_LABEL = (o: Orientation) => (o === 'portrait' ? '縦' : '横');

/** 台紙に対して図面が大きすぎないか。向きを変えると大きく出せるなら勧める */
function checkPaper(doc: Doc, paper: PaperSize, orientation: Orientation, titleH?: number): Issue[] {
  const now = fitScale(doc, paper, orientation, titleH);
  if (now >= 0.6) return [];

  const other: Orientation = orientation === 'portrait' ? 'landscape' : 'portrait';
  const sc = fitScale(doc, paper, other, titleH);
  const b = docBounds(doc);
  const where = { x: (b.x0 + b.x1) / 2, y: b.y0 };
  if (sc > now + 0.02) {
    return [
      {
        kind: 'paper',
        message:
          `いまは${ORIENT_LABEL(orientation)}向きで、用紙いっぱいに ${Math.round(now * 100)}% まで縮めています。` +
          `${ORIENT_LABEL(other)}向きにすると ${Math.round(sc * 100)}% で出せます`,
        ...where,
      },
    ];
  }
  return [
    {
      kind: 'paper',
      message: `図面が大きく、用紙いっぱいに ${Math.round(now * 100)}% まで縮めて収めています。向きを変えても、これ以上は大きくなりません`,
      ...where,
    },
  ];
}

/** 直さずに調べるだけ（直したあとの確かめにも使う） */
export function inspectDrawing(doc: Doc, paper: PaperSize, orientation: Orientation, titleH?: number): Issue[] {
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
      if (branchesInsideParent(doc, w, x, y)) continue;
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

  // 斜めの線
  for (const w of wires) {
    if (w.x1 === w.x2 || w.y1 === w.y2) continue;
    issues.push({
      kind: 'skew',
      message: '線が斜めになっています',
      x: (w.x1 + w.x2) / 2,
      y: (w.y1 + w.y2) / 2,
      itemId: w.id,
    });
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

  issues.push(...checkPaper(doc, paper, orientation, titleH));
  return issues;
}

/**
 * 図面を整える。直したうえで、残った問題を返す。
 * 元に戻せるよう、呼ぶ側で履歴に積むこと。
 */
export function tidyDrawing(
  doc: Doc,
  paper: PaperSize = 'A4',
  orientation: Orientation = 'portrait',
  titleH?: number,
): TidyResult {
  const fixed = emptyCount();

  // 線の端を接続点に結び直す（これまでの「整える」と同じ）
  let next = applyAnchors(linkWires(doc));

  const a = dropStrayWires(next);
  next = a.doc;
  fixed.stray += a.removed;

  // 記号を消して途切れた線を、向かい合う端どうしでつなぎ直す（相手が一つに決まらないときは、つながずに印を出す）
  const br = bridgeBrokenWires(next);
  next = applyAnchors(br.doc);
  fixed.floating += br.fixed;

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

  // 消した記号につながっていた線のうち、つなぎ直せずに行き止まりになったものを消す
  const dead = dropDeadEnds(next, bridgeBrokenWires(next).unsure);
  next = dead.doc;
  fixed.stray += dead.removed;

  // 消した記号の跡に残った余白を詰める（つなぎ直しのあと。記号と文字を、まとめて上へ動かす）
  const gap = closeVacatedBands(next);
  next = gap.doc;
  fixed.gap += gap.closed;

  // 全体の間隔：長すぎる帯は縮め、狭すぎる帯は広げる（自動で作った図面の間隔は、そのまま）
  const bal = balanceBands(next);
  next = bal.doc;
  fixed.gap += bal.fixed;

  // まず、どこにもつながっていない斜めの線をまっすぐにする
  const fw = straightenFreeWires(next);
  next = fw.doc;
  fixed.skew += fw.fixed;

  // 残った斜めは、機器のほうを動かしてまっすぐにする
  const sk = straightenWires(next);
  next = sk.doc;
  fixed.skew += sk.fixed;

  const d = spreadLabels(next);
  next = d.doc;
  fixed.overlap += d.fixed;

  // 直したあと、もう一度調べ直す。つなぐ相手が一つに決まらなかった端は、その旨を説明に書く
  const unsure = bridgeBrokenWires(next).unsure;
  const issues = inspectDrawing(next, paper, orientation, titleH).map((i) =>
    i.kind === 'floating' && unsure.some((u) => Math.hypot(u.x - i.x, u.y - i.y) < 1)
      ? { ...i, message: '線が途切れています。つなぐ相手が2か所以上あり、一つに決められません。どの線とつなぐか、確かめてください' }
      : i,
  );
  return { doc: next, fixed, issues };
}

/** 接続点の一覧（検査の説明に使う） */
export const portCount = (doc: Doc): number =>
  symbolsOf(doc).reduce((n, s) => n + portsOf(s).length, 0);
