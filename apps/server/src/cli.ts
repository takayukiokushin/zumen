import { createUser, listUsers, setPassword } from './auth.ts';
import { backup, sourceDir } from './backup.ts';

/**
 * 利用者を追加・変更するための小さなコマンド。
 *
 *   pnpm --filter @zumen/server user:add <ID> <名前> <パスワード>
 *   pnpm --filter @zumen/server user:passwd <ID> <新しいパスワード>
 *   pnpm --filter @zumen/server user:list
 *   pnpm --filter @zumen/server backup <保存先フォルダ>
 */
const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'add': {
      const [id, name, password] = args;
      if (!id || !name || !password) throw new Error('使い方: add <ID> <名前> <パスワード>');
      if (password.length < 8) throw new Error('パスワードは8文字以上にしてください。');
      createUser(id, name, password);
      console.log(`利用者を追加しました: ${id}（${name}）`);
      break;
    }
    case 'passwd': {
      const [id, password] = args;
      if (!id || !password) throw new Error('使い方: passwd <ID> <新しいパスワード>');
      if (password.length < 8) throw new Error('パスワードは8文字以上にしてください。');
      if (!setPassword(id, password)) throw new Error(`利用者が見つかりません: ${id}`);
      console.log(`パスワードを変更しました: ${id}`);
      break;
    }
    case 'list': {
      const users = listUsers();
      console.log(users.length ? users.map((u) => `  ${u.id}\t${u.name}`).join('\n') : '  （まだ誰も登録されていません）');
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
    default:
      console.log('使い方: add <ID> <名前> <パスワード> / passwd <ID> <パスワード> / list / backup <保存先>');
      process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
