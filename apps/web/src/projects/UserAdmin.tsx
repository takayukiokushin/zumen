import { useEffect, useState } from 'react';
import { api } from '../session/api.ts';
import type { Role, User } from '../session/api.ts';
import { useDialogs } from '../Dialogs.tsx';
import { useT } from '../i18n/useT.ts';

/**
 * 利用者の管理。管理用のアカウントでログインしたときだけ開ける。
 * ターミナルを使わずに、追加・削除・パスワードの再設定ができる。
 */

export function UserAdmin({ me, onClose }: { me: User; onClose: () => void }) {
  const t = useT();
  const { ask, input } = useDialogs();
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

  // Esc キーで閉じる（日本語の変換中の Esc は、変換の取り消しなので閉じない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const resetPassword = async (u: User) => {
    const pw = await input({
      title: `${u.name}（${u.id}）の新しいパスワード`,
      message: [
        '新しいパスワードを入れてください。10文字以上。IDと同じ・よくある言葉・連番は使えません。',
        '※ ログインが止まっている場合も、ここで変えればすぐ入れるようになります。',
      ],
      secret: true,
    });
    if (!pw) return;
    void run(() => api.setUserPassword(u.id, pw), `${u.id} のパスワードを変えました。`);
  };

  const remove = async (u: User) => {
    if (!(await ask({ title: `${u.name}（${u.id}）を消す`, message: [`${u.name}（${u.id}）を消します。元に戻せません。よろしいですか。`], confirmLabel: t('users.remove') }))) return;
    void run(() => api.removeUser(u.id), `${u.id} を消しました。`);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal useradmin" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('users.title')}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>

        {error && <p className="err">{error}</p>}
        {done && <p className="ok-note">{done}</p>}

        <section>
          <h3>{t('users.current')}</h3>
          {users === null ? (
            <p className="hint">{t('common.loading')}</p>
          ) : (
            <table className="users">
              <thead>
                <tr>
                  <th>{t('users.kind')}</th>
                  <th>{t('users.id')}</th>
                  <th>{t('users.name')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className={`role role-${u.role}`}>{t(`role.${u.role}`)}</span>
                    </td>
                    <td className="mono">{u.id}</td>
                    <td>
                      {u.name}
                      {u.id === me.id && <span className="you">{t('users.you')}</span>}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn" onClick={() => resetPassword(u)}>
                        {t('users.setPassword')}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void run(() => api.unlockUser(u.id), `${u.id} のログインを解除しました。`)}
                      >
                        {t('users.unlock')}
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={u.id === me.id}
                        onClick={() => remove(u)}
                      >
                        {t('users.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">{t('users.unlockNote')}</p>
        </section>

        <section>
          <h3>{t('users.add')}</h3>
          <form className="add-user" onSubmit={add}>
            <label>
              {t('users.id')}
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="eigyo"
                autoComplete="off"
              />
            </label>
            <label>
              {t('users.name')}
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="営業部" />
            </label>
            <label>
              {t('users.password')}
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('users.passwordHint')}
                autoComplete="new-password"
              />
            </label>
            <label>
              {t('users.kind')}
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">{t('role.member')}</option>
                <option value="sandbox">{t('role.sandbox')}</option>
                <option value="admin">{t('role.admin')}</option>
              </select>
            </label>
            <p className="hint role-help">{t(`users.help.${role}`)}</p>
            <button type="submit" className="btn primary" disabled={!id || !name || password.length < 10}>
              {t('users.addButton')}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
