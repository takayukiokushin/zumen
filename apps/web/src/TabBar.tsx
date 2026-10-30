import type { User } from './session/api.ts';
import { useDialogs } from './Dialogs.tsx';
import { useT } from './i18n/useT.ts';
import type { Key } from './i18n/index.ts';
import { GearIcon, InfoIcon } from './icons.tsx';

/**
 * 上の帯。左にタブ、右端に社名・設定・ログアウト（㉙）。
 * タブはしばらくカーソルを置くと説明が出る（㉘。出し方は Tooltips.tsx）。
 */

function Tab({
  label,
  help,
  pressed,
  onClick,
}: {
  label: string;
  help: string;
  pressed: boolean;
  onClick: () => void;
}) {
  // 説明は、アプリ全体の吹き出し（Tooltips.tsx）が、カーソルを合わせて1秒後に出す
  return (
    <span className="tab-wrap">
      <button type="button" aria-pressed={pressed} data-tip={help} onClick={onClick}>
        {label}
      </button>
    </span>
  );
}

export type Tab = 'analyze' | 'hearing' | 'voice' | 'drawing';

const TABS: [Tab, Key, Key][] = [
  ['analyze', 'tab.analyze', 'tab.analyze.help'],
  ['hearing', 'tab.hearing', 'tab.hearing.help'],
  ['voice', 'tab.voice', 'tab.voice.help'],
  ['drawing', 'tab.drawing', 'tab.drawing.help'],
];

interface Props {
  user: User;
  tab: Tab;
  onTab: (t: Tab) => void;
  /** 案件を開いていないときはタブを押せない */
  enabled: boolean;
  onSettings: () => void;
  onHelp: () => void;
  onUsers: () => void;
  onLogout: () => void;
  /** 開いている案件に、保存していない変更があるか（ログアウトの確認に使う） */
  dirty?: boolean;
}

export function TabBar({ user, tab, onTab, enabled, onSettings, onHelp, onUsers, onLogout, dirty = false }: Props) {
  const t = useT();
  const { ask } = useDialogs();
  return (
    <div className="tabbar">
      <span className="title">{t('app.name')}</span>

      {TABS.map(([id, label, help]) =>
        enabled ? (
          <Tab key={id} label={t(label)} help={t(help)} pressed={tab === id} onClick={() => onTab(id)} />
        ) : (
          <button key={id} type="button" disabled>
            {t(label)}
          </button>
        ),
      )}

      <span className="spacer" />

      <button type="button" className="icon-btn" title={t('help.button')} onClick={onHelp}>
        <InfoIcon size={1.6} />
        <span>{t('help.button')}</span>
      </button>
      <button type="button" className="icon-btn" title={t('nav.settings')} aria-label={t('nav.settings')} onClick={onSettings}>
        <GearIcon size={1.6} />
        <span>{t('nav.settings.label')}</span>
      </button>
      {user.role === 'admin' && (
        <button type="button" onClick={onUsers}>
          {t('nav.users')}
        </button>
      )}
      <span className="who">
        {user.name}
        <span className={`role role-${user.role}`}>{t(`role.${user.role}`)}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          // 保存していない変更があるときは、それが消えることを先に伝える
          void ask({ title: t('nav.logout'), message: [t(dirty ? 'nav.logout.confirmUnsaved' : 'nav.logout.confirm')], confirmLabel: t('nav.logout') }).then((yes) => {
            if (yes) onLogout();
          });
        }}
      >
        {t('nav.logout')}
      </button>
    </div>
  );
}
