import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from '../i18n/index.ts';

/**
 * 画面の見え方の設定。使う人ごとにブラウザへ覚えさせる。
 * 案件のデータとは関係がないので、サーバーには送らない。
 */

export type Theme = 'light' | 'dark' | 'auto';

export interface Settings {
  /** 画面の言葉。記号名と質問文は日本語のまま */
  lang: Lang;
  /** 明るい／暗い／端末に合わせる */
  theme: Theme;
  /** 文字の大きさ（0.85〜1.6） */
  textScale: number;
  /** 画面全体の大きさ（0.85〜1.5）。文字も含めて全部が拡大縮小する */
  uiScale: number;
  /** 文字を太くする */
  bold: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ja',
  theme: 'auto',
  textScale: 1,
  uiScale: 1,
  bold: false,
};

/** 文字・画面の大きさの選べる段階。％で見せる */
export const TEXT_STEPS = [0.85, 0.925, 1, 1.1, 1.25, 1.4, 1.6];
export const UI_STEPS = [0.85, 0.925, 1, 1.1, 1.25, 1.4, 1.5];

const KEY = 'zumen.display';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      lang: v.lang ?? DEFAULT_SETTINGS.lang,
      theme: v.theme ?? DEFAULT_SETTINGS.theme,
      textScale: typeof v.textScale === 'number' ? v.textScale : 1,
      uiScale: typeof v.uiScale === 'number' ? v.uiScale : 1,
      bold: v.bold === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 設定を実際の画面に効かせる。CSS側はこの印と変数だけを見る */
function applyToDocument(s: Settings): void {
  const el = document.documentElement;
  el.dataset.theme = s.theme;
  el.dataset.bold = s.bold ? 'on' : 'off';
  el.style.setProperty('--text-scale', String(s.textScale));
  el.style.setProperty('--ui-scale', String(s.uiScale));
  el.lang = s.lang;
}

interface Ctx {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const s = load();
    applyToDocument(s);
    return s;
  });

  useEffect(() => {
    applyToDocument(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくても画面は使える（プライベートモードなど）
    }
  }, [settings]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  const value = useMemo<Ctx>(() => ({ settings, set, reset }), [settings, set, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const v = useContext(SettingsContext);
  if (!v) throw new Error('SettingsProvider の中で使ってください');
  return v;
}
