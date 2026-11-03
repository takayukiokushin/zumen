import { Fragment } from 'react';

/**
 * 辞書の文の中の <b>…</b>（太字）と <code>…</code>（等幅）だけを、画面の部品にする。
 * ほかの文字は、そのまま文字として出す（外から来た文字を、画面の部品として読むことはしない）。
 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(<b>.*?<\/b>|<code>.*?<\/code>)/s);
  return (
    <>
      {parts.map((p, i) => {
        const b = /^<b>(.*)<\/b>$/s.exec(p);
        if (b) return <b key={i}>{b[1]}</b>;
        const c = /^<code>(.*)<\/code>$/s.exec(p);
        if (c) return <code key={i}>{c[1]}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
