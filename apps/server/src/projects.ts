import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { FILES_DIR, db, now } from './db.ts';
import { newId, requireAuth } from './auth.ts';
import type { User } from './auth.ts';
import { FILE_CSP, isPhotoType } from './security.ts';
import { clearForDuplicate } from '@zumen/knowledge';

/** 案件（プロジェクト）の保存・呼び出し。ヒアリング回答・図面・現地写真を一式で扱う */

/** 現地写真の上限（1枚あたり） */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * 編集中の印がこの時間更新されなければ、その人はもう見ていないとみなして解除する。
 * 画面からは1分ごとに更新しているので、パソコンが落ちても数分で他の人が編集できる。
 */
const LOCK_TIMEOUT_MS = 3 * 60 * 1000;

/** 消した案件を、ごみ箱に残しておく日数。過ぎたら、写真も含めて完全に消える */
export const TRASH_DAYS = 30;
const TRASH_MS = TRASH_DAYS * 86400_000;

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

/**
 * その人がこの案件を扱えるか。
 * 練習用のアカウントは、自分が作ったものだけを扱う（他の人の案件は見えない）。
 * 逆に、練習用のアカウントが作った案件は、練習用の本人以外（管理用も含む）は、IDを直接指定しても扱えない。
 */
function canTouch(user: User, projectId: string): boolean {
  const row = db
    .prepare('SELECT p.owner, (SELECT role FROM users WHERE id = p.owner) AS owner_role FROM projects p WHERE p.id = ?')
    .get(projectId) as { owner: string | null; owner_role: string | null } | undefined;
  if (user.role === 'sandbox') return row?.owner === user.id;
  return row?.owner_role !== 'sandbox';
}

/** 編集中の印を自分のものにする（すでに自分のものなら時刻だけ更新する） */
function takeLock(projectId: string, userId: string): void {
  db.prepare('UPDATE projects SET locked_by = ?, locked_at = ? WHERE id = ?').run(userId, now(), projectId);
}

/** 練習用のアカウントは自分のものだけ。ほかの人には練習用のものを見せない（一覧・ごみ箱で共通） */
function visibleTo(user: User): { where: string; args: string[] } {
  return user.role === 'sandbox'
    ? { where: 'p.owner = ?', args: [user.id] }
    : { where: "(p.owner IS NULL OR p.owner NOT IN (SELECT id FROM users WHERE role = 'sandbox'))", args: [] };
}

/** ごみ箱に入れてから期限を過ぎた案件を、写真ごと完全に消す。消した件数を返す */
export function purgeExpiredTrash(): number {
  const cutoff = new Date(Date.now() - TRASH_MS).toISOString();
  const old = db.prepare('SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as {
    id: string;
  }[];
  for (const { id } of old) {
    for (const f of db.prepare('SELECT id FROM project_files WHERE project_id = ?').all(id) as { id: string }[]) {
      try {
        unlinkSync(resolve(FILES_DIR, f.id));
      } catch {
        // ファイルが既に無くても消せていれば問題ない
      }
    }
    db.prepare('DELETE FROM project_files WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
  return old.length;
}

export const projects = new Hono<{ Variables: { user: User } }>();
projects.use('*', requireAuth);

/** 一覧（中身は返さない） */
projects.get('/', (c) => {
  const user = c.get('user');
  const { where: visible, args } = visibleTo(user);
  const where = `WHERE p.deleted_at IS NULL AND ${visible}`;
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at, p.updated_by,
              (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
       FROM projects p ${where} ORDER BY p.updated_at DESC`,
    )
    .all(...args) as { id: string }[];
  return c.json({
    projects: rows.map((r) => ({ ...r, lock: currentLock(r.id) })),
  });
});

/** ごみ箱（消してから30日以内の案件）。見える範囲は一覧と同じ。全員が戻せる */
projects.get('/trash', (c) => {
  purgeExpiredTrash();
  const { where, args } = visibleTo(c.get('user'));
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.deleted_at, u.name AS deleted_by_name, p.deleted_by,
              (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
       FROM projects p LEFT JOIN users u ON u.id = p.deleted_by
       WHERE p.deleted_at IS NOT NULL AND ${where} ORDER BY p.deleted_at DESC`,
    )
    .all(...args) as { id: string; name: string; deleted_at: string; deleted_by_name: string | null; deleted_by: string | null; file_count: number }[];
  return c.json({
    retainDays: TRASH_DAYS,
    projects: rows.map((r) => ({
      id: r.id,
      name: r.name,
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by_name ?? r.deleted_by,
      purgeAt: new Date(Date.parse(r.deleted_at) + TRASH_MS).toISOString(),
      fileCount: r.file_count,
    })),
  });
});

/* ---------------- 練習環境（本番の案件をコピーして練習する） ---------------- */

/** 練習用のアカウントだけが使える。それ以外は、使えないことを伝える */
const PRACTICE_ONLY = '本番の案件をコピーして練習できるのは、練習用のアカウントだけです。';

/** 練習用ではない人が作った、消されていない案件（コピー元にできるもの） */
const PRODUCTION_WHERE =
  "p.deleted_at IS NULL AND (p.owner IS NULL OR p.owner NOT IN (SELECT id FROM users WHERE role = 'sandbox'))";

/** コピー元にできる本番の案件の一覧（練習用のアカウントだけ） */
projects.get('/practice/sources', (c) => {
  if (c.get('user').role !== 'sandbox') return c.json({ error: PRACTICE_ONLY }, 403);
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.updated_at, u.name AS updated_by_name, p.updated_by,
              (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
       FROM projects p LEFT JOIN users u ON u.id = p.updated_by
       WHERE ${PRODUCTION_WHERE} ORDER BY p.updated_at DESC`,
    )
    .all() as { id: string; name: string; updated_at: string; updated_by_name: string | null; updated_by: string | null; file_count: number }[];
  return c.json({
    projects: rows.map((r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by_name ?? r.updated_by,
      fileCount: r.file_count,
    })),
  });
});

/**
 * 本番の案件を、練習用のアカウントの案件としてコピーする。
 * コピーなので、もとの案件（回答・図面・写真）は何も変わらない。
 * コピーしたあとの編集は、コピーにだけ反映される（練習用のアカウントにしか見えない）。
 */
projects.post('/practice/copy', async (c) => {
  const user = c.get('user');
  if (user.role !== 'sandbox') return c.json({ error: PRACTICE_ONLY }, 403);
  const { sourceId } = (await c.req.json().catch(() => ({}))) as { sourceId?: string };
  const src = sourceId
    ? (db.prepare(`SELECT p.* FROM projects p WHERE p.id = ? AND ${PRODUCTION_WHERE}`).get(sourceId) as
        | (ProjectRow & { answers: string; drawing: string | null })
        | undefined)
    : undefined;
  if (!src) {
    return c.json({ error: 'コピーする案件が見つかりません。すでに消されたか、練習用の案件です。一覧を開き直して、選び直してください。' }, 404);
  }

  const id = newId();
  const t = now();
  const name = `（練習）${src.name}`;
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers, drawing, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, t, t, user.id, src.answers, src.drawing, user.id);

  // 写真も別のファイルとしてコピーする（コピー側を消しても、もとの写真は残る）
  const files = db
    .prepare('SELECT id, file_name, media_type, size FROM project_files WHERE project_id = ? ORDER BY created_at')
    .all(src.id) as { id: string; file_name: string; media_type: string; size: number }[];
  for (const f of files) {
    try {
      const buf = readFileSync(resolve(FILES_DIR, f.id));
      const fid = newId();
      writeFileSync(resolve(FILES_DIR, fid), buf);
      db.prepare(
        'INSERT INTO project_files (id, project_id, file_name, media_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(fid, id, f.file_name, f.media_type, buf.byteLength, t);
    } catch {
      // もとの写真のデータが無いものは、コピーしない
    }
  }
  takeLock(id, user.id);
  return c.json({ id, name, updatedAt: t }, 201);
});

/**
 * 図面に手で足した文字（メモ）を外す。自動で作った文字（ケーブルの説明など）と、記号・線の手直しは、そのまま残す。
 * どれが手で足したものかは、図面の控え（base.textIds）で分かる。控えが無い古い図面は、そのまま。
 */
function withoutHandwrittenMemos(drawing: string | null): string | null {
  if (!drawing) return drawing;
  try {
    const doc = JSON.parse(drawing) as {
      items?: { kind?: string; id?: string }[];
      base?: { textIds?: string[] };
      overrides?: { added?: { kind?: string }[] };
    };
    const auto = doc.base?.textIds;
    if (!Array.isArray(auto) || !Array.isArray(doc.items)) return drawing;
    doc.items = doc.items.filter((it) => it.kind !== 'text' || auto.includes(String(it.id)));
    if (doc.overrides && Array.isArray(doc.overrides.added)) doc.overrides.added = doc.overrides.added.filter((a) => a.kind !== 'text');
    return JSON.stringify(doc);
  } catch {
    return drawing;
  }
}

/**
 * 過去の図面を複製して、新しい案件を作る（本番のアカウントも使える。練習用の「本番の案件をコピー」とは別）。
 * 設備の内容と、手で直した図面は、そのまま使う。
 * その現場だけの、事業場名称・電柱名称・図面の名称・特記事項などの答えと、図面に手で足したメモは、空にする。
 * 現地写真は、その現場のものなので、コピーしない。もとの案件は何も変わらない。
 */
projects.post('/:id/duplicate', (c) => {
  const user = c.get('user');
  const src = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(c.req.param('id')) as
    | (ProjectRow & { answers: string; drawing: string | null })
    | undefined;
  if (!src || !canTouch(user, src.id)) {
    return c.json({ error: '複製する案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」を開き直して、選び直してください。' }, 404);
  }
  let answers: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(src.answers);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) answers = parsed;
  } catch {
    // 壊れた回答は、空として扱う
  }
  const id = newId();
  const t = now();
  const name = '無題の案件';
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers, drawing, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, t, t, user.id, JSON.stringify(clearForDuplicate(answers as never)), withoutHandwrittenMemos(src.drawing), user.id);
  takeLock(id, user.id);
  return c.json({ id, name, updatedAt: t }, 201);
});

/** ごみ箱から戻す */
projects.post('/:id/restore', (c) => {
  purgeExpiredTrash();
  const id = c.req.param('id');
  // ごみ箱に見えるものだけ戻せる（練習用の案件を、ほかの人がIDを直接指定して戻すことはできない）
  const { where, args } = visibleTo(c.get('user'));
  const row = db.prepare(`SELECT p.id FROM projects p WHERE p.id = ? AND p.deleted_at IS NOT NULL AND ${where}`).get(id, ...args);
  if (!row) {
    return c.json({ error: 'その案件は、ごみ箱にありません。30日を過ぎて完全に消えたか、すでに戻されています。「図面一覧」を見直してください。' }, 404);
  }
  db.prepare('UPDATE projects SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);
  return c.json({ ok: true });
});

projects.post('/', async (c) => {
  const { name, answers } = (await c.req.json().catch(() => ({}))) as { name?: string; answers?: unknown };
  const id = newId();
  const t = now();
  // 最初から入れておく回答（図面の名称を事業場名称の初期値にするなど）。オブジェクト以外は無視する
  const initial = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers, owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, (name ?? '').trim() || '無題の案件', t, t, c.get('user').id, JSON.stringify(initial), c.get('user').id);
  takeLock(id, c.get('user').id);
  return c.json({ id, updatedAt: t }, 201);
});

projects.get('/:id', (c) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(c.req.param('id')) as ProjectRow | undefined;
  if (!row) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  if (!canTouch(c.get('user'), row.id)) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
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
  const exists = db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!exists) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);

  // 他の人が編集中なら保存させない（あとから保存したほうで上書きされるのを防ぐ）。
  // ただし管理用のアカウントは、編集中でも上書きできる
  const user = c.get('user');
  if (!canTouch(user, id)) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  const lock = currentLock(id);
  if (lock && lock.userId !== user.id && user.role !== 'admin') {
    return c.json({ error: `${lock.userName}さんが編集中のため保存できません。${lock.userName}さんの編集が終わるのを待つか、${lock.userName}さんに連絡してください。`, lock }, 409);
  }
  takeLock(id, user.id);

  const body = (await c.req.json().catch(() => null)) as
    | { name?: string; answers?: unknown; drawing?: unknown; baseUpdatedAt?: string; force?: boolean }
    | null;
  if (!body) return c.json({ error: 'うまく受け取れませんでした。もう一度お試しください。' }, 400);

  // 同じ人が別の端末や別の画面で保存していたら、そのまま上書きしない。
  // 「読み込んだ（または最後に保存した）時点の更新時刻」と、いまの更新時刻が違えば、あいだに誰かが保存している。
  // baseUpdatedAt を送らない古い画面は、これまでどおり確かめない
  if (body.baseUpdatedAt !== undefined && !body.force) {
    const cur = db.prepare('SELECT updated_at, updated_by FROM projects WHERE id = ?').get(id) as
      | { updated_at: string; updated_by: string | null }
      | undefined;
    if (cur && cur.updated_at !== body.baseUpdatedAt) {
      const by = cur.updated_by
        ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(cur.updated_by) as { name: string } | undefined)?.name ??
          cur.updated_by)
        : null;
      return c.json(
        {
          error:
            'この案件は、この画面で読み込んだあとに、ほかの端末や画面で更新されています。上書きするか、最新を読み込み直すかを選んでください。',
          stale: true,
          updatedAt: cur.updated_at,
          updatedByName: by,
        },
        409,
      );
    }
  }

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
  if (!db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(id)) {
    return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  }
  const user = c.get('user');
  if (!canTouch(user, id)) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  const { force } = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const lock = currentLock(id);
  // 管理用のアカウントは、確認なしで編集を引き継げる
  if (lock && lock.userId !== user.id && !force && user.role !== 'admin') {
    return c.json({ error: `${lock.userName}さんが編集中です。${lock.userName}さんの編集が終わるのを待つか、${lock.userName}さんに連絡してください。`, lock }, 409);
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
  if (!canTouch(c.get('user'), id)) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  const held = currentLock(id);
  if (held && held.userId !== c.get('user').id && c.get('user').role !== 'admin') {
    return c.json({ error: `${held.userName}さんが編集中のため削除できません。${held.userName}さんの編集が終わってから、もう一度お試しください。`, lock: held }, 409);
  }
  // 本当には消さず、ごみ箱へ入れる（30日間は戻せる）。写真もそのまま残す
  const r = db
    .prepare('UPDATE projects SET deleted_at = ?, deleted_by = ?, locked_by = NULL, locked_at = NULL WHERE id = ? AND deleted_at IS NULL')
    .run(now(), c.get('user').id, id);
  if (Number(r.changes) === 0) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  return c.json({ ok: true });
});

/* ---------------- 現地写真 ---------------- */

projects.post('/:id/files', async (c) => {
  const projectId = c.req.param('id');
  if (!db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId)) {
    return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  }
  if (!canTouch(c.get('user'), projectId)) return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  const held = currentLock(projectId);
  if (held && held.userId !== c.get('user').id && c.get('user').role !== 'admin') {
    return c.json({ error: `${held.userName}さんが編集中のため追加できません。${held.userName}さんの編集が終わってから、もう一度お試しください。`, lock: held }, 409);
  }
  const body = (await c.req.json().catch(() => null)) as
    | { fileName?: string; mediaType?: string; data?: string }
    | null;
  if (!body?.data || !body.mediaType) return c.json({ error: '画像が選ばれていません。画像を選んでから、もう一度お試しください。' }, 400);
  if (!isPhotoType(body.mediaType)) {
    return c.json({ error: `この種類のファイルは追加できません（${String(body.mediaType).slice(0, 40)}）。JPEG・PNG などの写真を選んでください。` }, 400);
  }

  const buf = Buffer.from(body.data, 'base64');
  if (buf.byteLength > MAX_FILE_BYTES) {
    return c.json({ error: `画像が大きすぎます（1枚${MAX_FILE_BYTES / 1024 / 1024}MBまで）。画像を小さくするか、別の画像でお試しください。` }, 413);
  }
  const id = newId();
  writeFileSync(resolve(FILES_DIR, id), buf);
  db.prepare(
    'INSERT INTO project_files (id, project_id, file_name, media_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, String(body.fileName ?? '写真').slice(0, 200), body.mediaType, buf.byteLength, now());
  return c.json({ id, size: buf.byteLength }, 201);
});

projects.get('/:id/files/:fileId', (c) => {
  if (!canTouch(c.get('user'), c.req.param('id'))) return c.json({ error: '画像が見つかりません。すでに消されたようです。案件の画面を見直してください。' }, 404);
  const row = db
    .prepare(
      `SELECT f.id, f.media_type FROM project_files f JOIN projects p ON p.id = f.project_id
       WHERE f.id = ? AND f.project_id = ? AND p.deleted_at IS NULL`,
    )
    .get(c.req.param('fileId'), c.req.param('id')) as { id: string; media_type: string } | undefined;
  if (!row) return c.json({ error: '画像が見つかりません。すでに消されたようです。案件の画面を見直してください。' }, 404);
  try {
    const buf = readFileSync(resolve(FILES_DIR, row.id));
    return c.body(buf as unknown as ArrayBuffer, 200, {
      // 以前に入れられたものに、写真以外の種類が混ざっていても、画面として動かさない
      'content-type': isPhotoType(row.media_type) ? row.media_type : 'application/octet-stream',
      'content-security-policy': FILE_CSP,
      'cache-control': 'private, max-age=86400',
    });
  } catch {
    return c.json({ error: '画像のデータが見つかりません。お手数ですが、画像をもう一度追加してください。' }, 404);
  }
});

projects.delete('/:id/files/:fileId', (c) => {
  if (!canTouch(c.get('user'), c.req.param('id'))) return c.json({ error: '画像が見つかりません。すでに消されたようです。案件の画面を見直してください。' }, 404);
  const fileId = c.req.param('fileId');
  const r = db.prepare('DELETE FROM project_files WHERE id = ? AND project_id = ?').run(fileId, c.req.param('id'));
  if (Number(r.changes) === 0) return c.json({ error: '画像が見つかりません。すでに消されたようです。案件の画面を見直してください。' }, 404);
  try {
    unlinkSync(resolve(FILES_DIR, fileId));
  } catch {
    // 既に消えていれば問題ない
  }
  return c.json({ ok: true });
});
