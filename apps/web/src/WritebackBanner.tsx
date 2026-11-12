import { useState } from 'react';
import { useT, useTx } from './i18n/useT.ts';
import type { Key } from './i18n/useT.ts';
import type { AppliedChange, Leftover, RejectedChange } from './editor/writeback.ts';

/**
 * 図面で直した内容を入力に書き戻したときの知らせ（「設備を入力して作成」の画面の上に出す）。
 *   ・書き戻した内容（「取り消す」で、書き戻す前に戻せる）
 *   ・ほかの記号も変わるため、書き戻さなかった変更
 *   ・入力画面には出ないので、図面にだけ残る変更の件数（「内容を見る」で一覧）
 */
export function WritebackBanner({
  applied,
  rejected,
  leftovers,
  onUndo,
  onClose,
}: {
  applied: AppliedChange[];
  rejected: RejectedChange[];
  leftovers: Leftover[];
  onUndo: (() => void) | null;
  onClose: () => void;
}) {
  const t = useT();
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const total = leftovers.reduce((n, l) => n + l.n, 0);
  return (
    <div className="wb" role="status">
      {applied.length > 0 && (
        <div className="bar-update wb-row">
          <b>{t('wb.applied.title', { n: applied.length })}</b>
          <span>{t('wb.applied.note')}</span>
          {onUndo && (
            <button type="button" className="btn" onClick={onUndo}>
              {t('wb.undo')}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {t('wb.close')}
          </button>
          <ul className="wb-list">
            {applied.map((a, i) => (
              <li key={i}>
                {tx(a.question)}
                {a.unit > 0 ? t('wb.unit', { n: a.unit }) : ''}：{tx(a.from)} → {tx(a.to)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rejected.length > 0 && (
        <div className="bar-warn wb-row">
          <ul className="wb-list">
            {rejected.map((r, i) => (
              <li key={i}>{t(`wb.rej.${r.kind}` as Key, { name: tx(r.symbol) })}</li>
            ))}
          </ul>
        </div>
      )}
      {total > 0 && (
        <div className="bar-update wb-row">
          <span>{t('wb.left.title', { n: total })}</span>
          <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? t('wb.left.hide') : t('wb.left.show')}
          </button>
          {applied.length === 0 && (
            <button type="button" className="btn" onClick={onClose}>
              {t('wb.close')}
            </button>
          )}
          {open && (
            <ul className="wb-list">
              {leftovers.map((l) => (
                <li key={l.kind}>{t(`wb.left.${l.kind}` as Key, { n: l.n })}</li>
              ))}
              <li>{t('wb.left.note')}</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
