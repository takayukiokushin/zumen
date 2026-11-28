import { useT } from './i18n/useT.ts';
import { useSettings } from './settings/settings.tsx';

/**
 * 設備入力の「入力欄の説明を隠す／出す」ボタン（第21弾 項目19の12）。
 * 設定の「入力欄の下の説明文を隠す」（hideHelp）と、同じもの。どちらで切り替えても、もう一方に反映され、次に開いたときも覚えている。
 */
export function HelpToggle({ className = 'panel-toggle' }: { className?: string }) {
  const t = useT();
  const { settings, set } = useSettings();
  return (
    <button type="button" className={className} aria-pressed={settings.hideHelp} onClick={() => set('hideHelp', !settings.hideHelp)}>
      {settings.hideHelp ? t('hearing.showHelp') : t('hearing.hideHelp')}
    </button>
  );
}
