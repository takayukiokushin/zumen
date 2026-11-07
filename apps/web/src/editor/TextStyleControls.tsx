import { TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP, clampTextSize } from '@zumen/layout';
import { useT } from '../i18n/useT.ts';

/**
 * 手で足した文字（テキストボックス）の、大きさ・太字・色を変える欄。
 *
 * 大きさは、記号の横の文字（VCB・LBS など）を「標準」（いちばん小さい）として、5倍まで。
 * 縦横の比は変えず、全体の大きさだけが変わる。色は、レイヤーに置いた文字だけ、黒と赤から選べる（red が null のときは、色の欄を出さない）。
 */
export function TextStyleControls({
  size,
  bold,
  red,
  onSize,
  onBold,
  onRed,
}: {
  size: number | undefined;
  bold: boolean;
  /** レイヤーの文字のとき、赤か。元の図面の文字のときは null（色は選べない） */
  red: boolean | null;
  onSize: (n: number) => void;
  onBold: (b: boolean) => void;
  onRed: (b: boolean) => void;
}) {
  const t = useT();
  const k = clampTextSize(size);
  const label = k === TEXT_SIZE_MIN ? t('textStyle.standard') : t('textStyle.times', { n: String(Math.round(k * 100) / 100) });
  return (
    <div className="text-style">
      <label className="lbl" htmlFor="text-size">
        {t('textStyle.size')}
      </label>
      <div className="size-row">
        <button type="button" className="btn size-step" aria-label={t('textStyle.smaller')} title={t('textStyle.smaller')} disabled={k <= TEXT_SIZE_MIN} onClick={() => onSize(k - TEXT_SIZE_STEP)}>
          −
        </button>
        <input
          id="text-size"
          type="range"
          min={TEXT_SIZE_MIN}
          max={TEXT_SIZE_MAX}
          step={TEXT_SIZE_STEP}
          value={k}
          aria-valuetext={label}
          onChange={(e) => onSize(Number(e.target.value))}
        />
        <button type="button" className="btn size-step" aria-label={t('textStyle.larger')} title={t('textStyle.larger')} disabled={k >= TEXT_SIZE_MAX} onClick={() => onSize(k + TEXT_SIZE_STEP)}>
          ＋
        </button>
      </div>
      <div className="size-ends">
        <span>{t('textStyle.small')}</span>
        <span className="size-readout">{label}</span>
        <span>{t('textStyle.large')}</span>
      </div>
      <p className="hint">{t('textStyle.help')}</p>
      <div className="seg text-style-row" role="group" aria-label={t('textStyle.bold')}>
        <button type="button" className="btn" aria-pressed={bold} onClick={() => onBold(!bold)}>
          <b>{t('textStyle.bold')}</b>
        </button>
      </div>
      {red !== null && (
        <>
          <label className="lbl">{t('textStyle.color')}</label>
          <div className="seg text-style-row" role="group" aria-label={t('textStyle.color')}>
            <button type="button" className="btn" aria-pressed={!red} onClick={() => onRed(false)}>
              {t('textStyle.black')}
            </button>
            <button type="button" className="btn" aria-pressed={red} onClick={() => onRed(true)}>
              <span className="red-word">{t('textStyle.red')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
