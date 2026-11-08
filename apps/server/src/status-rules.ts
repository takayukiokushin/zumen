/**
 * サーバーの状態を、管理者に見せるときの決まり（データベース・ファイルには触れない。計算と判断だけ）。
 *
 * 管理用の帯で知らせる条件：
 *   ・控えが、BACKUP_STALE_DAYS 日（2日）以上、取れていない（まだ1つも無い・保存先が決まっていない場合も含む）
 *   ・ディスクの空きが、DISK_LOW_PERCENT %（10%）以下
 *   ・直近の控えが、失敗している
 * エラーの件数は、状態の画面に出すだけで、帯では知らせない。
 */

/** 控えが、この日数以上取れていなければ、知らせる */
export const BACKUP_STALE_DAYS = 2;
/** ディスクの空きが、この割合（%）以下なら、知らせる */
export const DISK_LOW_PERCENT = 10;

const DAY_MS = 24 * 3600 * 1000;

export type WarningCode = 'backup-not-configured' | 'backup-none' | 'backup-stale' | 'backup-failed' | 'disk-low' | 'backup-disk-low';

export interface Warning {
  code: WarningCode;
  /** 文に入れる数（日数・割合など） */
  n?: number;
}

export interface DiskInfo {
  freeBytes: number;
  totalBytes: number;
  /** 空きの割合（%）。小数第1位まで */
  freePercent: number;
}

export interface JudgeInput {
  now: number;
  /** 控えの保存先が決まっているか（.env の BACKUP_DIR） */
  backupConfigured: boolean;
  /** いちばん新しい控えの時刻（ミリ秒）。1つも無ければ null */
  lastBackupAt: number | null;
  /** 直近の控えの失敗（そのあと成功していなければ残る）。無ければ null */
  lastFailure: { at: number } | null;
  disk: DiskInfo | null;
  backupDisk: DiskInfo | null;
}

/** 空きの割合を求める（合計が分からない・0 のときは null） */
export function diskInfo(freeBytes: number, totalBytes: number): DiskInfo | null {
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  return { freeBytes, totalBytes, freePercent: Math.round((freeBytes / totalBytes) * 1000) / 10 };
}

/** 帯で知らせることを、重要なものから並べる */
export function judge(i: JudgeInput): Warning[] {
  const out: Warning[] = [];
  if (!i.backupConfigured) out.push({ code: 'backup-not-configured' });
  else if (i.lastBackupAt === null) out.push({ code: 'backup-none' });
  else {
    const days = Math.floor((i.now - i.lastBackupAt) / DAY_MS);
    if (days >= BACKUP_STALE_DAYS) out.push({ code: 'backup-stale', n: days });
  }
  if (i.lastFailure) out.push({ code: 'backup-failed' });
  if (i.disk && i.disk.freePercent <= DISK_LOW_PERCENT) out.push({ code: 'disk-low', n: i.disk.freePercent });
  if (i.backupDisk && i.backupDisk.freePercent <= DISK_LOW_PERCENT) out.push({ code: 'backup-disk-low', n: i.backupDisk.freePercent });
  return out;
}

export interface ErrorCounts {
  last24h: number;
  last7d: number;
  /** 最後に起きた時刻（ミリ秒）。1件も無ければ null */
  lastAt: number | null;
}

/**
 * 記録ファイル（error.log）の文から、エラーの件数を数える。
 * 1件は「[2026-11-03 14:05:09] 種類 …」で始まる行（日本時間）。続きの行（どこで起きたか）は数えない。
 */
export function countErrors(logText: string, now: number): ErrorCounts {
  let last24h = 0;
  let last7d = 0;
  let lastAt: number | null = null;
  const re = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\] /gm;
  for (const m of logText.matchAll(re)) {
    const at = Date.parse(`${m[1]}T${m[2]}+09:00`);
    if (!Number.isFinite(at)) continue;
    if (lastAt === null || at > lastAt) lastAt = at;
    const age = now - at;
    if (age <= 7 * DAY_MS) last7d++;
    if (age <= DAY_MS) last24h++;
  }
  return { last24h, last7d, lastAt };
}
