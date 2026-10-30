import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from './i18n/useT.ts';

/**
 * ブラウザ標準の確認画面・入力画面（window.confirm / window.prompt）の代わり。
 * どの端末・どのブラウザでも、同じ見た目・同じ操作になる。
 *
 *   const { ask, input } = useDialogs();
 *   if (!(await ask({ message: ['消します。よろしいですか。'] }))) return;
 *   const name = await input({ title: '案件の名前', defaultValue: '' });   // キャンセルなら null
 *
 * 確認では、最初に選ばれているのは「キャンセル」（うっかりEnterを押しても、実行されないように）。
 * 入力では、最初に入力欄が選ばれていて、Enterで決定できる（日本語の変換中のEnterは決定にしない）。
 */

export interface AskOptions {
  title?: string;
  /** 1行ずつの文。段落に分けて出す */
  message: string[] | string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface InputOptions {
  title: string;
  /** 入力欄の上に出す説明（1行ずつ） */
  message?: string[] | string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** パスワードなど、画面に見せたくない入力。「表示する」ボタンで確かめられる */
  secret?: boolean;
}

interface Ctx {
  ask: (o: AskOptions) => Promise<boolean>;
  input: (o: InputOptions) => Promise<string | null>;
}

const DialogsContext = createContext<Ctx | null>(null);

type Pending =
  | { id: number; kind: 'ask'; opts: AskOptions; done: (v: boolean) => void }
  | { id: number; kind: 'input'; opts: InputOptions; done: (v: string | null) => void };

let nextId = 1;

/**
 * 窓が開いている間の、キーボードの扱い。
 * - Esc：キャンセル（窓の後ろの画面の「Escで閉じる」には、届かせない）
 * - Tab：窓の中だけを回る（後ろの画面に移らない）
 * - そのほかのキー：後ろの画面（図面の Delete キーなど）に届かせない。窓は、元の画面を止めて使うものだから
 * - 日本語の変換を確定する Enter では、決定しない
 */
function useDialogKeys(boxRef: React.RefObject<HTMLElement | null>, onCancel: () => void): void {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      if (e.key === 'Tab' && boxRef.current) {
        const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')).filter((x) => !(x as HTMLButtonElement).disabled);
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const outside = !active || !boxRef.current.contains(active);
        if (first && last && (outside || (e.shiftKey && active === first) || (!e.shiftKey && active === last))) {
          e.preventDefault();
          (e.shiftKey && !outside ? last : first).focus();
        }
      } else if (e.key === 'Enter' && e.isComposing) {
        e.preventDefault();
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [boxRef]);
}

const lines = (m: string[] | string | undefined): string[] =>
  m === undefined ? [] : (Array.isArray(m) ? m : m.split('\n')).filter((l) => l !== '');

export function DialogsProvider({ children }: { children: ReactNode }) {
  // 続けて呼ばれても、順番に1つずつ出す
  const [queue, setQueue] = useState<Pending[]>([]);

  const ask = useCallback(
    (opts: AskOptions) => new Promise<boolean>((done) => setQueue((q) => [...q, { id: nextId++, kind: 'ask', opts, done }])),
    [],
  );
  const input = useCallback(
    (opts: InputOptions) => new Promise<string | null>((done) => setQueue((q) => [...q, { id: nextId++, kind: 'input', opts, done }])),
    [],
  );
  const value = useMemo(() => ({ ask, input }), [ask, input]);

  const current = queue[0];
  const close = () => setQueue((q) => q.slice(1));

  return (
    <DialogsContext.Provider value={value}>
      {children}
      {current?.kind === 'ask' && (
        <AskDialog
          key={current.id}
          opts={current.opts}
          onResult={(v) => {
            current.done(v);
            close();
          }}
        />
      )}
      {current?.kind === 'input' && (
        <InputDialog
          key={current.id}
          opts={current.opts}
          onResult={(v) => {
            current.done(v);
            close();
          }}
        />
      )}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Ctx {
  const c = useContext(DialogsContext);
  if (!c) throw new Error('DialogsProvider の中で使ってください');
  return c;
}

function AskDialog({ opts, onResult }: { opts: AskOptions; onResult: (v: boolean) => void }) {
  const t = useT();
  const cancel = () => onResult(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogKeys(boxRef, cancel);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const title = opts.title ?? t('dialog.confirmTitle');

  return (
    <div className="modal-back dialog-back" onClick={cancel}>
      <div ref={boxRef} className="modal confirm" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <header>
          <h2>{title}</h2>
        </header>
        <section>
          {lines(opts.message).map((line, i) => (
            <p key={i} className="confirm-line">
              {line}
            </p>
          ))}
        </section>
        <div className="confirm-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={cancel}>
            {opts.cancelLabel ?? t('dialog.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => onResult(true)}>
            {opts.confirmLabel ?? t('dialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function InputDialog({ opts, onResult }: { opts: InputOptions; onResult: (v: string | null) => void }) {
  const t = useT();
  const [value, setValue] = useState(opts.defaultValue ?? '');
  const [shown, setShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancel = () => onResult(null);
  const boxRef = useRef<HTMLFormElement>(null);
  useDialogKeys(boxRef, cancel);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="modal-back dialog-back" onClick={cancel}>
      <form
        ref={boxRef}
        className="modal confirm"
        role="dialog"
        aria-modal="true"
        aria-label={opts.title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onResult(value);
        }}
        style={{ maxWidth: 520 }}
      >
        <header>
          <h2>{opts.title}</h2>
        </header>
        <section>
          {lines(opts.message).map((line, i) => (
            <p key={i} className="confirm-line">
              {line}
            </p>
          ))}
          <div className="dialog-input-row">
            <input
              ref={inputRef}
              type={opts.secret && !shown ? 'password' : 'text'}
              value={value}
              placeholder={opts.placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-label={opts.title}
              onChange={(e) => setValue(e.target.value)}
            />
            {opts.secret && (
              <button type="button" className="btn" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
                {shown ? t('dialog.hide') : t('dialog.show')}
              </button>
            )}
          </div>
        </section>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={cancel}>
            {opts.cancelLabel ?? t('dialog.cancel')}
          </button>
          <button type="submit" className="btn primary">
            {opts.confirmLabel ?? t('dialog.ok')}
          </button>
        </div>
      </form>
    </div>
  );
}
