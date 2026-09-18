/**
 * 質問の出し分け・構成の分岐に使う条件式。
 *
 * 条件をコードではなくデータ（JSONにできる形）で書けるようにしている。
 * 新しい分岐が増えても、ルールを1件足すだけで済むようにするため。
 */

export type Value = string | number | boolean | null | undefined;

/** 回答の集まり。キーは質問ID */
export type Answers = Record<string, Value>;

export type Condition =
  | { key: string; eq: Value }
  | { key: string; ne: Value }
  | { key: string; in: Value[] }
  | { key: string; gt: number }
  | { key: string; lte: number }
  | { key: string; answered: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export function evaluate(cond: Condition | undefined, answers: Answers): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c) => evaluate(c, answers));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, answers));
  if ('not' in cond) return !evaluate(cond.not, answers);

  const v = answers[cond.key];
  if ('eq' in cond) return v === cond.eq;
  if ('ne' in cond) return v !== cond.ne;
  if ('in' in cond) return cond.in.includes(v as Value);
  if ('gt' in cond) return typeof v === 'number' && v > cond.gt;
  if ('lte' in cond) return typeof v === 'number' && v <= cond.lte;
  if ('answered' in cond) return v !== undefined && v !== null && v !== '';
  return true;
}

/** 条件式が参照している質問IDを列挙する（依存関係の検証に使う） */
export function referencedKeys(cond: Condition | undefined, out: Set<string> = new Set()): Set<string> {
  if (!cond) return out;
  if ('all' in cond) cond.all.forEach((c) => referencedKeys(c, out));
  else if ('any' in cond) cond.any.forEach((c) => referencedKeys(c, out));
  else if ('not' in cond) referencedKeys(cond.not, out);
  else out.add(cond.key);
  return out;
}

/**
 * 「{questionId}」を回答で置き換える。
 * 差し込みの値が1つでも無い行は、その行ごと落とす（「7200VA」のような中途半端な
 * 文字が図面に出ないようにするため）。差し込みの無い行はそのまま残す。
 */
export function fillTemplate(lines: string[], answers: Answers): string[] {
  const out: string[] = [];
  for (const line of lines) {
    let missing = false;
    const filled = line.replace(/\{([\w.]+)\}/g, (_, key: string) => {
      const v = answers[key];
      if (v === undefined || v === null || v === '') {
        missing = true;
        return '';
      }
      return String(v);
    });
    if (missing) continue;
    const trimmed = filled.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
