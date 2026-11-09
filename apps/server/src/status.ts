import { existsSync, readFileSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from './data-dir.ts';
import { ERROR_LOG } from './errors.ts';
import { KEEP } from './backup-rules.ts';
import { SERVER_VERSION } from './version.ts';
import { countErrors, diskInfo, judge } from './status-rules.ts';
import type { DiskInfo, ErrorCounts, Warning } from './status-rules.ts';

/**
 * サーバーの状態（管理者の画面に見せる）。控え・ディスクの空き・エラーの件数。
 * 見るだけで、何も変えない。パスワードや案件の中身は含めない。
 */

const startedAt = Date.now();

/** 直近の控えの失敗（そのあとで成功したら、消える） */
let lastFailure: { at: number; message: string } | null = null;
export const recordBackupFailure = (message: string): void => {
  lastFailure = { at: Date.now(), message: message.slice(0, 200) };
};
export const recordBackupSuccess = (): void => {
  lastFailure = null;
};

function diskOf(path: string): DiskInfo | null {
  try {
    const s = statfsSync(path);
    return diskInfo(Number(s.bavail) * Number(s.bsize), Number(s.blocks) * Number(s.bsize));
  } catch {
    return null;
  }
}

/** 控えのフォルダ（20260918-143205 の形のもの）の数と、いちばん新しいものの時刻 */
function backupsIn(dir: string): { count: number; lastAt: number | null } {
  try {
    if (!existsSync(dir)) return { count: 0, lastAt: null };
    // 中身（zumen.db）の無いものは、控えとして数えない
    const names = readdirSync(dir).filter((n) => /^\d{8}-\d{6}$/.test(n) && existsSync(resolve(dir, n, 'zumen.db')));
    let lastAt: number | null = null;
    for (const n of names) {
      const t = statSync(resolve(dir, n)).mtimeMs;
      if (lastAt === null || t > lastAt) lastAt = Math.round(t);
    }
    return { count: names.length, lastAt };
  } catch {
    return { count: 0, lastAt: null };
  }
}

function errorCounts(now: number): ErrorCounts {
  let text = '';
  for (const f of [`${ERROR_LOG}.1`, ERROR_LOG]) {
    try {
      if (existsSync(f)) text += readFileSync(f, 'utf8');
    } catch {
      // 読めないときは、数えない
    }
  }
  return countErrors(text, now);
}

export interface ServerStatus {
  now: number;
  version: string;
  startedAt: number;
  backup: { configured: boolean; lastAt: number | null; count: number; keep: number; failure: { at: number; message: string } | null };
  disk: DiskInfo | null;
  backupDisk: DiskInfo | null;
  errors: ErrorCounts;
  warnings: Warning[];
}

export function serverStatus(now: number = Date.now()): ServerStatus {
  const dest = process.env.BACKUP_DIR?.trim() || '';
  const b = dest ? backupsIn(dest) : { count: 0, lastAt: null };
  const disk = diskOf(DATA_DIR);
  const backupDisk = dest && existsSync(dest) ? diskOf(dest) : null;
  return {
    now,
    version: SERVER_VERSION,
    startedAt,
    backup: { configured: Boolean(dest), lastAt: b.lastAt, count: b.count, keep: KEEP, failure: lastFailure },
    disk,
    backupDisk,
    errors: errorCounts(now),
    warnings: judge({ now, backupConfigured: Boolean(dest), lastBackupAt: b.lastAt, lastFailure, disk, backupDisk }),
  };
}
