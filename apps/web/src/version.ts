/**
 * この画面の版と、組み立てた日。
 * 値は vite.config.ts が、リポジトリ直下の package.json から埋め込む。
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
