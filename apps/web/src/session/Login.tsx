import { useEffect, useState } from 'react';
import { api, LoginError } from './api.ts';
import { useT } from '../i18n/useT.ts';
import { Rich } from '../i18n/Rich.tsx';
import { tr } from '../i18n/index.ts';
import { EyeIcon, EyeOffIcon } from '../icons.tsx';
import { useSettings } from '../settings/settings.tsx';
import { APP_VERSION } from '../version.ts';
import type { User } from './api.ts';

/** 残り時間を「29分40秒」の形にする */
function formatLeft(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? tr('time.minSec', { m, s: String(s).padStart(2, '0') }) : tr('time.sec', { s });
}

/** ログイン画面。社内数名での利用を想定した最小構成 */
export function Login({ onDone }: { onDone: (user: User) => void }) {
  const t = useT();
  const { settings, set } = useSettings();
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
        setError(err instanceof Error ? err.message : t('login.failed'));
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
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {locked ? (
          <div className="locked-box">
            <b>{t('login.lockedTitle')}</b>
            <p className="countdown">
              <Rich text={t('login.lockedLeft', { left: formatLeft(lockedSec!) })} />
            </p>
            <p>{t('login.lockedAdmin')}</p>
          </div>
        ) : (
          <>
            {error && <p className="err">{error}</p>}
            {remaining !== null && remaining > 0 && (
              <p className="warn-box">
                <Rich text={t('login.warnLeft', { n: remaining, minutes: lockMinutes })} />
                <br />
                <Rich text={t('login.warnAdmin')} />
              </p>
            )}
          </>
        )}

        <button type="submit" className="primary" disabled={busy || locked || !userId || !password}>
          {busy ? t('login.busy') : t('login.submit')}
        </button>

        {/*
          文字が小さくて読めない人が、ログインする前に大きくできるようにしておく。
          ここで選んだ大きさは、ログインしたあとの画面にもそのまま引き継がれる。
        */}
        <div className="login-size">
          <span className="lbl">{t('login.size')}</span>
          <div className="seg">
            {([
              [0.9, 'login.size.small'],
              [1, 'login.size.normal'],
              [1.2, 'login.size.large'],
              [1.6, 'login.size.xlarge'],
            ] as const).map(([value, key]) => (
              <button
                key={key}
                type="button"
                className="btn"
                aria-pressed={settings.textScale === value}
                onClick={() => set('textScale', value)}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>

        <p className="login-version">
          {t('settings.version')} {APP_VERSION}
        </p>
      </form>
    </div>
  );
}
