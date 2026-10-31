import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * 画面の中でスクロールする場所（入力欄・目次・「いまの構成」。幅の狭い画面では全体）。
 * 別のタブへ移って戻ってきたとき、編集していた位置に戻すために、位置を覚えておく。
 */
const SCROLLERS = ['.form', '.nav', '.preview', '.app'] as const;

export interface ScrollStore {
  /** どの案件の位置か。案件が変わったら、覚えていた位置は捨てる */
  id: string | null;
  pos: Record<string, number>;
}

export const newScrollStore = (): ScrollStore => ({ id: null, pos: {} });

/**
 * 入力画面の外枠。タブを切り替えると、この画面は一度消えて、戻ると作り直される（そのままだと一番上に戻る）。
 * スクロールのたびに位置を store に控え、作り直されたときに、その位置へ戻す。
 */
export function KeepScroll({ store, projectId, className, children }: { store: ScrollStore; projectId: string | null; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (store.id !== projectId) {
      store.id = projectId;
      store.pos = {};
    }
    const apply = () => {
      for (const sel of SCROLLERS) {
        const top = store.pos[sel];
        const el = root.matches(sel) ? root : root.querySelector<HTMLElement>(sel);
        if (el && top) el.scrollTop = top;
      }
    };
    apply();
    // 文字や画像で高さが決まったあとにも、もう一度合わせる
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      onScrollCapture={(e) => {
        const el = e.target as HTMLElement;
        if (!el.matches) return;
        for (const sel of SCROLLERS) if (el.matches(sel)) store.pos[sel] = el.scrollTop;
      }}
    >
      {children}
    </div>
  );
}
