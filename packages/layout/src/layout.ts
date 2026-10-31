import { BOUNDARY_SAFETY_LEFT, findSymbol, getSymbol } from '@zumen/symbols';
import type { Port, SymbolDef } from '@zumen/symbols';
import { ROW, ROW_COUNT } from '@zumen/knowledge';
import type { Answers, PlacedItem } from '@zumen/knowledge';
import { LABEL_FONT, LABEL_LINE, labelWidth } from './text.ts';

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
  /** 親の記号のid。PASに内蔵するZCT・VT・LAのように、親と一緒に動くもの */
  parent?: string;
  /** 親のどのスロットに入っているか。記号を差し替えたときの置き直しに使う */
  slot?: string;
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
const GAP = 16;
/**
 * 高圧母線（変圧器などを並べる横線）を、その手前の機器から離す最小の距離。
 * 母線を描くとき（列が2つ以上のとき）だけ使う。OCR・試験端子・ZPDなどの分岐が手前にあっても、窮屈に見えないように
 */
const BUS_CLEAR = 36;
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
/** 高圧母線から下がる列どうしの間隔（記号の脇に文字を書くぶん広めに取る） */
const PARALLEL_GAP = 160;
/** 結線せずに置くものを、主回路からどれだけ下に離すか */
const FREE_GAP = 56;
/** 並列に入る機器（励磁突入電流抑制開閉器）を、主回路の縦線から左へ離す距離（記号の中心まで） */
const BYPASS_OFFSET = 96;
/** 置き場所が決まっていない継電器の名前を、置き先の記号の上に書くときの隙間と、重ねるときの間隔 */
const NOTE_GAP = 16;
const NOTE_STEP = 8;
/** 名前だけの継電器を、OCRの上の線から右へ離す距離 */
const NOTE_SIDE = 10;
/** トリップコイルを置く、主回路の縦線からの最小の距離（VCBの文字と重ならないため） */
const COIL_MIN_X = 170;
/** 結線せずに置くものどうしの間隔 */
const FREE_SPACING = 170;

const portOf = (def: SymbolDef, ...ids: string[]): Port | undefined => {
  for (const id of ids) {
    const p = def.ports.find((q) => q.id === id);
    if (p) return p;
  }
  return undefined;
};

/** 受電設備エリア1か所ぶんの配置。2か所目以降のエリアをつなぐ位置（taps）も返す */
interface AreaLayout extends DrawingLayout {
  taps: AreaTaps;
}

/** 前のエリアから分岐するときの、そのエリアの中の位置（このエリアの座標。主回路の縦線は x=0） */
interface AreaTaps {
  dsEntry?: number;
  dsExit?: number;
  breakerEntry?: number;
  breakerExit?: number;
  bus?: { x: number; y: number };
  /** 主回路のいちばん下 */
  end: number;
}

function layoutArea(items: PlacedItem[], answers: Answers): AreaLayout {
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
  let lastBranch: { role: string; dir: number; sym: PlacedSymbol; def: SymbolDef; unit?: number } | null = null;
  /** 直前までの分岐が占めている下端（文字を含む）。次の分岐をここより下に出す */
  let branchBottom = -Infinity;
  /** 直前に置いたケーブルの端末の、文字が記号の下へ出る長さ */
  let cableHeadOverhang = 0;
  /** 同じ機器（VT）の二次側につなぐ継電器の積み上げ：1つ目の位置と、いまの下端 */
  const stacks = new Map<string, { railX: number; x: number; bottom: number }>();
  /** 名前だけの継電器を、置き先ごとに何個重ねたか */
  const noteCount = new Map<string, number>();

  /** 回したあとの接続点の座標（記号の左上からの相対） */
  const flip = (def: SymbolDef, x: number, yy: number, rotate: number): [number, number] =>
    rotatedPort(def.box, x, yy, rotate);

  const add = (
    item: PlacedItem,
    def: SymbolDef,
    x: number,
    yy: number,
    rotate: number,
    side: 'right' | 'left',
    parentId?: string,
    slotId?: string,
  ): PlacedSymbol => {
    const labelSide = item.labelSide ?? side;
    const sym: PlacedSymbol = {
      id: item.id,
      role: item.role,
      symbolId: item.symbolId,
      parent: parentId,
      slot: slotId,
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
    // 同じ役割の機器が複数あるもの（継電器など）は、IDでも引けるようにする
    if (item.id !== item.role) placed.set(item.id, { sym, def });
    return sym;
  };

  /** 低圧母線から出る回線は、主回路を描き終えてからまとめて並べる */
  const feeders: PlacedItem[] = [];
  /** どこにも結線せずに置くもの（発電機・太陽光・蓄電池） */
  const frees: PlacedItem[] = [];
  /** 結線せずに置いたものは、受電設備の枠の中に数えない */
  const freeIds = new Set<string>();
  /** 高圧母線から並列にぶら下がるもの（変圧器・高圧進相設備） */
  const parallels = items.filter((i) => i.kind === 'parallel' && findSymbol(i.symbolId));
  let parallelDrawn = false;
  /** 高圧母線の位置（右の端と、高さ）。2か所目以降のエリアをつなぐときに使う */
  let busInfo: { x: number; y: number } | undefined;
  /** 低圧の回線をぶら下げる位置（最初の変圧器の下）。無ければ主回路の末端 */
  let feederAnchorX = SPINE;
  let feederAnchorY: number | null = null;
  /** 変圧器ごとの低圧側の出口（1台目から順に）。低圧の回線はここからぶら下げる */
  const transformerOut: { x: number; y: number }[] = [];

  /** 高圧母線を引き、変圧器や高圧進相設備をそこから下へ並列にぶら下げる */
  function drawParallelSection(): void {
    if (parallels.length === 0) return;

    const lanes = [...new Set(parallels.map((p) => p.lane ?? 0))].sort((a, b) => a - b);
    // 直前の分岐（試験端子・OCR・ZPDなど）の下端より下に引く。母線を描くときは、さらに余裕を持たせる
    const before = started ? pendingGap : GAP;
    const busY = spineY + (lanes.length > 1 ? Math.max(before + 8, BUS_CLEAR) : before);
    // 1列しかないときは母線を描かず、主回路をそのまま下ろす（1台だけの図面を変えないため）
    /*
     * 変圧器の列と列の間隔。ふつうは PARALLEL_GAP。
     * 変圧器の下に低圧の回線が2本以上ぶら下がる（蓄電池と補助変圧器など）ときは、隣の変圧器の下の回線と
     * 文字が重ならないよう、そのぶん間隔を広げる。回線が少なければ、これまでどおり
     */
    const trCount = parallels.filter((p) => p.role === 'transformer').length;
    const feederLanes = new Map<number, Set<number>>();
    for (const f of items) {
      if (f.kind !== 'feeder' || !findSymbol(f.symbolId)) continue;
      const n = Number(f.props?.transformer ?? 1);
      const t = Math.min(Math.max(1, Number.isFinite(n) ? n : 1), Math.max(1, trCount)) - 1;
      const set = feederLanes.get(t) ?? new Set<number>();
      set.add(f.lane ?? 0);
      feederLanes.set(t, set);
    }
    const lanesUnder = (lane: number): number => {
      const tr = parallels.find((p) => p.lane === lane && p.role === 'transformer');
      return tr ? (feederLanes.get(tr.unit ?? 0)?.size ?? 0) : 0;
    };
    const colX: number[] = [0];
    for (let j = 1; j < lanes.length; j++) {
      const widen = LANE_GAP + (Math.max(1, lanesUnder(lanes[j - 1]!)) - 1) * (LANE_GAP / 2) + (Math.max(1, lanesUnder(lanes[j]!)) - 1) * (LANE_GAP / 2);
      colX.push(colX[j - 1]! + Math.max(PARALLEL_GAP, widen));
    }
    const colCenter = ((colX[0] ?? 0) + (colX.at(-1) ?? 0)) / 2;
    const laneX = (lane: number) => (lanes.length <= 1 ? SPINE : SPINE + (colX[lanes.indexOf(lane)] ?? 0) - colCenter);

    busInfo = { x: lanes.length > 1 ? laneX(lanes.at(-1)!) : SPINE, y: busY };
    wires.push({ x1: SPINE, y1: spineY, x2: SPINE, y2: busY, dashed: pendingDashed });
    if (lanes.length > 1) {
      wires.push({ x1: laneX(lanes[0]!), y1: busY, x2: laneX(lanes.at(-1)!), y2: busY });
    }
    pendingDashed = false;

    /*
     * 列ごとに上から詰めるのではなく、「段」で揃える。
     * 変圧器は変圧器で、コンデンサはコンデンサで、どの列でも同じ高さに来る。
     * PCやLBSが無い列は、その段を空けたまま母線からの線を長く引く。
     */
    /*
     * 変圧器などの手前に入る開閉器（PC・LBS）が、その列に1つしかないときは、PCの段にそろえる。
     * PCとLBSが混ざっていると、LBSだけが下（変圧器寄り）に来てしまい、横に並ぶほかの列と高さが合わなくなるため。
     * 2つ入る列（PC→LBS）と、VCSが続く列（LBS→VCS）は、これまでどおりの段にする。
     */
    const switchRowOverride = new Map<PlacedItem, number>();
    for (const lane of lanes) {
      const inLane = parallels.filter((p) => (p.lane ?? 0) === lane);
      const front = inLane.filter((p) => p.row === ROW.pc || p.row === ROW.lbs);
      const hasVcs = inLane.some((p) => p.row === ROW.vcs);
      if (front.length === 1 && front[0]!.row === ROW.lbs && !hasVcs) switchRowOverride.set(front[0]!, ROW.pc);
    }
    const rowOf = (p: PlacedItem) => switchRowOverride.get(p) ?? p.row ?? ROW_COUNT - 1;
    const rowHeight = Array.from({ length: ROW_COUNT }, () => 0);
    for (const p of parallels) {
      const def = findSymbol(p.symbolId);
      if (!def) continue;
      const r = rowOf(p);
      rowHeight[r] = Math.max(rowHeight[r]!, def.box.h);
    }
    // 誰も使わない段は詰める（1台だけの図面を無駄に縦長にしないため）
    const rowTop = Array.from({ length: ROW_COUNT }, () => busY);
    let cursor = busY;
    for (let r = 0; r < ROW_COUNT; r++) {
      if (rowHeight[r] === 0) {
        rowTop[r] = cursor;
        continue;
      }
      cursor += GAP;
      rowTop[r] = cursor;
      cursor += rowHeight[r]!;
    }

    let deepest = busY;
    for (const lane of lanes) {
      let ly = busY;
      const inLane = parallels
        .filter((p) => (p.lane ?? 0) === lane)
        .sort((a, b) => rowOf(a) - rowOf(b));
      for (const item of inLane) {
        const def = getSymbol(item.symbolId);
        const entry = portOf(def, 'in') ?? def.ports[0]!;
        const exit = portOf(def, 'out', 'sec');
        const top = rowTop[rowOf(item)]!;
        const x = laneX(lane) - entry.x;
        const yy = top - entry.y;
        wires.push({ x1: laneX(lane), y1: ly, x2: laneX(lane), y2: top });
        add(item, def, x, yy, 0, 'right');
        ly = exit ? yy + exit.y : yy + def.box.h;
        if (item.role === 'transformer') transformerOut[item.unit ?? 0] = { x: laneX(lane), y: ly };
      }
      // 低圧の回線は、1台目の変圧器の真下から出す
      if (lane === lanes[0]) {
        feederAnchorX = laneX(lane);
        feederAnchorY = ly;
      }
      deepest = Math.max(deepest, ly);
    }
    spineY = deepest;
    started = true;
    pendingGap = GAP;
    lastBranch = null;
  }

  // トリップコイルがつながる継電器（OCR）。コイルは主回路から離して置くので、
  // OCRも同じ位置まで右へ寄せて置き、コイルからOCRへの線が曲がらず、まっすぐ降りるようにする
  const coilTargets = new Set(items.filter((i) => i.kind === 'coil').flatMap((i) => i.connectFrom?.slice(0, 1) ?? []));

  for (const item of items) {
    const def = findSymbol(item.symbolId);
    if (!def) continue;

    if (item.kind === 'feeder') {
      feeders.push(item);
      continue;
    }
    if (item.kind === 'free') {
      frees.push(item);
      continue;
    }
    if (item.kind === 'parallel') {
      // 最初の1件に出会った時点で、並列の区画をまるごと描く
      if (!parallelDrawn) {
        drawParallelSection();
        parallelDrawn = true;
      }
      continue;
    }

    /* ---- ほかの機器（VCB）と並列に入る機器（励磁突入電流抑制開閉器） ---- */
    if (item.kind === 'bypass') {
      const target = item.attachTo ? placed.get(item.attachTo) : undefined;
      const tIn = target ? portOf(target.def, 'in') : undefined;
      const tOut = target ? portOf(target.def, 'out', 'sec') : undefined;
      const inP = portOf(def, 'in');
      const outP = portOf(def, 'out', 'sec');
      if (!target || !tIn || !tOut || !inP || !outP) continue;
      // 並べる相手（VCB）の入口・出口の高さに、この機器の入口・出口をそろえる。主回路の縦線から左へ離して置く
      const entryY = target.sym.y + tIn.y;
      const exitY = target.sym.y + tOut.y;
      const cx = SPINE - BYPASS_OFFSET;
      const sym = add(item, def, cx - inP.x, entryY - inP.y, 0, 'left');
      const upY = entryY - 8;
      const downY = exitY + 8;
      // 主回路の縦線から、真横に出て、真下に折れて入る。出口は、真下に出て、真横に戻る
      wires.push({ x1: SPINE, y1: upY, x2: cx, y2: upY });
      wires.push({ x1: cx, y1: upY, x2: cx, y2: sym.y + inP.y });
      wires.push({ x1: cx, y1: sym.y + outP.y, x2: cx, y2: downY });
      wires.push({ x1: cx, y1: downY, x2: SPINE, y2: downY });
      continue;
    }

    /* ---- 置き場所が決まっていない継電器：置き先（OCRなど）の真上に、隙間を空けて、名前だけ ---- */
    if (item.kind === 'note-above') {
      const target = item.attachTo ? placed.get(item.attachTo) : undefined;
      if (!target) continue;
      const k = noteCount.get(item.attachTo!) ?? 0;
      noteCount.set(item.attachTo!, k + 1);
      // トリップコイルからOCRの上へ降りてくる線と重ならないよう、その線の右に寄せて置く
      const topPort = portOf(target.def, 'top');
      const nx = topPort ? target.sym.x + topPort.x + NOTE_SIDE : target.sym.x;
      add(item, def, nx, target.sym.y - NOTE_GAP - (k + 1) * def.box.h - k * NOTE_STEP, 0, 'right');
      continue;
    }

    /* ---- トリップコイル：VCBの横に置き、OCRとつなぐ ---- */
    if (item.kind === 'coil') {
      const breaker = item.attachTo ? placed.get(item.attachTo) : undefined;
      const ocr = item.connectFrom?.[0] ? placed.get(item.connectFrom[0]) : undefined;
      const top = ocr ? portOf(ocr.def, 'top') : undefined;
      const cl = portOf(def, 'l');
      const cb = portOf(def, 'b');
      if (!breaker || !ocr || !top || !cl || !cb) continue;
      const ocrX = ocr.sym.x + top.x;
      const ocrY = ocr.sym.y + top.y;
      // コイルの中心は、OCRの真上の線に合わせる。VCBの文字と重ならないよう、主回路から離す
      const cx = Math.max(ocrX, SPINE + COIL_MIN_X);
      // VCBの下の端子（VCBの文字より下）から、右へ点線で連動を引く
      const bOut = portOf(breaker.def, 'out', 'sec');
      const linkY = breaker.sym.y + (bOut ? bOut.y : breaker.def.box.h);
      const linkX = breaker.sym.x + (bOut ? bOut.x : breaker.def.box.w / 2);
      const sym = add(item, def, cx - cb.x, linkY - cl.y, 0, 'right');
      // VCBとコイルの連動（点線）
      wires.push({ x1: linkX, y1: linkY, x2: sym.x + cl.x, y2: linkY, dashed: true });
      // コイルの下から、OCRの上へ
      const downY = sym.y + cb.y;
      if (Math.abs(cx - ocrX) < 0.5) {
        wires.push({ x1: cx, y1: downY, x2: ocrX, y2: ocrY });
      } else {
        const midY = Math.max(downY + 8, ocrY - 10);
        wires.push({ x1: cx, y1: downY, x2: cx, y2: midY });
        wires.push({ x1: cx, y1: midY, x2: ocrX, y2: midY });
        wires.push({ x1: ocrX, y1: midY, x2: ocrX, y2: ocrY });
      }
      continue;
    }

    /* ---- 別の記号に重ねる横線（3点不一致の責任分界点） ---- */
    if (item.kind === 'overlay') {
      const target = item.attachTo ? placed.get(item.attachTo) : undefined;
      if (!target) continue;
      // 重ねる先の記号の中央の高さ・主回路の縦線の位置に合わせる
      const inPort = portOf(target.def, 'in');
      const axisX = target.sym.x + (inPort ? inPort.x : target.def.box.w / 2);
      const centerY = target.sym.y + target.def.box.h / 2;
      const sym = add(item, def, axisX - BOUNDARY_SAFETY_LEFT, centerY - def.box.h / 2, 0, 'left');
      // 文言は線の左上（線の上、左端にそろえる）
      sym.labelAt = { x: sym.x + 2, y: sym.y - 6, anchor: 'start' };
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
        const placedSym = add(item, def, SPINE - ex, yy - ey, rotate, 'right');
        const [, oy] = exitPort ? flip(def, exitPort.x, exitPort.y, rotate) : [0, def.box.h];
        spineY = yy - ey + oy;
        // ケーブルの端末は小さい（文字が何行か並ぶと、記号の下より文字のほうが下に出る）ので、文字の下端から、次の機器まで空ける
        if (item.symbolId === 'cable-head' && item.label.length > 0) {
          cableHeadOverhang = Math.max(0, placedSym.labelAt.y + (item.label.length - 1) * LABEL_LINE + 4 - spineY);
        }
      } else if (outPort) {
        // 電柱のように上流側の端が無い記号
        const yy = started ? spineY + pendingGap : spineY;
        add(item, def, SPINE - outPort.x, yy, 0, 'right');
        spineY = yy + outPort.y;
      }
      started = true;
      pendingDashed = item.dashedAfter ?? false;
      pendingGap = Math.max(item.gapAfter ?? GAP, cableHeadOverhang > 0 ? cableHeadOverhang + 12 : 0);
      cableHeadOverhang = 0;
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
      add(item, def, ax - entry.x, ay - entry.y, 0, 'right', parent.sym.id, slot.id);
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
        return { x: f.sym.x + q.x, y: f.sym.y + q.y, from: f };
      });

    // 二次側から結線してくる機器（継電器など）
    if (sources.length > 0) {
      const railX = Math.max(...sources.map((v) => v.x * dir)) * dir + 18 * dir;
      const midY = sources.reduce((a, v) => a + v.y, 0) / sources.length;
      const entry = portOf(def, dir > 0 ? 'l' : 'r', 'in') ?? def.ports[0]!;
      let x = dir > 0 ? railX + BRANCH_OFFSET : railX - BRANCH_OFFSET - def.box.w;
      // トリップコイルがつながるOCRは、コイルの真下に来る位置（主回路から COIL_MIN_X 以上）まで右へ寄せる
      const coilTop = dir > 0 && coilTargets.has(item.id) ? portOf(def, 'top') : undefined;
      if (coilTop) x = Math.max(x, SPINE + COIL_MIN_X - coilTop.x);
      // 同じ機器の二次側につなぐ2つ目以降は、1つ目の下に並べる（並列）
      const stackKey = item.sourceLabel === 'below' && sources.length === 1 ? sources[0]!.from.sym.id : undefined;
      const stack = stackKey ? stacks.get(stackKey) : undefined;
      let atY = midY;
      if (stack) {
        x = stack.x;
        atY = stack.bottom + 14 + entry.y;
      }
      const sym = add(item, def, x, atY - entry.y, 0, dir > 0 ? 'right' : 'left');
      const target = sym.x + entry.x;
      if (stackKey && !stack) stacks.set(stackKey, { railX, x, bottom: sym.y + def.box.h });
      else if (stack) stack.bottom = Math.max(stack.bottom, sym.y + def.box.h);
      if (item.sourceLabel === 'below') {
        // つなぎ元（VT）の文字は、右へ続く線と重ならないよう、記号の下へ動かす。下端が増えるぶん、次の機器を下げる
        for (const v of sources) {
          if (v.from.sym.label.length === 0) continue;
          v.from.sym.labelAt = { x: v.from.sym.x, y: v.from.sym.y + v.from.def.box.h + 12, anchor: 'start' };
          const lines = v.from.sym.label.length;
          branchBottom = Math.max(branchBottom, v.from.sym.labelAt.y + (lines - 1) * LABEL_LINE + 4);
        }
        branchBottom = Math.max(branchBottom, sym.y + def.box.h);
        pendingGap = Math.max(pendingGap, branchBottom - spineY + 10);
      }
      if (stack) {
        // 1つ目の継電器へ向かう線から、縦に分かれて下へ降りる
        const v = sources[0]!;
        wires.push({ x1: stack.railX, y1: v.y, x2: stack.railX, y2: atY });
        wires.push({ x1: stack.railX, y1: atY, x2: target, y2: atY });
      } else if (sources.length === 1) {
        // つなぎ元が1つなら、曲げずに1本でまっすぐ引く。
        // 分けて引くと、途中が「記号を突き抜けている線」と見なされて切られ、
        // ZCTから出る線が途切れて見えることがあった
        const v = sources[0]!;
        wires.push({ x1: v.x, y1: v.y, x2: target, y2: v.y });
      } else {
        for (const v of sources) {
          wires.push({ x1: v.x, y1: v.y, x2: railX, y2: v.y });
          wires.push({ x1: railX, y1: v.y, x2: railX, y2: midY });
        }
        wires.push({ x1: railX, y1: midY, x2: target, y2: midY });
      }
      continue;
    }

    const entry = portOf(def, 'in', dir > 0 ? 'l' : 'r') ?? def.ports[0]!;
    // 縦長の記号（PFなど）は、横に出す分岐では、上を主回路の側へ向けて横に回す
    // （右へ分岐するときは上を左へ、左へ分岐するときは上を右へ）。
    // ただし、縦のまま置くと指定された記号（LA）は、回さない。
    // 主回路から真横に線が出て、真下に折れてから、記号（四角の矢印・アース）が縦に並ぶ
    const rotate = !item.upright && entry.dir === 'up' && def.box.h > def.box.w ? (dir > 0 ? -90 : 90) : 0;
    const rb = rotatedBox(def.box, rotate);
    const [erx, ery] = rotatedPort(def.box, entry.x, entry.y, rotate);

    // 直前も同じ向きの分岐で、かつ同じ1台ぶんなら、その出口から横につなぐ（ZPDとLAのように、別の記号にしたいものは、つながない）。
    // （コンデンサ1台目のリアクトルとコンデンサは1本の分岐、2台目は別の分岐になる）
    const chain =
      lastBranch && lastBranch.dir === dir && lastBranch.unit === item.unit && !item.separate ? lastBranch : null;
    let tapY: number;
    let x: number;
    if (chain) {
      const prevExit = portOf(chain.def, 'sec', 'out', 'r') ?? chain.def.ports[chain.def.ports.length - 1]!;
      const pr = rotatedPort(chain.def.box, prevExit.x, prevExit.y, chain.sym.rotate);
      const px = chain.sym.x + pr[0]!;
      tapY = chain.sym.y + pr[1]!;
      // 記号は箱の中心まわりに回るので、見えている外形の端に合わせて置く
      x = dir > 0 ? px + 14 - rb.dx : px - 14 - rb.dx - rb.w;
      wires.push({ x1: px, y1: tapY, x2: dir > 0 ? x + erx : x + erx, y2: tapY });
    } else {
      // 直前の分岐の文字と重ならない位置まで下げる
      tapY = started ? Math.max(spineY + BRANCH_GAP, branchBottom + BRANCH_GAP) : spineY;
      if (started) wires.push({ x1: SPINE, y1: spineY, x2: SPINE, y2: tapY, dashed: pendingDashed });
      spineY = tapY;
      started = true;
      pendingDashed = false;
      x = dir > 0 ? BRANCH_OFFSET - rb.dx : -BRANCH_OFFSET - rb.dx - rb.w;
      wires.push({ x1: SPINE, y1: tapY, x2: x + erx, y2: tapY });
    }
    // トリップコイルがつながるOCRは、コイルの真下に来る位置（主回路から COIL_MIN_X 以上）まで、右へ離して置く
    // （試験端子が無いときは、主回路から直接、真横に出る線の先にOCRが来る）
    const coilTop2 = dir > 0 && !chain && coilTargets.has(item.id) ? portOf(def, 'top') : undefined;
    if (coilTop2) {
      const topX = x + rb.dx + coilTop2.x;
      if (topX < SPINE + COIL_MIN_X) {
        x += SPINE + COIL_MIN_X - topX;
        // 主回路から出た線も、その分、長くする（さきほど引いた線を、置き直す）
        const w = wires[wires.length - 1]!;
        w.x2 = x + erx;
      }
    }
    const sym = add(item, def, x, tapY - ery, rotate, dir > 0 ? 'right' : 'left');
    if (chain) {
      // 横につないだときは、手前の記号の文字をこの記号の下にまとめる
      const merged = [...chain.sym.label, ...sym.label];
      chain.sym.label = [];
      sym.label = merged;
      // 横に並べた記号の文字は、いちばん端の記号の横に書く（下に書くと、そのぶん主回路が間延びするため）
      sym.labelAt =
        dir > 0
          ? { x: sym.x + rb.dx + rb.w + LABEL_GAP, y: sym.y + rb.dy + 10, anchor: 'start' }
          : { x: sym.x + rb.dx - LABEL_GAP, y: sym.y + rb.dy + 10, anchor: 'end' };
    }
    // 分岐の記号（と、その文字）の下端まで主回路を空けて、次の機器と重ならないようにする
    const symBottom = sym.y + rb.dy + rb.h;
    const labelBottom = sym.label.length ? sym.labelAt.y + (sym.label.length - 1) * LABEL_LINE + 4 : -Infinity;
    const bottom = Math.max(symBottom, labelBottom);
    branchBottom = Math.max(branchBottom, bottom);
    // 直前までの分岐のうち、いちばん下のものに合わせる（先に出した背の高い分岐の下に、次の機器が入り込まないように）
    pendingGap = Math.max(GAP, branchBottom - spineY + 10);
    lastBranch = { role: item.role, dir, sym, def, unit: item.unit };
  }

  /* ---- 低圧母線と、そこから下へ出る回線 ---- */
  if (feeders.length > 0) {
    const laneIds = [...new Set(feeders.map((f) => f.lane ?? 0))].sort((a, b) => a - b);

    /** その回線をつなぐ変圧器（0始まり）。台数を超えて選んでいたら最後の台に寄せる */
    const targetOf = (lane: number): number => {
      const head = feeders.find((f) => (f.lane ?? 0) === lane);
      const n = Number(head?.props?.transformer ?? 1);
      const last = Math.max(1, transformerOut.length);
      return Math.min(Math.max(1, Number.isFinite(n) ? n : 1), last) - 1;
    };

    // 変圧器ごとに、その下へぶら下げる回線をまとめる
    const byTransformer = new Map<number, number[]>();
    for (const lane of laneIds) {
      const t = targetOf(lane);
      const list = byTransformer.get(t);
      if (list) list.push(lane);
      else byTransformer.set(t, [lane]);
    }

    for (const [t, lanes] of [...byTransformer.entries()].sort((a, b) => a[0] - b[0])) {
      // 変圧器が見つからないときだけ、主回路の末端からぶら下げる
      const anchor = transformerOut[t] ?? { x: feederAnchorX, y: feederAnchorY ?? spineY };
      const busY = anchor.y + GAP;
      const base = anchor.x;
      wires.push({ x1: base, y1: anchor.y, x2: base, y2: busY });
      const laneX = (i: number) => base + (i - (lanes.length - 1) / 2) * LANE_GAP;
      // 1本だけなら母線は引かず、変圧器からその機器まで1本の線でつなぐ
      if (lanes.length > 1) wires.push({ x1: laneX(0), y1: busY, x2: laneX(lanes.length - 1), y2: busY });

      lanes.forEach((lane, slot) => {
        let ly = busY;
        const inLane = feeders.filter((f) => (f.lane ?? 0) === lane);
        for (const [i, item] of inLane.entries()) {
          const def = getSymbol(item.symbolId);
          const entry = portOf(def, 'in') ?? portOf(def, 'out')!;
          const exit = portOf(def, 'out');
          const x = laneX(slot) - entry.x;
          const yy = ly + (i === 0 ? 0 : GAP) - entry.y;
          if (i > 0) wires.push({ x1: laneX(slot), y1: ly, x2: laneX(slot), y2: yy + entry.y });
          const sym = add(item, def, x, yy, 0, 'right');
          if (i > 0) {
            // 2つ目以降は記号の下に中央揃えで文字を書く
            sym.labelAt = { x: laneX(slot) + def.box.w / 2 - entry.x, y: yy + def.box.h + 12, anchor: 'middle' };
          }
          ly = exit ? yy + exit.y : yy + def.box.h;
        }
      });
    }
  }

  /* ---- 結線せずに置くもの（発電機・太陽光・蓄電池） ---- */
  if (frees.length > 0) {
    // 主回路の下に、間を空けて横一列に並べる。
    // 線はつながない（つなぎ先は現地のメモを見てから、図面の上で結ぶ）
    let fy = spineY;
    for (const w of wires) fy = Math.max(fy, w.y1, w.y2);
    for (const sym of symbols) {
      const def = getSymbol(sym.symbolId);
      fy = Math.max(fy, sym.y + def.box.h + (sym.label.length ? sym.label.length * LABEL_LINE : 0));
    }
    fy += FREE_GAP;

    let fx = SPINE - ((frees.length - 1) * FREE_SPACING) / 2;
    for (const item of frees) {
      const def = getSymbol(item.symbolId);
      const sym = add(item, def, fx - def.box.w / 2, fy, 0, 'right');
      freeIds.add(sym.id);
      fx += FREE_SPACING;
    }
  }

  // 文字が、線・記号・ほかの文字に重なったり近づいたりしていたら、空いているところへずらす
  avoidLabelCollisions(symbols, wires, frames);

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
    const rb = rotatedBox(def.box, s.rotate);
    ext(s.x + rb.dx, s.y + rb.dy, s.x + rb.dx + rb.w, s.y + rb.dy + rb.h);
    if (s.label.length) {
      const r = labelRect(s.labelAt, s.label);
      ext(r.x0, r.y0, r.x1, r.y1);
    }
  }
  for (const w of wires) ext(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2));

  // 枠（受電設備の範囲）は、中身がはみ出さない幅に広げる。
  // ただし結線せずに置いたもの（発電機・太陽光など）は受電設備の外なので数えない
  let fx0 = Infinity;
  let fx1 = -Infinity;
  for (const sy of symbols) {
    if (freeIds.has(sy.id)) continue;
    const def = getSymbol(sy.symbolId);
    fx0 = Math.min(fx0, sy.x);
    fx1 = Math.max(fx1, sy.x + def.box.w);
    if (sy.label.length) {
      const r = labelRect(sy.labelAt, sy.label);
      fx0 = Math.min(fx0, r.x0);
      fx1 = Math.max(fx1, r.x1);
    }
  }
  for (const w of wires) {
    fx0 = Math.min(fx0, w.x1, w.x2);
    fx1 = Math.max(fx1, w.x1, w.x2);
  }
  for (const f of frames) {
    const left = Math.min(f.x, fx0 - 12);
    const right = Math.max(f.x + f.w, fx1 + 12);
    f.x = left;
    f.w = right - left;
    ext(f.x, f.y - 14, f.x + f.w, f.y + 26);
  }

  const portY = (key: string, ...ids: string[]): number | undefined => {
    const p = placed.get(key);
    const port = p ? portOf(p.def, ...ids) : undefined;
    return p && port ? p.sym.y + port.y : undefined;
  };
  const taps: AreaTaps = {
    dsEntry: portY('ds', 'in'),
    dsExit: portY('ds', 'out', 'sec'),
    breakerEntry: portY('main-breaker', 'in'),
    breakerExit: portY('main-breaker', 'out', 'sec'),
    bus: busInfo,
    end: spineY,
  };
  return { symbols, wires, frames, bounds: { x0, y0, x1, y1 }, taps };
}

/* ------------------------------------------------------------------ */
/* 文字の置き場所を、線・記号・ほかの文字から離す                          */
/* ------------------------------------------------------------------ */

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 文字の周りに空けておく余白（線・記号・ほかの文字に、これ以上は近づけない） */
export const LABEL_CLEAR = 3;
/** 文字を動かして探す間隔と、動かしてよい上限 */
const NUDGE_STEP = 4;
const NUDGE_MAX = 96;

/** 文字の並びが占める範囲。y は1行目のベースライン */
export function labelRect(at: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }, lines: string[]): Rect {
  const w = labelWidth(lines);
  const x0 = at.anchor === 'start' ? at.x : at.anchor === 'end' ? at.x - w : at.x - w / 2;
  return {
    x0,
    y0: at.y - LABEL_FONT * 0.85,
    x1: x0 + w,
    y1: at.y + (lines.length - 1) * LABEL_LINE + LABEL_FONT * 0.25,
  };
}

const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
const rectsOverlap = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** 線分が長方形に入り込むか（端が中にある、または辺と交わる） */
function segmentHitsRect(w: Wire, r: Rect): boolean {
  const inside = (x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  if (inside(w.x1, w.y1) || inside(w.x2, w.y2)) return true;
  // 縦・横の線（ほとんどすべて）は、範囲の重なりだけで足りる
  if (w.x1 === w.x2) return w.x1 > r.x0 && w.x1 < r.x1 && Math.max(w.y1, w.y2) > r.y0 && Math.min(w.y1, w.y2) < r.y1;
  if (w.y1 === w.y2) return w.y1 > r.y0 && w.y1 < r.y1 && Math.max(w.x1, w.x2) > r.x0 && Math.min(w.x1, w.x2) < r.x1;
  // 斜めの線は、長方形の4辺との交差を調べる
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const edges: [number, number, number, number][] = [
    [r.x0, r.y0, r.x1, r.y0],
    [r.x1, r.y0, r.x1, r.y1],
    [r.x1, r.y1, r.x0, r.y1],
    [r.x0, r.y1, r.x0, r.y0],
  ];
  return edges.some(([a, b, c, d]) => cross(w.x1, w.y1, w.x2, w.y2, a, b, c, d));
}

interface LabelPlacement {
  at: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
  rect: Rect;
}

/**
 * 文字（記号の横の文字）のぶつかりを調べる。
 * 文字の周りに margin だけ余白を取り、そこに線・ほかの記号・ほかの文字が入ったら「ぶつかり」とする。
 * 返り値は、ぶつかっているものの説明。何も無ければ空。
 */
export function findLabelCollisions(
  d: Pick<DrawingLayout, 'symbols' | 'wires' | 'frames'>,
  margin = LABEL_CLEAR,
): string[] {
  const out: string[] = [];
  const boxes = d.symbols.map((s) => {
    const rb = rotatedBox(getSymbol(s.symbolId).box, s.rotate);
    return { id: s.id, abbr: getSymbol(s.symbolId).abbr, rect: { x0: s.x + rb.dx, y0: s.y + rb.dy, x1: s.x + rb.dx + rb.w, y1: s.y + rb.dy + rb.h } };
  });
  const labeled = d.symbols.filter((s) => s.label.length > 0);
  labeled.forEach((s, i) => {
    const r = grow(labelRect(s.labelAt, s.label), margin);
    const name = `「${s.label[0]}」`;
    for (const w of d.wires) if (segmentHitsRect(w, r)) out.push(`${name} が線に近すぎます`);
    for (const b of boxes) if (b.id !== s.id && rectsOverlap(r, b.rect)) out.push(`${name} が記号（${b.abbr}）に近すぎます`);
    for (const f of d.frames) {
      if (segmentHitsRect({ x1: -1e5, y1: f.y, x2: 1e5, y2: f.y }, r)) out.push(`${name} が枠の線に近すぎます`);
    }
    for (const o of labeled.slice(i + 1)) {
      if (rectsOverlap(r, grow(labelRect(o.labelAt, o.label), 0))) out.push(`${name} が文字「${o.label[0]}」に近すぎます`);
    }
  });
  return out;
}

/**
 * 文字の置き場所を決め直す。
 *
 * 上にある記号から順に、いまの場所が線・記号・ほかの文字にぶつからないか調べ、
 * ぶつかるなら、近い順に「少し上下にずらす」「反対側（左右）へ移す」を試して、
 * 最初に空いたところへ置く。どこも空かないときは、ぶつかりがいちばん少ない場所に置く。
 * 記号から離れすぎないよう、動かすのは記号の上下の範囲＋少しまで。
 */
function avoidLabelCollisions(symbols: PlacedSymbol[], wires: Wire[], frames: FrameMark[]): void {
  const boxes = symbols.map((s) => {
    const rb = rotatedBox(getSymbol(s.symbolId).box, s.rotate);
    return { id: s.id, rect: { x0: s.x + rb.dx, y0: s.y + rb.dy, x1: s.x + rb.dx + rb.w, y1: s.y + rb.dy + rb.h } };
  });
  const frameLines: Wire[] = frames.map((f) => ({ x1: -1e5, y1: f.y, x2: 1e5, y2: f.y }));
  const placed: Rect[] = [];

  const order = symbols.filter((s) => s.label.length > 0).sort((a, b) => a.y - b.y);
  for (const s of order) {
    const def = getSymbol(s.symbolId);
    const rb = rotatedBox(def.box, s.rotate);
    const symTop = s.y + rb.dy;
    const symBottom = symTop + rb.h;
    const lines = s.label;
    const originalAt = s.labelAt;

    const collisions = (at: LabelPlacement['at']): number => {
      const r = grow(labelRect(at, lines), LABEL_CLEAR);
      let n = 0;
      for (const w of wires) if (segmentHitsRect(w, r)) n++;
      for (const w of frameLines) if (segmentHitsRect(w, r)) n++;
      for (const b of boxes) if (b.id !== s.id && rectsOverlap(r, b.rect)) n++;
      if (rectsOverlap(r, boxes.find((b) => b.id === s.id)!.rect)) n++;
      for (const p of placed) if (rectsOverlap(r, grow(p, 1))) n++;
      return n;
    };
    // 記号から離れすぎない範囲か（文字の中心が、記号の上下の範囲＋30以内）
    const near = (at: LabelPlacement['at']): boolean => {
      const r = labelRect(at, lines);
      const cy = (r.y0 + r.y1) / 2;
      return cy >= symTop - 30 && cy <= symBottom + 30;
    };

    // 候補：いまの場所 → 上下に少しずつずらす → 反対側 → 反対側で上下にずらす
    const candidates: { at: LabelPlacement['at']; cost: number }[] = [{ at: originalAt, cost: 0 }];
    const shifts: number[] = [];
    for (let k = 1; k * NUDGE_STEP <= NUDGE_MAX; k++) shifts.push(k * NUDGE_STEP, -k * NUDGE_STEP);
    for (const dy of shifts) candidates.push({ at: { ...originalAt, y: originalAt.y + dy }, cost: Math.abs(dy) });
    if (originalAt.anchor !== 'middle') {
      const flipped =
        originalAt.anchor === 'start'
          ? { x: s.x + rb.dx - 10, anchor: 'end' as const }
          : { x: s.x + rb.dx + rb.w + 10, anchor: 'start' as const };
      candidates.push({ at: { ...originalAt, ...flipped }, cost: 40 });
      for (const dy of shifts) {
        candidates.push({ at: { ...originalAt, ...flipped, y: originalAt.y + dy }, cost: 40 + Math.abs(dy) });
      }
    }

    let best = { at: originalAt, bad: collisions(originalAt), cost: 0 };
    if (best.bad > 0) {
      for (const c of candidates.slice(1)) {
        if (!near(c.at)) continue;
        const bad = collisions(c.at);
        if (bad < best.bad || (bad === best.bad && c.cost < best.cost && bad === 0)) {
          best = { at: c.at, bad, cost: c.cost };
        }
        if (bad === 0) break;
      }
    }
    s.labelAt = best.at;
    placed.push(labelRect(best.at, lines));
  }
}

/** 図面の格子の刻み。移動・伸縮はこの単位に吸着させる */
/**
 * 記号を回したあとの、接続点の位置（記号の左上からの相対）。
 * 画面に描くときは箱の中心まわりに回しているので、計算もそこに揃える。
 * ここがずれると、線の端が接続点から外れて印刷で目立つ。
 * 90度の倍数は三角関数を使わずに出して、誤差を残さない。
 */
export function rotatedPort(
  box: { w: number; h: number },
  x: number,
  y: number,
  deg: number,
): [number, number] {
  const cx = box.w / 2;
  const cy = box.h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [x, y];
  if (d === 90) return [cx - dy, cy + dx];
  if (d === 180) return [cx - dx, cy - dy];
  if (d === 270) return [cx + dy, cy - dx];
  const rad = (d * Math.PI) / 180;
  return [cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad)];
}

/**
 * 記号を回したあとの外形。dx・dy は記号の左上から見た、見えている左上のずれ。
 * 縦長の記号を90°回すと、箱の中心はそのままで左右にはみ出す。
 */
export function rotatedBox(
  box: { w: number; h: number },
  deg: number,
): { dx: number; dy: number; w: number; h: number } {
  const d = ((deg % 360) + 360) % 360;
  if (d === 90 || d === 270) {
    return { dx: (box.w - box.h) / 2, dy: (box.h - box.w) / 2, w: box.h, h: box.w };
  }
  return { dx: 0, dy: 0, w: box.w, h: box.h };
}

export const GRID = 2;

/** 格子に吸着させる */
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** 線を縦か横のどちらかに揃える（斜めにしない） */
export function straighten(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  return Math.abs(x2 - x1) <= Math.abs(y2 - y1) ? [x1, y1, x1, y2] : [x1, y1, x2, y1];
}


/**
 * 主回路の縦線（x=0）から右へ出るケーブルの線の高さを決める。
 * 指定の高さ y で、右にある記号・文字・横の線にぶつかる（または、主回路の縦線の上にある記号の中になる）ときは、
 * 近くの、ぶつからない高さ（上下 60 まで、2刻み）に変える。見つからなければ、指定の高さのまま。
 * lowest は、これより下にはずらさない高さ（高圧母線の少し上）。
 */
function clearRunY(area: AreaLayout, y: number, lowest: number): number {
  const hits: Rect[] = [];
  const spine: Rect[] = [];
  for (const s of area.symbols) {
    const def = findSymbol(s.symbolId);
    if (!def) continue;
    const rb = rotatedBox(def.box, s.rotate);
    const r = { x0: s.x + rb.dx, y0: s.y + rb.dy, x1: s.x + rb.dx + rb.w, y1: s.y + rb.dy + rb.h };
    if (r.x0 < 0 && r.x1 > 0) spine.push(r);
    else hits.push(r);
    if (s.label.length > 0) hits.push(labelRect(s.labelAt, s.label));
  }
  for (const w of area.wires) {
    if (Math.abs(w.y1 - w.y2) < 0.01 && Math.abs(w.x1 - w.x2) > 0.5) {
      hits.push({ x0: Math.min(w.x1, w.x2), y0: w.y1 - 3, x1: Math.max(w.x1, w.x2), y1: w.y1 + 3 });
    }
  }
  const ok = (yy: number): boolean => {
    if (yy > lowest) return false;
    if (spine.some((r) => yy > r.y0 - 2 && yy < r.y1 + 2)) return false;
    const band = { y0: yy - 4, y1: yy + 4 };
    return !hits.some((r) => r.x1 > 4 && r.y0 < band.y1 && r.y1 > band.y0);
  };
  if (ok(y)) return y;
  for (let d = 2; d <= 60; d += 2) {
    if (ok(y + d)) return y + d;
    if (ok(y - d)) return y - d;
  }
  return y;
}

/** エリアどうしの横の間隔（枠と枠のあいだ。エリアをつなぐケーブルを引くところ） */
const AREA_GAP = 140;
/** 分岐の位置から、主回路の端子の前後に空ける距離 */
const TAP_OFFSET = 8;
/** 同じエリアから出る、高さの違う線の幹どうしの間隔 */
const TRUNK_STEP = 10;
/** ケーブルの端末から、幹の縦線までの距離 */
const HEAD_MARGIN = 10;
/** 送り出しの開閉器の前後・あいだの線の長さ */
const SENDOUT_GAP = 16;
/** ケーブルが、エリアの枠の上端より上を通る高さ */
const LINK_RISE = 40;

/**
 * 構成データを、図面上の座標に落とす。
 * 受電設備エリアが1か所なら、そのまま1か所ぶんを置く。
 * 2か所以上のときは、エリアごとに配置して、枠の上端をそろえて左から右へ並べ、
 * 前のエリアの指定の位置から、ケーブルの線を引いてつなぐ。
 */
export function layout(allItems: PlacedItem[], answers: Answers): DrawingLayout {
  const areaNos = [...new Set(allItems.map((i) => i.area ?? 0))].sort((a, b) => a - b);
  if (areaNos.length <= 1) return layoutArea(allItems.filter((i) => i.kind !== 'link' && i.kind !== 'sendout'), answers);

  // エリアごとに、主回路の縦線を x=0、いちばん上を y=0 として配置する
  const parts = areaNos.map((n) => {
    const prefix = `a${n + 1}:`;
    const strip = (r: string) => (n > 0 && r.startsWith(prefix) ? r.slice(prefix.length) : r);
    const mine = allItems.filter((i) => (i.area ?? 0) === n);
    const items = mine
      .filter((i) => i.kind !== 'link' && i.kind !== 'sendout')
      .map((i) => (n === 0 ? i : { ...i, id: strip(i.id), role: strip(i.role), parent: i.parent ? strip(i.parent) : undefined, attachTo: i.attachTo ? strip(i.attachTo) : undefined, connectFrom: i.connectFrom?.map(strip) }));
    const result = layoutArea(items, answers);
    // 役割の名前・IDは、エリアの番号つきに戻す
    if (n > 0) {
      for (const sym of result.symbols) {
        sym.role = `${prefix}${sym.role}`;
        sym.id = `${prefix}${sym.id}`;
        if (sym.parent) sym.parent = `${prefix}${sym.parent}`;
      }
    }
    return { n, prefix, result, link: mine.find((i) => i.kind === 'link') };
  });

  /** 枠の上端（無ければ、いちばん上の記号）。ここを、エリアどうしでそろえる */
  const topOf = (r: AreaLayout): number => r.frames[0]?.y ?? Math.min(0, ...r.symbols.map((s) => s.y));
  const baseTop = topOf(parts[0]!.result);

  /** エリアごとの、上下のずれ（枠の上端をそろえる） */
  const dys = parts.map((part) => baseTop - topOf(part.result));

  /*
   * エリアをつなぐケーブルの経路。
   * 分岐する位置（元のエリアの主回路の脇）から右へ出て、元のエリアの右のすきまで上へ上がり、
   * 枠の上端より上を横へ通って、つなぐ先のエリアの真上から、枠の上端まで下りる。
   * 間にほかのエリアがあっても、その上を通るので、エリアの中を横切らない。
   * 同じ位置から出る線は、1本の縦線（幹）を共有し、高さごとに横へ分かれる。
   */
  type LinkInfo = { n: number; from: number; sx: number; sy: number; label: string[]; dashed: boolean };
  const linkInfos: LinkInfo[] = [];
  for (const part of parts) {
    const link = part.link?.link;
    if (!link || link.from >= part.n || !parts[link.from]) continue;
    const src = parts[link.from]!;
    const t = src.result.taps;
    const dsTop = t.dsEntry ?? t.breakerEntry;
    const breakerTop = t.breakerEntry ?? t.dsExit;
    const breakerBottom = t.breakerExit ?? t.dsExit;
    // 位置の指定が使えないとき（その機器が無いとき）は、近い位置に寄せる
    let y: number | undefined;
    if (link.tap === 'ds-source' && dsTop !== undefined) y = dsTop - TAP_OFFSET;
    else if (link.tap === 'ds-vcb' && breakerTop !== undefined) y = t.breakerEntry !== undefined ? t.breakerEntry - 5 : breakerTop + TAP_OFFSET;
    else if (link.tap === 'vcb-load' && breakerBottom !== undefined) y = breakerBottom + TAP_OFFSET;
    // 主回路の縦線から右へ出る線が、右にある機器（トリップコイルなど）や文字を突き抜けるときは、近くの空いた高さへずらす
    if (y !== undefined) y = clearRunY(src.result, y, t.bus ? t.bus.y - 8 : t.end);
    // 位置が決まらないときは、高圧母線の右端（母線が無ければ、主回路の末端）から出る
    const sy = (y ?? (t.bus ? t.bus.y : t.end)) + dys[link.from]!;
    const sx = y !== undefined ? 0 : t.bus ? t.bus.x : 0;
    linkInfos.push({ n: part.n, from: link.from, sx, sy, label: part.link?.label ?? [], dashed: link.dashed });
  }
  /** 同じエリアの、同じ高さから出る線の組（幹） */
  type Trunk = { from: number; sy: number; links: LinkInfo[]; index: number };
  const trunks: Trunk[] = [];
  for (const li of linkInfos) {
    let tr = trunks.find((x) => x.from === li.from && Math.abs(x.sy - li.sy) < 0.5);
    if (!tr) {
      tr = { from: li.from, sy: li.sy, links: [], index: trunks.filter((x) => x.from === li.from).length };
      trunks.push(tr);
    }
    tr.links.push(li);
  }
  // 同じエリアから出る幹は、上から出る線ほど、左に置く（線が交わらないように）
  for (const f of new Set(trunks.map((x) => x.from))) {
    trunks.filter((x) => x.from === f).sort((a, b) => a.sy - b.sy).forEach((x, i) => { x.index = i; });
  }

  /**
   * 送り出しの開閉器（DS・VCB・LBS）。元のエリアごとに答える。エリアどうしのすきまに、線の上に横向きに置く。
   * 同じ幹には、1組だけ描く。
   */
  const sendoutsOf = (area: number) => allItems.filter((i) => i.kind === 'sendout' && (i.area ?? 0) === area && findSymbol(i.symbolId));
  const runOf = (area: number) => sendoutsOf(area).reduce((w, i) => w + getSymbol(i.symbolId).box.h + SENDOUT_GAP, SENDOUT_GAP);

  /** エリアの手前（左）のすきまの広さ。そのエリアの左のエリアから出る線の幹と、送り出しの開閉器が入る広さ */
  const gapBefore = (p: number): number => {
    const mine = trunks.filter((x) => x.from === p - 1);
    if (mine.length === 0) return AREA_GAP;
    // 送り出しの開閉器と、ケーブルの端末（40）が、すきまの中に入る広さ
    const run = (sendoutsOf(p - 1).length > 0 ? runOf(p - 1) - SENDOUT_GAP : 0) + getSymbol('cable-head').box.h + HEAD_MARGIN + SENDOUT_GAP + 12;
    return Math.max(AREA_GAP, 2 * run, 2 * (TRUNK_STEP * mine.length + 20));
  };

  type Moved = { dx: number; dy: number; part: (typeof parts)[number] };
  const moved: Moved[] = [];
  let right = -Infinity;
  for (const part of parts) {
    const b = part.result.bounds;
    const dy = dys[part.n]!;
    const dx = moved.length === 0 ? 0 : right + gapBefore(part.n) - b.x0;
    moved.push({ dx, dy, part });
    right = Math.max(right, b.x1 + dx);
  }

  const symbols: PlacedSymbol[] = [];
  const wires: Wire[] = [];
  const frames: FrameMark[] = [];
  const texts: DrawingText[] = [];
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
  for (const { dx, dy, part } of moved) {
    const r = part.result;
    for (const sym of r.symbols) {
      symbols.push({ ...sym, x: sym.x + dx, y: sym.y + dy, labelAt: { ...sym.labelAt, x: sym.labelAt.x + dx, y: sym.labelAt.y + dy } });
    }
    for (const w of r.wires) wires.push({ ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy });
    for (const f of r.frames) frames.push({ ...f, x: f.x + dx, y: f.y + dy });
    ext(r.bounds.x0 + dx, r.bounds.y0 + dy, r.bounds.x1 + dx, r.bounds.y1 + dy);
  }

  // 前のエリアの指定の位置から、このエリアの上へ、ケーブルの線を引く
  const maxLines = Math.max(1, ...linkInfos.map((l) => l.label.length));
  /** 遠くのエリアへ渡す線が通る高さの間隔（文字が入る分、広げる） */
  const laneStep = 12 + maxLines * LABEL_LINE;
  // 間にほかのエリアをはさむ線は、枠の上端から離れた高さを、1本ずつ通る（短い線ほど、低い）
  const lanes = new Map<LinkInfo, number>();
  [...linkInfos]
    .filter((l) => l.n - l.from > 1)
    .sort((a, b) => a.n - a.from - (b.n - b.from) || a.from - b.from)
    .forEach((l, i) => lanes.set(l, i + 1));
  const ey = baseTop;
  const tyOf = (l: LinkInfo) => ey - LINK_RISE - (lanes.get(l) ?? 0) * laneStep;
  /** 幹の、縦の線の位置（元のエリアの右のすきまの真ん中から、幹ごとに少しずつ右へ） */
  const trunkX = (tr: Trunk): number => {
    const next = moved[tr.from + 1];
    const base = next ? next.part.result.bounds.x0 + next.dx - gapBefore(tr.from + 1) / 2 : moved[tr.from]!.part.result.bounds.x1 + moved[tr.from]!.dx + AREA_GAP / 2;
    return base + TRUNK_STEP * tr.index;
  };
  const flip = (def: SymbolDef, x: number, y: number, r: number): [number, number] => rotatedPort(def.box, x, y, r);

  for (const tr of trunks) {
    const from = moved[tr.from]!;
    // 分岐する位置のx：高圧母線のときは母線の右端、それ以外は主回路の縦線
    const sx = tr.links[0]!.sx + from.dx;
    const sy = tr.sy;
    const gx = trunkX(tr);
    const tops = tr.links.map(tyOf);
    const topY = Math.min(...tops);

    // 送り出しの開閉器（幹の手前に、横向きに並べる）
    const sends = sendoutsOf(tr.from);
    let cableFrom = sx;
    if (sends.length > 0) {
      const runStart = gx - HEAD_MARGIN - getSymbol('cable-head').box.h - SENDOUT_GAP - (runOf(tr.from) - SENDOUT_GAP);
      if (runStart - sx > 0.5) {
        wires.push({ x1: sx, y1: sy, x2: runStart, y2: sy });
        ext(sx, sy, runStart, sy);
      }
      let cx = runStart;
      // 同じエリアから、高さの違う幹が複数あるときは、2本目からは、IDに印を付ける
      const sfx = tr.index === 0 ? '' : `-${tr.links[0]!.n + 1}`;
      for (const it of sends) {
        const def = getSymbol(it.symbolId);
        const inP = portOf(def, 'in') ?? def.ports[0]!;
        const outP = portOf(def, 'out') ?? def.ports[def.ports.length - 1]!;
        // 入口が左、出口が右になる向きに回す
        const rotate = [-90, 90].find((r) => flip(def, inP.x, inP.y, r)[0] < flip(def, outP.x, outP.y, r)[0]) ?? -90;
        const [ix, iy] = flip(def, inP.x, inP.y, rotate);
        const [ox] = flip(def, outP.x, outP.y, rotate);
        const rb = rotatedBox(def.box, rotate);
        const sym: PlacedSymbol = {
          id: `${it.id}${sfx}`,
          role: `${it.role}${sfx}`,
          symbolId: it.symbolId,
          x: cx - ix,
          y: sy - iy,
          rotate,
          label: it.label,
          labelAt: { x: cx - ix + def.box.w / 2, y: sy - iy + rb.dy - 6 - (it.label.length - 1) * LABEL_LINE, anchor: 'middle' },
        };
        symbols.push(sym);
        ext(sym.x + rb.dx, sym.y + rb.dy, sym.x + rb.dx + rb.w, sym.y + rb.dy + rb.h);
        const exitX = cx - ix + ox;
        cx = exitX + SENDOUT_GAP;
        if (it !== sends[sends.length - 1]) {
          wires.push({ x1: exitX, y1: sy, x2: cx, y2: sy });
        } else {
          cableFrom = exitX;
        }
      }
    }

    const seg = (ax: number, ay: number, bx: number, by: number, dashed: boolean) => {
      if (Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) < 0.5) return;
      wires.push({ x1: ax, y1: ay, x2: bx, y2: by, dashed });
      ext(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    };
    // 送り出し側のケーブルの端末（頂点がケーブル側＝右を向く）。ここから先が、ケーブル。同じ幹から出る線は、1つを共有する
    const head = getSymbol('cable-head');
    const hin = portOf(head, 'in') ?? head.ports[0]!;
    const hout = portOf(head, 'out') ?? head.ports[head.ports.length - 1]!;
    const hrot = [-90, 90].find((r) => flip(head, hin.x, hin.y, r)[0] < flip(head, hout.x, hout.y, r)[0]) ?? -90;
    const [hix, hiy] = flip(head, hin.x, hin.y, hrot);
    const [hox] = flip(head, hout.x, hout.y, hrot);
    const hrb = rotatedBox(head.box, hrot);
    const hexit = gx - HEAD_MARGIN;
    const hx = hexit - (hox - hix);
    // IDは、1か所目の1本目は「cable-head-send」。2か所目以降のエリアから出る線は「a2:」などを前に、2本目以降の幹は何か所目への線かを後ろに付ける
    const hid = `${tr.from === 0 ? '' : `a${tr.from + 1}:`}cable-head-send${tr.index === 0 ? '' : `-${tr.links[0]!.n + 1}`}`;
    symbols.push({
      id: hid,
      role: hid,
      symbolId: 'cable-head',
      x: hx - hix,
      y: sy - hiy,
      rotate: hrot,
      label: [],
      labelAt: { x: hx - hix, y: sy - hiy, anchor: 'start' },
    });
    ext(hx - hix + hrb.dx, sy - hiy + hrb.dy, hx - hix + hrb.dx + hrb.w, sy - hiy + hrb.dy + hrb.h);
    // 幹：分岐の位置（開閉器）から端末まで（ふつうの線）。端末から右へ、すきままで。そこから、いちばん高い横線の高さまで上へ（ケーブル）
    const dashedTrunk = tr.links.every((l) => l.dashed);
    seg(cableFrom, sy, hx, sy, false);
    seg(hexit, sy, gx, sy, dashedTrunk);
    seg(gx, sy, gx, topY, dashedTrunk);
    for (const l of tr.links) {
      const m = moved[l.n]!;
      const ex = m.dx; // このエリアの主回路の縦線は x=0
      const ty = tyOf(l);
      // 線ごとの横線と、つなぐ先のエリアへの縦線
      seg(gx, ty, ex, ty, l.dashed);
      seg(ex, ty, ex, ey, l.dashed);
      // ケーブルの文字：幹が1本の線だけで、開閉器も無いときは、横線（分岐の位置の手前）の上。それ以外は、横線の上、つなぐ先の近く
      const lines = l.label;
      if (lines.length === 0) continue;
      const alone = tr.links.length === 1 && sends.length === 0 && !lanes.has(l);
      const tx = alone ? gx - 8 : ex - 8;
      const tyText = (alone ? sy - 24 : ty - 6) - (lines.length - 1) * LABEL_LINE;
      texts.push({ x: tx, y: tyText, lines, anchor: 'end' });
      const r = labelRect({ x: tx, y: tyText, anchor: 'end' }, lines);
      ext(r.x0, r.y0, r.x1, r.y1);
    }
  }

  return { symbols, wires, frames, texts, bounds: { x0, y0, x1, y1 } };
}
