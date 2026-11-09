/**
 * 自己診断の道具。想定外のエラーが、短い間に大量に起きたことにして、error.log が増え続けないかを確かめる。
 *
 *   DATA_DIR=<データ置き場> node ... log-storm.ts <回数>
 */
import { logError } from '../../apps/server/src/errors.ts';

const n = Number(process.argv[2] ?? 20000);
// 画面（console）への出力は、この試験では要らない
console.error = () => undefined;
for (let i = 0; i < n; i++) logError('想定外のエラー', new Error(`嵐 ${i}`), `POST /api/projects/x （ID: storm）`);
console.log('done');
