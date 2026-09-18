import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { FILES_DIR, db, now } from './db.ts';
import { newId, requireAuth } from './auth.ts';
import type { User } from './auth.ts';

/** 案件（プロジェクト）の保存・呼び出し。ヒアリング回答・図面・現地写真を一式で扱う */

/** 現地写真の上限（1枚あたり） */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * 編集中の印がこの時間更新されなければ、その人はもう見ていないとみなして解除する。
 * 画面からは1分ごとに更新しているので、パソコンが落ちても数分で他の人が編集できる。
 */
const LOCK_TIMEOUT_MS = 3 * 60 * 1000;

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  answers: string;
  drawing: string | null;
  locked_by: string | null;
  locked_at: string | null;
}

/** 誰かが編集中であることの印 */
export interface Lock {
  userId: string;
  userName: string;
  since: string;
}

/**
 * いま有効な編集中の印を返す。時間切れのものは無かったことにする。
 * （持ち主が画面を閉じずにパソコンごと落ちた場合に、案件が永久に開けなくならないように）
 */
function currentLock(projectId: string): Lock | null {
  const row = db
    .prepare(
      `SELECT p.locked_by, p.locked_at, u.name AS user_name
       FROM projects p LEFT JOIN users u ON u.id = p.locked_by
       WHERE p.id = ?`,
    )
    .get(projectId) as { locked_by: string | null; locked_at: string | null; user_name: string | null } | undefined;
  if (!row?.locked_by || !row.locked_at) return null;
  if (Date.now() - Date.parse(row.locked_at) > LOCK_TIMEOUT_MS) return null;
  return { userId: row.locked_by, userName: row.user_name ?? row.locked_by, since: row.locked_at };
}

/** 編集中の印を自分のものにする（すでに自分のものなら時刻だけ更新する） */
function takeLock(projectId: string, userId: string): void {
  db.prepare('UPDATE projects SET locked_by = ?, locked_at = ? WHERE id = ?').run(userId, now(), projectId);
}

export const projects = new Hono<{ Variables: { user: User } }>();
projects.use('*', requireAuth);

/** 一覧（中身は返さない） */
projects.get('/', (c) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at, p.updated_by,
              (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
       FROM projects p ORDER BY p.updated_at DESC`,
    )
    .all() as { id: string }[];
  return c.json({
    projects: rows.map((r) => ({ ...r, lock: currentLock(r.id) })),
  });
});

projects.post('/', async (c) => {
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string };
  const id = newId();
  const t = now();
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, (name ?? '').trim() || '無題の案件', t, t, c.get('user').id, '{}');
  takeLock(id, c.get('user').id);
  return c.json({ id }, 201);
});

projects.get('/:id', (c) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(c.req.param('id')) as ProjectRow | undefined;
  if (!row) return c.json({ error: '案件が見つかりません。' }, 404);
  const files = db
    .prepare('SELECT id, file_name, media_type, size, created_at FROM project_files WHERE project_id = ? ORDER BY created_at')
    .all(row.id);
  return c.json({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    answers: JSON.parse(row.answers),
    drawing: row.drawing ? JSON.parse(row.drawing) : null,
    files,
    lock: currentLock(row.id),
  });
});

projects.put('/:id', async (c) => {
  const id = c.req.param('id');
  const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!exists) return c.json({ error: '案件が見つかりません。' }, 404);

  // 他の人が編集中なら保存させない（あとから保存したほうで上書きされるのを防ぐ）
  const user = c.get('user');
  const lock = currentLock(id);
  if (lock && lock.userId !== user.id) {
    return c.json({ error: `${lock.userName}さんが編集中のため保存できません。`, lock }, 409);
  }
  takeLock(id, user.id);

  const body = (await c.req.json().catch(() => null)) as
    | { name?: string; answers?: unknown; drawing?: unknown }
    | null;
  if (!body) return c.json({ error: 'リクエストの形式が不正です。' }, 400);

  const sets: string[] = ['updated_at = ?', 'updated_by = ?'];
  const args: (string | null)[] = [now(), user.id];
  if (typeof body.name === 'string') {
    sets.push('name = ?');
    args.push(body.name.trim() || '無題の案件');
  }
  if (body.answers !== undefined) {
    sets.push('answers = ?');
    args.push(JSON.stringify(body.answers ?? {}));
  }
  if (body.drawing !== undefined) {
    sets.push('drawing = ?');
    args.push(body.drawing === null ? null : JSON.stringify(body.drawing));
  }
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  return c.json({ ok: true, updatedAt: args[0] });
});

/* ---------------- 編集中の印 ---------------- */

/**
 * 編集を始める・続けていることを伝える。
 * 画面から1分ごとに呼び、他の人が編集中なら409で断る（force なら奪い取る）。
 */
projects.post('/:id/lock', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) {
    return c.json({ error: '案件が見つかりません。' }, 404);
  }
  const user = c.get('user');
  const { force } = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const lock = currentLock(id);
  if (lock && lock.userId !== user.id && !force) {
    return c.json({ error: `${lock.userName}さんが編集中です。`, lock }, 409);
  }
  takeLock(id, user.id);
  return c.json({ lock: currentLock(id) });
});

/** 編集をやめたことを伝える。自分のものでなければ何もしない */
projects.delete('/:id/lock', (c) => {
  const id = c.req.param('id');
  const lock = currentLock(id);
  if (lock && lock.userId === c.get('user').id) {
    db.prepare('UPDATE projects SET locked_by = NULL, locked_at = NULL WHERE id = ?').run(id);
  }
  return c.json({ ok: true });
});

projects.delete('/:id', (c) => {
  const id = c.req.param('id');
  const held = currentLock(id);
  if (held && held.userId !== c.get('user').id) {
    return c.json({ error: `${held.userName}さんが編集中のため削除できません。`, lock: held }, 409);
  }
  for (const f of db.prepare('SELECT id FROM project_files WHERE project_id = ?').all(id) as { id: string }[]) {
    try {
      unlinkSync(resolve(FILES_DIR, f.id));
    } catch {
      // ファイルが既に無くても消せていれば問題ない
    }
  }
  db.prepare('DELETE FROM project_files WHERE project_id = ?').run(id);
  const r = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  if (Number(r.changes) === 0) return c.json({ error: '案件が見つかりません。' }, 404);
  return c.json({ ok: true });
});

/* ---------------- 現地写真 ---------------- */

projects.post('/:id/files', async (c) => {
  const projectId = c.req.param('id');
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return c.json({ error: '案件が見つかりません。' }, 404);
  }
  const held = currentLock(projectId);
  if (held && held.userId !== c.get('user').id) {
    return c.json({ error: `${held.userName}さんが編集中のため追加できません。`, lock: held }, 409);
  }
  const body = (await c.req.json().catch(() => null)) as
    | { fileName?: string; mediaType?: string; data?: string }
    | null;
  if (!body?.data || !body.mediaType) return c.json({ error: '画像が添付されていません。' }, 400);

  const buf = Buffer.from(body.data, 'base64');
  if (buf.byteLength > MAX_FILE_BYTES) {
    return c.json({ error: `画像が大きすぎます（1枚${MAX_FILE_BYTES / 1024 / 1024}MBまで）。` }, 413);
  }
  const id = newId();
  writeFileSync(resolve(FILES_DIR, id), buf);
  db.prepare(
    'INSERT INTO project_files (id, project_id, file_name, media_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, body.fileName ?? '写真', body.mediaType, buf.byteLength, now());
  return c.json({ id, size: buf.byteLength }, 201);
});

projects.get('/:id/files/:fileId', (c) => {
  const row = db
    .prepare('SELECT id, media_type FROM project_files WHERE id = ? AND project_id = ?')
    .get(c.req.param('fileId'), c.req.param('id')) as { id: string; media_type: string } | undefined;
  if (!row) return c.json({ error: '画像が見つかりません。' }, 404);
  try {
    const buf = readFileSync(resolve(FILES_DIR, row.id));
    return c.body(buf as unknown as ArrayBuffer, 200, {
      'content-type': row.media_type,
      'cache-control': 'private, max-age=86400',
    });
  } catch {
    return c.json({ error: '画像を読み込めませんでした。' }, 404);
  }
});

projects.delete('/:id/files/:fileId', (c) => {
  const fileId = c.req.param('fileId');
  const r = db.prepare('DELETE FROM project_files WHERE id = ? AND project_id = ?').run(fileId, c.req.param('id'));
  if (Number(r.changes) === 0) return c.json({ error: '画像が見つかりません。' }, 404);
  try {
    unlinkSync(resolve(FILES_DIR, fileId));
  } catch {
    // 既に消えていれば問題ない
  }
  return c.json({ ok: true });
});
