// 何よりも先に .env を読み込む（APIキーやポートの設定がここにある）
import './env.ts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { analyze, validateImages } from './analyze.ts';
import { cancelJob, getJob, purgeAnalyzeJobs, runningJobOf, startJob } from './analyze-jobs.ts';
import { describeAnalyzeFailure } from './analyze-errors.ts';
import { startAutoBackup } from './backup.ts';
import { currentUser, login, logout, purgeExpiredSessions, requireAuth, LOCK_MS, MAX_FAILS, WARN_FROM } from './auth.ts';
import type { User } from './auth.ts';
import { projects, purgeExpiredTrash, purgeOldDrafts, purgeStrayFiles } from './projects.ts';
import { admin } from './admin.ts';
import { listUsers } from './auth.ts';
import type { Answers } from '@zumen/knowledge';
import { SERVER_VERSION } from './version.ts';
import { bodyLimits, securityHeaders } from './security.ts';
import { installProcessHandlers, logError, onUnexpectedError, rotateByCopy, SERVER_LOG } from './errors.ts';
import { readBody, text } from './input.ts';

/**
 * 案件の保管と解析を行うサーバー。
 * Claude APIキーはここにだけ置き、利用者の端末やブラウザには配らない。
 */
const app = new Hono<{ Variables: { user: User } }>();

// 想定外のエラーの最終的な受け皿（落ちない・分かる言葉で返す・error.log に残す）
installProcessHandlers();
app.onError(onUnexpectedError);

app.use('*', securityHeaders);
app.use('/api/*', bodyLimits);

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    userCount: listUsers().length,
    version: SERVER_VERSION,
    // いま配っている画面の「版の印」。開きっぱなしの画面が、古くなったことに気づくために使う
    webBuild: currentWebBuild(),
  }),
);

/* ---------------- ログイン ---------------- */

app.post('/api/auth/login', async (c) => {
  const body = await readBody(c);
  // 文字以外（数字・配列など）が届いても、エラーにせず、「入力してください」と返す
  const userId = text(body.userId);
  const password = text(body.password);
  if (!userId || !password) return c.json({ error: 'IDとパスワードを入力してください。' }, 400);
  const r = login(c, userId, password);
  if (!r.ok && r.reason === 'locked') {
    return c.json(
      {
        error: '何度もまちがえたため、このIDはしばらくログインできません。時間をおいてから、もう一度お試しください。',
        lockedSec: r.retryAfterSec,
      },
      429,
      { 'retry-after': String(r.retryAfterSec) },
    );
  }
  if (!r.ok) {
    // 残りが少なくなってきたら、あと何回で止まるかを知らせる
    const warn = r.remaining > 0 && r.remaining <= MAX_FAILS - WARN_FROM;
    return c.json(
      {
        error: 'IDまたはパスワードが違います。確かめて、もう一度入れてください。',
        ...(warn ? { remaining: r.remaining, lockMinutes: Math.round(LOCK_MS / 60_000) } : {}),
      },
      401,
    );
  }
  return c.json({ user: r.user });
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
app.route('/api/admin', admin);

/* ---------------- 解析 ---------------- */

app.post('/api/analyze', requireAuth, async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return c.json(
      {
        error:
          '手書きメモの読み取りは、まだ使えるようになっていません。' +
          'サーバーに Claude の利用券（APIキー）を設定すると使えるようになります。' +
          '設定のしかたは docs/install.md の「1-4. Claude APIキーを置く」を見てください。',
      },
      503,
    );
  }
  const body = (await c.req.json().catch(() => null)) as {
    images?: { mediaType: string; data: string }[];
    answers?: Answers;
  } | null;
  if (!body) return c.json({ error: 'うまく受け取れませんでした。もう一度お試しください。' }, 400);
  if (!body.images?.length) return c.json({ error: '画像が選ばれていません。画像を1枚以上選んでから、もう一度お試しください。' }, 400);
  if (body.images.length > 10) return c.json({ error: '画像は一度に10枚までです。何回かに分けて、読み取ってください。' }, 400);

  // 送る前の確認（形式・大きさ・PDFのページ数）。問題があれば、AI に送らず、すぐ断る
  try {
    validateImages(body.images);
  } catch (e) {
    return c.json({ error: describeAnalyzeFailure(e) }, 400);
  }

  // 同じ人の、前の読み取りがまだ動いているとき（画面を読み込み直して、押し直した・別の画面から押した）は、前のものをやめて、
  // 今回のものを始める（前の結果は、もう受け取れない。続けると、AI の料金だけがかかる）
  const who = c.get('user').id;
  const prev = runningJobOf(who);
  if (prev) cancelJob(who, prev.id);

  // 裏で読み取りを始めて、すぐ「受け付けました」と返す（外から入る設定の、約100秒の制限に、引っかからないように）。
  // 結果は、画面が、GET /api/analyze/:id で受け取る
  const answers = body.answers ?? {};
  const images = body.images;
  const job = startJob(who, (signal) => analyze(images, answers, signal));
  return c.json({ jobId: job.id }, 202);
});

/** 読み取りの様子を聞く。画面が、2〜3秒おきに呼ぶ */
app.get('/api/analyze/:id', requireAuth, (c) => {
  const job = getJob(c.get('user').id, c.req.param('id') ?? '');
  if (!job) {
    return c.json(
      { error: '読み取りの記録が見つかりません。サーバーが再起動したか、時間がたって消えました。お手数ですが、もう一度「読み取る」を押してください。' },
      404,
    );
  }
  if (job.state === 'running') return c.json({ state: 'running', elapsedSec: Math.round((Date.now() - job.startedAt) / 1000) });
  if (job.state === 'error') return c.json({ state: 'error', error: job.error, code: job.code });
  return c.json({ state: 'done', ...job.result });
});

/** 読み取りをやめる（途中なら、AI への問い合わせもやめる）。受け取り済みの記録を消すのにも使う */
app.delete('/api/analyze/:id', requireAuth, (c) => {
  cancelJob(c.get('user').id, c.req.param('id') ?? '');
  return c.json({ ok: true });
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

/**
 * いま配っている画面の「版の印」。画面を組み立て直すと変わる（index.html が読み込む本体のファイル名）。
 * 画面を開きっぱなしの人に、「新しい版があります」と知らせるために、/api/health で返す。
 * 組み立て直されたら読み直す（ファイルの更新時刻で見分ける）。画面を配っていないときは null。
 */
let webBuildCache: { mtime: number; id: string | null } | null = null;
function currentWebBuild(): string | null {
  if (!hasWeb) return null;
  try {
    const file = resolve(webDist, 'index.html');
    const mtime = statSync(file).mtimeMs;
    if (webBuildCache?.mtime === mtime) return webBuildCache.id;
    const id = readFileSync(file, 'utf8').match(/\/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
    webBuildCache = { mtime, id };
    return id;
  } catch {
    return null;
  }
}
if (hasWeb) {
  // まず実体のあるファイル（アイコン・manifest・assets）を返し、
  // 無ければ画面本体を返す（画面側で住所を見て表示を切り替えるため）。
  app.use('/*', serveStatic({ root: webDist }));
  app.get('*', (c) => c.html(readFileSync(resolve(webDist, 'index.html'), 'utf8')));
}

/** 社内の他のパソコンから繋ぐときの住所を案内するために、この機械のLAN側アドレスを拾う。 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

const port = Number(process.env.PORT ?? 8787);
/**
 * どこからの接続を受けるか。
 * 何も書かなければ、社内の他のパソコンからも直接つなげる（これまでどおり）。
 * .env に LISTEN_HOST=127.0.0.1 と書くと、このパソコンの中からしかつなげなくなる
 * （社内の他のパソコンは、https の住所だけを使う。通信が暗号化される）。
 */
const listenHost = process.env.LISTEN_HOST?.trim() || undefined;
const closedToLan = listenHost === '127.0.0.1' || listenHost === 'localhost' || listenHost === '::1';
serve({ fetch: app.fetch, port, ...(listenHost ? { hostname: listenHost } : {}) }, (info) => {
  console.log(`サーバーを起動しました: http://127.0.0.1:${info.port}`);
  if (closedToLan) {
    console.log('  社内の他のパソコンからは、この住所では開けません（https の住所を使ってください）。');
  } else {
    for (const address of lanAddresses()) {
      console.log(`  社内の他のパソコンからは: http://${address}:${info.port}`);
    }
  }
  if (listUsers().length === 0) {
    console.warn('※ 利用者が登録されていません。`pnpm --filter @zumen/server user:add <ID> <名前> <パスワード>` で追加してください。');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('※ ANTHROPIC_API_KEY が設定されていないため、スケッチの読み取りは使えません。');
  }
  startAutoBackup();
  // ごみ箱の期限切れと、古い下書きを片づける（起動時と、1時間ごと）。失敗しても、サーバーは止めない
  const tidy = () => {
    try {
      purgeExpiredTrash();
      purgeOldDrafts();
      purgeStrayFiles();
      purgeAnalyzeJobs();
      purgeExpiredSessions();
      rotateByCopy(SERVER_LOG);
    } catch (e) {
      logError('片づけの失敗（動作は続けます）', e);
    }
  };
  tidy();
  setInterval(tidy, 3600_000).unref();
  if (!hasWeb) {
    console.warn(`※ 画面のビルドが見つかりません（${webDist}）。'pnpm build' を実行してください。`);
  }
});

export { app };
