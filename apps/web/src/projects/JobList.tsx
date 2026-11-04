import { useEffect, useRef, useState } from 'react';
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

/** 1回に出す件数の選択肢。選んだ件数は、このブラウザに覚えさせる */
const PAGE_SIZES = [25, 50, 100, 200] as const;
const PAGE_SIZE_KEY = 'zumen.listSize';
function loadPageSize(): number {
  try {
    const v = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if ((PAGE_SIZES as readonly number[]).includes(v)) return v;
  } catch {
    // 覚えていなくても使える
  }
  return 50;
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
  /** いま画面に出している案件（先頭から、続きを足していく） */
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  /** 探した言葉で絞ったあとの、全部の件数（画面に出ているのは、このうちの先頭から） */
  const [total, setTotal] = useState(0);
  /** 入力欄の言葉。少し待ってから、サーバーに尋ねる（1文字ごとに尋ねない） */
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(loadPageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 古い返事が、新しい返事を上書きしないための番号 */
  const seq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  /** ごみ箱（消してから30日以内の案件） */
  const [trash, setTrash] = useState<TrashItem[]>([]);
  /** 消した・戻した直後の知らせ。消した直後は「元に戻す」を添える */
  const [notice, setNotice] = useState<{ id: string; name: string; text: string; undo: boolean } | null>(null);

  /** 練習用のアカウントがコピーできる、本番の案件 */
  const [sources, setSources] = useState<PracticeSource[]>([]);

  /** 先頭から出し直す（探す言葉・件数を変えたとき、消した・戻したあと） */
  const reload = () => {
    const mine = ++seq.current;
    return Promise.all([
      api.listProjects({ q: query, limit: pageSize, offset: 0 }),
      api.listTrash(),
      role === 'sandbox' ? api.listPracticeSources() : Promise.resolve({ projects: [] }),
    ])
      .then(([l, tr, src]) => {
        if (mine !== seq.current) return;
        setList(l.projects);
        setTotal(l.total);
        setTrash(tr.projects);
        setSources(src.projects);
      })
      .catch((e) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : t('err.loadProjects'));
      });
  };

  // 探す言葉を入れてから 0.3 秒たったら、サーバーに尋ねる
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), q.trim() === query ? 0 : 300);
    return () => clearTimeout(timer);
  }, [q]);

  // 探す言葉・1回の件数が変わったら、先頭から出し直す
  useEffect(() => {
    void reload();
  }, [query, pageSize]);

  /** 続きを足す（いまの件数ぶん） */
  const loadMore = async () => {
    if (!list || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const l = await api.listProjects({ q: query, limit: pageSize, offset: list.length });
      if (mine !== seq.current) return;
      setList((cur) => {
        const have = new Set((cur ?? []).map((p) => p.id));
        return [...(cur ?? []), ...l.projects.filter((p) => !have.has(p.id))];
      });
      setTotal(l.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.loadProjects'));
    } finally {
      setLoadingMore(false);
    }
  };

  const chooseSize = (n: number) => {
    setPageSize(n);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      // 覚えられなくても、この画面では使える
    }
  };

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
      setNotice({ id: p.id, name: p.name, text: `${t('project.quote', { name: p.name })}${t('project.deletedNote')}`, undo: true });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.delete'));
    }
  };

  /** 本番の案件を練習用にコピーして、そのまま開く。本番の案件は変わらない */
  const copyToPractice = async (src: PracticeSource) => {
    if (!(await ask({ message: [`${t('project.quote', { name: src.name })}${t('project.practice.confirm')}`] }))) return;
    if (!(await canLeave())) return;
    try {
      setError(null);
      const r = await api.copyToPractice(src.id);
      onOpen(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.copy'));
    }
  };

  /** 過去の図面を複製して、新しい案件として開く。もとの案件は変わらない */
  const duplicate = async (src: { id: string; name: string }) => {
    if (!(await ask({ message: [`${t('project.quote', { name: src.name })}${t('project.duplicate.confirm')}`] }))) return;
    if (!(await canLeave())) return;
    try {
      setError(null);
      const r = await api.duplicateProject(src.id);
      onOpen(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.duplicate'));
    }
  };

  const restore = async (id: string, name: string) => {
    try {
      setError(null);
      await api.restoreProject(id);
      setNotice({ id, name, text: `${t('project.quote', { name })}${t('project.restoredNote')}`, undo: false });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.restore'));
    }
  };

  return (
    <div className="analyze joblist">
      <div className="panel">
        {/* 見出しと同じ行の右端に、表示件数を置く（「案件を追加」から離して、押し間違いを防ぐ） */}
        <div className="list-head">
          <h2>{t('project.list')}</h2>
          <div className="page-size" role="group" aria-label={t('project.pageSize')}>
            <span className="lbl">{t('project.pageSize')}</span>
            <div className="seg">
              {PAGE_SIZES.map((n) => (
                <button key={n} type="button" className="btn" aria-pressed={pageSize === n} onClick={() => chooseSize(n)}>
                  {n}
                  {t('project.count')}
                </button>
              ))}
            </div>
          </div>

        </div>
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
          <span className="count">{list ? `${total}${t('project.count')}` : ''}</span>
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

        {list === null ? (
          <p className="hint">{t('common.loading')}</p>
        ) : total === 0 && query === '' ? (
          <p className="hint">{t('project.none')}</p>
        ) : total === 0 ? (
          <p className="hint">{t('project.noMatch')}</p>
        ) : (
          <>
          <table className="jobs">
            <thead>
              <tr>
                <th className="c-act" />
                <th>{t('project.name')}</th>
                <th>{t('project.updated')}</th>
                <th className="c-dup" />
                <th className="c-del" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={`has-del${p.id === currentId ? ' current' : ''}`}>
                  {/* 「開く」は、名前のすぐ左に。「消す」は、右端に離して置く（押し間違いを防ぐ） */}
                  <td className="c-act">
                    <button
                      type="button"
                      className="btn primary job-open"
                      aria-label={t('project.openLabel', { name: p.name })}
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
                  </td>
                  <td className="c-name">
                    <span className="name">
                      <Highlight text={p.name} needle={query} />
                    </span>
                    {p.lock && p.lock.userId !== meId && (
                      <b className="editing">　{t('project.editingBy', { user: p.lock.userName })}</b>
                    )}
                  </td>
                  <td className="when c-info">{new Date(p.updated_at).toLocaleString(lang)}</td>
                  <td className="c-dup">
                    <button
                      type="button"
                      className="btn job-duplicate"
                      title={t('project.duplicate.title')}
                      aria-label={`${p.name}：${t('project.duplicate.title')}`}
                      onClick={() => void duplicate(p)}
                    >
                      {t('project.duplicate')}
                    </button>
                  </td>
                  <td className="c-del">
                    <button
                      type="button"
                      className="btn danger job-delete"
                      disabled={p.lock !== null && p.lock.userId !== meId}
                      onClick={() => void remove(p)}
                      aria-label={t('project.deleteLabel', { name: p.name })}
                    >
                      {t('project.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 件数が多いときは、先頭から出して、続きは「さらに表示」で足す */}
          <p className="more-row">
            <span className="hint">{t('project.shownOf', { total, shown: list.length })}</span>
            {list.length < total && (
              <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t('common.loading') : t('project.more', { n: Math.min(pageSize, total - list.length) })}
              </button>
            )}
          </p>
          </>
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
                    <th className="c-act" />
                    <th>{t('project.name')}</th>
                    <th>{t('project.updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((p) => (
                    <tr key={p.id}>
                      <td className="c-act">
                        <button type="button" className="btn primary" onClick={() => void copyToPractice(p)}>
                          {t('project.practice.copy')}
                        </button>
                      </td>
                      <td className="c-name">
                        <span className="name">{p.name}</span>
                      </td>
                      <td className="when c-info">
                        {new Date(p.updatedAt).toLocaleString(lang)}
                        {p.updatedBy ? `（${p.updatedBy}）` : ''}
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
                  <th className="c-act" />
                  <th>{t('project.name')}</th>
                  <th>{t('project.trashDeleted')}</th>
                  <th>{t('project.trashPurge')}</th>
                </tr>
              </thead>
              <tbody>
                {trash.map((p) => (
                  <tr key={p.id}>
                    <td className="c-act">
                      <button type="button" className="btn primary" onClick={() => void restore(p.id, p.name)}>
                        {t('project.restore')}
                      </button>
                    </td>
                    <td className="c-name">
                      <span className="name">{p.name}</span>
                    </td>
                    <td className="when c-info" data-label={t('project.trashDeleted')}>
                      {new Date(p.deletedAt).toLocaleString(lang)}
                      {p.deletedBy ? `（${p.deletedBy}）` : ''}
                    </td>
                    <td className="when c-info" data-label={t('project.trashPurge')}>{new Date(p.purgeAt).toLocaleDateString(lang)}</td>
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
