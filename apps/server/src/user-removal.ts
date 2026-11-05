import { db } from './db.ts';
import { deleteUser } from './auth.ts';
import { purgeProjectsOwnedBy } from './projects.ts';

/**
 * 利用者を消す（管理画面と、コマンド remove の、どちらからも、これを使う）。
 *
 * - 標準・管理用のアカウント：その人が作った案件は、**残す**。作成者・更新者の欄は、画面に「削除された利用者」と出る。
 * - 練習用のアカウント：その人の案件は、**いっしょに完全に消す**（練習用の案件は、練習用の本人たちにしか見えず、
 *   管理者も扱わない決まり。持ち主がいなくなると、だれにも見えない案件が残ってしまうため。ほかの人に見えるようにはしない）。
 *
 * 消せたら true、そういう利用者がいなければ false。
 */
export function removeUser(id: string): boolean {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
  if (!row) return false;
  if (row.role === 'sandbox') purgeProjectsOwnedBy(id);
  return deleteUser(id);
}
