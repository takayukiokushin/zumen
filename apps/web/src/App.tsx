import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './session/api.ts';
import type { User } from './session/api.ts';
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

  const effective = useMemo<Answers>(() => ({ ...DEFAULTS, ...answers }), [answers]);

  const updateAnswers = useCallback((next: Answers | ((prev: Answers) => Answers)) => {
    setAnswers((prev) => (typeof next === 'function' ? next(prev) : next));
    setDirty(true);
  }, []);

  const openProject = async (id: string) => {
    try {
      const p = await api.getProject(id);
      setProjectId(p.id);
      setProjectName(p.name);
      setAnswers(p.answers ?? {});
      setDrawing(p.drawing);
      setDirty(false);
      setSavedAt(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '案件を開けませんでした。');
    }
  };

  const newProject = async (name: string) => {
    try {
      const { id } = await api.createProject(name);
      setProjectId(id);
      setProjectName(name || '無題の案件');
      setAnswers({});
      setDrawing(null);
      setDirty(false);
      setError(null);
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
        onLogout={() => {
          void api.logout();
          setUser(null);
        }}
      />

      {error && <p className="bar-error">{error}</p>}

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
    </>
  );
}
