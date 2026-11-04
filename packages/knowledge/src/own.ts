/**
 * 名前の表（「引込ケーブルの種類 → 表示名」など）から、**表に書いてある名前だけ**を引く。
 *
 * ふつうの `表[名前]` だと、名前が `constructor`・`__proto__`・`toString` などのとき、表にない名前でも、
 * JavaScript の中身（関数）が返ってきて、図面の文字に「function Object() …」のような文字が出たり、組み立てが止まったりする。
 * 値は、画面の選択肢から入るが、AI の読み取りや、保存済みのデータに、想定外の文字が入っていることもあるため、安全に引く。
 */
export function pickOwn<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
