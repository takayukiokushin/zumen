import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * リポジトリ直下の .env を読み込む。
 *
 * サーバーもコマンドも、まずこれを読み込んでから動かす。
 * 既に環境変数が設定されている場合は、そちらが優先される。
 */
const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * Node.js の版の確認。動作を確かめてあるのは 22 系（22.13 以上）。
 *   ・22.13 より古い：Node標準のデータベース（node:sqlite）が、そのままでは使えないので、分かりやすい言葉で知らせて止める
 *   ・23 以上：確かめていない版。知らせるだけで、そのまま動かす（自動更新などで、いつのまにか版が上がっても、止めないため）
 */
export function checkNodeVersion(version: string = process.versions.node): 'ok' | 'old' | 'newer' {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) return 'old';
  return major > 22 ? 'newer' : 'ok';
}
{
  const state = checkNodeVersion();
  if (state === 'old') {
    console.error(
      `Node.js の版が古いため、起動できません（いまの版：${process.version}）。\n` +
        'Node.js は「22」の版を使います。https://nodejs.org/ja/download で、バージョンの欄から 22 を選んで入れ直してください。\n' +
        '（入れ終わったら、ターミナルを一度閉じて、開き直します）',
    );
    process.exit(1);
  }
  if (state === 'newer') {
    console.warn(`※ Node.js の版が新しすぎます（いまの版：${process.version}）。動作を確かめてあるのは「22」の版です。このまま動かしますが、おかしいときは、22 の版に入れ直してください。`);
  }
}

export function loadEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (e) {
    console.warn(`※ .env を読み込めませんでした（${ENV_FILE}）:`, e instanceof Error ? e.message : e);
  }
}

loadEnv();
