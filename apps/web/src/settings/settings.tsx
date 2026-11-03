import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setCurrentLang } from '../i18n/index.ts';
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
  /** 文字の大きさ（0.6〜1.6。0.1 刻み） */
  textScale: number;
  /** 画面全体の大きさ（0.6〜1.6。0.1 刻み）。文字も含めて全部が拡大縮小する */
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
export const SIZE_MIN = 0.6;
export const SIZE_MAX = 1.6;
/** 60%〜160% を 10% 刻み（11段階）。文字も画面全体も同じ段階 */
const stepsFrom = (): number[] => Array.from({ length: Math.round((SIZE_MAX - SIZE_MIN) * 10) + 1 }, (_, i) => Math.round((SIZE_MIN + i * 0.1) * 10) / 10);
export const TEXT_STEPS = stepsFrom();
export const UI_STEPS = stepsFrom();

/**
 * 前に保存された値（85%・92.5%・125% など、いまの段階に無いもの）は、いちばん近い段階に合わせる。
 * 範囲の外（60%より小さい・160%より大きい）は、端に寄せる。真ん中ちょうどのとき（85%・125%）は、読みやすいよう、大きいほう（90%・130%）。
 */
export function snapToStep(steps: number[], value: number): number {
  let best = steps[0]!;
  for (const st of steps) if (Math.abs(st - value) <= Math.abs(best - value) + 1e-9) best = st;
  return best;
}

const KEY = 'zumen.display';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      lang: v.lang ?? DEFAULT_SETTINGS.lang,
      theme: v.theme ?? DEFAULT_SETTINGS.theme,
      textScale: typeof v.textScale === 'number' ? snapToStep(TEXT_STEPS, v.textScale) : 1,
      uiScale: typeof v.uiScale === 'number' ? snapToStep(UI_STEPS, v.uiScale) : 1,
      bold: v.bold === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * 文字の「標準」の大きさ。設定の「標準（1）」のときに、これだけ大きく出す。
 * 設定の段階（小・標準・大…）は、この大きさを基準にした、相対の大きさのまま。
 * 標準が小さめだったため、初めて見る人でも読みやすいよう、少し大きくした。
 */
export const BASE_TEXT_SCALE = 1.1;

/** 設定を実際の画面に効かせる。CSS側はこの印と変数だけを見る */
function applyToDocument(s: Settings): void {
  const el = document.documentElement;
  el.dataset.theme = s.theme;
  el.dataset.bold = s.bold ? 'on' : 'off';
  el.style.setProperty('--text-scale', String(s.textScale * BASE_TEXT_SCALE));
  el.style.setProperty('--ui-scale', String(s.uiScale));
  el.lang = s.lang;
  // 画面の部品の外（通信の失敗の文言など）でも、選んでいる言葉を使えるように
  setCurrentLang(s.lang);
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
