import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * リポジトリ直下の .env を読み込む。
 *
 * サーバーもコマンドも、まずこれを読み込んでから動かす。
 * 既に環境変数が設定されている場合は、そちらが優先される。
 */
const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

export function loadEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (e) {
    console.warn(`※ .env を読み込めませんでした（${ENV_FILE}）:`, e instanceof Error ? e.message : e);
  }
}

loadEnv();
