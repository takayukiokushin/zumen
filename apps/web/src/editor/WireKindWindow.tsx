import { useT } from '../i18n/useT.ts';
import { FloatingWindow } from './FloatingWindow.tsx';
import type { Pos } from './FloatingWindow.tsx';

export type { Pos };

/**
 * 「線を引く」のあいだ、図面の上に出す、線の種類（実線・点線）を選ぶ小さな窓。
 *
 * - 画面の上の道具の並び（レイアウト）は、変えない。窓は、図面の上に、重ねて出す。
 * - 上の帯をつかんで、ドラッグすると、窓を、好きな所へ動かせる（線をたくさん引くとき、種類を選び直しに、画面の上まで戻らなくてよい）。
 * - 左上の「×」を押すと、窓が消えて、線を引くのも終わる。
 * 動かせる窓の部分は、文字の設定の窓（TextWindow）と共通（FloatingWindow）。
 */
export function WireKindWindow({
  dashed,
  onChange,
  onClose,
  pos,
  onPos,
  anchor,
}: {
  dashed: boolean;
  onChange: (dashed: boolean) => void;
  onClose: () => void;
  /** 前に動かした位置。まだ動かしていないときは null（図面の左上に出す） */
  pos: Pos | null;
  onPos: (p: Pos) => void;
  /** 初めて出す位置の目安にする要素（図面を置く場所） */
  anchor: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  return (
    <FloatingWindow
      title={t('editor.lineKind')}
      closeLabel={t('editor.wireWindowClose')}
      dragHint={t('editor.wireWindowDrag')}
      onClose={onClose}
      pos={pos}
      onPos={onPos}
      anchor={anchor}
    >
      <div className="wire-window-body" role="group" aria-label={t('editor.lineKind')}>
        {([false, true] as const).map((d) => (
          <button
            key={String(d)}
            type="button"
            className="line-kind"
            aria-pressed={dashed === d}
            title={t(d ? 'editor.lineDashed' : 'editor.lineSolid')}
            aria-label={t(d ? 'editor.lineDashed' : 'editor.lineSolid')}
            onClick={() => onChange(d)}
          >
            <svg width="44" height="10" viewBox="0 0 44 10" aria-hidden="true">
              <line x1="2" y1="5" x2="42" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={d ? '6 4' : undefined} />
            </svg>
            <span>{t(d ? 'editor.lineDashedShort' : 'editor.lineSolid')}</span>
          </button>
        ))}
      </div>
    </FloatingWindow>
  );
}
