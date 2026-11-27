import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * アプリ全体の「説明の吹き出し」。
 *
 * ボタンなどに付けた説明（title・data-tip）を、**カーソルを合わせてから1秒後**に出す。
 * ブラウザ標準の説明は、出るまでの時間を決められない（ブラウザ任せで、長いことも短いこともある）ので、
 * 標準のものは出さずに、ここで出す。キーボードで選んだときは、待たずに出す。
 *
 *   - 説明を付けるときは、ふつうに title="…" か data-tip="…" を書くだけでよい
 *   - カーソルを合わせている間だけ、title を data-tip に退避する（外すと、元に戻す）
 */

/** カーソルを合わせてから、説明が出るまでの時間（ミリ秒） */
export const TIP_DELAY = 1000;

interface Shown {
  text: string;
  /** 説明を出す要素の位置 */
  rect: { left: number; right: number; top: number; bottom: number };
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    let savedTitle: string | null = null;

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      // 退避していた title を、元に戻す
      if (current && savedTitle !== null) {
        if (!current.hasAttribute('title')) current.setAttribute('title', savedTitle);
        current.removeAttribute('data-tip');
      }
      current = null;
      savedTitle = null;
      setShown(null);
    };

    const open = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect();
      setShown({ text, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
    };

    const attach = (el: HTMLElement): string | null => {
      const title = el.getAttribute('title');
      if (title) {
        savedTitle = title;
        el.removeAttribute('title');
        el.setAttribute('data-tip', title);
      }
      const text = el.getAttribute('data-tip');
      return text && text.trim() ? text : null;
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('[title], [data-tip]') ?? null;
      if (el === current) return;
      hide();
      if (!el) return;
      const text = attach(el);
      if (!text) return;
      current = el;
      timer = setTimeout(() => open(el, text), TIP_DELAY);
    };
    const onOut = (e: MouseEvent) => {
      if (!current) return;
      const to = e.relatedTarget as Node | null;
      if (to && current.contains(to)) return;
      hide();
    };
    // キーボードで選んだときは、待たずに出す（クリックで選んだときは出さない）
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('[title], [data-tip]') ?? null;
      if (!el || !el.matches(':focus-visible')) return;
      hide();
      const text = attach(el);
      if (!text) return;
      current = el;
      open(el, text);
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // 画面からはみ出さないように、位置を決める（右にはみ出すなら左へ、下にはみ出すなら要素の上へ）
  // 画面全体の倍率（設定の130%など）があると、「画面の長さ（getBoundingClientRect・innerWidth）」と、吹き出しに指定する「CSSの長さ」は、
  // 同じではない（倍率ぶん、違う）。吹き出しの見た目の幅 ÷ 中の幅 で、その比 z を測り、画面の長さで位置を決めてから、CSSの長さに直す。
  // （これを混ぜると、倍率があるとき、右のタブほど、三角が左にずれ、吹き出しが画面の外に出た。第21弾 項目16）
  useLayoutEffect(() => {
    if (!shown || !box.current) {
      setPos(null);
      return;
    }
    const el = box.current;
    const shownW = el.getBoundingClientRect().width;
    const z = el.offsetWidth > 0 && shownW > 0 ? shownW / el.offsetWidth : 1;
    const w = shownW;
    const h = el.getBoundingClientRect().height;
    const margin = 8;
    const centerX = (shown.rect.left + shown.rect.right) / 2;
    let left = Math.min(shown.rect.left, window.innerWidth - w - margin);
    left = Math.max(margin, left);
    const below = shown.rect.bottom + 6;
    const above = below + h > window.innerHeight - margin && shown.rect.top - 6 - h > margin;
    const top = above ? shown.rect.top - 6 - h : below;
    const arrowScreen = Math.min(Math.max(centerX - left, 12 * z), Math.max(12 * z, w - 12 * z));
    setPos({ left: left / z, top: top / z, arrow: arrowScreen / z, above });
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={box}
      className={`tip tip-fixed${pos?.above ? ' above' : ''}`}
      role="tooltip"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        ['--arrow-x' as string]: `${pos?.arrow ?? 16}px`,
      }}
    >
      {shown.text}
    </div>
  );
}
