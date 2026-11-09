import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { DATA_DIR, db } from './db.ts';
import { recordBackupFailure, recordBackupSuccess } from './status.ts';
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

/** 作っている途中の写しの置き場所の印（控えの名前の形ではないので、控えとしては数えられず、間引きの対象にもならない） */
const PARTIAL = '.作成中';
/** 消している途中のものの置き場所の印（同じ理由で、控えとしては数えない） */
const GONE = '.削除中';

/**
 * フォルダを消す。いきなり消さず、まず名前を「削除中」に変えてから消す。
 * 消している途中で止まっても（強制終了・停電）、半分だけ消えたものが、控えの名前のまま残らないようにするため。
 */
function discard(path: string): void {
  if (!existsSync(path)) return;
  const gone = `${path}${GONE}`;
  rmSync(gone, { recursive: true, force: true });
  renameSync(path, gone);
  rmSync(gone, { recursive: true, force: true });
}

/** 控えのデータベースが、ちゃんと開けて、案件を読めるか（空・途中で切れたものを、控えとして残さないための確認） */
function verifyCopy(file: string): void {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const r = copy.prepare('PRAGMA quick_check').get() as { quick_check: string };
    if (r.quick_check !== 'ok') throw new Error(`控えの確認に失敗しました: ${r.quick_check}`);
    copy.prepare('SELECT COUNT(*) AS n FROM projects').get();
  } finally {
    copy.close();
  }
}

/**
 * 1回分の写しを作る。返り値は作った場所。
 * 「作成中」の場所に作り、確認が済んでから、控えの名前に変える。
 * ディスクがいっぱいなどで失敗したときは、作りかけのものを消す（空の控えが、最新の控えとして残り、本物の控えを間引いてしまわないように）。
 */
export function backup(destRoot: string): BackupResult {
  const root = resolve(destRoot);
  mkdirSync(root, { recursive: true });

  // 前に失敗して残った作りかけがあれば、片づける
  for (const n of readdirSync(root)) if (n.endsWith(PARTIAL) || n.endsWith(GONE)) rmSync(resolve(root, n), { recursive: true, force: true });

  const name = stamp(new Date(), TIMEZONE);
  const work = resolve(root, `${name}${PARTIAL}`);
  const dir = resolve(root, name);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    // データベースのきれいな写し（書き込み中でも整合が取れた1ファイルになる）
    const dbCopy = resolve(work, 'zumen.db');
    db.exec(`VACUUM INTO '${dbCopy.replaceAll("'", "''")}'`);
    verifyCopy(dbCopy);
    // 同じ秒に二度実行された場合に備えて、同じ名前のものは、確認が済んでから入れ替える
    discard(dir);
    renameSync(work, dir);
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }

  // 間引くのは、新しい控えが確かにできてから
  prune(root);
  return { dir, bytes: statSync(resolve(dir, 'zumen.db')).size };
}

/** 古い写しを間引く（同じ日は新しい1つだけ、新しい日から10日分） */
function prune(root: string): void {
  for (const old of pickToDelete(readdirSync(root))) discard(resolve(root, old));
}

/** 今日（控えの時間帯での今日）の控えが、もうあるか */
function hasBackupOfToday(root: string): boolean {
  if (!existsSync(root)) return false;
  const today = dayOf(new Date(), TIMEZONE);
  return readdirSync(root).some((n) => /^\d{8}-\d{6}$/.test(n) && n.startsWith(today) && existsSync(resolve(root, n, 'zumen.db')));
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
      recordBackupSuccess();
      console.log(`控えを作りました: ${r.dir}`);
    } catch (e) {
      recordBackupFailure(e instanceof Error ? e.message : String(e));
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
