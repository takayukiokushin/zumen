import { useMemo } from 'react';
import { dataTranslator, translator } from './index.ts';
import type { Key, Vars } from './index.ts';
import { useSettings } from '../settings/settings.tsx';

/** 日付や時刻の書き方を、選んでいる言葉に合わせる */
export function useLang(): string {
  return useSettings().settings.lang;
}

/** 画面の言葉を引く。t('tab.drawing') のように使う */
export function useT(): (key: Key, vars?: Vars) => string {
  const { settings } = useSettings();
  return useMemo(() => translator(settings.lang), [settings.lang]);
}

/**
 * 質問・選択肢・説明文・記号の名前など、日本語の文を、選んでいる言葉にする。
 * 図面に印刷される文字には使わない（日本語のまま）。
 */
export function useTx(): (text: string, context?: string) => string {
  const { settings } = useSettings();
  return useMemo(() => dataTranslator(settings.lang), [settings.lang]);
}
