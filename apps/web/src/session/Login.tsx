import { useState } from 'react';
import { api } from './api.ts';
import type { User } from './api.ts';

/** ログイン画面。社内数名での利用を想定した最小構成 */
export function Login({ onDone }: { onDone: (user: User) => void }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(userId, password);
      onDone(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインできませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <h1>単線結線図作成</h1>
        <p className="hint">ID とパスワードを入力してください。</p>
        <label htmlFor="login-id">ID</label>
        <input id="login-id" value={userId} autoComplete="username" onChange={(e) => setUserId(e.target.value)} />
        <label htmlFor="login-pw">パスワード</label>
        <input
          id="login-pw"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="err">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !userId || !password}>
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}
