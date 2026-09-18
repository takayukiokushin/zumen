import { useEffect, useState } from 'react';
import { api } from '../session/api.ts';
import type { ProjectSummary, User } from '../session/api.ts';

interface Props {
  user: User;
  projectId: string | null;
  projectName: string;
  /** 未保存の変更があるか */
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  onOpen: (id: string) => void;
  onNew: (name: string) => void;
  onRename: (name: string) => void;
  onSave: () => void;
  onLogout: () => void;
}

/** 案件の切り替え・保存と、ログイン状態を出す帯 */
export function ProjectBar(props: Props) {
  const { user, projectId, projectName, dirty, saving, savedAt } = props;
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .listProjects()
      .then((r) => setList(r.projects))
      .catch((e) => setError(e instanceof Error ? e.message : '案件を読み込めませんでした。'));
  }, [open, savedAt]);

  const newProject = () => {
    const name = window.prompt('案件の名前を入力してください', '新しい案件');
    if (name !== null) props.onNew(name);
    setOpen(false);
  };

  const remove = async (p: ProjectSummary) => {
    if (!window.confirm(`「${p.name}」を削除します。元に戻せません。よろしいですか。`)) return;
    try {
      await api.deleteProject(p.id);
      setList((prev) => prev?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除できませんでした。');
    }
  };

  return (
    <div className="projectbar">
      <button type="button" className="picker" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {projectId ? projectName : '案件を選ぶ'}
        <span className="caret">▾</span>
      </button>

      {projectId && (
        <>
          <button type="button" onClick={() => {
            const name = window.prompt('案件の名前', projectName);
            if (name) props.onRename(name);
          }}>
            名前を変える
          </button>
          <button type="button" className={dirty ? 'need-save' : ''} onClick={props.onSave} disabled={saving || !dirty}>
            {saving ? '保存中…' : dirty ? '保存する' : '保存済み'}
          </button>
          <span className="saved">
            {dirty ? '未保存の変更があります' : savedAt ? `${new Date(savedAt).toLocaleTimeString('ja-JP')} に保存` : ''}
          </span>
        </>
      )}

      <span className="spacer" />
      <span className="who">{user.name}</span>
      <button type="button" onClick={props.onLogout}>
        ログアウト
      </button>

      {open && (
        <div className="picker-menu">
          <button type="button" className="new" onClick={newProject}>
            ＋ 新しい案件をつくる
          </button>
          {error && <p className="err">{error}</p>}
          {list === null ? (
            <p className="hint">読み込み中…</p>
          ) : list.length === 0 ? (
            <p className="hint">まだ案件がありません。</p>
          ) : (
            <ul>
              {list.map((p) => (
                <li key={p.id} className={p.id === projectId ? 'current' : ''}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onOpen(p.id);
                      setOpen(false);
                    }}
                  >
                    <b>{p.name}</b>
                    <span>
                      {new Date(p.updated_at).toLocaleString('ja-JP')}
                      {p.file_count > 0 && ` ・写真${p.file_count}枚`}
                    </span>
                  </button>
                  <button type="button" className="del" onClick={() => void remove(p)} aria-label={`${p.name}を削除`}>
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
