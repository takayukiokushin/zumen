import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * データの置き場所。社内数名での利用のため、データはサーバー側にだけ置き、利用者の端末には残さない。
 * 既定の置き場所は、このファイルから見たリポジトリ直下の data/。
 * 起動ディレクトリによって保存先が変わると案件が行方不明になるため、cwdには依存させない。
 * （データベースを開かないよう、場所の決定だけを、db.ts から切り離してある）
 */
export const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : fileURLToPath(new URL('../../../data/', import.meta.url));
export const FILES_DIR = resolve(DATA_DIR, 'files');
