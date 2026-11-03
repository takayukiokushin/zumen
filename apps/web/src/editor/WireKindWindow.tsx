import { useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/useT.ts';

/** 窓の位置（画面の左上からの距離） */
export interface Pos {
  x: number;
  y: number;
}

/**
 * 「線を引く」のあいだ、図面の上に出す、線の種類（実線・点線）を選ぶ小さな窓。
 *
 * - 画面の上の道具の並び（レイアウト）は、変えない。窓は、図面の上に、重ねて出す。
 * - 上の帯をつかんで、ドラッグすると、窓を、好きな所へ動かせる（線をたくさん引くとき、種類を選び直しに、画面の上まで戻らなくてよい）。
 * - 左上の「×」を押すと、窓が消えて、線を引くのも終わる。
 */
export function WireKindWindow({
  dashed,
  onChange,
  onClose,
  pos,
  onPos,
  anchor,
}: {
  dashed: boolean;
  onChange: (dashed: boolean) => void;
  onClose: () => void;
  /** 前に動かした位置。まだ動かしていないときは null（図面の左上に出す） */
  pos: Pos | null;
  onPos: (p: Pos) => void;
  /** 初めて出す位置の目安にする要素（図面を置く場所） */
  anchor: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
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
      className="wire-window"
      role="dialog"
      aria-label={t('editor.lineKind')}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
    >
      <div
        className="wire-window-bar"
        title={t('editor.wireWindowDrag')}
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
        <button type="button" className="wire-window-close" aria-label={t('editor.wireWindowClose')} title={t('editor.wireWindowClose')} onClick={onClose}>
          ×
        </button>
        <span className="wire-window-title">{t('editor.lineKind')}</span>
      </div>
      <div className="wire-window-body" role="group" aria-label={t('editor.lineKind')}>
        {([false, true] as const).map((d) => (
          <button
            key={String(d)}
            type="button"
            className="line-kind"
            aria-pressed={dashed === d}
            title={t(d ? 'editor.lineDashed' : 'editor.lineSolid')}
            aria-label={t(d ? 'editor.lineDashed' : 'editor.lineSolid')}
            onClick={() => onChange(d)}
          >
            <svg width="44" height="10" viewBox="0 0 44 10" aria-hidden="true">
              <line x1="2" y1="5" x2="42" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={d ? '6 4' : undefined} />
            </svg>
            <span>{t(d ? 'editor.lineDashedShort' : 'editor.lineSolid')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
