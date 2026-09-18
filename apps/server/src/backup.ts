import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, FILES_DIR, db } from './db.ts';

/**
 * 案件を丸ごと別の場所に写す。
 *
 * 保存先をドロップボックスなどの同期フォルダにしておけば、そのままクラウドに上がる。
 * データベースは使用中に直接コピーすると壊れた写しができることがあるので、
 * SQLite自身に「今の状態の、きれいな写しを1つ作らせる」（VACUUM INTO）。
 */

/** 何世代残すか。これより古い写しは消す */
const KEEP = 30;

/** 20260918-143205 のような、並べ替えれば時系列になる名前 */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export interface BackupResult {
  dir: string;
  bytes: number;
  fileCount: number;
}

/** 1回分の写しを作る。返り値は作った場所 */
export function backup(destRoot: string): BackupResult {
  const root = resolve(destRoot);
  mkdirSync(root, { recursive: true });

  const dir = resolve(root, stamp());
  // 同じ秒に二度実行された場合に備えて、いちど消してから作る
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // データベースのきれいな写し（書き込み中でも整合が取れた1ファイルになる）
  const dbCopy = resolve(dir, 'zumen.db');
  db.exec(`VACUUM INTO '${dbCopy.replaceAll("'", "''")}'`);

  // 現地写真
  let fileCount = 0;
  if (existsSync(FILES_DIR)) {
    cpSync(FILES_DIR, resolve(dir, 'files'), { recursive: true });
    fileCount = readdirSync(FILES_DIR).length;
  }

  prune(root);
  return { dir, bytes: statSync(dbCopy).size, fileCount };
}

/** 古い写しを間引く */
function prune(root: string): void {
  const dirs = readdirSync(root)
    .filter((n) => /^\d{8}-\d{6}$/.test(n))
    .sort();
  for (const old of dirs.slice(0, Math.max(0, dirs.length - KEEP))) {
    rmSync(resolve(root, old), { recursive: true, force: true });
  }
}

/**
 * 1日1回、自動で写しを作る。
 * .env に BACKUP_DIR を書いてあるときだけ動く。
 */
export function startAutoBackup(): void {
  const dest = process.env.BACKUP_DIR;
  if (!dest) return;

  const run = () => {
    try {
      const r = backup(dest);
      console.log(`控えを作りました: ${r.dir}（写真${r.fileCount}枚）`);
    } catch (e) {
      console.error('控えを作れませんでした:', e instanceof Error ? e.message : e);
    }
  };

  run(); // 起動したときに1回
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
  console.log(`控えの保存先: ${resolve(dest)}（1日1回・${KEEP}世代まで）`);
}

/** 保存先の案内。DATA_DIR を教えるのは「元はここにある」と分かるように */
export const sourceDir = DATA_DIR;
