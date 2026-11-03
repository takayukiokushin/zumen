import { getCurrentLang, templatesOf, tr, trData } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';

/**
 * サーバーが返す日本語の文を、選んでいる言葉にする。
 *
 * サーバーは日本語の文しか返さない。そこで、辞書の「srv.」で始まる言葉の日本語（{名前} の入った型）を、
 * 文の形に合わせる（型に合えば、その言葉の訳を、{名前} の部分を入れ替えて出す）。型に合わない文は、そのまま出す。
 * 日本語を選んでいるときは、何もしない。
 */
interface Entry {
  key: Key;
  re: RegExp;
}

const cache = new Map<string, Entry[]>();

/** 辞書の、その接頭辞（srv. など）で始まる言葉の日本語を、文の型にする */
const buildEntries = (prefix: string): Entry[] =>
  templatesOf(prefix).map(([key, ja]) => {
    const seen = new Set<string>();
    const body = ja
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const name = m[1]!;
        if (seen.has(name)) return `\\k<${name}>`;
        seen.add(name);
        return `(?<${name}>.+?)`;
      })
      .join('');
    return { key, re: new RegExp(`^${body}$`, 's') };
  });

const entriesOf = (prefix: string): Entry[] => {
  let e = cache.get(prefix);
  if (!e) {
    e = buildEntries(prefix);
    cache.set(prefix, e);
  }
  return e;
};

/** 辞書の、その接頭辞の言葉の型に合う文を、選んでいる言葉にする。合うものが無ければ null */
export function translateByTemplate(prefix: string, message: string): string | null {
  for (const e of entriesOf(prefix)) {
    const m = e.re.exec(message);
    if (m) return tr(e.key, (m.groups ?? {}) as Record<string, string>);
  }
  return null;
}

export function translateServerMessage(message: string): string {
  if (getCurrentLang() === 'ja') return message;
  return translateByTemplate('srv.', message) ?? message;
}

/**
 * 読み取り結果の「確認してほしいこと」の見出し・値・文章を、選んでいる言葉にする。
 * 型（rev.）に合うものは、その訳。質問の名前・選択肢は、質問の訳（trData）。どちらでもなければ、そのまま。
 */
export function translateReviewText(text: string): string {
  if (getCurrentLang() === 'ja') return text;
  return translateByTemplate('rev.', text) ?? trData(text);
}

/** 検証用：文が、その接頭辞のどの型にも合わないとき、null */
export function matchTemplate(prefix: string, message: string): Key | null {
  return entriesOf(prefix).find((e) => e.re.test(message))?.key ?? null;
}
