import { findSymbol, getSymbol } from '@zumen/symbols';
import type { Port, SymbolDef } from '@zumen/symbols';
import type { Answers, PlacedItem } from '@zumen/knowledge';

/**
 * 構成データ（上流→下流に並んだ機器）を、図面上の座標に落とす。
 *
 * ここで決めるのは「たたき台」の位置だけで、あとからエディタで自由に動かせる前提。
 * 配置の決まりごと（主回路は縦一本、分岐は横、内蔵はスロット位置）は
 * 記号マスタが持つ接続点（ポート）とスロットの座標をそのまま使う。
 */

export interface PlacedSymbol {
  id: string;
  role: string;
  symbolId: string;
  /** 記号の左上の座標 */
  x: number;
  y: number;
  rotate: number;
  label: string[];
  labelAt: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
}

export interface Wire {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
}

export interface FrameMark {
  x: number;
  y: number;
  w: number;
  label?: string;
}

export interface DrawingText {
  x: number;
  y: number;
  lines: string[];
  anchor: 'start' | 'middle' | 'end';
}

export interface DrawingLayout {
  symbols: PlacedSymbol[];
  wires: Wire[];
  frames: FrameMark[];
  /** 手で追加した注記 */
  texts?: DrawingText[];
  /** 作図内容の外形 */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** 主回路どうしの標準の間隔 */
const GAP = 22;
/** 分岐が主回路から出る位置の間隔 */
const BRANCH_GAP = 26;
/** 分岐の記号を主回路から離す距離 */
const BRANCH_OFFSET = 34;
/** 記号と、その脇に書く文字の間隔 */
const LABEL_GAP = 10;
/** 枠の左右の広がり */
const FRAME_HALF = 200;
/** 低圧の回線どうしの間隔 */
const LANE_GAP = 120;

const portOf = (def: SymbolDef, ...ids: string[]): Port | undefined => {
  for (const id of ids) {
    const p = def.ports.find((q) => q.id === id);
    if (p) return p;
  }
  return undefined;
};

export function layout(items: PlacedItem[], answers: Answers): DrawingLayout {
  void answers;
  const symbols: PlacedSymbol[] = [];
  const wires: Wire[] = [];
  const frames: FrameMark[] = [];
  const placed = new Map<string, { sym: PlacedSymbol; def: SymbolDef }>();

  const SPINE = 0;
  /** 直前の主回路の出口の高さ */
  let spineY = 0;
  let started = false;
  let pendingDashed = false;
  let pendingGap = GAP;
  /** 直前に置いた横分岐（続けて横につなぐかの判定に使う） */
  let lastBranch: { role: string; dir: number; sym: PlacedSymbol; def: SymbolDef } | null = null;

  /** 180°回したときの座標 */
  const flip = (def: SymbolDef, x: number, yy: number, rotate: number): [number, number] =>
    rotate === 180 ? [def.box.w - x, def.box.h - yy] : [x, yy];

  const add = (
    item: PlacedItem,
    def: SymbolDef,
    x: number,
    yy: number,
    rotate: number,
    side: 'right' | 'left',
  ): PlacedSymbol => {
    const labelSide = item.labelSide ?? side;
    const sym: PlacedSymbol = {
      id: item.id,
      role: item.role,
      symbolId: item.symbolId,
      x,
      y: yy,
      rotate,
      label: item.label,
      labelAt:
        labelSide === 'right'
          ? { x: x + def.box.w + LABEL_GAP, y: yy + 10, anchor: 'start' }
          : { x: x - LABEL_GAP, y: yy + 10, anchor: 'end' },
    };
    symbols.push(sym);
    placed.set(item.role, { sym, def });
    return sym;
  };

  /** 低圧母線から出る回線は、主回路を描き終えてからまとめて並べる */
  const feeders: PlacedItem[] = [];

  for (const item of items) {
    const def = findSymbol(item.symbolId);
    if (!def) continue;

    if (item.kind === 'feeder') {
      feeders.push(item);
      continue;
    }

    /* ---- キュービクルなどの枠 ---- */
    if (item.kind === 'frame') {
      const fy = started ? spineY + Math.max(pendingGap, GAP) : spineY;
      if (started) wires.push({ x1: SPINE, y1: spineY, x2: SPINE, y2: fy, dashed: pendingDashed });
      frames.push({ x: SPINE - FRAME_HALF, y: fy, w: FRAME_HALF * 2, label: item.label[0] });
      spineY = fy;
      started = true;
      pendingDashed = false;
      pendingGap = 0;
      lastBranch = null;
      continue;
    }

    /* ---- 主回路（直列） ---- */
    if (item.kind === 'series') {
      // 受電側のケーブル端末は180°回して頂点をケーブル側に向ける
      const rotate = item.role === 'cable-head-site' ? 180 : 0;
      const inPort = portOf(def, 'in');
      const outPort = portOf(def, 'out') ?? portOf(def, 'sec');
      // 180°回すと上下が入れ替わるので、入口と出口も入れ替える
      const entryPort = rotate === 180 ? outPort : inPort;
      const exitPort = rotate === 180 ? inPort : outPort;

      if (entryPort) {
        const yy = started ? spineY + pendingGap : spineY;
        if (started && pendingGap > 0) {
          wires.push({ x1: SPINE, y1: spineY, x2: SPINE, y2: yy, dashed: pendingDashed });
        }
        const [ex, ey] = flip(def, entryPort.x, entryPort.y, rotate);
        add(item, def, SPINE - ex, yy - ey, rotate, 'right');
        const [, oy] = exitPort ? flip(def, exitPort.x, exitPort.y, rotate) : [0, def.box.h];
        spineY = yy - ey + oy;
      } else if (outPort) {
        // 電柱のように上流側の端が無い記号
        const yy = started ? spineY + pendingGap : spineY;
        add(item, def, SPINE - outPort.x, yy, 0, 'right');
        spineY = yy + outPort.y;
      }
      started = true;
      pendingDashed = item.dashedAfter ?? false;
      pendingGap = item.gapAfter ?? GAP;
      lastBranch = null;
      continue;
    }

    /* ---- 内蔵（親のスロットに入れる） ---- */
    if (item.kind === 'inside') {
      const parent = item.parent ? placed.get(item.parent) : undefined;
      const slot = parent?.def.slots?.find((s2) => s2.id === item.slot);
      const entry = portOf(def, 'in') ?? def.ports[0];
      if (!parent || !slot || !entry) continue;
      const ax = parent.sym.x + slot.x;
      const ay = parent.sym.y + slot.y;
      add(item, def, ax - entry.x, ay - entry.y, 0, 'right');
      const parentEntry = portOf(parent.def, 'in');
      const spineX = parentEntry ? parent.sym.x + parentEntry.x : SPINE;
      if (Math.abs(ax - spineX) > 0.5) wires.push({ x1: spineX, y1: ay, x2: ax, y2: ay });
      continue;
    }

    /* ---- 横分岐 ---- */
    const dir = item.kind === 'branch-right' ? 1 : -1;
    const sources = (item.connectFrom ?? [])
      .map((r) => placed.get(r))
      .filter((v): v is { sym: PlacedSymbol; def: SymbolDef } => v !== undefined)
      .map((f) => {
        const q = portOf(f.def, 'sec', 'out', 'r') ?? f.def.ports[f.def.ports.length - 1]!;
        return { x: f.sym.x + q.x, y: f.sym.y + q.y };
      });

    // 二次側から結線してくる機器（継電器など）
    if (sources.length > 0) {
      const railX = Math.max(...sources.map((v) => v.x * dir)) * dir + 18 * dir;
      const midY = sources.reduce((a, v) => a + v.y, 0) / sources.length;
      const entry = portOf(def, dir > 0 ? 'l' : 'r', 'in') ?? def.ports[0]!;
      const x = dir > 0 ? railX + BRANCH_OFFSET : railX - BRANCH_OFFSET - def.box.w;
      const sym = add(item, def, x, midY - entry.y, 0, dir > 0 ? 'right' : 'left');
      for (const v of sources) {
        wires.push({ x1: v.x, y1: v.y, x2: railX, y2: v.y });
        wires.push({ x1: railX, y1: v.y, x2: railX, y2: midY });
      }
      wires.push({ x1: railX, y1: midY, x2: sym.x + entry.x, y2: midY });
      continue;
    }

    const entry = portOf(def, 'in', dir > 0 ? 'l' : 'r') ?? def.ports[0]!;
    // 縦向きの記号（PFなど）は90°回して横に出す
    const rotate = entry.dir === 'up' && def.box.h > def.box.w ? -90 : 0;
    const w = rotate ? def.box.h : def.box.w;
    const [erx, ery] = rotate === -90 ? [entry.y, def.box.h - entry.x] : [entry.x, entry.y];

    // 直前も同じ向きの分岐なら、その出口から横につなぐ
    const chain = lastBranch && lastBranch.dir === dir ? lastBranch : null;
    let tapY: number;
    let x: number;
    if (chain) {
      const prevExit = portOf(chain.def, 'sec', 'out', 'r') ?? chain.def.ports[chain.def.ports.length - 1]!;
      const pr = chain.sym.rotate === -90
        ? [prevExit.y, chain.def.box.h - prevExit.x]
        : [prevExit.x, prevExit.y];
      const px = chain.sym.x + pr[0]!;
      tapY = chain.sym.y + pr[1]!;
      x = dir > 0 ? px + 14 : px - 14 - w;
      wires.push({ x1: px, y1: tapY, x2: dir > 0 ? x + erx : x + erx, y2: tapY });
    } else {
      tapY = started ? spineY + BRANCH_GAP : spineY;
      if (started) wires.push({ x1: SPINE, y1: spineY, x2: SPINE, y2: tapY, dashed: pendingDashed });
      spineY = tapY;
      started = true;
      pendingDashed = false;
      x = dir > 0 ? BRANCH_OFFSET : -BRANCH_OFFSET - w;
      wires.push({ x1: SPINE, y1: tapY, x2: x + erx, y2: tapY });
    }
    const sym = add(item, def, x, tapY - ery, rotate, dir > 0 ? 'right' : 'left');
    if (chain) {
      // 横につないだときは、手前の記号の文字をこの記号の下にまとめる
      const merged = [...chain.sym.label, ...sym.label];
      chain.sym.label = [];
      sym.label = merged;
      sym.labelAt = { x: sym.x, y: sym.y + (rotate ? def.box.w : def.box.h) + 12, anchor: 'start' };
    }
    // 分岐の記号の下端まで主回路を空けて、次の機器と重ならないようにする
    const bottom = sym.y + (rotate ? def.box.w : def.box.h) + (sym.label.length ? sym.label.length * 10 + 12 : 0);
    pendingGap = Math.max(GAP, bottom - spineY + 10);
    lastBranch = { role: item.role, dir, sym, def };
  }

  /* ---- 低圧母線と、そこから下へ出る回線 ---- */
  if (feeders.length > 0) {
    const laneCount = Math.max(...feeders.map((f) => f.lane ?? 0)) + 1;
    const busY = spineY + GAP;
    wires.push({ x1: SPINE, y1: spineY, x2: SPINE, y2: busY });
    const laneX = (i: number) => SPINE + (i - (laneCount - 1) / 2) * LANE_GAP;
    wires.push({ x1: laneX(0), y1: busY, x2: laneX(laneCount - 1), y2: busY });

    for (let lane = 0; lane < laneCount; lane++) {
      let ly = busY;
      const inLane = feeders.filter((f) => (f.lane ?? 0) === lane);
      for (const [i, item] of inLane.entries()) {
        const def = getSymbol(item.symbolId);
        const entry = portOf(def, 'in') ?? portOf(def, 'out')!;
        const exit = portOf(def, 'out');
        const x = laneX(lane) - entry.x;
        const yy = ly + (i === 0 ? 0 : GAP) - entry.y;
        if (i > 0) wires.push({ x1: laneX(lane), y1: ly, x2: laneX(lane), y2: yy + entry.y });
        const side = i === 0 ? 'right' : 'right';
        const sym = add(item, def, x, yy, 0, side);
        if (i > 0) {
          // 2つ目以降は記号の下に中央揃えで文字を書く
          sym.labelAt = { x: laneX(lane) + def.box.w / 2 - entry.x, y: yy + def.box.h + 12, anchor: 'middle' };
        }
        ly = exit ? yy + exit.y : yy + def.box.h;
      }
    }
  }

  // 外形を求める
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const ext = (a: number, b: number, c: number, d: number) => {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  };
  for (const s of symbols) {
    const def = getSymbol(s.symbolId);
    ext(s.x, s.y, s.x + def.box.w, s.y + def.box.h);
    if (s.label.length) {
      const w = Math.max(...s.label.map((l) => l.length)) * 6;
      ext(
        s.labelAt.anchor === 'start' ? s.labelAt.x : s.labelAt.x - w,
        s.labelAt.y - 8,
        s.labelAt.anchor === 'start' ? s.labelAt.x + w : s.labelAt.x,
        s.labelAt.y + s.label.length * 10,
      );
    }
  }
  for (const w of wires) ext(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2));
  for (const f of frames) ext(f.x, f.y - 14, f.x + f.w, f.y + 26);

  return { symbols, wires, frames, bounds: { x0, y0, x1, y1 } };
}

/** 図面の格子の刻み。移動・伸縮はこの単位に吸着させる */
export const GRID = 2;

/** 格子に吸着させる */
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** 線を縦か横のどちらかに揃える（斜めにしない） */
export function straighten(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  return Math.abs(x2 - x1) <= Math.abs(y2 - y1) ? [x1, y1, x1, y2] : [x1, y1, x2, y1];
}
