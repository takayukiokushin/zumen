import { db } from './db.ts';

/**
 * 「ひとつ前の保存」（作り直しや操作のまちがいを、あとから戻せるようにする控え）。
 *
 * ・案件ごとに、1世代だけ持つ。「保存」を押すと、保存する前の回答と図面を、「ひとつ前」に移す。
 * ・ただし、前に内容を保存してから、1時間以上あいたときだけ入れ替える（短い間に続けて保存しても、
 *   作業を始める前の内容が残るように）。
 * ・内容（回答・図面）が変わらない保存（案件名だけの変更など）では、入れ替えない。
 * ・何も入っていない案件（作ったばかり）は、控えない。
 * ・戻すときは、時間に関係なく、いまの内容と「ひとつ前」を入れ替える（もう一度戻せる）。
 */

/** 前の保存から、これだけ（ミリ秒）あいたときだけ、「ひとつ前」を入れ替える（1時間） */
export const PREVIOUS_MIN_GAP_MS = 60 * 60 * 1000;

export interface PreviousRow {
  answers: string;
  drawing: string | null;
  /** その内容を保存した時刻 */
  saved_at: string;
}

/** 案件の、いまの内容（保存する前の状態） */
export interface CurrentContent {
  answers: string;
  drawing: string | null;
  /** 内容（回答・図面）を最後に保存した時刻。無ければ、案件の最後の更新の時刻 */
  content_updated_at: string | null;
  updated_at: string;
}

const EMPTY_ANSWERS = '{}';

/** 「保存」で内容が変わるとき、必要なら、保存する前の内容を「ひとつ前」に移す。移したら true */
export function keepPrevious(projectId: string, cur: CurrentContent, nextAnswers: string, nextDrawing: string | null, nowMs: number): boolean {
  // 内容が変わらない保存では、入れ替えない
  if (nextAnswers === cur.answers && nextDrawing === cur.drawing) return false;
  // 何も入っていない案件は、控えない
  if (cur.answers === EMPTY_ANSWERS && cur.drawing === null) return false;
  const savedAt = cur.content_updated_at ?? cur.updated_at;
  const gap = nowMs - Date.parse(savedAt);
  // 時刻が読めないとき・時計が戻っているときは、安全のため、入れ替える
  if (Number.isFinite(gap) && gap >= 0 && gap < PREVIOUS_MIN_GAP_MS) return false;
  db.prepare('INSERT OR REPLACE INTO project_previous (project_id, answers, drawing, saved_at) VALUES (?, ?, ?, ?)').run(
    projectId,
    cur.answers,
    cur.drawing,
    savedAt,
  );
  return true;
}

/** 「ひとつ前」の保存の時刻（無ければ null） */
export function previousSavedAt(projectId: string): string | null {
  const r = db.prepare('SELECT saved_at FROM project_previous WHERE project_id = ?').get(projectId) as { saved_at: string } | undefined;
  return r?.saved_at ?? null;
}

export function previousOf(projectId: string): PreviousRow | null {
  return (db.prepare('SELECT answers, drawing, saved_at FROM project_previous WHERE project_id = ?').get(projectId) as PreviousRow | undefined) ?? null;
}
