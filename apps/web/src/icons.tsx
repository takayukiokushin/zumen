/**
 * 画面で使う小さな絵記号。
 * 絵文字は端末によって形も大きさも変わり、写実的で落ち着かないものもあるので、
 * 線だけの白黒で自前に描いている。色は文字の色（currentColor）に従う。
 */

interface IconProps {
  /** 文字の大きさの何倍にするか */
  size?: number;
}

const base = (size: number) => ({
  width: `${size}em`,
  height: `${size}em`,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

/** 目。パスワードを表示する側 */
export function EyeIcon({ size = 1.25 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 12C4.6 8.2 8.1 6 12 6s7.4 2.2 9.5 6c-2.1 3.8-5.6 6-9.5 6s-7.4-2.2-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 目に斜線。パスワードを隠す側 */
export function EyeOffIcon({ size = 1.25 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 12C4.6 8.2 8.1 6 12 6s7.4 2.2 9.5 6c-2.1 3.8-5.6 6-9.5 6s-7.4-2.2-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="4" y1="20" x2="20" y2="4" />
    </svg>
  );
}

/**
 * 歯車の輪郭。
 * 角張らないよう、歯の山も谷も**円弧**でつなぎ、
 * 山と谷の間だけをゆるい直線（歯の側面）にしている。
 * 太陽（放射状の線）に見えないよう、山には幅を持たせてある。
 */
type Pt = [number, number];

/**
 * 角をすべて丸めた多角形のパスを作る。
 * 頂点ごとに、両隣の辺に沿って少し手前で切り、その間を円弧でつなぐ。
 */
function roundedPolygon(pts: Pt[], radius: number): string {
  const n = pts.length;
  const out: string[] = [];
  const fix = (v: number) => v.toFixed(2);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const here = pts[i]!;
    const next = pts[(i + 1) % n]!;

    const toPrev: Pt = [prev[0] - here[0], prev[1] - here[1]];
    const toNext: Pt = [next[0] - here[0], next[1] - here[1]];
    const lenPrev = Math.hypot(...toPrev) || 1;
    const lenNext = Math.hypot(...toNext) || 1;
    // 辺の半分より深くは切らない（隣の角と食い合わないように）
    const cut = Math.min(radius, lenPrev / 2, lenNext / 2);

    const a: Pt = [here[0] + (toPrev[0] / lenPrev) * cut, here[1] + (toPrev[1] / lenPrev) * cut];
    const b: Pt = [here[0] + (toNext[0] / lenNext) * cut, here[1] + (toNext[1] / lenNext) * cut];

    // 曲がる向き。SVGはy下向きなので、外積が正なら時計回り
    const cross = (here[0] - prev[0]) * (next[1] - here[1]) - (here[1] - prev[1]) * (next[0] - here[0]);
    const sweep = cross > 0 ? 1 : 0;

    out.push(`${i === 0 ? 'M' : 'L'} ${fix(a[0])} ${fix(a[1])}`);
    out.push(`A ${fix(cut)} ${fix(cut)} 0 0 ${sweep} ${fix(b[0])} ${fix(b[1])}`);
  }
  return `${out.join(' ')} Z`;
}

/** 歯車の輪郭。角のある歯車を作ってから、角をすべて丸めている */
const COG_PATH = (() => {
  const teeth = 8;
  const rOut = 10.8;
  const rIn = 7.6;
  const cx = 12;
  const cy = 12;
  const step = (Math.PI * 2) / teeth;
  const half = step * 0.26;
  const at = (r: number, a: number): Pt => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

  const pts: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(at(rOut, a - half), at(rOut, a + half), at(rIn, a + half), at(rIn, a + step - half));
  }
  return roundedPolygon(pts, 1.5);
})();

/** 歯車。表示の設定 */
export function GearIcon({ size = 1.7 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round">
      <path d={COG_PATH} />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}
