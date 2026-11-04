/**
 * 図面一覧の検索のための、言葉の整え方。
 * 案件名・事業場名称・お客様番号を、ひとつにまとめた「探すための文字」を作る。
 * 全角・半角の違い（ＡＢＣ／ABC、１２３／123）と、大文字・小文字の違いは、同じものとして探せるようにする。
 */

/** 全角・半角をそろえ、小文字にして、空白を1つにする */
export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 回答の中の文字の項目を、文字として取り出す（空なら null） */
function pick(answers: unknown, key: string): string | null {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const v = (answers as Record<string, unknown>)[key];
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  return s.trim() === '' ? null : s.trim();
}

/** 一覧に出す事業場名称・お客様番号と、探すための文字 */
export function searchFields(name: string, answers: unknown): { site: string | null; no: string | null; text: string } {
  const site = pick(answers, 'siteName');
  const no = pick(answers, 'customerNo');
  return { site, no, text: norm([name, site ?? '', no ?? ''].join('\n')) };
}

/** 探す言葉を、空白で区切った言葉に分ける（全部を含むものが見つかる）。多すぎる分は捨てる */
export function searchTerms(q: string): string[] {
  return norm(q).split(' ').filter(Boolean).slice(0, 5);
}
