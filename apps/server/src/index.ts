import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { analyze } from './analyze.ts';
import { currentUser, login, logout, requireAuth } from './auth.ts';
import type { User } from './auth.ts';
import { projects } from './projects.ts';
import { listUsers } from './auth.ts';
import type { Answers } from '@zumen/knowledge';

/**
 * 案件の保管と解析を行うサーバー。
 * Claude APIキーはここにだけ置き、利用者の端末やブラウザには配らない。
 */
const app = new Hono<{ Variables: { user: User } }>();

app.get('/api/health', (c) =>
  c.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY), userCount: listUsers().length }),
);

/* ---------------- ログイン ---------------- */

app.post('/api/auth/login', async (c) => {
  const { userId, password } = (await c.req.json().catch(() => ({}))) as {
    userId?: string;
    password?: string;
  };
  if (!userId || !password) return c.json({ error: 'IDとパスワードを入力してください。' }, 400);
  const user = login(c, userId, password);
  if (!user) return c.json({ error: 'IDまたはパスワードが違います。' }, 401);
  return c.json({ user });
});

app.post('/api/auth/logout', (c) => {
  logout(c);
  return c.json({ ok: true });
});

app.get('/api/auth/me', (c) => {
  const user = currentUser(c);
  return user ? c.json({ user }) : c.json({ user: null }, 200);
});

/* ---------------- 案件 ---------------- */

app.route('/api/projects', projects);

/* ---------------- 解析 ---------------- */

app.post('/api/analyze', requireAuth, async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'サーバーにAPIキーが設定されていません（ANTHROPIC_API_KEY）。' }, 503);
  }
  const body = (await c.req.json().catch(() => null)) as {
    images?: { mediaType: string; data: string }[];
    answers?: Answers;
  } | null;
  if (!body) return c.json({ error: 'リクエストの形式が不正です。' }, 400);
  if (!body.images?.length) return c.json({ error: '画像が添付されていません。' }, 400);
  if (body.images.length > 10) return c.json({ error: '画像は一度に10枚までです。' }, 400);

  try {
    return c.json(await analyze(body.images, body.answers ?? {}));
  } catch (e) {
    console.error('解析に失敗しました', e);
    return c.json({ error: e instanceof Error ? e.message : '解析に失敗しました。' }, 502);
  }
});

/* ---------------- 画面の配信 ---------------- */

/**
 * ビルドした画面をこのサーバーから配る。
 * デスクトップ版はこのサーバーの住所を開くだけでよくなる（画面を直しても入れ直し不要）。
 */
// 画面のビルド結果。既定はこのファイルから見た apps/web/dist（起動ディレクトリに依存させない）
const webDist = process.env.WEB_DIST
  ? resolve(process.env.WEB_DIST)
  : fileURLToPath(new URL('../../web/dist', import.meta.url));
const hasWeb = existsSync(resolve(webDist, 'index.html'));
if (hasWeb) {
  app.use('/assets/*', serveStatic({ root: webDist, rewriteRequestPath: (p) => p }));
  app.use('/*', serveStatic({ root: webDist, rewriteRequestPath: () => '/index.html' }));
}

/** 社内の他のパソコンから繋ぐときの住所を案内するために、この機械のLAN側アドレスを拾う。 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`サーバーを起動しました: http://127.0.0.1:${info.port}`);
  for (const address of lanAddresses()) {
    console.log(`  社内の他のパソコンからは: http://${address}:${info.port}`);
  }
  if (listUsers().length === 0) {
    console.warn('※ 利用者が登録されていません。`pnpm --filter @zumen/server user:add <ID> <名前> <パスワード>` で追加してください。');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('※ ANTHROPIC_API_KEY が設定されていないため、スケッチの読み取りは使えません。');
  }
  if (!hasWeb) {
    console.warn(`※ 画面のビルドが見つかりません（${webDist}）。'pnpm build' を実行してください。`);
  }
});

export { app };
