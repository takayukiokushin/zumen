import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, LockedError } from './session/api.ts';
import type { Lock, User } from './session/api.ts';
import { Login } from './session/Login.tsx';
import { ProjectBar } from './projects/ProjectBar.tsx';
import { HearingForm } from './HearingForm.tsx';
import { CompositionPreview } from './CompositionPreview.tsx';
import { Editor } from './editor/Editor.tsx';
import { Analyze } from './analyze/Analyze.tsx';
import type { Doc } from './editor/doc.ts';
import type { Answers, Value } from '@zumen/knowledge';
import { QUESTIONS } from '@zumen/knowledge';

type Tab = 'analyze' | 'hearing' | 'drawing';

/** 質問定義の既定値。回答そのものとは分けて持ち、「まだ触っていない」が分かるようにする */
export const DEFAULTS: Answers = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('hearing');

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
      setError(e instanceof Error ? e.message : '保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  if (user === undefined) return <p className="booting">読み込み中…</p>;
  if (user === null) return <Login onDone={setUser} />;

  return (
    <>
      <div className="tabbar">
        <strong>単線結線図作成</strong>
        {(
          [
            ['analyze', 'スケッチ読み取り'],
            ['hearing', '事前ヒアリング'],
            ['drawing', '図面'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <ProjectBar
        user={user}
        projectId={projectId}
        projectName={projectName}
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onOpen={(id) => void openProject(id)}
        onNew={(name) => void newProject(name)}
        onRename={(name) => {
          setProjectName(name);
          setDirty(true);
        }}
        onSave={() => void save()}
        readOnly={readOnly}
        onLogout={() => {
          void leaveCurrent();
          void api.logout();
          setUser(null);
        }}
      />

      {error && <p className="bar-error">{error}</p>}

      {lockedBy && (
        <p className="bar-lock">
          <b>{lockedBy.userName}さんが編集中です。</b>
          この案件はいま閲覧のみです（{new Date(lockedBy.since).toLocaleTimeString('ja-JP')} から）。
          {dirty && <b className="warn">この画面の未保存の変更は保存できません。</b>}
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
            編集を引き継ぐ
          </button>
        </p>
      )}

      <Shield readOnly={readOnly}>
      {!projectId ? (
        <p className="empty-state">
          上の「案件を選ぶ」から案件を開くか、新しい案件をつくってください。
        </p>
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
          projectId={projectId}
          onApply={(patch) => updateAnswers((prev) => ({ ...prev, ...patch }))}
          onGoToHearing={() => setTab('hearing')}
        />
      ) : (
        <div className="app">
          <HearingForm answers={answers} effective={effective} onChange={updateAnswers} />
          <CompositionPreview answers={effective} />
        </div>
      )}
      </Shield>
    </>
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
