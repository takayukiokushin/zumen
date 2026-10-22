import { useEffect, useMemo, useState } from 'react';
import { api } from '../session/api.ts';
import type { ProjectSummary } from '../session/api.ts';
import { useLang, useT } from '../i18n/useT.ts';

/**
 * 案件の一覧（㉚）。名前の一部を入れて絞り込める。
 * 案件を開いていないときは、この画面が最初に出る。
 */

interface Props {
  /** いまログインしている人。自分が編集中のときは印を出さない */
  meId: string;
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: (name: string) => void;
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

export function JobList({ meId, currentId, onOpen, onNew }: Props) {
  const t = useT();
  const lang = useLang();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    api
      .listProjects()
      .then((r) => setList(r.projects))
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

  const create = () => {
    const name = window.prompt(t('project.newName'), q.trim() || t('project.newDefault'));
    if (name !== null) onNew(name);
  };

  const remove = async (p: ProjectSummary) => {
    if (!window.confirm(`「${p.name}」${t('project.deleteConfirm')}`)) return;
    try {
      await api.deleteProject(p.id);
      setList((prev) => prev?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除できませんでした。');
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
          <button type="button" className="btn primary" onClick={create}>
            ＋ {t('project.new')}
          </button>
        </div>

        {error && <p className="err">{error}</p>}

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
                    <button type="button" className="btn primary" onClick={() => onOpen(p.id)}>
                      {t('project.open')}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
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
      </div>
    </div>
  );
}
