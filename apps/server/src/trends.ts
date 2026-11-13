import { Hono } from 'hono';
import { TREND_MIN_COUNT, tallyTrends } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { db } from './db.ts';
import { parseObject } from './input.ts';
import { requireAuth } from './auth.ts';
import type { User } from './auth.ts';

/**
 * 過去の案件の「傾向」（第13弾 項目51）。
 *
 * 会社全体の案件（練習用・ごみ箱に入れたものは除く）の回答から、質問ごとに、選択肢の件数を数えて返す。
 * 返すのは、件数と割合のもとになる数だけ。ほかの案件の回答そのもの・案件の名前・お客様の名前は、返さない。
 * 数え方・件数が足りないときの扱いは、packages/knowledge/src/trends.ts。AI（Claude）は使わない。
 * 練習用のアカウントには、傾向を返さない（本番の案件から切り離しておくため）。
 */
export const trends = new Hono<{ Variables: { user: User } }>();
trends.use('*', requireAuth);

/** 集計のもとにする案件の数の上限（新しいものから）。十分に多いので、実際には、ほぼ全部が入る */
const MAX_PROJECTS = 5000;
let cache: { stamp: string; list: Answers[] } | null = null;

const SCOPE = `p.deleted_at IS NULL AND (p.owner IS NULL OR p.owner NOT IN (SELECT id FROM users WHERE role = 'sandbox'))`;

/** 本番の案件の回答の一覧。案件が増えた・保存された・消されたときだけ、読み直す（件数と、いちばん新しい更新時刻が変わったとき） */
function productionAnswers(): Answers[] {
  const s = db.prepare(`SELECT COUNT(*) AS n, MAX(p.updated_at) AS u FROM projects p WHERE ${SCOPE}`).get() as { n: number; u: string | null };
  const stamp = `${s.n}|${s.u ?? ''}`;
  if (cache && cache.stamp === stamp) return cache.list;
  const rows = db.prepare(`SELECT p.answers FROM projects p WHERE ${SCOPE} ORDER BY p.updated_at DESC LIMIT ?`).all(MAX_PROJECTS) as { answers: string }[];
  const list = rows.map((r) => parseObject(r.answers, {}) as Answers);
  cache = { stamp, list };
  return list;
}

/** 集計のやり直しを促す（試験用） */
export function resetTrendCache(): void {
  cache = null;
}

trends.get('/', (c) => {
  if (c.get('user').role === 'sandbox') return c.json({ min: TREND_MIN_COUNT, projects: 0, trends: {} });
  const context = (c.req.query('context') ?? '').slice(0, 40);
  const list = productionAnswers();
  return c.json({ min: TREND_MIN_COUNT, projects: list.length, trends: tallyTrends(list, context || undefined) });
});
