import { useEffect, useState } from 'react';
import { api } from '../session/api.ts';
import type { Role, User } from '../session/api.ts';
import { useDialogs } from '../Dialogs.tsx';
import { useT } from '../i18n/useT.ts';
import { MAX_TEXT_LENGTH } from '@zumen/knowledge';
import { ServerStatusPanel } from './ServerStatusPanel.tsx';

/**
 * 利用者の管理。管理用のアカウントでログインしたときだけ開ける。
 * ターミナルを使わずに、追加・削除・パスワードの再設定ができる。
 */

/**
 * 会社の設定。いまは、電柱の名称の頭の部分（電力会社の呼び名。既定は「中電柱：」）だけ。
 * 新しい案件・複製した案件の「引込元の名称」の最初に入る。すでにある案件は変わらない。空にして保存すると、既定に戻る。
 */
function CompanySettingsPanel() {
  const t = useT();
  const [saved, setSaved] = useState<string | null>(null);
  const [defaultPrefix, setDefaultPrefix] = useState('');
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .company()
      .then((c) => {
        setSaved(c.polePrefix);
        setDefaultPrefix(c.defaultPolePrefix);
        setValue(c.polePrefix);
      })
      .catch(() => undefined);
  }, []);
  const save = async (next: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const c = await api.setCompany(next);
      setSaved(c.polePrefix);
      setValue(c.polePrefix);
      setMsg({ ok: true, text: t('company.saved', { v: c.polePrefix }) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : t('err.generic') });
    } finally {
      setBusy(false);
    }
  };
  if (saved === null) return null;
  return (
    <section className="company-settings">
      <h3>{t('company.title')}</h3>
      <div className="field">
        <label htmlFor="company-pole">{t('company.pole')}</label>
        <input id="company-pole" type="text" maxLength={20} value={value} placeholder={defaultPrefix} onChange={(e) => setValue(e.target.value)} />
        <p className="help">{t('company.poleHelp', { d: defaultPrefix })}</p>
      </div>
      <div className="voice-actions">
        <button type="button" className="primary" disabled={busy || value.trim() === saved} onClick={() => void save(value)}>
          {t('company.save')}
        </button>
        <button type="button" className="btn" disabled={busy || saved === defaultPrefix} onClick={() => void save('')}>
          {t('company.reset', { d: defaultPrefix })}
        </button>
      </div>
      {msg && <p className={msg.ok ? 'ok-note-inline' : 'err'}>{msg.text}</p>}
    </section>
  );
}

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
      .catch((e) => setError(e instanceof Error ? e.message : t('err.load')));

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
      setError(e instanceof Error ? e.message : t('err.generic'));
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
    }, t('users.added', { id: id.trim() }));
  };

  const resetPassword = async (u: User) => {
    const pw = await input({
      title: t('users.pwTitle', { name: u.name, id: u.id }),
      message: [
        t('users.pwMsg1'),
        t('users.pwMsg2'),
      ],
      secret: true,
    });
    if (!pw) return;
    void run(() => api.setUserPassword(u.id, pw), t('users.pwChanged', { id: u.id }));
  };

  const remove = async (u: User) => {
    if (!(await ask({ title: t('users.removeTitle', { name: u.name, id: u.id }), message: [t('users.removeMsg', { name: u.name, id: u.id })], confirmLabel: t('users.remove') }))) return;
    void run(() => api.removeUser(u.id), t('users.removed', { id: u.id }));
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

        <ServerStatusPanel />

        <CompanySettingsPanel />

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
                        onClick={() => void run(() => api.unlockUser(u.id), t('users.unlocked', { id: u.id }))}
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
                maxLength={MAX_TEXT_LENGTH}
                onChange={(e) => setId(e.target.value)}
                placeholder="eigyo"
                autoComplete="off"
              />
            </label>
            <label>
              {t('users.name')}
              <input value={name} maxLength={MAX_TEXT_LENGTH} onChange={(e) => setName(e.target.value)} placeholder={t('users.namePlaceholder')} />
            </label>
            <label>
              {t('users.password')}
              <input
                value={password}
                maxLength={MAX_TEXT_LENGTH}
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
