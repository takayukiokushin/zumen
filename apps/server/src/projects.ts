import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { FILES_DIR, db, now } from './db.ts';
import { isPlainObject, parseObject, readBody, text } from './input.ts';
import { keepOnlyLayers, summarizeLayers, wouldDropLayers } from './layers.ts';
import { searchFields, searchTerms } from './search.ts';
import { newId, requireAuth } from './auth.ts';
import type { User } from './auth.ts';
import { FILE_CSP, isPhotoType } from './security.ts';
import { clearForDuplicate, MAX_TEXT_LENGTH } from '@zumen/knowledge';

/** 案件（プロジェクト）の保存・呼び出し。ヒアリング回答・図面・現地写真を一式で扱う */

/** 現地写真の上限（1枚あたり） */
/** 案件名が長すぎるときの知らせ（上限は MAX_TEXT_LENGTH ＝ 100文字） */
const NAME_TOO_LONG = '案件名は100文字までです。短くしてから、もう一度お試しください。';
/** 古い画面から保存しようとして、レイヤーが消えてしまうとき */
const OLD_SCREEN_LAYERS =
  'この画面は、古い版のまま開かれています。このまま保存すると、レイヤー（停電範囲図など）の内容が消えてしまうため、保存を止めました。画面を読み込み直してから、もう一度お試しください。';
const MAX_FILE_BYTES = 12 * 1024 * 1024;
/** PDF（スキャンした図面など）は、写真より大きくなりやすいので、上限を広げる */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

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
  /** スケッチ・PDFを読み取った案件なら 1 */
  sketch_read: number;
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
  // 編集中の印を付けた人が、消されていたら、その人は編集していない。印は無かったことにする
  if (row.user_name === null) return null;
  return { userId: row.locked_by, userName: row.user_name, since: row.locked_at };
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

/**
 * その案件の写真・PDF（読み取りに使ったもの）を、データベースとディスクから消す。消した枚数を返す。
 * 読み取りに使った画像は、図面を作って「保存」を押したあとは要らないので、残さない。
 */
function removeProjectFiles(projectId: string): number {
  const rows = db.prepare('SELECT id FROM project_files WHERE project_id = ?').all(projectId) as { id: string }[];
  db.prepare('DELETE FROM project_files WHERE project_id = ?').run(projectId);
  for (const f of rows) {
    try {
      unlinkSync(resolve(FILES_DIR, f.id));
    } catch {
      // ファイルが既に無くても、データベースから消せていれば問題ない
    }
  }
  return rows.length;
}

/** 下書きを、保存の期限（日数）。これを過ぎた下書きは、消す */
const DRAFT_DAYS = 30;

/** その人が書いた、この案件の下書き。無ければ null */
function draftOf(projectId: string, userId: string) {
  const d = db.prepare('SELECT * FROM project_drafts WHERE project_id = ? AND user_id = ?').get(projectId, userId) as
    | {
        name: string | null;
        answers: string;
        drawing: string | null;
        sketch_read: number;
        base_updated_at: string | null;
        saved_at: string;
      }
    | undefined;
  if (!d) return null;
  try {
    return {
      savedAt: d.saved_at,
      name: d.name,
      answers: parseObject(d.answers, {}),
      drawing: parseObject(d.drawing, null),
      sketchRead: d.sketch_read === 1,
      baseUpdatedAt: d.base_updated_at,
    };
  } catch {
    return null;
  }
}

/** 古い下書きを消す */
export function purgeOldDrafts(): number {
  const cutoff = new Date(Date.now() - DRAFT_DAYS * 86400_000).toISOString();
  return Number(db.prepare('DELETE FROM project_drafts WHERE saved_at < ?').run(cutoff).changes);
}

export interface PhotoPurgeResult {
  /** 写真・PDFがある案件の数（ごみ箱の中も含む） */
  projects: number;
  /** 写真・PDFの数 */
  files: number;
  bytes: number;
  /** データベースに記録が無いのに、ディスクに残っていたファイルの数 */
  orphans: number;
}

/**
 * 保存されている写真・PDFを、全部の案件から消す（案件の回答・図面は、そのまま）。
 * 以前の版が預かっていた写真を、まとめて片付けるためのもの。「読み取った案件」の印は、消す前に付けておく。
 * execute が false のときは、消さずに、何が消えるかだけ数える。
 */
export function purgeAllPhotos(execute: boolean): PhotoPurgeResult {
  const rows = db.prepare('SELECT id, project_id, size FROM project_files').all() as {
    id: string;
    project_id: string;
    size: number;
  }[];
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const known = new Set(rows.map((r) => r.id));
  let orphanNames: string[] = [];
  try {
    orphanNames = readdirSync(FILES_DIR).filter((n) => !known.has(n) && statSync(resolve(FILES_DIR, n)).isFile());
  } catch {
    // フォルダが無ければ、残っているファイルも無い
  }
  if (execute) {
    for (const pid of projectIds) {
      db.prepare('UPDATE projects SET sketch_read = 1 WHERE id = ?').run(pid);
      removeProjectFiles(pid);
    }
    for (const n of orphanNames) {
      try {
        unlinkSync(resolve(FILES_DIR, n));
      } catch {
        // 消せなければ、次の機会に
      }
    }
  }
  return { projects: projectIds.length, files: rows.length, bytes: rows.reduce((n, r) => n + r.size, 0), orphans: orphanNames.length };
}

/** ごみ箱に入れてから期限を過ぎた案件を、写真ごと完全に消す。消した件数を返す */
export function purgeExpiredTrash(): number {
  const cutoff = new Date(Date.now() - TRASH_MS).toISOString();
  const old = db.prepare('SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as {
    id: string;
  }[];
  for (const { id } of old) {
    removeProjectFiles(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
  return old.length;
}

/**
 * その人が作った案件を、写真・下書きごと、完全に消す（ごみ箱には入れない）。消した件数を返す。
 * 練習用のアカウントを消したときに使う。練習用の案件は、練習用の本人（たち）にしか見えない決まりなので、
 * 持ち主がいなくなると、だれにも見えない・だれも消せない案件が残ってしまうため、いっしょに消す。
 */
export function purgeProjectsOwnedBy(userId: string): number {
  const rows = db.prepare('SELECT id FROM projects WHERE owner = ?').all(userId) as { id: string }[];
  for (const { id } of rows) {
    removeProjectFiles(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
  return rows.length;
}

export const projects = new Hono<{ Variables: { user: User } }>();
projects.use('*', requireAuth);

/** 案件名・回答が変わったら、一覧に出す事業場名称・お客様番号と、探すための文字を、作り直す */
function refreshSearch(id: string): void {
  const r = db.prepare('SELECT name, answers FROM projects WHERE id = ?').get(id) as { name: string; answers: string } | undefined;
  if (!r) return;
  let a: unknown = {};
  try {
    a = JSON.parse(r.answers);
  } catch {
    // 壊れた回答は、空として扱う
  }
  const f = searchFields(r.name, a);
  db.prepare('UPDATE projects SET site_name = ?, customer_no = ?, search_text = ?, name_sort = ? WHERE id = ?').run(f.site, f.no, f.text, f.sort, id);
}

/** 並び順（名前→並べ方の書き方）。知らない名前が来たら、標準（更新が新しい順）にする */
const LIST_SORTS: Record<string, string> = {
  updated_desc: 'p.updated_at DESC',
  updated_asc: 'p.updated_at ASC',
  created_desc: 'p.created_at DESC',
  created_asc: 'p.created_at ASC',
  name_asc: 'p.name_sort ASC',
  name_desc: 'p.name_sort DESC',
};

/** 一覧で、1回に返せる件数の上限 */
const LIST_MAX = 200;
const LIST_DEFAULT = 50;

/**
 * 一覧（中身は返さない）。
 *   q      … 探す言葉。案件名・事業場名称・お客様番号のどれかに含まれるもの（空白で区切ると、全部の言葉を含むもの）。
 *            大文字・小文字、全角・半角は区別しない。サーバー側で絞るので、件数が増えても速い
 *   sort   … 並び順。updated_desc（更新が新しい順・標準）／updated_asc／created_desc（新規作成が新しい順）／created_asc／name_asc（名前順）／name_desc
 *   limit  … 1回に返す件数（1〜200。省略すると、50件。limit も offset も省くと、全件を返す＝古い画面との互換）
 *   offset … 何件目から返すか（「さらに表示」で、続きをもらうのに使う）
 * 新しい順（更新日）。total は、絞り込んだあとの全件数。
 */
projects.get('/', (c) => {
  const user = c.get('user');
  const { where: visible, args } = visibleTo(user);
  const q = (c.req.query('q') ?? '').trim();
  const paged = c.req.query('limit') !== undefined || c.req.query('offset') !== undefined;
  const limit = Math.min(LIST_MAX, Math.max(1, Math.floor(Number(c.req.query('limit'))) || LIST_DEFAULT));
  const offset = Math.min(1_000_000_000, Math.max(0, Math.floor(Number(c.req.query('offset'))) || 0));
  // 探す言葉を、空白で区切って、全部を含むものを探す。LIKE の特別な文字（% _ \）は、ふつうの文字として探す
  const terms = searchTerms(q);
  const likes = terms.map((w) => `%${w.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  const orderBy = LIST_SORTS[c.req.query('sort') ?? ''] ?? LIST_SORTS.updated_desc!;
  const where = `WHERE p.deleted_at IS NULL AND ${visible}${likes.map(() => " AND p.search_text LIKE ? ESCAPE '\\'").join('')}`;
  const whereArgs = [...args, ...likes];
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM projects p ${where}`).get(...whereArgs) as { n: number }).n);
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.created_at, p.updated_at, p.updated_by, p.site_name, p.customer_no,
              (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count
       FROM projects p ${where} ORDER BY ${orderBy}, p.id${paged ? ' LIMIT ? OFFSET ?' : ''}`,
    )
    .all(...whereArgs, ...(paged ? [limit, offset] : [])) as { id: string }[];
  return c.json({
    projects: rows.map((r) => ({ ...r, lock: currentLock(r.id) })),
    total,
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
      // 消した人が、すでに消されている利用者のとき：名前は null、deletedByRemoved が true（画面は「削除された利用者」と出す）
      deletedBy: r.deleted_by_name,
      deletedByRemoved: r.deleted_by_name === null && r.deleted_by !== null,
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
      updatedBy: r.updated_by_name,
      updatedByRemoved: r.updated_by_name === null && r.updated_by !== null,
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
  const sourceId = text((await readBody(c)).sourceId);
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
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers, drawing, owner, sketch_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, t, t, user.id, src.answers, src.drawing, user.id, src.sketch_read ?? 0);

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
  refreshSearch(id);
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
projects.post('/:id/duplicate', async (c) => {
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
  // レイヤー（停電範囲図など）は、頼まれたものだけを複製する（何も頼まれなければ、1つも複製しない。意図せず写さないため）
  const body = await readBody(c);
  const layerIds = Array.isArray(body.layers) ? body.layers.filter((x): x is string => typeof x === 'string') : [];
  const id = newId();
  const t = now();
  const name = '無題の案件';
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers, drawing, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, t, t, user.id, JSON.stringify(clearForDuplicate(answers as never)), keepOnlyLayers(withoutHandwrittenMemos(src.drawing), layerIds), user.id);
  refreshSearch(id);
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
  const body = await readBody(c);
  const name = text(body.name).trim();
  const answers = body.answers;
  // 案件名は必須。空のままでは作らない
  if (!name) return c.json({ error: '案件名を入力してください。' }, 400);
  if (name.length > MAX_TEXT_LENGTH) return c.json({ error: NAME_TOO_LONG }, 400);
  const id = newId();
  const t = now();
  // 最初から入れておく回答（図面の名称を事業場名称の初期値にするなど）。オブジェクト以外は無視する
  const initial = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  db.prepare(
    'INSERT INTO projects (id, name, created_at, updated_at, updated_by, answers, owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, t, t, c.get('user').id, JSON.stringify(initial), c.get('user').id);
  refreshSearch(id);
  takeLock(id, c.get('user').id);
  return c.json({ id, updatedAt: t }, 201);
});

/** 複製のときに尋ねる、図面のレイヤーの一覧（案件は開かない。編集中の印も取らない） */
projects.get('/:id/layers', (c) => {
  const row = db.prepare('SELECT id, drawing FROM projects WHERE id = ? AND deleted_at IS NULL').get(c.req.param('id')) as
    | { id: string; drawing: string | null }
    | undefined;
  if (!row || !canTouch(c.get('user'), row.id)) {
    return c.json({ error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' }, 404);
  }
  return c.json({ layers: summarizeLayers(row.drawing) });
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
    answers: parseObject(row.answers, {}),
    drawing: parseObject(row.drawing, null),
    files,
    // 保存していない入力を、自動で控えたもの（書いた本人にだけ返す）
    draft: draftOf(row.id, c.get('user').id),
    // 写真は保存したときに消すので、「読み取った案件か」は、写真の有無とは別に覚えている
    sketchRead: row.sketch_read === 1 || files.some((f) => { const m = (f as { media_type: string }).media_type; return m.startsWith('image/') || m === 'application/pdf'; }),
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
    | { name?: string; answers?: unknown; drawing?: unknown; sketchRead?: boolean; baseUpdatedAt?: string; force?: boolean }
    | null;
  if (!body) return c.json({ error: 'うまく受け取れませんでした。もう一度お試しください。' }, 400);
  // 回答と図面は、「項目名と値の組」の形で届く。ほかの形（文字・数字・配列）は、保存すると、案件が開けなくなるので受け付けない
  if ((body.answers != null && !isPlainObject(body.answers)) || (body.drawing != null && !isPlainObject(body.drawing))) {
    return c.json({ error: 'うまく受け取れませんでした。もう一度お試しください。' }, 400);
  }
  // バージョンアップ前の古い画面は、レイヤーを知らない。そのまま保存すると消えてしまうので、止める
  if (body.drawing != null) {
    const stored = (db.prepare('SELECT drawing FROM projects WHERE id = ?').get(id) as { drawing: string | null } | undefined)?.drawing ?? null;
    if (wouldDropLayers(stored, body.drawing)) return c.json({ error: OLD_SCREEN_LAYERS, oldScreen: true }, 400);
  }

  // 同じ人が別の端末や別の画面で保存していたら、そのまま上書きしない。
  // 「読み込んだ（または最後に保存した）時点の更新時刻」と、いまの更新時刻が違えば、あいだに誰かが保存している。
  // baseUpdatedAt を送らない古い画面は、これまでどおり確かめない
  if (body.baseUpdatedAt !== undefined && !body.force) {
    const cur = db.prepare('SELECT updated_at, updated_by FROM projects WHERE id = ?').get(id) as
      | { updated_at: string; updated_by: string | null }
      | undefined;
    if (cur && cur.updated_at !== body.baseUpdatedAt) {
      // 更新した人の名前。その人がすでに消されている利用者なら、名前は null、byRemoved が true
      const by = cur.updated_by
        ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(cur.updated_by) as { name: string } | undefined)?.name ?? null)
        : null;
      const byRemoved = by === null && cur.updated_by !== null;
      return c.json(
        {
          error:
            'この案件は、この画面で読み込んだあとに、ほかの端末や画面で更新されています。上書きするか、最新を読み込み直すかを選んでください。',
          stale: true,
          updatedAt: cur.updated_at,
          updatedByName: by,
          updatedByRemoved: byRemoved,
        },
        409,
      );
    }
  }

  const sets: string[] = ['updated_at = ?', 'updated_by = ?'];
  const args: (string | null)[] = [now(), user.id];
  if (typeof body.name === 'string') {
    // 案件名は必須。空のままでは変えさせない
    if (!body.name.trim()) return c.json({ error: '案件名を入力してください。' }, 400);
    if (body.name.trim().length > MAX_TEXT_LENGTH) return c.json({ error: NAME_TOO_LONG }, 400);
    sets.push('name = ?');
    args.push(body.name.trim());
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
  // 案件名・回答が変わったので、一覧の検索用の文字も、作り直す
  refreshSearch(id);
  // 「保存」を押したら、読み取りに使った写真・PDFは消す（図面の元になる内容は、回答と図面として、いま保存した）。
  // 「読み取った案件か」の印は、写真が無くなっても残す
  let removed = 0;
  if (body.answers !== undefined) {
    removed = removeProjectFiles(id);
    // 保存できたので、自動で控えた下書きは、もう要らない
    db.prepare('DELETE FROM project_drafts WHERE project_id = ?').run(id);
  }
  if (removed > 0 || body.sketchRead === true) db.prepare('UPDATE projects SET sketch_read = 1 WHERE id = ?').run(id);
  return c.json({ ok: true, updatedAt: args[0] });
});

/* ---------------- 下書き（自動で控える） ---------------- */

/**
 * 画面が、保存していない入力を、一定の間隔で預ける。案件そのものは、書き換えない（「保存」を押すまで、確定しない）。
 * 開いたとき、書いた本人にだけ、「復元するか」を尋ねる。「保存」を押すと、下書きは消える。
 * 編集中の印は、取らない（印を取るのは、保存と、1分ごとの更新）。
 */
projects.put('/:id/draft', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const NOT_FOUND = { error: '案件が見つかりません。すでに消されたか、見られない案件です。「図面一覧」から選び直してください。' };
  if (!db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(id)) return c.json(NOT_FOUND, 404);
  if (!canTouch(user, id)) return c.json(NOT_FOUND, 404);
  const lock = currentLock(id);
  if (lock && lock.userId !== user.id && user.role !== 'admin') {
    return c.json({ error: `${lock.userName}さんが編集中のため保存できません。${lock.userName}さんの編集が終わるのを待つか、${lock.userName}さんに連絡してください。`, lock }, 409);
  }
  const body = (await c.req.json().catch(() => null)) as
    | { name?: unknown; answers?: unknown; drawing?: unknown; sketchRead?: unknown; baseUpdatedAt?: unknown }
    | null;
  if (!body || typeof body.answers !== 'object' || body.answers === null || Array.isArray(body.answers)) {
    return c.json({ error: 'うまく受け取れませんでした。もう一度お試しください。' }, 400);
  }
  const t = now();
  db.prepare(
    `INSERT INTO project_drafts (project_id, user_id, name, answers, drawing, sketch_read, base_updated_at, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, answers = excluded.answers,
       drawing = excluded.drawing, sketch_read = excluded.sketch_read, base_updated_at = excluded.base_updated_at,
       saved_at = excluded.saved_at`,
  ).run(
    id,
    user.id,
    typeof body.name === 'string' ? body.name.slice(0, 200) : null,
    JSON.stringify(body.answers),
    body.drawing && typeof body.drawing === 'object' ? JSON.stringify(body.drawing) : null,
    body.sketchRead === true ? 1 : 0,
    typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null,
    t,
  );
  return c.json({ ok: true, savedAt: t });
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
  if (typeof body?.data !== 'string' || typeof body.mediaType !== 'string' || !body.data || !body.mediaType) return c.json({ error: '画像が選ばれていません。画像を選んでから、もう一度お試しください。' }, 400);
  if (!isPhotoType(body.mediaType)) {
    return c.json({ error: `この種類のファイルは追加できません（${String(body.mediaType).slice(0, 40)}）。JPEG・PNG などの写真、または PDF を選んでください。` }, 400);
  }

  const buf = Buffer.from(body.data, 'base64');
  const maxBytes = body.mediaType === 'application/pdf' ? MAX_PDF_BYTES : MAX_FILE_BYTES;
  if (buf.byteLength > maxBytes) {
    return c.json({ error: `ファイルが大きすぎます（1つ${maxBytes / 1024 / 1024}MBまで）。小さくするか、別のファイルでお試しください。` }, 413);
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
