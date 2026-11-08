import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { ServerStatus } from './api.ts';

/** 何分おきに、サーバーの状態を確かめるか */
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * 管理用のアカウントのとき、サーバーの状態（控えが取れているか・ディスクの空き）を確かめて、
 * 注意が必要なときに、帯で知らせるための状態を返す。
 * 確かめるのは、ログインしたとき・30分おき・この画面に戻ってきたとき。確かめられなくても、何も出さない。
 */
export function useServerStatus(enabled: boolean): { status: ServerStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    let stopped = false;
    const check = () => {
      api
        .serverStatus()
        .then((s) => {
          if (!stopped) setStatus(s);
        })
        .catch(() => undefined);
    };
    check();
    const onShow = () => {
      if (document.visibilityState === 'visible') check();
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [enabled, tick]);
  return { status, refresh: () => setTick((n) => n + 1) };
}
