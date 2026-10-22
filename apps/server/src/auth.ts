import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import { db, now } from './db.ts';

/** ログインの仕組み。社内数名を想定し、ID＋パスワードとセッションだけの最小構成 */

const COOKIE = 'zumen_session';
const SESSION_DAYS = 30;

/* ---------------- 総当たり対策 ---------------- */

/** 何回まちがえたら止めるか */
const MAX_FAILS = 5;
/** 止める時間（ミリ秒）。まちがえ続けると伸びていく */
const LOCK_MS = 60_000;
/** この時間まちがえなければ、失敗の数を忘れる */
const FORGET_MS = 15 * 60_000;

/** IDごとの失敗の記録。再起動すると消えるが、社内数名の運用ではこれで足りる */
const fails = new Map<string, { count: number; last: number; until: number }>();

/** 存在しないIDでも同じだけ時間をかけるための、形だけのハッシュ */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** いま止められているか。止められていれば、あと何秒かを返す */
function lockedFor(id: string): number {
  const f = fails.get(id);
  if (!f) return 0;
  if (Date.now() - f.last > FORGET_MS) {
    fails.delete(id);
    return 0;
  }
  return f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}

function recordFail(id: string): void {
  const f = fails.get(id) ?? { count: 0, last: 0, until: 0 };
  f.count += 1;
  f.last = Date.now();
  if (f.count >= MAX_FAILS) {
    // 5回目以降は、まちがえるたびに止める時間が倍になる（1分→2分→4分…最大1時間）
    const step = Math.min(f.count - MAX_FAILS, 6);
    f.until = Date.now() + LOCK_MS * 2 ** step;
  }
  fails.set(id, f);
}

function clearFails(id: string): void {
  fails.delete(id);
}

/** 試験用。失敗の記録をすべて忘れる */
export function resetLoginAttempts(): void {
  fails.clear();
}

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

/** 利用者を消す。その人のログイン中の状態（セッション）もまとめて消える */
export function deleteUser(id: string): boolean {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return Number(r.changes) > 0;
}

export function listUsers(): User[] {
  return db.prepare('SELECT id, name FROM users ORDER BY id').all() as unknown as User[];
}

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'bad' }
  | { ok: false; reason: 'locked'; retryAfterSec: number };

export function login(c: Context, userId: string, password: string): LoginResult {
  const retryAfterSec = lockedFor(userId);
  if (retryAfterSec > 0) return { ok: false, reason: 'locked', retryAfterSec };

  const row = db.prepare('SELECT id, name, password_hash FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string; password_hash: string }
    | undefined;

  // 存在しないIDでも同じだけ時間をかける。
  // そうしないと、返ってくる速さで「このIDは実在する」と分かってしまう
  const okPassword = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !okPassword) {
    recordFail(userId);
    return { ok: false, reason: 'bad' };
  }
  clearFails(userId);

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
  return { ok: true, user: { id: row.id, name: row.name } };
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
