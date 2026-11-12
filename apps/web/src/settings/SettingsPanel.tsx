import { useEffect, useState } from 'react';
import { useT } from '../i18n/useT.ts';
import { Rich } from '../i18n/Rich.tsx';
import { api } from '../session/api.ts';
import { APP_VERSION, BUILD_DATE } from '../version.ts';
import { useEscapeToClose } from '../useEscapeToClose.ts';
import { LangSelect } from './LangSelect.tsx';
import { SCROLLBAR_SIZES, TEXT_STEPS, UI_STEPS, useSettings } from './settings.tsx';
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
  const t = useT();
  const i = indexOf(steps, value);
  // 「−」「+」は、段階を1つ動かす（10%）。いちばん下・いちばん上では、押せない
  const move = (d: number) => onChange(steps[Math.min(steps.length - 1, Math.max(0, i + d))]!);
  return (
    <div className="settings-row size-settings">
      <span className="lbl">{label}</span>
      <div className="size-row">
        <button
          type="button"
          className="btn step-btn"
          aria-label={`${label}: ${t('settings.sizeDown')}`}
          title={t('settings.sizeDown')}
          disabled={i <= 0}
          onClick={() => move(-1)}
        >
          −
        </button>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={i}
          aria-label={label}
          onChange={(e) => onChange(steps[Number(e.target.value)]!)}
        />
        <button
          type="button"
          className="btn step-btn"
          aria-label={`${label}: ${t('settings.sizeUp')}`}
          title={t('settings.sizeUp')}
          disabled={i >= steps.length - 1}
          onClick={() => move(1)}
        >
          +
        </button>
        <span className="val">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

type SettingsTab = 'basic' | 'detail';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  // 開くたびに「基本設定」から始める
  const [tab, setTab] = useState<SettingsTab>('basic');
  const { settings, set, reset } = useSettings();
  useEscapeToClose(onClose);

  // サーバーの版も見せる（画面とサーバーの版が違えば、画面が古いと分かる）
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  useEffect(() => {
    api
      .health()
      .then((h) => setServerVersion(h.version ?? null))
      .catch(() => setServerVersion(null));
  }, []);

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

        <div className="settings-tabs" role="tablist" aria-label={t('settings.tabs')}>
          {(['basic', 'detail'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`settings-panel-${id}`}
              onClick={() => setTab(id)}
            >
              {t(id === 'basic' ? 'settings.tab.basic' : 'settings.tab.detail')}
            </button>
          ))}
        </div>

        {tab === 'basic' && (
          <div role="tabpanel" id="settings-panel-basic" aria-labelledby="settings-tab-basic">
            <section>
              <div className="settings-row">
                <span className="lbl">{t('settings.lang')}</span>
                <LangSelect />
              </div>
              {/* 「日本語以外は参考訳です」などの注意書きは、一覧を開いたときだけ、一覧の下に出る（LangSelect） */}

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
          <label className="switch wide block">
            <input type="checkbox" checked={settings.bold} onChange={(e) => set('bold', e.target.checked)} />
            {t('settings.bold')}
          </label>
          <label className="switch wide block">
            <input type="checkbox" checked={settings.hideHelp} onChange={(e) => set('hideHelp', e.target.checked)} />
            {t('settings.hideHelp')}
          </label>
          <p className="hint">{t('settings.hideHelpNote')}</p>
          <p className="hint">{t('settings.sizeNote')}</p>
          <p className="sample">{t('settings.preview')}</p>
        </section>
          </div>
        )}

        {tab === 'detail' && (
          <div role="tabpanel" id="settings-panel-detail" aria-labelledby="settings-tab-detail">
            <section>
              <div className="settings-row">
                <span className="lbl">{t('settings.scrollbar')}</span>
                <div className="seg">
                  {SCROLLBAR_SIZES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="btn"
                      aria-pressed={settings.scrollbar === v}
                      onClick={() => set('scrollbar', v)}
                    >
                      {t(`settings.scrollbar.${v}`)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="hint">{t('settings.scrollbarNote')}</p>
            </section>
          </div>
        )}

        <section>
          <button type="button" className="btn" onClick={reset}>
            {t('settings.reset')}
          </button>
          <p className="hint version">
            {t('settings.version')}　{t('settings.version.screen')} {APP_VERSION}
            {BUILD_DATE && `（${BUILD_DATE}）`}　／　{t('settings.version.server')} {serverVersion ?? '—'}
          </p>
        </section>
      </div>
    </div>
  );
}
