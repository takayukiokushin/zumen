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

/**
 * ブラウザの zoom の仕組みを調べる。
 * 新しいブラウザ（Chrome 128 以降など）は、拡大した部品の中の「％」が、拡大したあとの長さで決まる。古いものは、拡大する前の長さで決まる。
 * 幅200の入れ物の中に、zoom:2・幅100% の箱を入れ、見た目の幅が 200（新）か 400（古）かで見分ける。
 */
function detectZoomMode(): 'standard' | 'legacy' {
  try {
    const outer = document.createElement('div');
    outer.style.cssText = 'position:absolute;visibility:hidden;width:200px;height:10px;left:-9999px;';
    const inner = document.createElement('div');
    inner.style.cssText = 'zoom:2;width:100%;height:1px;';
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const w = inner.getBoundingClientRect().width;
    outer.remove();
    return w < 300 ? 'standard' : 'legacy';
  } catch {
    return 'legacy';
  }
}
let zoomMode: 'standard' | 'legacy' | null = null;

/**
 * 画面の「実効幅」の区切り（px）。実効幅 ＝ 画面の幅 ÷ 画面全体の倍率。
 * 画面全体を60%にすれば、見えている幅の1.67倍ぶん、部品が並べられる。逆に160%なら、狭い画面と同じ。
 * CSS の @media は、倍率を考えない画面の幅で決まってしまうので、ここで計算して、html の data-uw に、
 * 「その幅以下の区切り」を全部入れる（例：実効幅 650 なら "700 900"）。CSS は html[data-uw~="700"] で見る。
 */
export const WIDTH_STEPS = [400, 640, 700, 900] as const;

/** いまの実効幅（px） */
export function usableWidth(uiScale: number): number {
  return window.innerWidth / (uiScale > 0 ? uiScale : 1);
}

/** 実効幅が、スマホの区切り（700px）以下か */
export function isNarrowScreen(): boolean {
  return document.documentElement.dataset.uw?.split(' ').includes('700') ?? false;
}

function applyWidth(uiScale: number): void {
  const w = usableWidth(uiScale);
  const v = WIDTH_STEPS.filter((n) => w <= n).join(' ');
  const el = document.documentElement;
  if (el.dataset.uw !== v) el.dataset.uw = v;
}

/** 設定を実際の画面に効かせる。CSS側はこの印と変数だけを見る */
function applyToDocument(s: Settings): void {
  const el = document.documentElement;
  applyWidth(s.uiScale);
  el.dataset.theme = s.theme;
  el.dataset.bold = s.bold ? 'on' : 'off';
  zoomMode ??= detectZoomMode();
  el.dataset.zoom = zoomMode;
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

  // 画面の幅が変わったとき（窓の大きさ・スマホの向き）も、実効幅の印を付け直す
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applyWidth(settings.uiScale));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [settings.uiScale]);

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
