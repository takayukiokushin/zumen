import { readFileSync } from 'node:fs';

/**
 * サーバーの版。画面の版と同じく、リポジトリ直下の package.json の1か所で決める。
 * 読めなくても、サーバーは動かす（版が分からないだけ）。
 */
export const SERVER_VERSION: string = (() => {
  try {
    const raw = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '?';
  } catch {
    return '?';
  }
})();
