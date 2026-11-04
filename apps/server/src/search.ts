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

/**
 * 名前順に並べるための文字。
 *  - 全角・半角、大文字・小文字をそろえる
 *  - カタカナは、ひらがなにそろえる（「ソ」と「そ」を、同じ並びにする）
 *  - 数字は、桁をそろえて、数の大きさで並べる（「案件2」→「案件10」の順。文字として比べると「案件10」が先になってしまう）
 *  - 先頭の記号・空白は、無いものとして並べる
 * 漢字は読みが分からないので、漢字の並び（文字コードの順）になる（ひらがな・カタカナ・英数字のあとに並ぶ）。
 */
export function sortKey(name: string): string {
  const s = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/^[\p{P}\p{S}\s]+/u, '')
    .replace(/\d+/g, (d) => d.padStart(12, '0'));
  return s;
}

/** 一覧に出す事業場名称・お客様番号と、探すための文字 */
export function searchFields(name: string, answers: unknown): { site: string | null; no: string | null; text: string; sort: string } {
  const site = pick(answers, 'siteName');
  const no = pick(answers, 'customerNo');
  return { site, no, text: norm([name, site ?? '', no ?? ''].join('\n')), sort: sortKey(name) };
}

/** 探す言葉を、空白で区切った言葉に分ける（全部を含むものが見つかる）。多すぎる分は捨てる */
export function searchTerms(q: string): string[] {
  return norm(q).split(' ').filter(Boolean).slice(0, 5);
}
