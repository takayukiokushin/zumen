import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ConnectionError, LockedError } from './session/api.ts';
import { SAVE_RETRY } from './session/messages.ts';
import type { Lock, User } from './session/api.ts';
import { Login } from './session/Login.tsx';
import { ProjectBar } from './projects/ProjectBar.tsx';
import { HearingForm } from './HearingForm.tsx';
import { CompositionPreview } from './CompositionPreview.tsx';
import { Editor } from './editor/Editor.tsx';
import { Analyze } from './analyze/Analyze.tsx';
import { JobList } from './projects/JobList.tsx';
import { TabBar } from './TabBar.tsx';
import type { Tab } from './TabBar.tsx';
import { UserAdmin } from './projects/UserAdmin.tsx';
import { SettingsPanel } from './settings/SettingsPanel.tsx';
import { useLang, useT } from './i18n/useT.ts';
import type { Doc } from './editor/doc.ts';
import type { Answers, Value } from '@zumen/knowledge';
import { QUESTIONS } from '@zumen/knowledge';

/** 質問定義の既定値。回答そのものとは分けて持ち、「まだ触っていない」が分かるようにする */
export const DEFAULTS: Answers = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

export function App() {
  const t = useT();
  const lang = useLang();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('hearing');
  /** 案件の一覧を出しているか（㉚）。案件を開いていないときは必ず一覧 */
  const [showList, setShowList] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  /** ㉖㉗ ヒアリング画面の左の目次・右の「いまの構成」を出すか */
  const [showNav, setShowNav] = useState(true);
  const [showPreview, setShowPreview] = useState(true);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [drawing, setDrawing] = useState<Doc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 他の人が編集中のときの、その人の情報。閲覧のみになる */
  const [lockedBy, setLockedBy] = useState<Lock | null>(null);
  const readOnly = lockedBy !== null;

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  /** 未保存のまま画面を閉じようとしたら止める */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** 編集中であることを伝え続ける。途切れると数分で他の人が編集できるようになる */
  useEffect(() => {
    if (!projectId || readOnly) return;
    const beat = () => {
      api.takeLock(projectId).catch((e) => {
        // 誰かに編集を引き継がれた場合はここで気づく
        if (e instanceof LockedError) setLockedBy(e.lock);
      });
    };
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [projectId, readOnly]);

  /** 画面を閉じるときは編集中の印を外す（他の人が待たされないように） */
  useEffect(() => {
    if (!projectId || readOnly) return;
    const release = () => {
      void fetch(`/api/projects/${projectId}/lock`, {
        method: 'DELETE',
        credentials: 'include',
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [projectId, readOnly]);

  const effective = useMemo<Answers>(() => ({ ...DEFAULTS, ...answers }), [answers]);

  const updateAnswers = useCallback((next: Answers | ((prev: Answers) => Answers)) => {
    setAnswers((prev) => (typeof next === 'function' ? next(prev) : next));
    setDirty(true);
  }, []);

  /**
   * 保存していない変更があるとき、別の案件へ移ってよいかを確かめる。
   * 移ってよい（または、失うものが無い）なら true。
   */
  const confirmLeave = (): boolean =>
    !dirty || window.confirm(`「${projectName}」${t('project.unsavedLeave')}`);

  /** 開いている案件から離れるとき、編集中の印を外しておく */
  const leaveCurrent = async () => {
    if (projectId && !readOnly) await api.releaseLock(projectId).catch(() => undefined);
  };

  const openProject = async (id: string, force = false) => {
    try {
      await leaveCurrent();
      const p = await api.getProject(id);
      setProjectId(p.id);
      setProjectName(p.name);
      setAnswers(p.answers ?? {});
      setDrawing(p.drawing);
      setDirty(false);
      setSavedAt(null);
      setError(null);
      setShowList(false);
      try {
        await api.takeLock(id, force);
        setLockedBy(null);
      } catch (e) {
        if (!(e instanceof LockedError)) throw e;
        setLockedBy(e.lock);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '案件を開けませんでした。');
    }
  };

  const newProject = async (name: string) => {
    try {
      await leaveCurrent();
      const { id } = await api.createProject(name);
      setProjectId(id);
      setProjectName(name || '無題の案件');
      setAnswers({});
      setDrawing(null);
      setDirty(false);
      setError(null);
      setLockedBy(null);
      setShowList(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '案件を作れませんでした。');
    }
  };

  const save = async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveProject(projectId, { name: projectName, answers, drawing });
      setSavedAt(r.updatedAt);
      setDirty(false);
    } catch (e) {
      if (e instanceof LockedError) setLockedBy(e.lock);
      // 通信が届かなかったときは、つながってからもう一度保存すればよいと伝える
      const retry = e instanceof ConnectionError ? SAVE_RETRY : '';
      setError(`${e instanceof Error ? e.message : '保存できませんでした。'}${retry}`);
    } finally {
      setSaving(false);
    }
  };

  if (user === undefined) return <p className="booting">…</p>;
  if (user === null) return <Login onDone={setUser} />;

  const listing = showList || !projectId;

  return (
    <div className="shell">
      <TabBar
        user={user}
        tab={tab}
        onTab={(id) => {
          setTab(id);
          setShowList(false);
        }}
        enabled={projectId !== null && !listing}
        onSettings={() => setSettingsOpen(true)}
        onUsers={() => setUsersOpen(true)}
        onLogout={() => {
          void leaveCurrent();
          void api.logout();
          setUser(null);
        }}
      />

      <ProjectBar
        projectId={projectId}
        projectName={projectName}
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onList={() => setShowList(true)}
        onRename={(name) => {
          setProjectName(name);
          setDirty(true);
        }}
        onSave={() => void save()}
        readOnly={readOnly}
      />

      {error && <p className="bar-error">{error}</p>}

      {lockedBy && !listing && (
        <p className="bar-lock">
          <b>
            {lockedBy.userName}
            {t('lock.editingNow')}
          </b>
          {t('lock.viewOnly')}（{new Date(lockedBy.since).toLocaleTimeString(lang)}）
          {dirty && <b className="warn">{t('lock.cannotSave')}</b>}
          <button
            type="button"
            onClick={() => {
              const warning = dirty
                ? 'この画面の未保存の変更は破棄され、保存されている内容を読み直します。\n'
                : '';
              if (
                window.confirm(
                  `${lockedBy.userName}さんから編集を引き継ぎます。\n` +
                    warning +
                    `${lockedBy.userName}さんの未保存の変更も失われます。よろしいですか。`,
                )
              ) {
                void openProject(projectId!, true);
              }
            }}
          >
            {t('lock.takeover')}
          </button>
        </p>
      )}

      <div className="body">
        <Shield readOnly={readOnly && !listing}>
          {listing ? (
            <JobList
              meId={user.id}
              currentId={projectId}
              onOpen={(id) => {
                // 開いている案件に戻るだけなら、読み直さずにそのまま見せる。
                // 読み直すと、保存していない変更が消えてしまう
                if (id === projectId && !readOnly) {
                  setShowList(false);
                  return;
                }
                void openProject(id);
              }}
              onNew={(name) => void newProject(name)}
              canLeave={confirmLeave}
            />
          ) : tab === 'drawing' ? (
            <Editor
              answers={effective}
              initialDoc={drawing}
              onDocChange={(doc) => {
                setDrawing(doc);
                setDirty(true);
              }}
            />
          ) : tab === 'analyze' ? (
            <Analyze
              answers={effective}
              projectId={projectId!}
              onApply={(patch) => updateAnswers((prev) => ({ ...prev, ...patch }))}
              onGoToHearing={() => setTab('hearing')}
            />
          ) : (
            <div className="hearing-pane">
              <div className="panel-bar">
                <button type="button" className="panel-toggle" aria-pressed={!showNav} onClick={() => setShowNav((v) => !v)}>
                  {showNav ? `◀ ${t('hearing.hideNav')}` : `▶ ${t('hearing.showNav')}`}
                </button>
                <button
                  type="button"
                  className="panel-toggle"
                  aria-pressed={!showPreview}
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {showPreview ? `${t('hearing.hidePreview')} ▶` : `◀ ${t('hearing.showPreview')}`}
                </button>
              </div>
              <div className={`app${showNav ? '' : ' no-nav'}${showPreview ? '' : ' no-preview'}`}>
                <HearingForm answers={answers} effective={effective} onChange={updateAnswers} showNav={showNav} />
                {showPreview && <CompositionPreview answers={effective} />}
              </div>
            </div>
          )}
        </Shield>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {usersOpen && <UserAdmin me={user} onClose={() => setUsersOpen(false)} />}
    </div>
  );
}

/**
 * 閲覧のみのときに、中の入力欄やボタンをまとめて使えなくする覆い。
 * fieldset の disabled は中の入力欄すべてに効くので、画面ごとに手当てしなくて済む。
 * display:contents にしてあるので、見た目の並びは変わらない。
 */
function Shield({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <fieldset className="shield" disabled>
      {children}
    </fieldset>
  );
}
