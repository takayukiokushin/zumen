import { useEffect, useRef } from 'react';
import { useEscapeToClose } from './useEscapeToClose.ts';

/**
 * 「実行」と「キャンセル」を選ぶ、確認の窓。
 * 消える・上書きされるなど、元に戻しにくい操作の前に出す。
 * キャンセル（Esc・窓の外をクリックも同じ）のときは、何も変えない。
 * 最初に選ばれているのは「キャンセル」（うっかりEnterを押しても、実行されないように）。
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** 1行ずつの文。段落に分けて出す */
  message: string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeToClose(onCancel);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <div className="modal-back" onClick={onCancel}>
      <div
        className="modal confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <header>
          <h2>{title}</h2>
        </header>
        <section>
          {message.map((line, i) => (
            <p key={i} className="confirm-line">
              {line}
            </p>
          ))}
        </section>
        <div className="confirm-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
