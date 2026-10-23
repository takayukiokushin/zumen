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
 * 歯車の輪郭。歯の数ぶん「外・外・内・内」の順に点を打って一筆で描く。
 * 太陽（放射状の線）に見えないよう、歯は平らな台形にしてある。
 */
const COG_PATH = (() => {
  const teeth = 8;
  const rOut = 10.6;
  const rIn = 7.8;
  const cx = 12;
  const cy = 12;
  const step = (Math.PI * 2) / teeth;
  const half = step * 0.26;
  const at = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    parts.push(
      `${i === 0 ? 'M' : 'L'} ${at(rOut, a - half)}`,
      `L ${at(rOut, a + half)}`,
      `L ${at(rIn, a + half)}`,
      `L ${at(rIn, a + step - half)}`,
    );
  }
  return `${parts.join(' ')} Z`;
})();

/** 歯車。表示の設定 */
export function GearIcon({ size = 1.7 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.3} strokeLinejoin="round">
      <path d={COG_PATH} />
      <circle cx="12" cy="12" r="3.6" />
    </svg>
  );
}
