import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_CUSTOM_LAYERS } from '@zumen/knowledge';
import { useT } from '../i18n/useT.ts';
import { useEscapeToClose } from '../useEscapeToClose.ts';
import type { Key } from '../i18n/index.ts';
import type { LayerInfo } from './layers.ts';

/**
 * レイヤー（図面の種類）を切り替える、ドロップダウンのリスト。
 * 普段の編集の邪魔にならないよう、印刷のボタンの近くに置く。
 *
 *   単線結線図（いつもここから始まる）
 *   停電範囲図
 *   絶縁耐力試験範囲図
 *   追加したレイヤー（名前を変える・削除ができる）
 *   ＋ レイヤーを追加
 */

/** 固定のレイヤーの、画面の言葉（図面のタイトルは日本語のまま。ここは、選んでいる言葉に合わせる） */
export const FIXED_LAYER_KEY: Record<string, Key> = { outage: 'layer.outage', withstand: 'layer.withstand' };

export const layerLabel = (t: (k: Key) => string, info: LayerInfo): string =>
  info.fixed ? t(FIXED_LAYER_KEY[info.id] ?? 'layer.outage') : info.title;

interface Props {
  infos: LayerInfo[];
  /** 元の図面が変わっていて、まだ確認していないレイヤー */
  review?: ReadonlySet<string>;
  /** いま選んでいるレイヤー。null は単線結線図 */
  activeId: string | null;
  /** もう追加できないか（上限に達した） */
  full: boolean;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onRename: (id: string) => void;
  onRemove: (id: string) => void;
}

export function LayerMenu({ infos, review, activeId, full, onSelect, onAdd, onRename, onRemove }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = infos.find((i) => i.id === activeId) ?? null;
  const close = () => setOpen(false);

  return (
    <div className="layer-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn layer-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('layer.help')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="layer-trigger-cap">{t('layer.label')}</span>
        <span className="layer-trigger-name">{active ? layerLabel(t, active) : t('layer.base')}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <LayerPanel triggerRef={triggerRef} onClose={close}>
          <div className="layer-list" role="listbox" aria-label={t('layer.label')}>
            <div className="layer-row">
              <button
                type="button"
                role="option"
                aria-selected={activeId === null}
                className="layer-pick"
                onClick={() => {
                  onSelect(null);
                  close();
                }}
              >
                {t('layer.base')}
              </button>
            </div>
            {infos.map((i) => (
              <div className="layer-row" key={i.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={activeId === i.id}
                  className="layer-pick"
                  onClick={() => {
                    onSelect(i.id);
                    close();
                  }}
                >
                  {layerLabel(t, i)}
                  {review?.has(i.id) && <span className="layer-review-badge">{t('layer.review.badge')}</span>}
                </button>
                {!i.fixed && (
                  <>
                    <button
                      type="button"
                      className="btn layer-small"
                      onClick={() => {
                        close();
                        onRename(i.id);
                      }}
                    >
                      {t('layer.rename')}
                    </button>
                    <button
                      type="button"
                      className="btn layer-small danger"
                      onClick={() => {
                        close();
                        onRemove(i.id);
                      }}
                    >
                      {t('layer.remove')}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="layer-add-row">
            <button
              type="button"
              className="btn"
              disabled={full}
              title={full ? t('layer.full', { n: MAX_CUSTOM_LAYERS }) : undefined}
              onClick={() => {
                close();
                onAdd();
              }}
            >
              {t('layer.add')}
            </button>
            {full && <span className="layer-full-note">{t('layer.full', { n: MAX_CUSTOM_LAYERS })}</span>}
          </div>
        </LayerPanel>
      )}
    </div>
  );
}

/**
 * 開いている間だけ：Esc・外側のクリックで閉じる。
 * 上のボタンの帯は、はみ出した部分を隠すので、一覧は、帯の外（ページの直下）に、ボタンの真下の位置で出す。
 * 画面がスクロールされたり、大きさが変わったときは、閉じずに、ボタンの真下に付け直す（スマホでは、開いた拍子に画面が動くことがある）。
 */
function LayerPanel({ triggerRef, onClose, children }: { triggerRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void; children: React.ReactNode }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    const w = panelRef.current?.offsetWidth ?? 0;
    if (!r) return;
    // 右にはみ出さないように寄せる（スマホなど、幅の狭い画面）
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
  };
  useLayoutEffect(place, []);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node;
      if (panelRef.current?.contains(el) || triggerRef.current?.contains(el)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerRef, onClose]);
  return createPortal(
    <div className="layer-panel" ref={panelRef} style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
