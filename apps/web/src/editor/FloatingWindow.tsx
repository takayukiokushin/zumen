import { useEffect, useLayoutEffect, useRef } from 'react';

/** 窓の位置（画面の左上からの距離） */
export interface Pos {
  x: number;
  y: number;
}

/**
 * 図面の上に重ねて出す、動かせる小さな窓（線の種類の窓・文字の設定の窓で共通）。
 *
 * - 上の帯をつかんで、ドラッグすると、窓を、好きな所へ動かせる。位置は、呼び出す側が覚えておく（pos・onPos）。
 * - 左上の「×」を押すと、onClose が呼ばれる。
 * - 初めて出すときは、anchor（図面を置く場所）の左上に、少し内側へ入れて出す。画面の外には出さない。
 */
export function FloatingWindow({
  title,
  closeLabel,
  dragHint,
  className,
  onClose,
  pos,
  onPos,
  anchor,
  children,
}: {
  title: string;
  closeLabel: string;
  dragHint: string;
  className?: string;
  onClose: () => void;
  /** 前に動かした位置。まだ動かしていないときは null（図面の左上に出す） */
  pos: Pos | null;
  onPos: (p: Pos) => void;
  /** 初めて出す位置の目安にする要素（図面を置く場所） */
  anchor: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  /** 画面の外に出ないようにする */
  const clamp = (p: Pos): Pos => {
    const w = box.current?.offsetWidth ?? 160;
    const h = box.current?.offsetHeight ?? 90;
    return {
      x: Math.max(0, Math.min(window.innerWidth - w, p.x)),
      y: Math.max(0, Math.min(window.innerHeight - h, p.y)),
    };
  };

  // 初めて出すとき：図面を置く場所の左上に、少し内側へ入れて出す
  useLayoutEffect(() => {
    if (pos) return;
    const r = anchor.current?.getBoundingClientRect();
    onPos(clamp({ x: (r?.left ?? 0) + 16, y: (r?.top ?? 0) + 16 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画面の大きさが変わって、窓が外に出てしまったら、中へ戻す
  useEffect(() => {
    const onResize = () => pos && onPos(clamp(pos));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  return (
    <div
      ref={box}
      className={`wire-window${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={title}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
    >
      <div
        className="wire-window-bar"
        title={dragHint}
        onPointerDown={(e) => {
          // 「×」の上では、つかまない
          if ((e.target as Element).closest('button')) return;
          if (!pos) return;
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          drag.current = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          onPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <button type="button" className="wire-window-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          ×
        </button>
        <span className="wire-window-title">{title}</span>
      </div>
      {children}
    </div>
  );
}
