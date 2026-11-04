import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { Doc } from './doc.ts';
import { runHeavy } from './heavy.ts';
import type { HeavyKind, HeavyRequest, HeavyResult } from './heavy.ts';

/**
 * 時間のかかる図面の処理（結線を整える・縮小・拡大）の、進み具合の管理と、画面の中央に出す吹き出し。
 *
 * - 押してから **1秒以上かかったときだけ**、画面の中央に「整えています。しばらくお待ちください…」が出る
 *   （くるくる回る印つき）。すぐ終わる処理では、何も出ない（出して、すぐ消えると、ちらついて邪魔なため）。
 *   吹き出しは、画面の操作をじゃましない（そのまま、ほかのタブに移ったり、入力したりできる）。
 *   動かしている間は、同じボタンを押せない（二重に動かさないため）。これは、すぐに効く。
 * - 終わったら、図面の画面が開いていれば、これまでどおり、その場で図面に反映する（吹き出しは消える）。
 *   ほかの画面を見ていたら、図面に反映して、吹き出しで「終わりました」を知らせる。
 * - 動かしている間に、図面や入力が変わっていたら、結果は使わない（古い図面に上書きしないため）。吹き出しで知らせる。
 */
export interface HeavyApi {
  /** いま動かしている処理（なければ null）。ボタンを押せなくする目印にも使う */
  busy: HeavyKind | null;
  start: (req: HeavyRequest) => void;
  /** 図面の画面が、結果を受け取る窓口を登録する（閉じるときは null）。登録が無いときは、App が図面に反映する */
  bind: (handler: ((req: HeavyRequest, res: HeavyResult) => void) | null) => void;
}

interface Options {
  /** 図面や入力が変わるたびに増える数。動かし始めたときと違っていたら、結果は使わない */
  getVersion: () => number;
  /** 図面の画面が閉じているときに、結果を図面に反映する（req は、動かし始めたときの図面など） */
  applyAway: (req: HeavyRequest, next: Doc) => void;
}

/** この時間（ミリ秒）より長くかかったときだけ、「しばらくお待ちください」の吹き出しを出す */
export const SHOW_AFTER_MS = 1000;

type Toast = { kind: 'running'; job: HeavyKind } | { kind: 'note'; text: string } | null;

export function useHeavyJob({ getVersion, applyAway }: Options): { api: HeavyApi; toast: React.ReactNode } {
  const t = useT();
  const [busy, setBusy] = useState<HeavyKind | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const handler = useRef<((req: HeavyRequest, res: HeavyResult) => void) | null>(null);
  const running = useRef(false);
  const timer = useRef<number | null>(null);
  /** 「しばらくお待ちください」を出すまでの待ち時間の計り */
  const showTimer = useRef<number | null>(null);
  const cancelShow = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = null;
  };
  const keep = useRef({ getVersion, applyAway, t });
  keep.current = { getVersion, applyAway, t };

  const note = useCallback((text: string) => {
    setToast({ kind: 'note', text });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 9000);
  }, []);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (showTimer.current) window.clearTimeout(showTimer.current);
  }, []);

  const start = useCallback(
    (req: HeavyRequest) => {
      if (running.current) return;
      running.current = true;
      const version = keep.current.getVersion();
      if (timer.current) window.clearTimeout(timer.current);
      setBusy(req.kind);
      setToast(null);
      cancelShow();
      showTimer.current = window.setTimeout(() => setToast({ kind: 'running', job: req.kind }), SHOW_AFTER_MS);
      runHeavy(req)
        .then((res) => {
          cancelShow();
          const tt = keep.current.t;
          if (keep.current.getVersion() !== version) {
            setToast(null);
            note(tt('heavy.stale'));
            return;
          }
          if (handler.current) {
            handler.current(req, res);
            setToast(null);
            return;
          }
          // 図面の画面が閉じている：図面に反映して、終わったことを知らせる
          const limit = res.kind !== 'tidy' && !res.result.changed;
          if (!limit) keep.current.applyAway(req, res.result.doc);
          const away = res.kind === 'tidy' ? 'heavy.tidy.away' : res.kind === 'shrink' ? 'heavy.shrink.away' : 'heavy.expand.away';
          note(limit && res.kind === 'shrink' ? tt('editor.layoutLimit') : tt(away));
        })
        .catch(() => {
          cancelShow();
          setToast(null);
          note(keep.current.t('heavy.failed'));
        })
        .finally(() => {
          cancelShow();
          running.current = false;
          setBusy(null);
        });
    },
    [note],
  );

  const bind = useCallback((h: ((req: HeavyRequest, res: HeavyResult) => void) | null) => {
    handler.current = h;
  }, []);

  const bubble =
    toast === null ? null : (
      <div className="heavy-toast" role="status" aria-live="polite">
        <div className={`heavy-bubble${toast.kind === 'running' ? ' running' : ''}`}>
          {toast.kind === 'running' ? (
            <>
              <span className="heavy-spin" aria-hidden="true" />
              <div className="heavy-text">
                <b>{t(`heavy.${toast.job}.running`)}</b>
                <span>{t('heavy.canMove')}</span>
              </div>
            </>
          ) : (
            <>
              <div className="heavy-text">
                <b>{toast.text}</b>
              </div>
              <button type="button" className="btn" onClick={() => setToast(null)}>
                {t('common.close')}
              </button>
            </>
          )}
        </div>
      </div>
    );

  return { api: { busy, start, bind }, toast: bubble };
}
