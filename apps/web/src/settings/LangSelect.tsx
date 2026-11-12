import { useEffect, useRef, useState } from 'react';
import { LANGS, LANG_LABEL } from '../i18n/index.ts';
import type { Lang } from '../i18n/index.ts';
import { Rich } from '../i18n/Rich.tsx';
import { useT } from '../i18n/useT.ts';
import { useSettings } from './settings.tsx';

/**
 * 言語を選ぶドロップダウン（ログイン画面と、設定の「基本設定」で、同じものを使う）。
 *
 * ふだんは、いま選んでいる言語だけが見える。押すと、言語の一覧が開く。
 * 「日本語以外は参考訳です」「図面に印刷される文字は、日本語のままです」という注意書きは、
 * **一覧を開いたときだけ**、一覧の下に出る（ふだんは何も出さない）。
 *
 * 一覧は、Esc キー・一覧の外を押す・言語を選ぶ、のどれかで閉じる。
 * 設定の窓の中でも、Esc は、まず一覧だけを閉じる（窓は閉じない）。
 */
export function LangSelect() {
  const t = useT();
  const { settings, set } = useSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Esc は、窓を閉じる処理より先に受けて、「処理済み」にする（日本語入力の変換中は、触らない）
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const pick = (l: Lang) => {
    set('lang', l);
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="lang-select" ref={box}>
      <button
        ref={button}
        type="button"
        className="btn lang-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('settings.lang')}
        onClick={() => setOpen((v) => !v)}
      >
        <span lang={settings.lang}>{LANG_LABEL[settings.lang]}</span>
        <span className="lang-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="lang-pop">
          <ul className="lang-list" role="listbox" aria-label={t('settings.lang')}>
            {LANGS.map((l: Lang) => (
              <li key={l} role="option" aria-selected={settings.lang === l}>
                <button type="button" className="lang-opt" lang={l} onClick={() => pick(l)} autoFocus={settings.lang === l}>
                  <span className="lang-check" aria-hidden="true">
                    {settings.lang === l ? '✓' : ''}
                  </span>
                  {LANG_LABEL[l]}
                </button>
              </li>
            ))}
          </ul>
          <p className="hint ref-note">
            <Rich text={t('settings.langRef')} />
          </p>
          <p className="hint">{t('settings.langNote')}</p>
        </div>
      )}
    </div>
  );
}
