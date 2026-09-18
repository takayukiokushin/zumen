import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { analyze } from './analyze.ts';
import type { Answers } from '@zumen/knowledge';

/**
 * 解析用の中継サーバー。
 * Claude APIキーはこのサーバーにだけ置き、利用者の端末には配らない。
 */
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) }));

app.post('/api/analyze', async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'サーバーにAPIキーが設定されていません（ANTHROPIC_API_KEY）。' }, 503);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'リクエストの形式が不正です。' }, 400);
  }
  const { images, answers } = (body ?? {}) as {
    images?: { mediaType: string; data: string }[];
    answers?: Answers;
  };
  if (!images?.length) return c.json({ error: '画像が添付されていません。' }, 400);
  if (images.length > 10) return c.json({ error: '画像は一度に10枚までです。' }, 400);

  try {
    const result = await analyze(images, answers ?? {});
    return c.json(result);
  } catch (e) {
    console.error('解析に失敗しました', e);
    const message = e instanceof Error ? e.message : '解析に失敗しました。';
    return c.json({ error: message }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`解析サーバーを起動しました: http://127.0.0.1:${info.port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('※ ANTHROPIC_API_KEY が設定されていないため、解析は使えません。');
  }
});

export { app };
