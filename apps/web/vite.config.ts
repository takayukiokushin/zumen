import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 版は、リポジトリ直下の package.json の1か所だけで決める */
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
/** この画面を組み立てた日（日本時間）。更新が反映されたかを見分けるのに使う */
const builtOn = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(builtOn),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 解析はサーバー経由。APIキーは端末に置かない
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
});
