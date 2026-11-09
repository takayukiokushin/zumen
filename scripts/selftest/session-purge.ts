/**
 * 自己診断の道具。期限が切れたログインの記録だけが消えて、有効なものは残るかを確かめる。
 *
 *   DATA_DIR=<データ置き場> node ... session-purge.ts
 */
import { db } from '../../apps/server/src/db.ts';
import { createUser, purgeExpiredSessions } from '../../apps/server/src/auth.ts';

createUser('purge', '片付け', 'Tulip-River-4821', 'member');
const ins = db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
const day = 86400_000;
for (let i = 0; i < 5; i++) ins.run(`old${i}`, 'purge', new Date(Date.now() - 40 * day).toISOString(), new Date(Date.now() - (i + 1) * day).toISOString());
for (let i = 0; i < 3; i++) ins.run(`new${i}`, 'purge', new Date().toISOString(), new Date(Date.now() + (i + 1) * day).toISOString());
const removed = purgeExpiredSessions();
const left = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
console.log(JSON.stringify({ removed, left }));
