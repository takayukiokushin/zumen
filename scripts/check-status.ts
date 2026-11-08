/**
 * サーバーの状態（控えが取れているか・ディスクの空き・エラーの件数）の判断の決まりの検証。
 * 帯で知らせる条件（控えが2日以上取れていない／ディスクの空きが10%以下 など）と、エラーの数え方を確かめる。
 *
 *   node --experimental-strip-types scripts/check-status.ts
 */
import { BACKUP_STALE_DAYS, DISK_LOW_PERCENT, countErrors, diskInfo, judge } from '../apps/server/src/status-rules.ts';
import type { JudgeInput, Warning } from '../apps/server/src/status-rules.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

console.log('■ サーバーの状態の判断');

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-11-08T12:00:00+09:00');
const good = diskInfo(50e9, 100e9);
const base: JudgeInput = { now, backupConfigured: true, lastBackupAt: now - 3600_000, lastFailure: null, disk: good, backupDisk: good };
const codes = (i: Partial<JudgeInput>): string => judge({ ...base, ...i }).map((w: Warning) => w.code).join(',');

if (BACKUP_STALE_DAYS !== 2 || DISK_LOW_PERCENT !== 10) fail('決めた基準（控え2日・ディスク10%）と違っています');
// 控え
if (codes({}) !== '') fail('控えが1時間前で、ディスクも十分なのに、注意が出ています');
if (codes({ lastBackupAt: now - (2 * DAY - 1000) }) !== '') fail('控えが2日に届かないのに、注意が出ています');
if (codes({ lastBackupAt: now - 2 * DAY }) !== 'backup-stale') fail('控えがちょうど2日前のとき、注意が出ません');
if (judge({ ...base, lastBackupAt: now - 5 * DAY })[0]?.n !== 5) fail('控えが5日前のとき、「5日」と知らせられません');
if (codes({ lastBackupAt: null }) !== 'backup-none') fail('控えが1つも無いとき、注意が出ません');
if (codes({ backupConfigured: false, lastBackupAt: null }) !== 'backup-not-configured') fail('控えの保存先が決まっていないとき、注意が出ません（ほかの控えの注意と重ならないはず）');
if (codes({ lastFailure: { at: now - 1000 } }) !== 'backup-failed') fail('直近の控えが失敗しているとき、注意が出ません');
// ディスク
if (codes({ disk: diskInfo(10e9, 100e9) }) !== 'disk-low') fail('空きがちょうど10%のとき、注意が出ません');
if (codes({ disk: diskInfo(10.1e9, 100e9) }) !== '') fail('空きが10%を少し超えているのに、注意が出ています');
if (codes({ backupDisk: diskInfo(5e9, 100e9) }) !== 'backup-disk-low') fail('控えの保存先の空きが少ないとき、注意が出ません');
if (codes({ disk: null, backupDisk: null }) !== '') fail('ディスクの空きが分からないとき（読めなかったとき）は、注意を出さないはず');
if (diskInfo(1, 0) !== null || diskInfo(NaN, 10) !== null) fail('合計が0・数でないときは、空きの割合を出さないはず');
if (diskInfo(333, 1000)?.freePercent !== 33.3) fail('空きの割合は、小数第1位までのはず');
// 重要なものから並ぶ（控え → 失敗 → ディスク）
if (codes({ lastBackupAt: null, lastFailure: { at: now }, disk: diskInfo(1e9, 100e9) }) !== 'backup-none,backup-failed,disk-low') fail('注意の並び順が、控え → 失敗 → ディスクになっていません');

// エラーの数え方
const log = [
  '[2026-11-08 11:00:00] 想定外のエラー GET /api/x （ID: a）',
  'Error: boom',
  '    at foo (a.ts:1:1)',
  '',
  '[2026-11-07 13:00:00] 想定外のエラー POST /api/y',
  'Error: 二つ目',
  '',
  '[2026-11-01 12:00:00] 処理されなかった失敗（動作は続けます）',
  'Error: 古い',
  '',
  '[2026-10-01 12:00:00] 想定外のエラー GET /api/z',
  '[壊れた行] 数えない',
  '  [2026-11-08 11:30:00] 行頭でないものは数えない',
].join('\n');
const c = countErrors(log, now);
// 24時間以内：1時間前と23時間前の2件。7日以内：それに、ちょうど7日前の1件を足した3件（10月のものと、行頭でない・壊れた行は数えない）
if (c.last24h !== 2 || c.last7d !== 3) fail(`エラーの件数が合いません（24時間 ${c.last24h}・7日 ${c.last7d}。期待は 2 と 3）`);
if (c.lastAt !== Date.parse('2026-11-08T11:00:00+09:00')) fail('最後に起きた時刻が合いません');
const none = countErrors('', now);
if (none.last24h !== 0 || none.last7d !== 0 || none.lastAt !== null) fail('記録が空のとき、0件・時刻なしのはずです');
console.log('  控え（2日以上・1つも無い・保存先なし・失敗）／ディスク（10%以下・分からないときは出さない）／注意の並び順／エラーの数え方');

console.log(failed === 0 ? '\n✓ サーバーの状態の判断を確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
