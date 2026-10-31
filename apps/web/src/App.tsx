import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ConnectionError, LockedError, StaleError } from './session/api.ts';
import { SAVE_RETRY } from './session/messages.ts';
import type { Lock, User } from './session/api.ts';
import { Login } from './session/Login.tsx';
import { ProjectBar } from './projects/ProjectBar.tsx';
import { HearingForm } from './HearingForm.tsx';
import { CompositionPreview } from './CompositionPreview.tsx';
import { Editor } from './editor/Editor.tsx';
import { Analyze } from './analyze/Analyze.tsx';
import { Voice } from './voice/Voice.tsx';
import { JobList } from './projects/JobList.tsx';
import { TabBar } from './TabBar.tsx';
import type { Tab } from './TabBar.tsx';
import { UserAdmin } from './projects/UserAdmin.tsx';
import { SettingsPanel } from './settings/SettingsPanel.tsx';
import { HelpPanel } from './help/HelpPanel.tsx';
import { helpSeen, markHelpSeen } from './help/seen.ts';
import { useDialogs } from './Dialogs.tsx';
import { useLang, useT } from './i18n/useT.ts';
import type { Doc } from './editor/doc.ts';
import type { Answers, Value } from '@zumen/knowledge';
import { QUESTIONS, normalizeAnswers, withAutoValues } from '@zumen/knowledge';

/** 質問定義の既定値。回答そのものとは分けて持ち、「まだ触っていない」が分かるようにする */
export const DEFAULTS: Answers = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

export function App() {
  const t = useT();
  const { ask } = useDialogs();
  const lang = useLang();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('hearing');
  /** 案件の一覧を出しているか（㉚）。案件を開いていないときは必ず一覧 */
  const [showList, setShowList] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** はじめて使うときの、「使い方」への案内。一度閉じたら、このブラウザでは出さない */
  const [firstHint, setFirstHint] = useState(() => !helpSeen());
  /**
   * ㉖㉗ ヒアリング画面の左の目次（「事前ヒアリング」の見出しと、質問のまとまりの一覧）・右の「いまの構成」を出すか。
   * 左の目次は、ふだんは見る必要がなく、情報が多くて分かりにくいので、最初は隠しておく（「▶ 目次を出す」で開く）
   */
  const [showNav, setShowNav] = useState(false);
  /**
   * この案件で、スケッチの読み取りを行ったか。
   * 読み取りに使った写真は案件に残してあるので、案件を開くときは、写真があるかで分かる。
   * 読み取りを実行した直後も、ここを「はい」にする
   */
  const [sketchRead, setSketchRead] = useState(false);
  // スマホ（幅の狭い画面）では、入力欄を広く使うため、「いまの構成」は最初は隠しておく
  const [showPreview, setShowPreview] = useState(() => !window.matchMedia?.('(max-width: 700px)').matches);

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
  /** この画面が読み込んだ（最後に保存した）時点の、サーバー側の更新時刻。別の端末での更新に気づくために使う */
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  /** 保存しようとしたら、ほかの端末・画面で更新されていたときの、その情報 */
  const [stale, setStale] = useState<{ updatedAt: string; by: string | null } | null>(null);

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

  // 古い回答（PASの設置：hasPas）が残っている案件は、区分開閉器の回答に読み替えてから、既定値を足す
  // （先に既定値を足すと、「PASなし」だった案件がPASありになってしまう）
  const effective = useMemo<Answers>(() => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(answers) }), [answers]);

  const updateAnswers = useCallback((next: Answers | ((prev: Answers) => Answers)) => {
    setAnswers((prev) => (typeof next === 'function' ? next(prev) : next));
    setDirty(true);
  }, []);

  /**
   * 保存していない変更があるとき、別の案件へ移ってよいかを確かめる。
   * 「実行」なら、いまの内容を保存してから、移る（保存できなかったときは、移らずに今の案件に留まる）。
   * 「キャンセル」なら、何もせず、今の案件に留まる。編集中のデータが消えないことを、いちばん大事にする。
   * 移ってよい（または、失うものが無い）なら true。
   */
  const confirmLeave = async (): Promise<boolean> => {
    if (!dirty) return true;
    // 他の人が編集中で、保存できない状態のときは、自動で保存できないので、変更が消えることを伝える
    if (readOnly) {
      return ask({ title: t('project.unsavedTitle'), message: [`「${projectName}」${t('project.unsavedLeave')}`], confirmLabel: t('project.unsavedGo') });
    }
    if (!(await ask({ title: t('project.autoSaveTitle'), message: [t('project.autoSaveLeave')] }))) return false;
    return save();
  };

  /**
   * 図面の名称を変える。事業場名称も、同じ名前に変わる。
   * ただし、事業場名称を手で別の名前にしているときは、変えてよいかを、「はい／いいえ」で聞く。
   * （空、または、これまでの図面の名称と同じなら、手で変えていないので、聞かずに自動で変える）
   */
  const renameProject = async (name: string) => {
    const oldName = projectName.trim();
    const next = name.trim();
    setProjectName(name);
    setDirty(true);
    if (!next || next === oldName) return;
    const site = String(answers.siteName ?? '').trim();
    if (site === next) return;
    if (site === '' || site === oldName) {
      updateAnswers((prev) => ({ ...prev, siteName: next }));
      return;
    }
    const yes = await ask({
      title: t('project.site.title'),
      message: [`${t('project.site.now')}「${site}」`, `${t('project.site.ask')}「${next}」`],
      confirmLabel: t('dialog.yes'),
      cancelLabel: t('dialog.no'),
    });
    if (yes) updateAnswers((prev) => ({ ...prev, siteName: next }));
  };

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
      setSketchRead(p.files.some((f) => f.media_type.startsWith('image/')));
      setDirty(false);
      setSavedAt(null);
      setError(null);
      setStale(null);
      setBaseUpdatedAt(p.updatedAt);
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

  /**
   * useAsSite：図面の名称を、ヒアリングの「事業場名称」の初期値にする（あとから自由に変えられる）。
   * 名前を決めていないとき（標準の名前のまま）は、空のままにする
   */
  const newProject = async (name: string, useAsSite = false) => {
    try {
      await leaveCurrent();
      const initial: Answers = useAsSite && name.trim() ? { siteName: name.trim() } : {};
      const { id, updatedAt } = await api.createProject(name, initial);
      setProjectId(id);
      setProjectName(name || '無題の案件');
      setAnswers(initial);
      setDrawing(null);
      setSketchRead(false);
      setDirty(false);
      setError(null);
      setStale(null);
      setBaseUpdatedAt(updatedAt);
      setLockedBy(null);
      setShowList(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '案件を作れませんでした。');
    }
  };

  /** 保存する。保存できたら true（別の端末で更新されていた・通信できなかったなどのときは false） */
  const save = async (force = false): Promise<boolean> => {
    if (!projectId) return false;
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveProject(projectId, {
        name: projectName,
        answers,
        drawing,
        ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
        ...(force ? { force: true } : {}),
      });
      setSavedAt(r.updatedAt);
      setBaseUpdatedAt(r.updatedAt);
      setStale(null);
      setDirty(false);
      return true;
    } catch (e) {
      if (e instanceof StaleError) {
        // 画面の内容はそのまま残し、上書きするか読み込み直すかを選んでもらう
        setStale({ updatedAt: e.updatedAt, by: e.updatedByName });
        return false;
      }
      if (e instanceof LockedError) setLockedBy(e.lock);
      // 通信が届かなかったときは、つながってからもう一度保存すればよいと伝える
      const retry = e instanceof ConnectionError ? SAVE_RETRY : '';
      setError(`${e instanceof Error ? e.message : '保存できませんでした。'}${retry}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 一覧を開いているときに Esc キーを押すと、一覧を閉じて、開く前の画面に戻る
  // （設定・使い方・利用者の管理の窓が開いているときは、そちらを邪魔しない）
  const canCloseListWithEsc = showList && projectId !== null && !settingsOpen && !helpOpen && !usersOpen;
  useEffect(() => {
    if (!canCloseListWithEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) setShowList(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCloseListWithEsc]);

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
        // 一覧を開いているときも、タブは押せる（押すと一覧を閉じて、そのタブの画面に戻る）
        enabled={projectId !== null}
        dirty={dirty}
        onSettings={() => setSettingsOpen(true)}
        onHelp={() => {
          setHelpOpen(true);
          markHelpSeen();
          setFirstHint(false);
        }}
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
        listing={listing}
        // 一覧を開いているときに、もう一度押すと閉じる（開いている案件が無いときは、戻る先が無いので開いたまま）
        onList={() => setShowList((open) => (projectId ? !open : true))}
        onRename={(name) => void renameProject(name)}
        onSave={() => void save()}
        readOnly={readOnly}
      />

      {firstHint && (
        <p className="bar-lock">
          {t('help.firstTime')}
          <button
            type="button"
            onClick={() => {
              setHelpOpen(true);
              markHelpSeen();
              setFirstHint(false);
            }}
          >
            {t('help.firstTimeOpen')}
          </button>
          <button
            type="button"
            onClick={() => {
              markHelpSeen();
              setFirstHint(false);
            }}
          >
            {t('help.firstTimeClose')}
          </button>
        </p>
      )}

      {error && <p className="bar-error">{error}</p>}

      {stale && !listing && (
        <p className="bar-lock">
          <b>{t('stale.title')}</b>
          （{stale.by ? `${stale.by} / ` : ''}
          {new Date(stale.updatedAt).toLocaleString(lang)}）{t('stale.warn')}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void ask({ title: t('stale.overwrite'), message: [t('stale.overwriteConfirm')], confirmLabel: t('stale.overwrite') }).then((yes) => {
                if (yes) void save(true);
              });
            }}
          >
            {t('stale.overwrite')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void ask({ title: t('stale.reload'), message: [t('stale.reloadConfirm')], confirmLabel: t('stale.reload') }).then((yes) => {
                if (yes) void openProject(projectId!);
              });
            }}
          >
            {t('stale.reload')}
          </button>
        </p>
      )}

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
              const warning = dirty ? ['この画面の未保存の変更は破棄され、保存されている内容を読み直します。'] : [];
              void ask({
                title: t('lock.takeover'),
                message: [
                  `${lockedBy.userName}さんから編集を引き継ぎます。`,
                  ...warning,
                  `${lockedBy.userName}さんの未保存の変更も失われます。よろしいですか。`,
                ],
                confirmLabel: t('lock.takeover'),
              }).then((yes) => {
                if (yes) void openProject(projectId!, true);
              });
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
              role={user.role}
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
              onNew={(name, useAsSite) => void newProject(name, useAsSite)}
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
          ) : tab === 'voice' ? (
            <Voice
              answers={effective}
              onApply={(patch) => updateAnswers((prev) => ({ ...prev, ...patch }))}
              onGoToHearing={() => setTab('hearing')}
            />
          ) : tab === 'analyze' ? (
            <Analyze
              answers={effective}
              projectId={projectId!}
              onApply={(patch) => updateAnswers((prev) => ({ ...prev, ...patch }))}
              onAnalyzed={() => setSketchRead(true)}
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
                <HearingForm answers={answers} effective={effective} onChange={updateAnswers} showNav={showNav} sketchRead={sketchRead} />
                {showPreview && <CompositionPreview answers={effective} />}
              </div>
            </div>
          )}
        </Shield>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
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
