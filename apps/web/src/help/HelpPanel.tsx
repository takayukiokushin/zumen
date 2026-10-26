import { useT } from '../i18n/useT.ts';
import type { Key } from '../i18n/index.ts';
import { useEscapeToClose } from '../useEscapeToClose.ts';

/**
 * 使い方（ボタンと画面の動きの説明）。
 * 操作の手順書ではなく、迷いやすいボタンと動きだけを短く説明する。
 * 文章は i18n に置いてある（help.1.t / help.1.b …）。
 */

const TOPICS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEscapeToClose(onClose);
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
          {TOPICS.map((n) => (
            <div key={n} className="help-item">
              <h3>{t(`help.${n}.t` as Key)}</h3>
              <p>{t(`help.${n}.b` as Key)}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
