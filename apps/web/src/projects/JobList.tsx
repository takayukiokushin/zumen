import { useEffect, useMemo, useState } from 'react';
import { api } from '../session/api.ts';
import type { PracticeSource, ProjectSummary, Role, TrashItem } from '../session/api.ts';
import { useDialogs } from '../Dialogs.tsx';
import { useLang, useT } from '../i18n/useT.ts';

/**
 * 案件の一覧（㉚）。名前の一部を入れて絞り込める。
 * 案件を開いていないときは、この画面が最初に出る。
 */

interface Props {
  /** いまログインしている人。自分が編集中のときは印を出さない */
  meId: string;
  /** ログインしている人の種類。練習用のときだけ、本番の案件をコピーする欄を出す */
  role: Role;
  currentId: string | null;
  onOpen: (id: string) => void;
  /** useAsSite：名前を決めて作ったか（標準の名前のままなら false）。事業場名称の初期値にするかの判断に使う */
  onNew: (name: string, useAsSite: boolean) => void;
  /**
   * 開いている案件に、保存していない変更があるときの確認。
   * 別の案件を開く・新しく作る前に呼ぶ。false なら取りやめる。
   */
  canLeave: () => Promise<boolean>;
}

/** 名前の中の、探した言葉のところを目立たせる */
function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="hit">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

export function JobList({ meId, role, currentId, onOpen, onNew, canLeave }: Props) {
  const t = useT();
  const { ask, input } = useDialogs();
  const lang = useLang();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** ごみ箱（消してから30日以内の案件） */
  const [trash, setTrash] = useState<TrashItem[]>([]);
  /** 消した・戻した直後の知らせ。消した直後は「元に戻す」を添える */
  const [notice, setNotice] = useState<{ id: string; name: string; text: string; undo: boolean } | null>(null);

  /** 練習用のアカウントがコピーできる、本番の案件 */
  const [sources, setSources] = useState<PracticeSource[]>([]);

  const reload = () =>
    Promise.all([api.listProjects(), api.listTrash(), role === 'sandbox' ? api.listPracticeSources() : Promise.resolve({ projects: [] })])
      .then(([l, tr, src]) => {
        setList(l.projects);
        setTrash(tr.projects);
        setSources(src.projects);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '案件を読み込めませんでした。'));

  useEffect(() => {
    void reload();
  }, []);

  const shown = useMemo(() => {
    if (!list) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((p) => p.name.toLowerCase().includes(needle));
  }, [list, q]);

  const create = async () => {
    // 名前を聞く前に確かめる（入力した名前が無駄にならないように）
    if (!(await canLeave())) return;
    const name = await input({ title: t('project.new'), message: [t('project.newName')], defaultValue: q.trim() || t('project.newDefault') });
    if (name !== null) onNew(name, name.trim() !== '' && name.trim() !== t('project.newDefault'));
  };

  const remove = async (p: ProjectSummary) => {
    if (!(await ask({ title: t('project.delete'), message: [`「${p.name}」${t('project.deleteConfirm')}`], confirmLabel: t('project.delete') }))) return;
    try {
      setError(null);
      await api.deleteProject(p.id);
      setNotice({ id: p.id, name: p.name, text: `「${p.name}」${t('project.deletedNote')}`, undo: true });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除できませんでした。');
    }
  };

  /** 本番の案件を練習用にコピーして、そのまま開く。本番の案件は変わらない */
  const copyToPractice = async (src: PracticeSource) => {
    if (!(await ask({ message: [`「${src.name}」${t('project.practice.confirm')}`] }))) return;
    if (!(await canLeave())) return;
    try {
      setError(null);
      const r = await api.copyToPractice(src.id);
      onOpen(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コピーできませんでした。');
    }
  };

  const restore = async (id: string, name: string) => {
    try {
      setError(null);
      await api.restoreProject(id);
      setNotice({ id, name, text: `「${name}」${t('project.restoredNote')}`, undo: false });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '戻せませんでした。');
    }
  };

  return (
    <div className="analyze joblist">
      <div className="panel">
        <h2>{t('project.list')}</h2>
        <p className="hint">{t('project.searchHint')}</p>

        <div className="search-row">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('project.search')}
            aria-label={t('project.search')}
            autoComplete="off"
          />
          <span className="count">
            {shown ? `${shown.length}${t('project.count')}` : ''}
          </span>
          <button type="button" className="btn primary" onClick={() => void create()}>
            ＋ {t('project.new')}
          </button>
        </div>

        {error && <p className="err">{error}</p>}

        {notice && (
          <p className="job-notice" role="status">
            {notice.text}
            {notice.undo && (
              <button type="button" className="btn" onClick={() => void restore(notice.id, notice.name)}>
                {t('project.undo')}
              </button>
            )}
          </p>
        )}

        {shown === null ? (
          <p className="hint">{t('common.loading')}</p>
        ) : list && list.length === 0 ? (
          <p className="hint">{t('project.none')}</p>
        ) : shown.length === 0 ? (
          <p className="hint">{t('project.noMatch')}</p>
        ) : (
          <table className="jobs">
            <thead>
              <tr>
                <th>{t('project.name')}</th>
                <th>{t('project.updated')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={p.id === currentId ? 'current' : ''}>
                  <td>
                    <span className="name">
                      <Highlight text={p.name} needle={q.trim()} />
                    </span>
                    {p.lock && p.lock.userId !== meId && (
                      <b className="editing">　{p.lock.userName}さんが{t('project.editing')}</b>
                    )}
                    {p.file_count > 0 && <span className="when">　写真{p.file_count}枚</span>}
                  </td>
                  <td className="when">{new Date(p.updated_at).toLocaleString(lang)}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="btn primary job-open"
                      onClick={() => {
                        // 開いている案件に戻るだけなら、何も失わないので確認しない
                        void (async () => {
                          if (p.id !== currentId && !(await canLeave())) return;
                          onOpen(p.id);
                        })();
                      }}
                    >
                      {t('project.open')}
                    </button>
                    <button
                      type="button"
                      className="btn danger job-delete"
                      disabled={p.lock !== null && p.lock.userId !== meId}
                      onClick={() => void remove(p)}
                      aria-label={`${p.name}を削除`}
                    >
                      {t('project.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {role === 'sandbox' && (
          <details className="trash practice">
            <summary>
              {t('project.practice')}（{sources.length}{t('project.count')}）
            </summary>
            <p className="hint">{t('project.practice.hint')}</p>
            {sources.length === 0 ? (
              <p className="hint">{t('project.practice.none')}</p>
            ) : (
              <table className="jobs">
                <thead>
                  <tr>
                    <th>{t('project.name')}</th>
                    <th>{t('project.updated')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sources.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="name">{p.name}</span>
                        {p.fileCount > 0 && <span className="when">　写真{p.fileCount}枚</span>}
                      </td>
                      <td className="when">
                        {new Date(p.updatedAt).toLocaleString(lang)}
                        {p.updatedBy ? `（${p.updatedBy}）` : ''}
                      </td>
                      <td className="row-actions">
                        <button type="button" className="btn primary" onClick={() => void copyToPractice(p)}>
                          {t('project.practice.copy')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        )}

        {trash.length > 0 && (
          <details className="trash">
            <summary>
              {t('project.trash')}（{trash.length}{t('project.count')}）
            </summary>
            <p className="hint">{t('project.trashHint')}</p>
            <table className="jobs">
              <thead>
                <tr>
                  <th>{t('project.name')}</th>
                  <th>{t('project.trashDeleted')}</th>
                  <th>{t('project.trashPurge')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trash.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="name">{p.name}</span>
                      {p.fileCount > 0 && <span className="when">　写真{p.fileCount}枚</span>}
                    </td>
                    <td className="when" data-label={t('project.trashDeleted')}>
                      {new Date(p.deletedAt).toLocaleString(lang)}
                      {p.deletedBy ? `（${p.deletedBy}）` : ''}
                    </td>
                    <td className="when" data-label={t('project.trashPurge')}>{new Date(p.purgeAt).toLocaleDateString(lang)}</td>
                    <td className="row-actions">
                      <button type="button" className="btn primary" onClick={() => void restore(p.id, p.name)}>
                        {t('project.restore')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </div>
  );
}
