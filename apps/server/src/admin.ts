import { Hono } from 'hono';
import {
  adminCount,
  createUser,
  deleteUser,
  listUsers,
  requireAdmin,
  ROLES,
  setPassword,
  unlockUser,
} from './auth.ts';
import type { Role, User } from './auth.ts';

/**
 * 利用者の管理。管理用のアカウントだけが使える。
 * ターミナルを開かなくても、画面から追加・削除・パスワードの再設定ができる。
 */
export const admin = new Hono<{ Variables: { user: User } }>();
admin.use('*', requireAdmin);

const MIN_PASSWORD = 8;

/** IDに使える文字（人に伝えるときに混乱しないよう、記号は控えめに） */
const ID_PATTERN = /^[A-Za-z0-9._@-]{2,64}$/;

admin.get('/users', (c) => c.json({ users: listUsers() }));

admin.post('/users', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    password?: string;
    role?: string;
  };
  const id = (body.id ?? '').trim();
  const name = (body.name ?? '').trim();
  const password = body.password ?? '';
  const role = (body.role ?? 'member') as Role;

  if (!ID_PATTERN.test(id)) {
    return c.json({ error: 'IDは半角の英数字と . _ - @ で、2〜64文字にしてください。' }, 400);
  }
  if (!name) return c.json({ error: '名前を入れてください。' }, 400);
  if (password.length < MIN_PASSWORD) {
    return c.json({ error: `パスワードは${MIN_PASSWORD}文字以上にしてください。` }, 400);
  }
  if (!ROLES.includes(role)) return c.json({ error: 'アカウントの種類を、一覧から選び直してください。' }, 400);
  if (listUsers().some((u) => u.id === id)) {
    return c.json({ error: `そのIDはすでに使われています: ${id}。別のIDにしてください。` }, 409);
  }

  createUser(id, name, password, role);
  return c.json({ ok: true }, 201);
});

admin.put('/users/:id/password', async (c) => {
  const id = c.req.param('id');
  const { password } = (await c.req.json().catch(() => ({}))) as { password?: string };
  if ((password ?? '').length < MIN_PASSWORD) {
    return c.json({ error: `パスワードは${MIN_PASSWORD}文字以上にしてください。` }, 400);
  }
  if (!setPassword(id, password!)) return c.json({ error: `利用者が見つかりません: ${id}。すでに消されたかもしれません。一覧を開き直して確かめてください。` }, 404);
  // パスワードを変えたら、止まっていたログインも解除する（駆け込みの逃げ道）
  unlockUser(id);
  return c.json({ ok: true });
});

admin.post('/users/:id/unlock', (c) => {
  unlockUser(c.req.param('id'));
  return c.json({ ok: true });
});

admin.delete('/users/:id', (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: '自分自身は消せません。ほかの管理用アカウントでログインして消してください。' }, 400);
  const target = listUsers().find((u) => u.id === id);
  if (!target) return c.json({ error: `利用者が見つかりません: ${id}。すでに消されたかもしれません。一覧を開き直して確かめてください。` }, 404);
  if (target.role === 'admin' && adminCount() <= 1) {
    return c.json({ error: '管理用のアカウントが1つも無くなってしまうため、消せません。先に、別の管理用アカウントを作ってください。' }, 400);
  }
  deleteUser(id);
  return c.json({ ok: true });
});
