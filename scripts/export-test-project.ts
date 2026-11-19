/**
 * 試験用の案件を、ファイル（JSON）に書き出す（読むだけ。案件のデータは、書き換えない・消さない）。
 * サーバー用パソコンの案件を、開発の側で調べるために使う（第17弾 項目7）。
 *
 *   DATA_DIR=<案件のフォルダ> node --experimental-strip-types scripts/export-test-project.ts <案件名の一部>
 *
 * 書き出すのは、案件の名前・入力の答え・編集した図面だけ（利用者・パスワード・APIキーは、入らない）。
 * 出力先：shared-test-data/<番号>.json（番号は、案件の識別子）。
 * 試験用の案件だけに使うこと（お客様の実際の案件は、書き出さない）。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fragment = process.argv[2];
if (!fragment) {
  console.error('使い方：DATA_DIR=<案件のフォルダ> node --experimental-strip-types scripts/export-test-project.ts <案件名の一部>');
  process.exit(1);
}
const dataDir = resolve(process.env.DATA_DIR ?? resolve(process.cwd(), 'data'));
const dbPath = resolve(dataDir, 'zumen.db');
if (!existsSync(dbPath)) {
  console.error(`案件のデータが見つかりません：${dbPath}`);
  process.exit(1);
}
// 読むだけで開く（案件は、書き換わらない）
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare('SELECT id, name, created_at, updated_at, answers, drawing FROM projects WHERE name LIKE ? ORDER BY updated_at DESC')
  .all(`%${fragment}%`) as { id: string; name: string; created_at: string; updated_at: string; answers: string; drawing: string | null }[];
if (rows.length === 0) {
  console.error(`「${fragment}」を含む案件が見つかりません。`);
  process.exit(1);
}
const out = resolve(process.cwd(), 'shared-test-data');
mkdirSync(out, { recursive: true });
for (const r of rows) {
  const file = resolve(out, `${r.id}.json`);
  writeFileSync(file, JSON.stringify({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, answers: JSON.parse(r.answers), drawing: r.drawing ? JSON.parse(r.drawing) : null }, null, 1), 'utf-8');
  console.log(`書き出しました：${r.name}（${r.updated_at}）→ ${file}（${Math.round((r.drawing?.length ?? 0) / 1024)}KB の図面）`);
}
