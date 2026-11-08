import { useEffect, useState } from 'react';
import { api } from '../session/api.ts';
import type { ServerDisk, ServerStatus } from '../session/api.ts';
import { useT } from '../i18n/useT.ts';
import type { Key } from '../i18n/index.ts';

/** バイト数を、読みやすい大きさにする（1 GB = 1000 MB の目安でよい） */
export function formatBytes(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

const when = (ms: number) => new Date(ms).toLocaleString();

/** サーバーの状態の注意を、1行の文にする */
export function useWarningText() {
  const t = useT();
  return (w: ServerStatus['warnings'][number]) => t(`status.warn.${w.code}` as Key, { n: w.n ?? 0 });
}

/**
 * サーバーの状態（管理者のみ）。控えが取れているか・ディスクの空き・エラーの件数を、見るだけ。
 * 注意が必要なものは、赤い文で、先頭に出す。
 */
export function ServerStatusPanel() {
  const t = useT();
  const warnText = useWarningText();
  const [s, setS] = useState<ServerStatus | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    api
      .serverStatus()
      .then(setS)
      .catch(() => setError(true));
  };
  useEffect(load, []);

  const disk = (d: ServerDisk | null) => (d ? t('status.diskValue', { free: formatBytes(d.freeBytes), pct: d.freePercent }) : t('status.unknown'));
  const up = s ? Math.max(0, Math.floor((s.now - s.startedAt) / 60000)) : 0;

  return (
    <section className="server-status">
      <h3>{t('status.title')}</h3>
      {error && <p className="err">{t('status.loadError')}</p>}
      {!s && !error && <p className="hint">{t('common.loading')}</p>}
      {s && (
        <>
          {s.warnings.length > 0 && (
            <ul className="status-warn" role="alert">
              {s.warnings.map((w) => (
                <li key={w.code}>{warnText(w)}</li>
              ))}
            </ul>
          )}
          <table className="status-table">
            <tbody>
              <tr>
                <th>{t('status.backupLast')}</th>
                <td>
                  {!s.backup.configured
                    ? t('status.backupNotConfigured')
                    : s.backup.lastAt === null
                      ? t('status.backupNone')
                      : t('status.backupAt', { at: when(s.backup.lastAt), days: Math.floor((s.now - s.backup.lastAt) / 86400000) })}
                </td>
              </tr>
              {s.backup.configured && (
                <tr>
                  <th>{t('status.backupCount')}</th>
                  <td>{t('status.backupCountValue', { n: s.backup.count, keep: s.backup.keep })}</td>
                </tr>
              )}
              {s.backup.failure && (
                <tr>
                  <th>{t('status.backupFailed')}</th>
                  <td>{t('status.backupFailedValue', { at: when(s.backup.failure.at), msg: s.backup.failure.message })}</td>
                </tr>
              )}
              <tr>
                <th>{t('status.disk')}</th>
                <td>{disk(s.disk)}</td>
              </tr>
              {s.backup.configured && (
                <tr>
                  <th>{t('status.backupDisk')}</th>
                  <td>{disk(s.backupDisk)}</td>
                </tr>
              )}
              <tr>
                <th>{t('status.errors')}</th>
                <td>
                  {t('status.errorsValue', { a: s.errors.last24h, b: s.errors.last7d })}
                  {s.errors.lastAt !== null && <span className="hint">　{t('status.errorsLast', { at: when(s.errors.lastAt) })}</span>}
                </td>
              </tr>
              <tr>
                <th>{t('status.version')}</th>
                <td>{t('status.versionValue', { v: s.version, h: Math.floor(up / 60), m: up % 60 })}</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">{t('status.errorsHelp')}</p>
          <button type="button" className="btn" onClick={load}>
            {t('status.refresh')}
          </button>
        </>
      )}
    </section>
  );
}
