import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ConnectionError, LockedError, setReauthHandler, StaleError } from './session/api.ts';
import { saveRetry } from './session/messages.ts';
import type { Lock, User } from './session/api.ts';
import { Login } from './session/Login.tsx';
import { ProjectBar } from './projects/ProjectBar.tsx';
import { HearingForm } from './HearingForm.tsx';
import { KeepScroll, newScrollStore } from './KeepScroll.tsx';
import { CompositionPreview } from './CompositionPreview.tsx';
import { Editor } from './editor/Editor.tsx';
import { purgeOrphanMarks, withCleanLayers } from './editor/layers.ts';
import { useHeavyJob } from './editor/useHeavyJob.tsx';
import { useNewVersion } from './session/useNewVersion.ts';
import { Analyze } from './analyze/Analyze.tsx';
import { Voice } from './voice/Voice.tsx';
import { JobList } from './projects/JobList.tsx';
import { TabBar } from './TabBar.tsx';
import type { Tab } from './TabBar.tsx';
import { UserAdmin } from './projects/UserAdmin.tsx';
import { SettingsPanel } from './settings/SettingsPanel.tsx';
import { isNarrowScreen } from './settings/settings.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { Relogin } from './session/Relogin.tsx';
import { HelpPanel } from './help/HelpPanel.tsx';
import { helpSeen, markHelpSeen } from './help/seen.ts';
import { useDialogs } from './Dialogs.tsx';
import { useLang, useT } from './i18n/useT.ts';
import type { Doc } from './editor/doc.ts';
import type { Answers, Value } from '@zumen/knowledge';
import { NEW_PROJECT_ANSWERS, QUESTIONS, normalizeAnswers, withAutoValues } from '@zumen/knowledge';

/** 質問定義の既定値。回答そのものとは分けて持ち、「まだ触っていない」が分かるようにする */
export const DEFAULTS: Answers = Object.fromEntries(
  QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]),
);

export function App() {
  const t = useT();
  const { ask } = useDialogs();
  const lang = useLang();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  /**
   * ログインの有効期限が切れたときの「もう一度ログインする窓」。窓が出ているあいだは、done を持つ。
   * 画面（入力した内容・図面）は、そのまま残る。ログインできたら、失敗した操作（保存など）が自動でやり直される
   */
  const [relogin, setRelogin] = useState<{ done: (ok: boolean) => void } | null>(null);
  const reloginPending = useRef<Promise<boolean> | null>(null);
  const loggedIn = user !== undefined && user !== null;
  useEffect(() => {
    if (!loggedIn) return;
    setReauthHandler(() => {
      // 窓が出ている最中に、ほかの通信も切れていたら、同じ窓の結果を待つ（窓を重ねて出さない）
      if (reloginPending.current) return reloginPending.current;
      const p = new Promise<boolean>((resolve) => {
        setRelogin({
          done: (ok) => {
            reloginPending.current = null;
            setRelogin(null);
            resolve(ok);
          },
        });
      });
      reloginPending.current = p;
      return p;
    });
    return () => setReauthHandler(null);
  }, [loggedIn]);
  const [tab, setTab] = useState<Tab>('hearing');
  /** 「設備を入力して作成」のスクロール位置。別のタブへ移って戻ったときに、同じ位置へ戻すため */
  const hearingScroll = useRef(newScrollStore());
  /**
   * スケッチ読み取りの状態。読み取りの画面は、別のタブを見ているあいだも、作ったまま（見えないだけ）にしてあるので、
   * 読み取りも、選んだ画像も、読み取った結果も、タブを切り替えても消えない。
   */
  const [analyzeStatus, setAnalyzeStatus] = useState<'idle' | 'busy' | 'done'>('idle');
  useEffect(() => {
    // 読み取りの画面を開いたら、「結果あり」の印は消す
    if (tab === 'analyze') setAnalyzeStatus((s) => (s === 'done' ? 'idle' : s));
  }, [tab, analyzeStatus]);
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
   * 読み取りに使った写真は、「保存」を押したときに消えるので、印を別に保存してある（案件を開くときは、その印で分かる）。
   * 読み取りを実行した直後も、ここを「はい」にする
   */
  const [sketchRead, setSketchRead] = useState(false);
  // スマホ（幅の狭い画面）では、入力欄を広く使うため、「いまの構成」は最初は隠しておく
  const [showPreview, setShowPreview] = useState(() => !isNarrowScreen());

  const [projectId, setProjectId] = useState<string | null>(null);
  // 別の案件を開いたら、読み取りの状態の印は、消す
  useEffect(() => setAnalyzeStatus('idle'), [projectId]);
  const [projectName, setProjectName] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [drawing, setDrawing] = useState<Doc | null>(null);
  /**
   * 図面や入力が変わるたびに増える数。時間のかかる図面の処理（結線を整える など）が終わったとき、
   * 動かし始めたときと違っていたら、古い図面に上書きしないよう、結果を使わない
   */
  const newVersion = useNewVersion(Boolean(user));
  const docVersion = useRef(0);
  useEffect(() => {
    docVersion.current++;
  }, [answers, projectId]);
  /** 時間のかかる処理（結線を整える・縮小・拡大）。ほかの画面に移っても続き、終わったら画面の中央の吹き出しで知らせる */
  const heavyJob = useHeavyJob({
    getVersion: () => docVersion.current,
    // 図面の画面を閉じているあいだに終わったとき：図面に反映する（図面の画面での反映と同じ印の付け方）
    applyAway: (req, next) => {
      setDrawing({ ...next, edited: req.kind === 'tidy' ? req.doc.edited : true, basis: req.doc.basis });
      setDirty(true);
    },
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** 保存していない入力を、自動で控えた時刻（下書き）。保存したら消す */
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 保存はできたが、入れ忘れがあるときの注意（例：事業場名称が空）。入れたら消える */
  const [warning, setWarning] = useState<string | null>(null);
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
      // 保存していない入力を、自動で控えた下書きがあれば、復元するか尋ねる（他の人が編集中で、自分は見るだけのときは、尋ねない）
      const busyByOther = p.lock && user && p.lock.userId !== user.id && user.role !== 'admin';
      const draft = !busyByOther && p.draft ? p.draft : null;
      const restore = draft
        ? await ask({
            title: t('draft.restore.title'),
            message: [
              t('draft.restore.msg1', { when: new Date(draft.savedAt).toLocaleString(lang) }),
              t('draft.restore.msg2'),
              t('draft.restore.msg3'),
            ],
            confirmLabel: t('draft.restore.yes'),
            cancelLabel: t('draft.restore.no'),
          })
        : false;
      const base = restore && draft ? draft : null;
      setProjectId(p.id);
      setProjectName(base?.name ?? p.name);
      setAnswers(base ? base.answers : (p.answers ?? {}));
      // 形の合わないレイヤーのデータ（古い版・壊れたもの）で、案件が開けなくならないよう、読み込むときに整理する
      setDrawing(withCleanLayers(base ? base.drawing : p.drawing));
      setSketchRead(
        base?.sketchRead || (p.sketchRead ?? p.files.some((f) => f.media_type.startsWith('image/') || f.media_type === 'application/pdf')),
      );
      // 復元したときは、「保存していない」状態で開く（「保存」を押すまで確定しない）。
      // 下書きをとったあとに、別の人が保存していたら、保存のときに、上書きしてよいか尋ねられる
      setDirty(base !== null);
      setDraftAt(base ? base.savedAt : null);
      setSavedAt(null);
      setError(null);
      setWarning(null);
      setStale(null);
      setBaseUpdatedAt(base ? (base.baseUpdatedAt ?? p.updatedAt) : p.updatedAt);
      setShowList(false);
      try {
        await api.takeLock(id, force);
        setLockedBy(null);
      } catch (e) {
        if (!(e instanceof LockedError)) throw e;
        setLockedBy(e.lock);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.openProject'));
    }
  };

  /**
   * useAsSite：図面の名称を、ヒアリングの「事業場名称」の初期値にする（あとから自由に変えられる）。
   * 名前を決めていないとき（標準の名前のまま）は、空のままにする
   */
  const newProject = async (name: string, useAsSite = false) => {
    try {
      await leaveCurrent();
      // 新しい案件は、初期設定（NEW_PROJECT_ANSWERS）の答えを入れた状態で始める。保存済みの案件は変わらない
      const initial: Answers = { ...NEW_PROJECT_ANSWERS, ...(useAsSite && name.trim() ? { siteName: name.trim() } : {}) };
      const { id, updatedAt } = await api.createProject(name, initial);
      setProjectId(id);
      setProjectName(name || t('project.untitled'));
      setAnswers(initial);
      setDrawing(null);
      setSketchRead(false);
      setDirty(false);
      setDraftAt(null);
      setError(null);
      setWarning(null);
      setStale(null);
      setBaseUpdatedAt(updatedAt);
      setLockedBy(null);
      setShowList(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('err.createProject'));
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
        // 付けた開閉器が無くなった×印は、保存するときに、データから外す
        drawing: drawing ? purgeOrphanMarks(drawing) : drawing,
        // 読み取った案件か（写真は、この保存のときに消えるので、印だけ残す）
        ...(sketchRead ? { sketchRead: true } : {}),
        ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
        ...(force ? { force: true } : {}),
      });
      setSavedAt(r.updatedAt);
      setBaseUpdatedAt(r.updatedAt);
      setStale(null);
      setDirty(false);
      setDraftAt(null);
      // 事業場名称は必須。空のまま保存したときは、保存はできるが、入れるよう知らせる
      setWarning(String(effective.siteName ?? '').trim() === '' ? t('project.siteRequired') : null);
      return true;
    } catch (e) {
      if (e instanceof StaleError) {
        // 画面の内容はそのまま残し、上書きするか読み込み直すかを選んでもらう
        setStale({ updatedAt: e.updatedAt, by: e.updatedByName ?? (e.updatedByRemoved ? t('project.userRemoved') : null) });
        return false;
      }
      if (e instanceof LockedError) setLockedBy(e.lock);
      // 通信が届かなかったときは、つながってからもう一度保存すればよいと伝える
      const retry = e instanceof ConnectionError ? saveRetry() : '';
      setError(`${e instanceof Error ? e.message : t('err.save')}${retry}`);
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

  // 事業場名称を入れたら、「入力してください」の注意は、すぐ消す
  useEffect(() => {
    if (warning && String(effective.siteName ?? '').trim() !== '') setWarning(null);
  }, [warning, effective.siteName]);

  /**
   * 保存していない入力を、20秒ごとに、サーバーへ自動で控える（下書き）。
   * 保存を押し忘れて、画面を閉じたり、パソコンが止まったりしても、次に案件を開いたとき、復元できる。
   * 案件そのものは書き換えない。「保存」を押すと、下書きは消える。変わっていないとき・他の人が編集中のときは、控えない
   */
  const draftState = useRef({ projectId, projectName, answers, drawing, sketchRead, baseUpdatedAt, dirty, readOnly, saving });
  draftState.current = { projectId, projectName, answers, drawing, sketchRead, baseUpdatedAt, dirty, readOnly, saving };
  const draftSig = useRef('');
  useEffect(() => {
    const timer = setInterval(() => {
      const s = draftState.current;
      if (!s.dirty || !s.projectId || s.readOnly || s.saving) {
        if (!s.dirty) draftSig.current = '';
        return;
      }
      const sig = JSON.stringify([s.projectId, s.projectName, s.answers, s.drawing, s.sketchRead]);
      if (sig === draftSig.current) return;
      draftSig.current = sig;
      api
        .saveDraft(s.projectId, {
          name: s.projectName,
          answers: s.answers,
          drawing: s.drawing,
          sketchRead: s.sketchRead,
          baseUpdatedAt: s.baseUpdatedAt,
        })
        .then((r) => setDraftAt(r.savedAt))
        .catch(() => {
          // 控えられなかったときは、次の機会（20秒後）にやり直す。画面には何も出さない
          draftSig.current = '';
        });
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * ブラウザのタブの名前。複数のタブを開いたとき、どの案件のどの画面かが分かるように、「案件名 – 画面名」にする。
   * 案件を開いていないとき（ログイン・図面一覧）は、案件名が無いので、アプリの名前を添える（タブの小さな絵でも、アプリだと分かる）
   */
  const screenKey = { analyze: 'title.analyze', voice: 'title.voice', hearing: 'title.hearing', drawing: 'title.drawing' } as const;
  useEffect(() => {
    if (user === undefined) return;
    if (user === null) document.title = `${t('login.submit')} – ${t('app.name')}`;
    else if (showList || !projectId) document.title = `${t('project.list')} – ${t('app.name')}`;
    else document.title = `${projectName || t('project.untitled')} – ${t(screenKey[tab])}`;
  }, [user, showList, projectId, projectName, tab, lang, t]);

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
        analyzeStatus={analyzeStatus}
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
        draftAt={draftAt}
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

      {newVersion && (
        <p className="bar-update" role="status">
          <b>{t('update.title')}</b>
          {t('update.msg')}
          <button
            type="button"
            className="btn"
            onClick={() => {
              // 保存していない変更があるときは、読み込み直すと消えることを、先に確かめる
              if (!dirty) {
                window.location.reload();
                return;
              }
              void ask({ title: t('update.reload'), message: [t('update.reloadLose')], confirmLabel: t('update.reload') }).then((yes) => {
                if (yes) window.location.reload();
              });
            }}
          >
            {t('update.reload')}
          </button>
        </p>
      )}

      {error && <p className="bar-error">{error}</p>}
      {warning && !error && !listing && (
        <p className="bar-warn" role="status">
          {warning}
        </p>
      )}

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
              const warning = dirty ? [t('lock.takeoverDiscard')] : [];
              void ask({
                title: t('lock.takeover'),
                message: [
                  t('lock.takeoverFrom', { name: lockedBy.userName }),
                  ...warning,
                  t('lock.takeoverLose', { name: lockedBy.userName }),
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
          {/* いま開いている画面の中でエラーが起きても、白くならない。入力内容・図面は、この外（App）が持っているので消えない */}
          <ErrorBoundary scope="screen" resetKey={`${listing ? 'list' : tab}:${projectId ?? ''}`}>
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
                docVersion.current++;
                setDrawing(doc);
                setDirty(true);
              }}
              heavy={heavyJob.api}
            />
          ) : tab === 'voice' ? (
            <Voice
              answers={effective}
              onApply={(patch) => updateAnswers((prev) => ({ ...prev, ...patch }))}
              onGoToHearing={() => setTab('hearing')}
            />
          ) : tab === 'analyze' ? null : (
            <KeepScroll store={hearingScroll.current} projectId={projectId} className="hearing-pane">
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
            </KeepScroll>
          )}
          </ErrorBoundary>
          {/* スケッチ読み取り：別のタブ・図面一覧を見ているあいだは、見えないだけで、作ったまま（読み取りも、画像も、結果も、消えない） */}
          {projectId && (
            <div className="analyze-keep" hidden={listing || tab !== 'analyze'}>
              <ErrorBoundary scope="screen" resetKey={projectId}>
              <Analyze
                key={projectId}
                answers={effective}
                onApply={(patch) => updateAnswers((prev) => ({ ...prev, ...patch }))}
                onAnalyzed={() => setSketchRead(true)}
                onStatus={setAnalyzeStatus}
                onGoToHearing={() => setTab('hearing')}
              />
              </ErrorBoundary>
            </div>
          )}
        </Shield>
      </div>

      {relogin && user && <Relogin userId={user.id} userName={user.name} onDone={relogin.done} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {usersOpen && <UserAdmin me={user} onClose={() => setUsersOpen(false)} />}
      {/* 時間のかかる図面の処理の、「しばらくお待ちください」の吹き出し（画面の中央。操作をじゃましない） */}
      {heavyJob.toast}
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
