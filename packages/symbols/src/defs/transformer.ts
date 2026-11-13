import type { FieldDef, SymbolDef } from '../types.ts';
import type { Shape } from '../shape.ts';
import { circle, deltaMark, hline, starMark, text, vline } from '../shape.ts';
import { CELL } from './switchgear.ts';

/**
 * 変圧器の共通の形（縦に重なった2つの円）。
 * 見本図面（電灯Tr・V結線）に合わせ、上下の円を大きめに重ねている。
 */
// 枠は主回路の記号と共通（CELL）。絵は枠の中で上下中央に置く。
/**
 * 絵の大きさ。枠（48×72）は他の記号と共通のまま、中の絵だけを1.5倍にしている。
 * 円の直径が36、上下あわせて63になり、48×72の枠に収まるぎりぎりの大きさ。
 * 寸法はすべてこの値から決めるので、変えれば絵全体がまとめて拡大・縮小する。
 */
const SCALE = 1.5;
const CX = 24;
const R = 12 * SCALE;
/** 枠の上下中央から、2つの円の中心までの距離 */
const SEP = 9 * SCALE;
const CY1 = CELL.h / 2 - SEP;
const CY2 = CELL.h / 2 + SEP;
const BOX = { ...CELL };

/** 下の円の下端。ここが出口（低圧側）になる */
const OUT_Y = CY2 + R;

/**
 * 変圧器の絵。
 *
 * 下側の縦線（低圧側への引き出し線）は**描かない**。
 * 下に何もつながっていないのに線だけ伸びていると、行き先のない線に見えるため。
 * 下につなぐものがあるときは、作図のほうが出口から接続先まで線を引く。
 */
const body = (primary: Shape[], secondary: Shape[]): Shape[] => [
  vline(CX, 0, CY1 - R),
  circle(CX, CY1, R),
  circle(CX, CY2, R),
  ...primary,
  ...secondary,
];

/** 座標を直に書いている記号（並行運転）を、まるごと拡大する */
const grow = (shapes: Shape[], k: number): Shape[] =>
  shapes.map((s) =>
    s.k === 'line'
      ? { ...s, x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k }
      : s.k === 'circle'
        ? { ...s, cx: s.cx * k, cy: s.cy * k, r: s.r * k }
        : s,
  );

const PORTS = [
  { id: 'in', x: CX, y: 0, dir: 'up' as const, role: 'line' as const },
  { id: 'out', x: CX, y: OUT_Y, dir: 'down' as const, role: 'line' as const },
];

/** 巻線の線数（単相変圧器は一次1本・二次3本で単相三線式を表す） */
const wires = (cy: number, count: number): Shape[] => {
  const gap = 4 * SCALE;
  const top = cy - ((count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => hline(top + i * gap, CX - 6 * SCALE, CX + 6 * SCALE));
};

const VOLTAGE: FieldDef = {
  key: 'voltage',
  label: '電圧',
  type: 'text',
  help: '図面の記載例: 6600/210-105V',
};
const USAGE: FieldDef = {
  key: 'usage',
  label: '用途',
  type: 'select',
  options: [
    { value: 'light', label: '電灯', text: '電灯' },
    { value: 'power', label: '動力', text: '動力' },
  ],
  allowFreeInput: true,
  help: '図面の1行目に記載する（例: 電灯）',
};
const CAPACITY: FieldDef = { key: 'capacity', label: '容量', type: 'number', unit: 'kVA' };
/** 単相変圧器を組み合わせて三相を構成する場合、専用の図記号は作らずこの欄に構成を書く */
const COMPOSITION: FieldDef = {
  key: 'composition',
  label: '構成',
  type: 'text',
  help: '単相変圧器を組み合わせて構成する場合に記載する。例: 単相変圧器×3',
};

const TR_1P_LINES = ['{usage}', 'Tr', '1φ{capacity}kVA', '{voltage}'];
const TR_3P_LINES = ['{usage}', 'Tr', '3φ{capacity}kVA', '{voltage}', '{composition}'];

type Conn = 'y' | 'd';
/**
 * 2つの丸が重なっている（中心の間隔 SEP×2 ＝27 は、半径 R＝18 より小さい）ので、
 * 丸の中心に印（Y・Δ・V）を置くと、下の丸の印の頂点が、上の丸の下の線に触れたり、上の丸の中へ出たりする（Δは、1.5はみ出す）。
 * そこで、上の丸の印は上へ、下の丸の印は下へ、MARK_DY だけずらして置く（重なっていない側へ寄せる）。
 * こうすると、どの印も、自分の丸の線からも、重なっている隣の丸の線からも、3以上離れる（第13弾 項目40）。
 */
const MARK_DY = 3 * SCALE;
const connMark = (conn: Conn, cy: number, dy: number): Shape[] =>
  conn === 'y' ? starMark(CX, cy + dy, 6 * SCALE) : [deltaMark(CX, cy + dy, 7 * SCALE)];

/** 三相変圧器（結線方式違い）を1つの定義から生成する */
const threePhase = (id: string, primary: Conn, secondary: Conn, label: string): SymbolDef => ({
  id,
  abbr: 'Tr',
  labelLines: TR_3P_LINES,
  nameJa: `三相変圧器（${label}）`,
  category: 'transformer',
  tags: ['変圧器', '三相', label],
  box: BOX,
  shapes: body(connMark(primary, CY1, -MARK_DY), connMark(secondary, CY2, MARK_DY)),
  ports: PORTS,
  fields: [USAGE, CAPACITY, VOLTAGE, COMPOSITION],
  status: 'confirmed',
  statusNote: '三相変圧器の図記号はこの形でOK。円の大きさは見本図面（電灯Tr）に合わせました。',
  note:
    label === 'Δ-Δ結線'
      ? '単相変圧器3台で構成するΔ-Δ結線も、専用の図記号を作らずこの記号を使い、構成欄に「単相変圧器×3」と記載する。'
      : '使用用途によって巻線の結線方式が異なる。基本は Y-Y / Δ-Δ / Y-Δ / Δ-Y の4種類。',
});

/*
 * 三巻線変圧器（丸が3つ）。
 *
 * 丸の大きさ（R）と、丸の中心どうしの距離（D）は、二巻線と同じ。
 * 3つの丸の中心は正三角形になる（上の丸が頂点、下の2つが底辺側）ので、
 * 3組すべての丸の重なり具合が、二巻線の2つの丸と同じになる。
 *   下の2つの丸の中心 ＝ 上の丸の中心から、真下に D×√3/2、左右に D/2 ずつ
 *
 * 絵の幅は D + 2R = 63 で、二巻線の枠（幅48）に収まらない。
 * そこで、この記号だけ枠の幅を広げ（72）、主回路の線は枠の中央（x = 36）を通す。
 * 枠の高さは二巻線と同じ（72）で、絵は上下中央に置く。
 */
const D = 2 * SEP;
const TRI_H = (D * Math.sqrt(3)) / 2;
const BOX3 = { w: 72, h: CELL.h };
const CX3 = BOX3.w / 2;
/** 上の丸の中心。3つの丸の外側全体（高さ TRI_H + 2R）が、枠の上下中央に来る */
const CY3_TOP = CELL.h / 2 - TRI_H / 2;
/** 下の2つの丸の中心の高さ・左右のずれ */
const CY3_LOW = CY3_TOP + TRI_H;
const DX3 = D / 2;
/** 下の丸の下端。ここから、低圧側の線が出る */
const OUT3_Y = CY3_LOW + R;

/**
 * 三巻線変圧器の、丸の中の結線の印（Y・Δ）。印そのものは、二巻線・三相変圧器と同じもの（大きさも同じ）。
 *
 * 丸が互いに重なっているので、丸の中心に置くと、隣の丸の線に近づく（Δで、線まで0.7しかない）。
 * そこで、3つの丸の真ん中から離れる向きに、MARK_SHIFT だけずらして置く。
 * こうすると、自分の丸の線からも、隣の丸の線からも、3.5以上離れる。
 *   上の丸は真上へ、左下の丸は左下へ、右下の丸は右下へ（どの印も、向きは上向きのまま）
 */
const MARK_SHIFT = 3.5;
const markAt = (conn: Conn, cx: number, cy: number): Shape[] =>
  conn === 'y' ? starMark(cx, cy, 6 * SCALE) : [deltaMark(cx, cy, 7 * SCALE)];
/** 三巻線変圧器の3つの丸（一次＝上、二次＝左下、三次＝右下）の印の位置 */
const MARK3 = {
  primary: { x: CX3, y: CY3_TOP - MARK_SHIFT },
  secondary: { x: CX3 - DX3 - MARK_SHIFT * (Math.sqrt(3) / 2), y: CY3_LOW + MARK_SHIFT / 2 },
  tertiary: { x: CX3 + DX3 + MARK_SHIFT * (Math.sqrt(3) / 2), y: CY3_LOW + MARK_SHIFT / 2 },
};

/**
 * 三巻線変圧器の接続点。
 *   in    … 一次（高圧側）。上の丸の真上。今までの変圧器と同じ名前・同じ位置（枠の上端の中央）
 *   out-2 … 二次。左下の丸の真下
 *   out-3 … 三次。右下の丸の真下
 * 二次・三次は、下につなぐものがあるときだけ線を引く（二巻線と同じ。何もつながないときは、線を描かない）。
 */
const PORTS3 = [
  { id: 'in', x: CX3, y: 0, dir: 'up' as const, role: 'line' as const },
  { id: 'out-2', x: CX3 - DX3, y: OUT3_Y, dir: 'down' as const, role: 'line' as const },
  { id: 'out-3', x: CX3 + DX3, y: OUT3_Y, dir: 'down' as const, role: 'line' as const },
];

/** 三巻線変圧器（結線方式違い）を1つの定義から生成する。conns は一次・二次・三次の順 */
const threeWinding = (id: string, conns: [Conn, Conn, Conn], label: string): SymbolDef => ({
  id,
  abbr: 'Tr',
  nameJa: `三巻線変圧器（${label}）`,
  category: 'transformer',
  tags: ['変圧器', '三巻線', '3巻線', '三次巻線', label],
  box: BOX3,
  shapes: [
    vline(CX3, 0, CY3_TOP - R),
    circle(CX3, CY3_TOP, R),
    circle(CX3 - DX3, CY3_LOW, R),
    circle(CX3 + DX3, CY3_LOW, R),
    ...markAt(conns[0], MARK3.primary.x, MARK3.primary.y),
    ...markAt(conns[1], MARK3.secondary.x, MARK3.secondary.y),
    ...markAt(conns[2], MARK3.tertiary.x, MARK3.tertiary.y),
  ],
  ports: PORTS3,
  status: 'confirmed',
  statusNote: `一次（上の丸）・二次（左下の丸）・三次（右下の丸）の順に、${label}。Y・Δの印は、二巻線・三相変圧器と同じもの。接続点は、一次＝上の丸の上、二次＝左下の丸の下、三次＝右下の丸の下。「設備を入力して作成」の結線方式から選べる（容量は、一次・二次・三次の巻線ごとに任意）。下につなぐ回線は、線でつながず、手で結ぶ。`,
  note: '巻線が3つある変圧器。丸が重なっているため、印は、丸の中心から少しずらして置いている（線に触れないように）。',
});

export const transformerSymbols: SymbolDef[] = [
  {
    /*
     * 結線方式がまだ決まっていない変圧器。
     * 円の中は空けておく。決まっていないのに勝手にΔやYを描くと、
     * 間違った図面がそのまま使われてしまうため。
     * 入力が済めば、その結線方式の記号に入れ替わる。
     */
    id: 'tr-blank',
    labelLines: TR_3P_LINES,
    abbr: 'Tr',
    nameJa: '変圧器（結線方式はこれから）',
    category: 'transformer',
    altOf: 'tr-3p-dy',
    optional: true,
    tags: ['変圧器', '未入力'],
    box: BOX,
    shapes: body([], []),
    ports: PORTS,
    fields: [USAGE, CAPACITY, VOLTAGE, COMPOSITION],
    status: 'confirmed',
    statusNote: '結線方式が未入力のときに使う。円の中は空のまま。',
    note: 'ヒアリングで結線方式を選ぶと、その結線方式の記号に入れ替わる。',
  },
  {
    id: 'tr-1p',
    labelLines: TR_1P_LINES,
    abbr: 'Tr',
    nameJa: '単相変圧器（単相三線式）',
    category: 'transformer',
    tags: ['変圧器', '単相', '電灯', '単相三線'],
    box: BOX,
    shapes: body(wires(CY1, 1), wires(CY2, 3)),
    ports: PORTS,
    fields: [USAGE, CAPACITY, VOLTAGE],
    status: 'confirmed',
    statusNote: '見本図面のとおり。上の円は常に横線1本、下の円は二次側が三線式なので3本。',
    note: '記載例「電灯 / Tr / 1φ200kVA / 6600/210-105V」。',
  },
  {
    id: 'tr-1p-2w',
    labelLines: TR_1P_LINES,
    abbr: 'Tr',
    nameJa: '単相変圧器（単相2線式）',
    category: 'transformer',
    altOf: 'tr-1p',
    tags: ['変圧器', '単相', '単相2線'],
    box: BOX,
    shapes: body(wires(CY1, 1), wires(CY2, 2)),
    ports: PORTS,
    fields: [USAGE, CAPACITY, VOLTAGE],
    status: 'confirmed',
    statusNote: '二次側が単相2線式の場合。下の円の横線を2本にします。',
    note: '上の円は常に横線1本。下の円の本数は二次側の方式で決まる（2線式=2本／三線式=3本）。',
  },
  threePhase('tr-3p-yy', 'y', 'y', 'Y-Y結線'),
  threePhase('tr-3p-dd', 'd', 'd', 'Δ-Δ結線'),
  threePhase('tr-3p-yd', 'y', 'd', 'Y-Δ結線'),
  threePhase('tr-3p-dy', 'd', 'y', 'Δ-Y結線'),
  {
    id: 'tr-vv',
    labelLines: ['{usage}', 'Tr', '1φ{capacity1}kVA', '1φ{capacity2}kVA', '{voltage}', '{composition}'],
    abbr: 'Tr',
    nameJa: '三相変圧器（V結線）',
    category: 'transformer',
    tags: ['変圧器', 'V結線', '単相2台'],
    box: BOX,
    shapes: body([text(CX, CY1 - MARK_DY, 'V', { size: 13 * SCALE })], [text(CX, CY2 + MARK_DY, 'V', { size: 13 * SCALE })]),
    ports: PORTS,
    fields: [
      USAGE,
      { key: 'capacity1', label: '1台目の容量', type: 'number', unit: 'kVA' },
      { key: 'capacity2', label: '2台目の容量', type: 'number', unit: 'kVA' },
      VOLTAGE,
      { ...COMPOSITION, defaultValue: '単相変圧器×2' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、丸を縦に2つ並べそれぞれの中にVを記載する形で確定。',
    note: '単相変圧器2台で三相を構成する。2台の定格容量が異なる場合があるため容量は2台分を別々に記載する。記載例「V結線 / Tr / 1φ50kVA / 1φ75kVA / 6600/210-105V」。',
  },
  {
    id: 'tr-1p-parallel',
    labelLines: TR_1P_LINES,
    abbr: 'Tr',
    nameJa: '単相変圧器 並行運転（倍容量）',
    category: 'transformer',
    tags: ['変圧器', '単相', '並行運転'],
    box: { w: 84 * SCALE, h: 68 * SCALE },
    shapes: grow([
      vline(42, 0, 8),
      hline(8, 22, 62),
      vline(22, 8, 12),
      vline(62, 8, 12),
      circle(22, 24, 12), circle(22, 42, 12),
      circle(62, 24, 12), circle(62, 42, 12),
      hline(24, 16, 28), hline(24, 56, 68),
      hline(38, 16, 28), hline(42, 16, 28), hline(46, 16, 28),
      hline(38, 56, 68), hline(42, 56, 68), hline(46, 56, 68),
      vline(22, 54, 60),
      vline(62, 54, 60),
      hline(60, 22, 62),
      // 下側の縦線は描かない（つなぐものがあるときだけ作図のほうが引く）
    ], SCALE),
    ports: [
      { id: 'in', x: 42 * SCALE, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 42 * SCALE, y: 60 * SCALE, dir: 'down', role: 'line' },
    ],
    fields: [USAGE, CAPACITY, VOLTAGE],
    status: 'confirmed',
    statusNote: '並行運転の構成はこの図でOK。単相変圧器の図記号を見本どおりに差し替えました。',
    note: '単相変圧器2台を並行運転させ、倍容量の単相変圧器として使用するパターン。',
  },
  {
    id: 'tr-scott',
    labelLines: ['Tr', '3φ{capacity}kVA', '{voltage}'],
    abbr: 'Tr',
    nameJa: 'スコット変圧器（低圧）',
    category: 'transformer',
    tags: ['変圧器', 'スコット', '単相三線', '低圧'],
    optional: true,
    box: BOX,
    shapes: body(
      [hline(CY1 + 4 * SCALE, CX - 7 * SCALE, CX + 7 * SCALE), vline(CX, CY1 - 6 * SCALE, CY1 + 4 * SCALE)],
      [
        // 縦線の上端は、上の丸の下の線から3以上離す（以前は、1.5まで近づいていた。第13弾 項目40）
        vline(CX - 5 * SCALE, CY2 - 4 * SCALE, CY2 + 5 * SCALE),
        hline(CY2 + 5 * SCALE, CX - 5 * SCALE, CX + 6 * SCALE),
      ],
    ),
    ports: PORTS,
    fields: [CAPACITY, VOLTAGE],
    status: 'confirmed',
    statusNote: '見本図面のとおり、上の円に「⊥」、下の円に「L」を入れる形にしました。',
    note: 'ほとんどが低圧から低圧への変換のため、通常は単線結線図に記載しない。指示があったときだけ配置する。記載例「低圧スコット（常時励磁）20kVA」。',
  },
  {
    id: 'tr-3w',
    abbr: 'Tr',
    nameJa: '三巻線変圧器',
    category: 'transformer',
    tags: ['変圧器', '三巻線', '3巻線', '三次巻線'],
    box: BOX3,
    shapes: [
      vline(CX3, 0, CY3_TOP - R),
      circle(CX3, CY3_TOP, R),
      circle(CX3 - DX3, CY3_LOW, R),
      circle(CX3 + DX3, CY3_LOW, R),
    ],
    /*
     * 接続点は仮の置き方（上の丸の上＝高圧側、下の2つの丸の下＝残りの2つの巻線）。
     * どこに線をつなぐかは、次の項目で決める。
     */
    ports: PORTS3,
    status: 'confirmed',
    statusNote: '丸を3つ、正三角形の形に重ねた形（確認済み）。丸の大きさと重なり具合は二巻線と同じ。接続点は、一次＝上の丸の上、二次＝左下の丸の下、三次＝右下の丸の下。丸の中は空のまま使う記号で、「設備を入力して作成」の結線方式には出ない（記号の一覧から、手で置く）。三巻線の結線の入った記号は、Y-Y-Δ結線とΔ-Δ-Y結線の2つ。',
    note: '巻線が3つある変圧器。丸だけの形で、結線の印（Y・Δ）は入っていない。調整用・力率改善用などに使う特殊なもの。',
  },
  // 一次（上）・二次（左下）・三次（右下）の順
  threeWinding('tr-3w-yyd', ['y', 'y', 'd'], 'Y-Y-Δ結線'),
  threeWinding('tr-3w-ddy', ['d', 'd', 'y'], 'Δ-Δ-Y結線'),
];
