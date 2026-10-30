// 何よりも先に .env を読み込む
import './env.ts';
import { createUser, deleteUser, listUsers, ROLE_LABEL, ROLES, setPassword } from './auth.ts';
import type { Role } from './auth.ts';
import { backup, sourceDir } from './backup.ts';
import { checkPassword } from './password-policy.ts';
import { checkApiKey, explainApiError } from './apikey.ts';

/**
 * 利用者を追加・変更するための小さなコマンド。
 *
 *   pnpm --filter @zumen/server user:add <ID> <名前> <パスワード> [admin|member|sandbox]
 *   pnpm --filter @zumen/server user:passwd <ID> <新しいパスワード>
 *   pnpm --filter @zumen/server user:remove <ID>
 *   pnpm --filter @zumen/server user:list
 *   pnpm --filter @zumen/server backup <保存先フォルダ>
 *   pnpm --filter @zumen/server apikey
 */
const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'add': {
      const [id, name, password, role = 'member'] = args;
      if (!id || !name || !password) {
        throw new Error('使い方: add <ID> <名前> <パスワード> [種類: admin / member / sandbox]');
      }
      {
        const weak = checkPassword(password, id);
        if (weak) throw new Error(weak);
      }
      if (!ROLES.includes(role as Role)) {
        throw new Error('種類は admin（管理用）／ member（標準）／ sandbox（練習用）のどれかです。');
      }
      createUser(id, name, password, role as Role);
      console.log(`利用者を追加しました: ${id}（${name}／${ROLE_LABEL[role as Role]}）`);
      break;
    }
    case 'passwd': {
      const [id, password] = args;
      if (!id || !password) throw new Error('使い方: passwd <ID> <新しいパスワード>');
      {
        const weak = checkPassword(password, id);
        if (weak) throw new Error(weak);
      }
      if (!setPassword(id, password)) throw new Error(`利用者が見つかりません: ${id}`);
      console.log(`パスワードを変更しました: ${id}`);
      break;
    }
    case 'remove': {
      const [id] = args;
      if (!id) throw new Error('使い方: remove <ID>');
      if (!deleteUser(id)) throw new Error(`利用者が見つかりません: ${id}`);
      console.log(`利用者を消しました: ${id}`);
      console.log('  この人がログイン中だった場合、その場で使えなくなります。');
      break;
    }
    case 'list': {
      const users = listUsers();
      console.log(
        users.length
          ? users.map((u) => `  ${ROLE_LABEL[u.role].padEnd(4, '　')}  ${u.id}\t${u.name}`).join('\n')
          : '  （まだ誰も登録されていません）',
      );
      break;
    }
    case 'backup': {
      const [dest] = args;
      if (!dest) throw new Error('使い方: backup <保存先フォルダ>');
      const r = backup(dest);
      console.log(`控えを作りました: ${r.dir}`);
      console.log(`  元の場所: ${sourceDir}`);
      console.log(`  案件のデータ: ${(r.bytes / 1024).toFixed(0)}KB / 写真: ${r.fileCount}枚`);
      break;
    }
    case 'apikey': {
      try {
        await checkApiKey();
      } catch (e) {
        console.error('\n✗ ' + explainApiError(e));
        process.exit(1);
      }
      break;
    }
    default:
      console.log(
        '使い方: add <ID> <名前> <パスワード> / passwd <ID> <パスワード> / remove <ID> / list / backup <保存先> / apikey',
      );
      process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
