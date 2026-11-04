import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useDialogKeys } from '../Dialogs.tsx';
import { useT } from '../i18n/useT.ts';
import { EyeIcon, EyeOffIcon } from '../icons.tsx';
import { MAX_TEXT_LENGTH } from '@zumen/knowledge';

/**
 * ログインの有効期限が切れたときの「もう一度ログインする窓」。
 *
 * 画面（入力した内容・図面）は、そのまま後ろに残っている。IDは、さっきまでの人のものに決めてあり、
 * パスワードだけを入れる（別の人が、この画面の続きを使えないようにするため）。
 * ログインできたら、失敗した操作（保存など）が、自動でやり直される。
 */
export function Relogin({ userId, userName, onDone }: { userId: string; userName: string; onDone: (ok: boolean) => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogKeys(boxRef, () => onDone(false));
  useEffect(() => inputRef.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(userId, password);
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'));
      setBusy(false);
      inputRef.current?.select();
    }
  };

  return (
    <div className="modal-back dialog-back">
      <form ref={boxRef} className="modal confirm relogin" role="alertdialog" aria-modal="true" aria-labelledby="relogin-title" onSubmit={submit} style={{ maxWidth: 520 }}>
        <header>
          <h2 id="relogin-title">{t('relogin.title')}</h2>
        </header>
        <section>
          <p className="confirm-line">{t('relogin.body')}</p>
          <p className="confirm-line relogin-id">
            <span className="lbl">{t('login.id')}</span>
            <b>{userId}</b>
            {userName && userName !== userId && <span>（{userName}）</span>}
          </p>
          <label htmlFor="relogin-pw" className="relogin-label">
            {t('login.password')}
          </label>
          <div className="pw-row">
            <input
              id="relogin-pw"
              ref={inputRef}
              maxLength={MAX_TEXT_LENGTH}
              type={show ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="pw-eye"
              aria-label={show ? t('login.hide') : t('login.show')}
              aria-pressed={show}
              title={show ? t('login.hide') : t('login.show')}
              onClick={() => setShow((v) => !v)}
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
        </section>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={() => onDone(false)}>
            {t('common.close')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !password}>
            {busy ? t('login.busy') : t('relogin.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
