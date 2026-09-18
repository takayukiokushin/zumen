import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 保存先。社内数名での利用のため、Node標準のSQLiteをそのまま使う。
 * データはサーバー側にだけ置き、利用者の端末には残さない。
 */
export const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
export const FILES_DIR = resolve(DATA_DIR, 'files');

mkdirSync(FILES_DIR, { recursive: true });

export const db = new DatabaseSync(resolve(DATA_DIR, 'zumen.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
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
    drawing    TEXT
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name  TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
`);

export const now = (): string => new Date().toISOString();
