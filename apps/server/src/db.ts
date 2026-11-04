import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 保存先。社内数名での利用のため、Node標準のSQLiteをそのまま使う。
 * データはサーバー側にだけ置き、利用者の端末には残さない。
 */
import { DATA_DIR, FILES_DIR } from './data-dir.ts';
import { searchFields } from './search.ts';
export { DATA_DIR, FILES_DIR };

mkdirSync(FILES_DIR, { recursive: true });

export const db = new DatabaseSync(resolve(DATA_DIR, 'zumen.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    -- admin（管理用）／ member（標準）／ sandbox（練習用）
    role          TEXT NOT NULL DEFAULT 'member'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    -- ヒアリングの回答
    answers    TEXT NOT NULL DEFAULT '{}',
    -- 編集した図面（未編集なら null）
    drawing    TEXT,
    -- 編集中の人（誰も編集していなければ null）
    locked_by  TEXT,
    locked_at  TEXT,
    -- 作った人。練習用のアカウントは、自分が作ったものだけを扱う
    owner      TEXT
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name  TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 下書き（「保存」を押す前の入力を、画面が自動で控えたもの）。案件ごとに1つ。「保存」を押すと消える
  CREATE TABLE IF NOT EXISTS project_drafts (
    project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    name            TEXT,
    answers         TEXT NOT NULL,
    drawing         TEXT,
    sketch_read     INTEGER NOT NULL DEFAULT 0,
    -- 下書きのもとにした、案件の更新時刻（別の人が先に保存していないかを、あとで確かめるため）
    base_updated_at TEXT,
    saved_at        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
  CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
`);

/**
 * 後から足した列を、既に使っているデータベースにも入れる。
 * 同じ列を二度足そうとすると失敗するので、無ければ足す形にしている。
 */
function addColumnIfMissing(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

addColumnIfMissing('projects', 'locked_by', 'TEXT');
addColumnIfMissing('projects', 'locked_at', 'TEXT');
addColumnIfMissing('projects', 'owner', 'TEXT');
// 消した日時と、消した人。入っている案件は「ごみ箱」にあり、一覧には出ない（一定期間は戻せる）
addColumnIfMissing('projects', 'deleted_at', 'TEXT');
addColumnIfMissing('projects', 'deleted_by', 'TEXT');
// スケッチ・PDFを読み取った案件か（読み取りに使った写真は、保存したときに消すので、写真の有無とは別に覚える）
addColumnIfMissing('projects', 'sketch_read', 'INTEGER NOT NULL DEFAULT 0');
// 図面一覧に出す事業場名称・お客様番号と、探すための文字（案件名・事業場名称・お客様番号を、整えてひとつにしたもの）
addColumnIfMissing('projects', 'site_name', 'TEXT');
addColumnIfMissing('projects', 'customer_no', 'TEXT');
addColumnIfMissing('projects', 'search_text', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'role', "TEXT NOT NULL DEFAULT 'member'");

const userVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

/**
 * ログインの印の保存の形を変えた（user_version 1）。古い形のものは使えないので、一度だけ捨てる
 * （全員、もう一度ログインすることになる。案件のデータには影響しない）。
 */
if (userVersion < 1) {
  db.exec('DELETE FROM sessions');
}

/** 回答の中の事業場名称・お客様番号を、探すための列に写す（user_version 2。以前からある案件の分を、一度だけ） */
if (userVersion < 2) {
  const rows = db.prepare('SELECT id, name, answers FROM projects').all() as { id: string; name: string; answers: string }[];
  const upd = db.prepare('UPDATE projects SET site_name = ?, customer_no = ?, search_text = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const r of rows) {
    let a: unknown = {};
    try {
      a = JSON.parse(r.answers);
    } catch {
      // 壊れた回答は、空として扱う
    }
    const f = searchFields(r.name, a);
    upd.run(f.site, f.no, f.text, r.id);
  }
  db.exec('COMMIT');
}
if (userVersion < 2) db.exec('PRAGMA user_version = 2');

export const now = (): string => new Date().toISOString();
