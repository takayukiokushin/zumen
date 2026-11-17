import { QUESTION_DEFAULTS } from '@zumen/knowledge';
import { db } from './db.ts';

/**
 * 会社の設定。管理用のアカウントが、画面（利用者の管理 → 会社の設定）から変える。
 * いまは、「電柱の名称の頭の部分」（電力会社の呼び名。既定は「中電柱：」）だけ。
 * 新しい案件を作るとき・複製するときに、「引込元の名称」の欄の最初に入る。すでにある案件は、変わらない（案件の中に、文字が残るため）。
 */

/** 設定していないときの、電柱の名称の頭の部分（質問の既定値と同じ） */
export const DEFAULT_POLE_PREFIX = String(QUESTION_DEFAULTS.poleName ?? '中電柱：');
/** 頭の部分の、文字数の上限 */
export const POLE_PREFIX_MAX = 20;

const KEY = 'polePrefix';

/** いまの、電柱の名称の頭の部分（設定が無ければ、既定） */
export function getPolePrefix(): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  return row?.value || DEFAULT_POLE_PREFIX;
}

/** 設定している頭の部分。既定のままのとき（または未設定）は、空 */
export function customPolePrefix(): string {
  const p = getPolePrefix();
  return p === DEFAULT_POLE_PREFIX ? '' : p;
}

/**
 * 頭の部分を保存する。空にすると、既定（「中電柱：」）に戻る。
 * 入れられない文字・長すぎるときは、利用者への案内の文で、Error を投げる。保存した値（既定に戻したときは、既定）を返す。
 */
export function setPolePrefix(raw: string, userId: string): string {
  const value = raw.normalize('NFC').trim();
  // 改行・制御文字は入れられない（図面の1行に書くため）
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('電柱の名称の頭の部分に、改行などの特別な文字は入れられません。');
  if (Array.from(value).length > POLE_PREFIX_MAX) throw new Error(`電柱の名称の頭の部分は、${POLE_PREFIX_MAX}文字までです。短くしてから、もう一度保存してください。`);
  if (value === '' || value === DEFAULT_POLE_PREFIX) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(KEY);
    return DEFAULT_POLE_PREFIX;
  }
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
  ).run(KEY, value, new Date().toISOString(), userId);
  return value;
}

/** 会社の設定を、画面に返す形にする */
export function companySettings(): { polePrefix: string; defaultPolePrefix: string } {
  return { polePrefix: getPolePrefix(), defaultPolePrefix: DEFAULT_POLE_PREFIX };
}
