import { useEffect, useState } from 'react';
import { api } from './api.ts';

/** いま開いている画面の「版の印」（本体のファイル名）。開発中（ビルドしていないとき）は null */
function myBuild(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src');
  return src?.match(/\/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
}

/** 何分おきに、サーバーの版を確かめるか */
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * 画面を開きっぱなしのあいだに、サーバーが新しい版に入れ替わったかを調べる。
 * 入れ替わっていたら true（「新しい版があります。保存してから、読み込み直してください」の帯を出す）。
 * 確かめるのは、5分おきと、この画面に戻ってきたとき。確かめられなくても（つながらなくても）、何も出さない。
 */
export function useNewVersion(enabled: boolean): boolean {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    const mine = myBuild();
    if (!enabled || !mine) return;
    let stopped = false;
    const check = () => {
      api
        .health()
        .then((h) => {
          if (!stopped && h.webBuild && h.webBuild !== mine) setNewer(true);
        })
        .catch(() => undefined);
    };
    const onShow = () => {
      if (document.visibilityState === 'visible') check();
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [enabled]);
  return newer;
}
