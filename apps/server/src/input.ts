import type { Context } from 'hono';

/**
 * 送られてきた内容を、安全に読む。
 * 画面からは、決まった形で届くが、想定外の形（数字・配列・空など）が届いても、エラーにしない。
 */

/** 本文を、オブジェクトとして読む。読めない・オブジェクトではないときは、空のオブジェクト */
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** 文字のときだけ、その文字。それ以外は、空 */
export const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 「項目名と値の組」（オブジェクト）か。配列・数字・文字・空は、違う */
export const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 保存してある文字（JSON）を、オブジェクトとして読む。壊れている・オブジェクトでないときは fallback */
export function parseObject<T extends Record<string, unknown> | null>(raw: string | null | undefined, fallback: T): Record<string, unknown> | T {
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return isPlainObject(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
