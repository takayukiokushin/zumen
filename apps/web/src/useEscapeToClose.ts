import { useEffect } from 'react';

/**
 * Esc キーで閉じる（開いている間だけ効く）。
 *
 * 日本語入力の変換中の Esc は「変換を取り消す」操作なので、閉じない。
 * ほかの部品が Esc を使って処理済みのとき（defaultPrevented）も閉じない。
 */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
