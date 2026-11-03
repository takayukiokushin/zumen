import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, db } from './db.ts';
import { DEFAULT_TIMEZONE, KEEP, dayOf, msUntilMidnight, pickToDelete, stamp, validTimezone } from './backup-rules.ts';

/**
 * 案件を別の場所に写す（控え）。
 *
 * 保存先をドロップボックスなどの同期フォルダにしておけば、そのままクラウドに上がる。
 * データベースは使用中に直接コピーすると壊れた写しができることがあるので、
 * SQLite自身に「今の状態の、きれいな写しを1つ作らせる」（VACUUM INTO）。
 *
 * 写すのは案件と利用者のデータ（zumen.db）だけ。読み取りに使った写真・PDFは、保存しない決まりなので、写さない。
 * 毎日午前0時に1つ作り、10日分残す（決まりは backup-rules.ts）。
 */

/** 控えの日付・時刻に使う時間帯。標準は日本時間 */
const requested = process.env.BACKUP_TIMEZONE?.trim();
const TIMEZONE = requested && validTimezone(requested) ? requested : DEFAULT_TIMEZONE;
if (requested && TIMEZONE !== requested) {
  console.error(`BACKUP_TIMEZONE「${requested}」は使えない名前です。${DEFAULT_TIMEZONE} を使います。`);
}

export interface BackupResult {
  dir: string;
  bytes: number;
}

/** 1回分の写しを作る。返り値は作った場所 */
export function backup(destRoot: string): BackupResult {
  const root = resolve(destRoot);
  mkdirSync(root, { recursive: true });

  const dir = resolve(root, stamp(new Date(), TIMEZONE));
  // 同じ秒に二度実行された場合に備えて、いちど消してから作る
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // データベースのきれいな写し（書き込み中でも整合が取れた1ファイルになる）
  const dbCopy = resolve(dir, 'zumen.db');
  db.exec(`VACUUM INTO '${dbCopy.replaceAll("'", "''")}'`);

  prune(root);
  return { dir, bytes: statSync(dbCopy).size };
}

/** 古い写しを間引く（同じ日は新しい1つだけ、新しい日から10日分） */
function prune(root: string): void {
  for (const old of pickToDelete(readdirSync(root))) rmSync(resolve(root, old), { recursive: true, force: true });
}

/** 今日（控えの時間帯での今日）の控えが、もうあるか */
function hasBackupOfToday(root: string): boolean {
  if (!existsSync(root)) return false;
  const today = dayOf(new Date(), TIMEZONE);
  return readdirSync(root).some((n) => /^\d{8}-\d{6}$/.test(n) && n.startsWith(today));
}

/**
 * 毎日、日付が変わった瞬間（午前0時）に、自動で写しを作る。
 * .env に BACKUP_DIR を書いてあるときだけ動く。
 * サーバーを起動したとき、今日の分がまだ無ければ、すぐ1つ作る（0時にサーバーが止まっていたときの補い）。
 */
export function startAutoBackup(): void {
  const dest = process.env.BACKUP_DIR;
  if (!dest) return;

  const run = () => {
    try {
      const r = backup(dest);
      console.log(`控えを作りました: ${r.dir}`);
    } catch (e) {
      console.error('控えを作れませんでした:', e instanceof Error ? e.message : e);
    }
  };

  if (!hasBackupOfToday(dest)) run();

  // 次の午前0時に動き、その次の0時を、また予約する（24時間ごとの繰り返しにすると、ずれていく）
  const arm = () => {
    const timer = setTimeout(() => {
      run();
      arm();
    }, msUntilMidnight(new Date(), TIMEZONE));
    timer.unref?.();
  };
  arm();
  console.log(`控えの保存先: ${resolve(dest)}（毎日午前0時・${KEEP}日分まで。時刻は ${TIMEZONE}）`);
}

/** 保存先の案内。DATA_DIR を教えるのは「元はここにある」と分かるように */
export const sourceDir = DATA_DIR;
