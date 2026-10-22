import { useMemo } from 'react';
import { translator } from './index.ts';
import type { Key } from './index.ts';
import { useSettings } from '../settings/settings.tsx';

/** 画面の言葉を引く。t('tab.drawing') のように使う */
export function useT(): (key: Key) => string {
  const { settings } = useSettings();
  return useMemo(() => translator(settings.lang), [settings.lang]);
}
