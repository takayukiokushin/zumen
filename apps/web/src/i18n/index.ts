/**
 * 画面の言葉。ボタン・案内・質問・選択肢・説明文・記号の名前・メッセージまで、4つの言語に訳す。
 * ただし、図面に印刷される文字（図面のプレビューと、印刷・PDF）は、日本語のまま
 * （提出先が日本の電力会社・消防のため）。
 *
 * 言葉は、言語ごとのファイルに分けてある（辞書：dict-ja / dict-en / dict-fr / dict-zh / dict-ko、
 * 質問・選択肢・説明文・記号の名前の訳：data-en / data-fr / data-zh / data-ko）。
 * 新しい言葉を足すときは dict-ja.ts に足してから、ほかの言語に同じ鍵で足す。このファイルは、引き出し方（tr・translator など）だけ。
 */

import { ja } from './dict-ja.ts';
import type { Dict, Key } from './dict-ja.ts';
import { en } from './dict-en.ts';
import { fr } from './dict-fr.ts';
import { zh } from './dict-zh.ts';
import { ko } from './dict-ko.ts';
import dataEn from './data-en.ts';
import dataFr from './data-fr.ts';
import dataZh from './data-zh.ts';
import dataKo from './data-ko.ts';

export const LANGS = ['ja', 'en', 'fr', 'zh', 'ko'] as const;
export type Lang = (typeof LANGS)[number];

/** 言語の選択肢に出す名前。その言語自身の表記にしてある */
export const LANG_LABEL: Record<Lang, string> = {
  ja: '日本語',
  en: 'English',
  fr: 'Français',
  zh: '中文',
  ko: '한국어',
};

export type { Key };

const DICTS: Record<Lang, Dict> = { ja, en, fr, zh, ko };
const DATA: Record<Exclude<Lang, 'ja'>, Record<string, string>> = { en: dataEn, fr: dataFr, zh: dataZh, ko: dataKo };

/** 言葉の中の {名前} を、渡された値に置き換える（件数など、あとから決まる部分に使う） */
export type Vars = Record<string, string | number>;
const fill = (text: string, vars?: Vars): string =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

/** その言語の言葉を引く道具を作る。未訳があれば日本語で出す */
export function translator(lang: Lang): (key: Key, vars?: Vars) => string {
  const dict = DICTS[lang] ?? ja;
  return (key, vars) => fill(dict[key] ?? ja[key] ?? key, vars);
}

/**
 * 質問・選択肢・説明文・記号の名前など、日本語の文そのものをキーにした訳（data-xx.ts）から引く。
 * 訳が無ければ日本語のまま。図面に印刷される文字は、これでは訳さない（日本語のまま）。
 */
export function dataTranslator(lang: Lang): (text: string) => string {
  const dict = lang === 'ja' ? undefined : DATA[lang];
  return (text) => dict?.[text] ?? text;
}

/**
 * いま選んでいる言葉。部品の外（通信の失敗の文言・図面の点検の文言など）で、言葉を引くのに使う。
 * 設定が変わるたびに、設定の部品が更新する。部品の中では、useT() を使う。
 */
let currentLang: Lang = 'ja';
export function setCurrentLang(lang: Lang): void {
  currentLang = lang;
}
export function getCurrentLang(): Lang {
  return currentLang;
}
/** 部品の外で、いま選んでいる言葉の文言を引く */
export function tr(key: Key, vars?: Vars): string {
  return translator(currentLang)(key, vars);
}
/** 部品の外で、質問・選択肢・説明文・記号の名前などを、いま選んでいる言葉にする */
export function trData(text: string): string {
  return dataTranslator(currentLang)(text);
}

/** 辞書の、その接頭辞（srv. など）で始まる言葉の日本語（文の型）。session/serverMessages.ts が使う */
export function templatesOf(prefix: string): [Key, string][] {
  return (Object.keys(ja) as Key[]).filter((k) => k.startsWith(prefix)).map((k) => [k, ja[k]]);
}

/** 検証用：言語ごとの辞書（ボタン・案内・メッセージ） */
export function dictionaryOf(lang: Lang): Record<string, string> {
  return DICTS[lang] as Record<string, string>;
}
/** 検証用：言語ごとの、質問・選択肢・説明文・記号の名前の訳 */
export function dataOf(lang: Exclude<Lang, 'ja'>): Record<string, string> {
  return DATA[lang];
}
