import { MAX_TEXT_LENGTH } from '@zumen/knowledge';
import { useT } from '../i18n/useT.ts';
import { FloatingWindow } from './FloatingWindow.tsx';
import type { Pos } from './FloatingWindow.tsx';
import { TextStyleControls } from './TextStyleControls.tsx';

/**
 * 図面に書く文字（「メモを追加」で置いた文字）の設定を、図面の上に重ねて出す小さな窓（第13弾 項目38）。
 * 文字の内容・大きさ・太字（レイヤーの文字は、色も）を、ここで変える。上の帯をつかんで、好きな所へ動かせる。
 * 「×」を押すと、窓が閉じる（文字の選びも外れる）。
 */
export function TextWindow({
  lines,
  onLines,
  size,
  bold,
  red,
  onSize,
  onBold,
  onRed,
  onClose,
  pos,
  onPos,
  anchor,
}: {
  lines: string[];
  onLines: (lines: string[]) => void;
  size: number | undefined;
  bold: boolean;
  /** レイヤーの文字のとき、赤か。元の図面の文字のときは null（色は選べない） */
  red: boolean | null;
  onSize: (n: number) => void;
  onBold: (b: boolean) => void;
  onRed: (b: boolean) => void;
  onClose: () => void;
  pos: Pos | null;
  onPos: (p: Pos) => void;
  anchor: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  return (
    <FloatingWindow
      title={t('editor.textWindow')}
      closeLabel={t('editor.textWindowClose')}
      dragHint={t('editor.wireWindowDrag')}
      className="text-window"
      onClose={onClose}
      pos={pos}
      onPos={onPos}
      anchor={anchor}
    >
      <div className="text-window-body">
        <label className="lbl" htmlFor="text-window-lines">
          {t('editor.note')}
        </label>
        <textarea id="text-window-lines" rows={3} maxLength={MAX_TEXT_LENGTH} value={lines.join('\n')} onChange={(e) => onLines(e.target.value.split('\n'))} />
        <TextStyleControls size={size} bold={bold} red={red} onSize={onSize} onBold={onBold} onRed={onRed} />
      </div>
    </FloatingWindow>
  );
}
