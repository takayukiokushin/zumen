import { useMemo } from 'react';
import { translator } from './index.ts';
import type { Key } from './index.ts';
import { useSettings } from '../settings/settings.tsx';

/** 日付や時刻の書き方を、選んでいる言葉に合わせる */
export function useLang(): string {
  return useSettings().settings.lang;
}

/** 画面の言葉を引く。t('tab.drawing') のように使う */
export function useT(): (key: Key) => string {
  const { settings } = useSettings();
  return useMemo(() => translator(settings.lang), [settings.lang]);
}
