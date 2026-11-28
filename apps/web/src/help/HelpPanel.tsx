import { useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import type { Key } from '../i18n/index.ts';
import { useEscapeToClose } from '../useEscapeToClose.ts';

/**
 * 使い方（ボタンと画面の動きの説明）。
 * 操作の手順書ではなく、迷いやすいボタンと動きだけを短く説明する。
 * 文章は i18n に置いてある（help.1.t / help.1.b …）。
 *
 * 上に、「言葉で探す」欄と目次を置く（第21弾 項目19の10）。
 * 探す：空白で区切った言葉を、すべて含む説明だけを残す（全角・半角、大文字・小文字の違いは、区別しない）。
 * 目次：押すと、その説明に移る。
 */

const TOPICS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

/** 比べるための形にそろえる（全角・半角、大文字・小文字の違いをなくす） */
function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEscapeToClose(onClose);
  const [query, setQuery] = useState('');
  const refs = useRef(new Map<number, HTMLElement>());

  const shown = useMemo(() => {
    const words = fold(query)
      .split(/\s+/)
      .filter((w) => w !== '');
    if (words.length === 0) return [...TOPICS];
    return TOPICS.filter((n) => {
      const text = fold(`${t(`help.${n}.t` as Key)} ${t(`help.${n}.b` as Key)}`);
      return words.every((w) => text.includes(w));
    });
  }, [query, t]);

  const jump = (n: number) => {
    const el = refs.current.get(n);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }} role="dialog" aria-label={t('help.title')}>
        <header>
          <h2>{t('help.title')}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>
        <section className="help">
          <p className="hint">{t('help.lead')}</p>
          <div className="help-search">
            <input
              type="search"
              value={query}
              placeholder={t('help.search.placeholder')}
              aria-label={t('help.search.label')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {shown.length === 0 ? (
            <p className="help-nohit" role="status">
              {t('help.search.none')}
            </p>
          ) : (
            <>
              <p className="help-toc-cap">{query.trim() === '' ? t('help.toc') : t('help.search.count', { n: shown.length })}</p>
              <ol className="help-toc">
                {shown.map((n) => (
                  <li key={n}>
                    <button type="button" className="link-btn" onClick={() => jump(n)}>
                      {n}. {t(`help.${n}.t` as Key)}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          {shown.map((n) => (
            <div
              key={n}
              className="help-item"
              ref={(el) => {
                if (el) refs.current.set(n, el);
                else refs.current.delete(n);
              }}
            >
              <h3>{t(`help.${n}.t` as Key)}</h3>
              <p>{t(`help.${n}.b` as Key)}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
