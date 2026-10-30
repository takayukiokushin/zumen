import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import { db, now } from './db.ts';
import { isHttps } from './security.ts';

/** ログインの仕組み。社内数名を想定し、ID＋パスワードとセッションだけの最小構成 */

const COOKIE = 'zumen_session';
/**
 * ログインが続く日数。使わずに、これを過ぎたら入れ直してもらう。
 * 使っている間は延びていく（開いたまま編集していれば、10日を超えても切れない）
 */
const SESSION_DAYS = 10;
/** 延ばすのは、残りがこれだけ減ったとき。毎回の書き込みを避けるため（1時間に1回まで） */
const RENEW_AFTER_MS = 60 * 60_000;

/**
 * ログインの印（セッション）は、データベースには、そのままの形で置かない。
 * 控えのデータ（Dropbox など）が外に出ても、そこから他人になりすませないようにするため。
 */
function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 今ブラウザが持っているログインの印（保存用の形）。無ければ null */
export function currentTokenKey(c: Context): string | null {
  const token = getCookie(c, COOKIE);
  return token ? tokenKey(token) : null;
}

/* ---------------- 総当たり対策 ---------------- */

/** 何回まちがえたら止めるか */
export const MAX_FAILS = 10;
/** 何回目から「あと○回」と知らせるか */
export const WARN_FROM = 5;
/** 止める時間（ミリ秒） */
export const LOCK_MS = 30 * 60_000;
/** この時間まちがえなければ、失敗の数を忘れる */
const FORGET_MS = 30 * 60_000;

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

/** まちがえた回数を1つ増やし、いま何回目かを返す */
/** 失敗の記録に残すIDの数の上限（でたらめなIDを大量に送られても、記憶が増え続けないように） */
const MAX_TRACKED = 5000;

function recordFail(id: string): number {
  if (fails.size >= MAX_TRACKED && !fails.has(id)) {
    for (const [k, v] of fails) if (Date.now() - v.last > FORGET_MS) fails.delete(k);
    // それでも多ければ、いちばん古く記録されたものから忘れる
    for (const k of fails.keys()) {
      if (fails.size < MAX_TRACKED) break;
      fails.delete(k);
    }
  }
  const f = fails.get(id) ?? { count: 0, last: 0, until: 0 };
  f.count += 1;
  f.last = Date.now();
  if (f.count >= MAX_FAILS) f.until = Date.now() + LOCK_MS;
  fails.set(id, f);
  return f.count;
}

function clearFails(id: string): void {
  fails.delete(id);
}

/** 試験用。失敗の記録をすべて忘れる */
export function resetLoginAttempts(): void {
  fails.clear();
}

/** アカウントの種類 */
export type Role =
  /** 管理用。すべての案件を扱え、利用者の管理もできる */
  | 'admin'
  /** 標準。案件はみんなで共有する */
  | 'member'
  /** 練習用。自分が作ったものだけを扱う */
  | 'sandbox';

export const ROLES: Role[] = ['admin', 'member', 'sandbox'];

export const ROLE_LABEL: Record<Role, string> = {
  admin: '管理用',
  member: '標準',
  sandbox: '練習用',
};

export interface User {
  id: string;
  name: string;
  role: Role;
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

export function createUser(id: string, name: string, password: string, role: Role = 'member'): void {
  db.prepare('INSERT INTO users (id, name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    hashPassword(password),
    now(),
    role,
  );
}

/**
 * パスワードを変える。変えたら、その人のログイン中の状態（セッション）を切る。
 * （パスワードを変えた理由が「知られたかもしれない」場合に、すでに入っている人を締め出すため）
 * keepTokenKey を渡すと、その1つだけは残す（変えた本人の、いまの画面が切れないように）。
 */
export function setPassword(id: string, password: string, keepTokenKey?: string | null): boolean {
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  if (Number(r.changes) === 0) return false;
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, keepTokenKey ?? '');
  return true;
}

/** 利用者を消す。その人のログイン中の状態（セッション）もまとめて消える */
export function deleteUser(id: string): boolean {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return Number(r.changes) > 0;
}

export function listUsers(): User[] {
  return db.prepare('SELECT id, name, role FROM users ORDER BY role, id').all() as unknown as User[];
}

/** 管理用のアカウントの数。最後の1つを消させないために使う */
export function adminCount(): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
  return Number(r.n);
}

/** 止まっているログインを、管理者が手で解除する */
export function unlockUser(id: string): void {
  fails.delete(id);
}

export type LoginResult =
  | { ok: true; user: User }
  /** まちがい。remaining は、あと何回まちがえると止まるか */
  | { ok: false; reason: 'bad'; remaining: number }
  | { ok: false; reason: 'locked'; retryAfterSec: number };

export function login(c: Context, userId: string, password: string): LoginResult {
  const retryAfterSec = lockedFor(userId);
  if (retryAfterSec > 0) return { ok: false, reason: 'locked', retryAfterSec };

  const row = db.prepare('SELECT id, name, role, password_hash FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string; role: Role; password_hash: string }
    | undefined;

  // 存在しないIDでも同じだけ時間をかける。
  // そうしないと、返ってくる速さで「このIDは実在する」と分かってしまう
  const okPassword = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !okPassword) {
    const count = recordFail(userId);
    return { ok: false, reason: 'bad', remaining: Math.max(0, MAX_FAILS - count) };
  }
  clearFails(userId);

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenKey(token),
    row.id,
    now(),
    expires.toISOString(),
  );
  setSessionCookie(c, token);
  return { ok: true, user: { id: row.id, name: row.name, role: row.role } };
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
    // HTTPS（暗号化された通信）で届いたときだけ、暗号化されていない通信には付けない印をつける。
    // 社内の http でのつなぎ方では、付けるとログインできなくなる
    secure: process.env.NODE_ENV === 'production' || isHttps(c),
  });
}

export function logout(c: Context): void {
  const token = getCookie(c, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenKey(token));
  deleteCookie(c, COOKIE, { path: '/' });
}

/**
 * 期限切れのセッションはその場で捨てる。
 * 使われているセッションは、そのつど期限を先へ延ばす（ブラウザ側の期限も延ばす）
 */
export function currentUser(c: Context): User | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id AS id, u.name AS name, u.role AS role, s.expires_at AS expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(tokenKey(token)) as { id: string; name: string; role: Role; expires_at: string } | undefined;
  if (!row) return null;
  const left = new Date(row.expires_at).getTime() - Date.now();
  if (left < 0) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenKey(token));
    return null;
  }
  if (left < SESSION_DAYS * 86400_000 - RENEW_AFTER_MS) {
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(expires, tokenKey(token));
    setSessionCookie(c, token);
  }
  return { id: row.id, name: row.name, role: row.role };
}

/** ログインしていなければ弾く */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const user = currentUser(c);
  if (!user) return c.json({ error: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, 401);
  c.set('user', user);
  await next();
}

/** 管理用のアカウントだけが通れる入口 */
export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  const user = currentUser(c);
  if (!user) return c.json({ error: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'この操作は、管理用のアカウントでないとできません。管理者に頼んでください。' }, 403);
  c.set('user', user);
  await next();
}

export const newId = (): string => randomUUID();
