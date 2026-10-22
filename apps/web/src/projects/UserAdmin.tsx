import { useEffect, useState } from 'react';
import { api, ROLE_LABEL } from '../session/api.ts';
import type { Role, User } from '../session/api.ts';

/**
 * 利用者の管理。管理用のアカウントでログインしたときだけ開ける。
 * ターミナルを使わずに、追加・削除・パスワードの再設定ができる。
 */

const ROLE_HELP: Record<Role, string> = {
  admin: 'すべての案件を扱えます。利用者の管理もできます',
  member: '案件をみんなで共有します。ふだん使うのはこれです',
  sandbox: '自分が作ったものだけを扱います。練習用です',
};

export function UserAdmin({ me, onClose }: { me: User; onClose: () => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('member');

  const reload = () =>
    api
      .listUsers()
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e instanceof Error ? e.message : '読み込めませんでした。'));

  useEffect(() => {
    void reload();
  }, []);

  /** 画面の操作をまとめて行う。成功したら一覧を読み直す */
  const run = async (work: () => Promise<unknown>, message: string) => {
    setError(null);
    setDone(null);
    try {
      await work();
      setDone(message);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'うまくいきませんでした。');
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.addUser({ id: id.trim(), name: name.trim(), password, role });
      setId('');
      setName('');
      setPassword('');
      setRole('member');
    }, `利用者を追加しました：${id.trim()}`);
  };

  const resetPassword = (u: User) => {
    const pw = window.prompt(
      `${u.name}（${u.id}）の新しいパスワードを入れてください。\n8文字以上。` +
        '\n※ ログインが止まっている場合も、ここで変えればすぐ入れるようになります。',
    );
    if (!pw) return;
    void run(() => api.setUserPassword(u.id, pw), `${u.id} のパスワードを変えました。`);
  };

  const remove = (u: User) => {
    if (!window.confirm(`${u.name}（${u.id}）を消します。元に戻せません。よろしいですか。`)) return;
    void run(() => api.removeUser(u.id), `${u.id} を消しました。`);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal useradmin" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>利用者の管理</h2>
          <button type="button" className="btn" onClick={onClose}>
            閉じる
          </button>
        </header>

        {error && <p className="err">{error}</p>}
        {done && <p className="ok-note">{done}</p>}

        <section>
          <h3>いまの利用者</h3>
          {users === null ? (
            <p className="hint">読み込み中…</p>
          ) : (
            <table className="users">
              <thead>
                <tr>
                  <th>種類</th>
                  <th>ID</th>
                  <th>名前</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className={`role role-${u.role}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="mono">{u.id}</td>
                    <td>
                      {u.name}
                      {u.id === me.id && <span className="you">（あなた）</span>}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn" onClick={() => resetPassword(u)}>
                        パスワードを変える
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void run(() => api.unlockUser(u.id), `${u.id} のログインを解除しました。`)}
                      >
                        ログインを解除
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={u.id === me.id}
                        onClick={() => remove(u)}
                      >
                        消す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">
            「ログインを解除」は、まちがえ過ぎて止まっている人を、待たずに入れるようにするためのものです。
          </p>
        </section>

        <section>
          <h3>利用者を追加する</h3>
          <form className="add-user" onSubmit={add}>
            <label>
              ID
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="eigyo"
                autoComplete="off"
              />
            </label>
            <label>
              名前
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="営業部" />
            </label>
            <label>
              パスワード
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8文字以上"
                autoComplete="new-password"
              />
            </label>
            <label>
              種類
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">標準</option>
                <option value="sandbox">練習用</option>
                <option value="admin">管理用</option>
              </select>
            </label>
            <p className="hint role-help">{ROLE_HELP[role]}</p>
            <button type="submit" className="btn primary" disabled={!id || !name || password.length < 8}>
              追加する
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
