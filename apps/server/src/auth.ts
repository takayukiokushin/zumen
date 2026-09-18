import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import { db, now } from './db.ts';

/** ログインの仕組み。社内数名を想定し、ID＋パスワードとセッションだけの最小構成 */

const COOKIE = 'zumen_session';
const SESSION_DAYS = 30;

export interface User {
  id: string;
  name: string;
}

/** パスワードを保存できる形にする（salt:hash） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

/** 総当たりで差が出ないよう、長さを揃えて比較する */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createUser(id: string, name: string, password: string): void {
  db.prepare('INSERT INTO users (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    hashPassword(password),
    now(),
  );
}

export function setPassword(id: string, password: string): boolean {
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  return Number(r.changes) > 0;
}

export function listUsers(): User[] {
  return db.prepare('SELECT id, name FROM users ORDER BY id').all() as unknown as User[];
}

export function login(c: Context, userId: string, password: string): User | null {
  const row = db.prepare('SELECT id, name, password_hash FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string; password_hash: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    row.id,
    now(),
    expires.toISOString(),
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
    secure: process.env.NODE_ENV === 'production',
  });
  return { id: row.id, name: row.name };
}

export function logout(c: Context): void {
  const token = getCookie(c, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  deleteCookie(c, COOKIE, { path: '/' });
}

/** 期限切れのセッションはその場で捨てる */
export function currentUser(c: Context): User | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id AS id, u.name AS name, s.expires_at AS expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as { id: string; name: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, name: row.name };
}

/** ログインしていなければ弾く */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const user = currentUser(c);
  if (!user) return c.json({ error: 'ログインしてください。' }, 401);
  c.set('user', user);
  await next();
}

export const newId = (): string => randomUUID();
