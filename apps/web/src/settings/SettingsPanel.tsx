import { LANGS, LANG_LABEL } from '../i18n/index.ts';
import type { Lang } from '../i18n/index.ts';
import { useT } from '../i18n/useT.ts';
import { TEXT_STEPS, UI_STEPS, useSettings } from './settings.tsx';
import type { Theme } from './settings.tsx';

/**
 * 表示の設定（⑮㉓㉔㉕）。
 * 言葉・明るさ・文字の大きさ・画面全体の大きさ・太字を、使う人ごとに決める。
 * 設定はこのブラウザに覚えさせるだけで、案件のデータには入らない。
 */

/** 段階の並びのうち、いまの値がどこかを返す（つまみの位置） */
function indexOf(steps: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs(steps[i]! - value) < Math.abs(steps[best]! - value)) best = i;
  }
  return best;
}

function SizeRow({
  label,
  steps,
  value,
  onChange,
}: {
  label: string;
  steps: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const i = indexOf(steps, value);
  return (
    <div className="settings-row">
      <span className="lbl">{label}</span>
      <div className="size-row">
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={i}
          aria-label={label}
          onChange={(e) => onChange(steps[Number(e.target.value)]!)}
        />
        <span className="val">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { settings, set, reset } = useSettings();

  const themes: [Theme, string][] = [
    ['light', t('settings.theme.light')],
    ['dark', t('settings.theme.dark')],
    ['auto', t('settings.theme.auto')],
  ];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <header>
          <h2>{t('settings.title')}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>

        <section>
          <div className="settings-row">
            <span className="lbl">{t('settings.lang')}</span>
            <div className="seg">
              {LANGS.map((l: Lang) => (
                <button
                  key={l}
                  type="button"
                  className="btn"
                  aria-pressed={settings.lang === l}
                  lang={l}
                  onClick={() => set('lang', l)}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">{t('settings.langNote')}</p>

          <div className="settings-row">
            <span className="lbl">{t('settings.theme')}</span>
            <div className="seg">
              {themes.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className="btn"
                  aria-pressed={settings.theme === v}
                  onClick={() => set('theme', v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SizeRow
            label={t('settings.textSize')}
            steps={TEXT_STEPS}
            value={settings.textScale}
            onChange={(v) => set('textScale', v)}
          />
          <SizeRow
            label={t('settings.uiSize')}
            steps={UI_STEPS}
            value={settings.uiScale}
            onChange={(v) => set('uiScale', v)}
          />
          <label className="switch wide">
            <input type="checkbox" checked={settings.bold} onChange={(e) => set('bold', e.target.checked)} />
            {t('settings.bold')}
          </label>
          <p className="hint">{t('settings.sizeNote')}</p>
          <p className="sample">{t('settings.preview')}</p>
        </section>

        <section>
          <button type="button" className="btn" onClick={reset}>
            {t('settings.reset')}
          </button>
        </section>
      </div>
    </div>
  );
}
