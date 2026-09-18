import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { FILES_DIR, db, now } from './db.ts';
import { newId, requireAuth } from './auth.ts';
import type { User } from './auth.ts';

/** 案件（プロジェクト）の保存・呼び出し。ヒアリング回答・図面・現地写真を一式で扱う */

/** 現地写真の上限（1枚あたり） */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  answers: string;
  drawing: string | null;
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
    .all();
  return c.json({ projects: rows });
});

projects.post('/', async (c) => {
  const { name } = (await c.req.json().catch(() => ({}))) as { name?: string };
  const id = newId();
  const t = now();
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, (name ?? '').trim() || '無題の案件', t, t, c.get('user').id, '{}');
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
  });
});

projects.put('/:id', async (c) => {
  const id = c.req.param('id');
  const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!exists) return c.json({ error: '案件が見つかりません。' }, 404);

  const body = (await c.req.json().catch(() => null)) as
    | { name?: string; answers?: unknown; drawing?: unknown }
    | null;
  if (!body) return c.json({ error: 'リクエストの形式が不正です。' }, 400);

  const sets: string[] = ['updated_at = ?', 'updated_by = ?'];
  const args: (string | null)[] = [now(), c.get('user').id];
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

projects.delete('/:id', (c) => {
  const id = c.req.param('id');
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
