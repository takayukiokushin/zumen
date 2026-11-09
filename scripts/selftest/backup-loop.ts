/**
 * 自己診断（停電・強制終了の試験）の道具。控えを、止まらずに作り続ける。
 * 試験が、途中で強制終了して、「作りかけの控え」が本物の控えに混ざらないかを確かめるために使う。
 *
 *   DATA_DIR=<データ置き場> node ... backup-loop.ts <控えの保存先>
 */
import { backup } from '../../apps/server/src/backup.ts';

const dest = process.argv[2];
if (!dest) throw new Error('控えの保存先を指定してください');
console.log('start');
for (;;) backup(dest);
