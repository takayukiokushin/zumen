import { useEffect, useRef, useState } from 'react';
import type { User } from './session/api.ts';
import { useT } from './i18n/useT.ts';
import type { Key } from './i18n/index.ts';
import { GearIcon, InfoIcon } from './icons.tsx';

/**
 * 上の帯。左にタブ、右端に社名・設定・ログアウト（㉙）。
 * タブはしばらくカーソルを置くと説明が出る（㉘）。
 */

/** 説明が出るまでの待ち時間 */
const TIP_DELAY = 1000;

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
  const [tip, setTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  return (
    <span className="tab-wrap">
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => {
          cancel();
          setTip(false);
          onClick();
        }}
        onMouseEnter={() => {
          cancel();
          timer.current = setTimeout(() => setTip(true), TIP_DELAY);
        }}
        onMouseLeave={() => {
          cancel();
          setTip(false);
        }}
        // キーボードで選んでいる人には、待たずに出す
        onFocus={() => setTip(true)}
        onBlur={() => {
          cancel();
          setTip(false);
        }}
      >
        {label}
      </button>
      {tip && (
        <span className="tip" role="tooltip">
          {help}
        </span>
      )}
    </span>
  );
}

export type Tab = 'analyze' | 'hearing' | 'drawing';

const TABS: [Tab, Key, Key][] = [
  ['analyze', 'tab.analyze', 'tab.analyze.help'],
  ['hearing', 'tab.hearing', 'tab.hearing.help'],
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
          if (window.confirm(t(dirty ? 'nav.logout.confirmUnsaved' : 'nav.logout.confirm'))) onLogout();
        }}
      >
        {t('nav.logout')}
      </button>
    </div>
  );
}
