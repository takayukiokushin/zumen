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
  label: React.ReactNode;
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
  ['voice', 'tab.voice', 'tab.voice.help'],
  ['hearing', 'tab.hearing', 'tab.hearing.help'],
  ['drawing', 'tab.drawing', 'tab.drawing.help'],
];

/** 幅が狭くて、タブの名前を2行にするとき、改行する位置（前半・後半）。無いタブ（図面）は、改行しない */
const SPLIT: Partial<Record<Tab, [Key, Key]>> = {
  analyze: ['tab.analyze.l1', 'tab.analyze.l2'],
  voice: ['tab.voice.l1', 'tab.voice.l2'],
  hearing: ['tab.hearing.l1', 'tab.hearing.l2'],
};

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
  /** 別のタブを見ているあいだの、スケッチ読み取りの状態（タブの名前の横に出す） */
  analyzeStatus?: 'idle' | 'busy' | 'done';
}

export function TabBar({ user, tab, onTab, enabled, onSettings, onHelp, onUsers, onLogout, dirty = false, analyzeStatus = 'idle' }: Props) {
  const t = useT();
  const { ask } = useDialogs();
  /** タブの名前。改行の位置があるものは、前半と、後半（狭い画面では、後半を、2行目に出す）に分ける */
  const labelOf = (id: Tab, label: Key, suffix = ''): React.ReactNode => {
    const sp = SPLIT[id];
    if (!sp) return `${t(label)}${suffix}`;
    return (
      <>
        {t(sp[0])}
        <span className="tab-l2">
          {t(sp[1])}
          {suffix}
        </span>
      </>
    );
  };
  return (
    <div className="tabbar">
      {TABS.map(([id, label, help]) =>
        enabled ? (
          <Tab
            key={id}
            label={labelOf(id, label, id === 'analyze' && tab !== 'analyze' && analyzeStatus !== 'idle' ? t(analyzeStatus === 'busy' ? 'tab.analyze.busy' : 'tab.analyze.done') : '')}
            help={t(help)}
            pressed={tab === id}
            onClick={() => onTab(id)}
          />
        ) : (
          <button key={id} type="button" disabled>
            {labelOf(id, label)}
          </button>
        ),
      )}

      {/* 右側のまとまり。幅が足りないときは、まとまりごと2段目に回る（画面の外に出ない） */}
      <div className="tabbar-right">
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
        <span className="who-name">{user.name}</span>
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
    </div>
  );
}
