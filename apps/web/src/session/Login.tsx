import { useEffect, useState } from 'react';
import { api, LoginError } from './api.ts';
import { useT } from '../i18n/useT.ts';
import type { User } from './api.ts';

/** 残り時間を「29分40秒」の形にする */
function formatLeft(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

/** ログイン画面。社内数名での利用を想定した最小構成 */
export function Login({ onDone }: { onDone: (user: User) => void }) {
  const t = useT();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** あと何回まちがえると止まるか（少なくなってきたときだけ出す） */
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lockMinutes, setLockMinutes] = useState(30);
  /** 止まっているとき、あと何秒で解けるか */
  const [lockedSec, setLockedSec] = useState<number | null>(null);

  // 止まっている間は、1秒ずつ数えて残り時間を見せる
  useEffect(() => {
    if (lockedSec === null) return;
    if (lockedSec <= 0) {
      setLockedSec(null);
      setError(null);
      setRemaining(null);
      return;
    }
    const t = setTimeout(() => setLockedSec((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [lockedSec]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(userId, password);
      onDone(user);
    } catch (err) {
      if (err instanceof LoginError) {
        setError(err.message);
        setRemaining(err.remaining ?? null);
        if (err.lockMinutes) setLockMinutes(err.lockMinutes);
        setLockedSec(err.lockedSec ?? null);
      } else {
        setError(err instanceof Error ? err.message : 'ログインできませんでした。');
      }
    } finally {
      setBusy(false);
    }
  };

  const locked = lockedSec !== null && lockedSec > 0;

  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <h1>{t('app.name')}</h1>
        <p className="hint">{t('login.hint')}</p>

        <label htmlFor="login-id">{t('login.id')}</label>
        <input
          id="login-id"
          value={userId}
          autoComplete="username"
          disabled={locked}
          onChange={(e) => setUserId(e.target.value)}
        />

        <label htmlFor="login-pw">{t('login.password')}</label>
        <div className="pw-row">
          <input
            id="login-pw"
            type={showPassword ? 'text' : 'password'}
            value={password}
            autoComplete="current-password"
            disabled={locked}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="pw-eye"
            aria-label={showPassword ? t('login.hide') : t('login.show')}
            aria-pressed={showPassword}
            title={showPassword ? t('login.hide') : t('login.show')}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        </div>

        {locked ? (
          <div className="locked-box">
            <b>何度もまちがえたため、このIDはログインできません。</b>
            <p className="countdown">
              あと <strong>{formatLeft(lockedSec!)}</strong> で、もう一度お試しいただけます。
            </p>
            <p>お急ぎの場合は、管理者にパスワードの再設定を頼んでください。すぐに入れるようになります。</p>
          </div>
        ) : (
          <>
            {error && <p className="err">{error}</p>}
            {remaining !== null && remaining > 0 && (
              <p className="warn-box">
                あと <b>{remaining}回</b> まちがえると、<b>{lockMinutes}分間</b>
                ログインできなくなります。
                <br />
                パスワードが分からない場合は、<b>管理者に確認してください。</b>
              </p>
            )}
          </>
        )}

        <button type="submit" className="primary" disabled={busy || locked || !userId || !password}>
          {busy ? t('login.busy') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
