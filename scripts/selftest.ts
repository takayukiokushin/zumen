/**
 * 自己診断。
 *
 *   pnpm selftest
 *
 * サーバーを一時的に立ち上げ、実際に通信して「ちゃんと動くか」を順に確かめる。
 * Windows・macOS・Linux のどれでも同じように動く。
 * 本物の案件には触らず、一時フォルダの中だけで試して、終わったら片付ける。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { pdfPageCount } from '../apps/server/src/analyze.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_DIST = resolve(ROOT, 'apps/web/dist');

let passed = 0;
let failed = 0;
const problems: string[] = [];

/** 画面に出しつつ、記録用にも控えておく（あとで人に渡せるように） */
const transcript: string[] = [];
function say(line = ''): void {
  console.log(line);
  transcript.push(line);
}

function ok(name: string, detail = ''): void {
  passed++;
  say(`  ○ ${name}${detail ? `　${detail}` : ''}`);
}
function ng(name: string, detail: string): void {
  failed++;
  problems.push(`${name}：${detail}`);
  say(`  ✗ ${name}　${detail}`);
}
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) ok(name, detail);
  else ng(name, detail || '想定と違います');
}

/** 空いている番号を1つ借りる */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** このNodeで、リポジトリの中のTypeScriptをそのまま動かす */
function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (out += String(d)));
    p.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

/* ------------------------------------------------------------------ */

say('単線結線図作成：自己診断');
say(`  Node ${process.version} / ${process.platform}`);
say(`  場所 ${ROOT}`);

const dataDir = mkdtempSync(join(tmpdir(), 'zumen-test-'));
const backupDir = mkdtempSync(join(tmpdir(), 'zumen-backup-'));
let server: ChildProcess | null = null;
let serverLog = '';

try {
  /* ---------- 1. 動かすのに必要なもの ---------- */
  say('\n■ 動かすのに必要なもの');
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(
    'Node.js のバージョン',
    major! > 22 || (major === 22 && minor! >= 6),
    `${process.version}（22.6 以上が必要）`,
  );
  check('TypeScriptをそのまま動かせる', true, '型ストリップが有効');
  try {
    new DatabaseSync(':memory:').exec('CREATE TABLE t (a)');
    ok('Node標準のSQLiteが使える');
  } catch (e) {
    ng('Node標準のSQLiteが使える', e instanceof Error ? e.message : String(e));
  }
  check(
    '画面のビルド結果がある',
    existsSync(join(WEB_DIST, 'index.html')),
    existsSync(join(WEB_DIST, 'index.html')) ? '' : '先に pnpm build を実行してください',
  );

  /* ---------- 2. 利用者の登録 ---------- */
  say('\n■ 利用者の登録');
  const env = { DATA_DIR: dataDir, ANTHROPIC_API_KEY: '' };
  const add1 = await runNode(['apps/server/src/cli.ts', 'add', 'tester1', '試験太郎', 'testpass123'], env);
  check('1人目を登録できる', add1.code === 0, add1.code === 0 ? '' : add1.out.trim().split('\n').pop() ?? '');
  const add2 = await runNode(['apps/server/src/cli.ts', 'add', 'tester2', '試験花子', 'testpass123'], env);
  await runNode(['apps/server/src/cli.ts', 'add', 'tester3', '試験次郎', 'testpass123'], env);
  const addAdmin = await runNode(
    ['apps/server/src/cli.ts', 'add', 'kanri', '管理者', 'testpass123', 'admin'],
    env,
  );
  check('管理用のアカウントを作れる', addAdmin.code === 0);
  const addSandbox = await runNode(
    ['apps/server/src/cli.ts', 'add', 'renshu', '練習用', 'testpass123', 'sandbox'],
    env,
  );
  check('練習用のアカウントを作れる', addSandbox.code === 0);
  const badRole = await runNode(
    ['apps/server/src/cli.ts', 'add', 'dame', 'だめ', 'testpass123', 'king'],
    env,
  );
  check('知らない種類は断る', badRole.code !== 0);
  check('2人目を登録できる', add2.code === 0, add2.code === 0 ? '' : add2.out.trim().split('\n').pop() ?? '');
  const short = await runNode(['apps/server/src/cli.ts', 'add', 'tester3', '短い', 'abc'], env);
  check('短すぎるパスワードは断る', short.code !== 0);

  /* ---------- 3. サーバーの起動 ---------- */
  say('\n■ サーバーの起動');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'],
    {
      cwd: ROOT,
      env: { ...process.env, ...env, PORT: String(port), BACKUP_DIR: backupDir },
    },
  );
  server.stdout?.on('data', (d) => (serverLog += String(d)));
  server.stderr?.on('data', (d) => (serverLog += String(d)));

  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(500);
    up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
  }
  check('起動して応答する', up, up ? base : serverLog.trim().split('\n').slice(-3).join(' / '));
  if (!up) throw new Error('サーバーが起動しませんでした');

  const health = (await (await fetch(`${base}/api/health`)).json()) as { userCount: number };
  check('登録した利用者が見えている', health.userCount === 5, `${health.userCount}人`);

  /* ---------- 3b. 社内の直接のつなぎ方を閉じる設定 ---------- */
  say('\n■ 社内からの直接のつなぎ方を閉じる設定（LISTEN_HOST）');
  {
    const port2 = await freePort();
    const s2 = spawn(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'],
      { cwd: ROOT, env: { ...process.env, ...env, PORT: String(port2), LISTEN_HOST: '127.0.0.1' } },
    );
    let log2 = '';
    s2.stdout?.on('data', (d) => (log2 += String(d)));
    s2.stderr?.on('data', (d) => (log2 += String(d)));
    let up2 = false;
    for (let i = 0; i < 40 && !up2; i++) {
      await sleep(500);
      up2 = await fetch(`http://127.0.0.1:${port2}/api/health`).then((r) => r.ok).catch(() => false);
    }
    check('LISTEN_HOST=127.0.0.1 でも、このパソコンの中からは開ける', up2);
    const lan = Object.values((await import('node:os')).networkInterfaces())
      .flatMap((l) => l ?? [])
      .find((n) => n.family === 'IPv4' && !n.internal)?.address;
    if (lan) {
      const viaLan = await fetch(`http://${lan}:${port2}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
      check('LISTEN_HOST=127.0.0.1 のときは、社内側の住所からは開けない', !viaLan, `${lan}`);
    } else {
      ok('（このパソコンには社内側の住所が無いため、閉じたことの確認は省略）');
    }
    check('閉じたことを、起動のときの表示で知らせる', log2.includes('https の住所を使ってください'));
    s2.kill();
  }

  /* ---------- 4. 画面の配信 ---------- */
  say('\n■ 画面の配信');
  for (const [path, type] of [
    ['/', 'text/html'],
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/icon-192.png', 'image/png'],
    ['/favicon-32.png', 'image/png'],
  ] as const) {
    const r = await fetch(base + path);
    check(`${path} が返る`, r.ok && (r.headers.get('content-type') ?? '').includes(type), `${r.status}`);
  }
  const spa = await fetch(`${base}/dareka/nai/page`);
  check('知らない住所でも画面が開く', spa.ok);
  {
    const r = await fetch(base + '/');
    const csp = r.headers.get('content-security-policy') ?? '';
    check('画面に、外のスクリプトを動かさない決まりが付いている', csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), csp ? '' : '無し');
    check('他のサイトに埋め込まれない・種類を決め直されない', r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff');
    check('http で届いたときは、https 専用の覚え込みは付けない', r.headers.get('strict-transport-security') === null);
    const viaHttps = await fetch(base + '/', { headers: { 'x-forwarded-proto': 'https' } });
    check('https で届いたときは、今後 http では入らないよう覚えさせる', (viaHttps.headers.get('strict-transport-security') ?? '').includes('max-age='));
    const api = await fetch(base + '/api/health');
    check('通信（API）の返事にも同じ決まりが付く', api.headers.get('x-content-type-options') === 'nosniff');
  }

  /* ---------- 5. ログイン ---------- */
  say('\n■ ログイン');
  /** Cookieを手で持ち回る（ブラウザの代わり） */
  async function login(userId: string): Promise<string> {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, password: 'testpass123' }),
    });
    if (!r.ok) throw new Error(`ログインできません: ${userId}`);
    return (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }
  async function login2(userId: string, password: string): Promise<string> {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    if (!r.ok) throw new Error(`ログインできません: ${userId}`);
    return (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }
  const call = (cookie: string, path: string, init?: RequestInit) =>
    fetch(base + path, {
      ...init,
      headers: { cookie, ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    });

  const a = await login('tester1');
  const b = await login('tester2');
  check('正しいIDとパスワードで入れる', Boolean(a) && Boolean(b));
  const badLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'tester1', password: 'chigau-password' }),
  });
  check('間違ったパスワードは断る', badLogin.status === 401, `${badLogin.status}`);
  {
    const loginWith = async (headers: Record<string, string>) =>
      fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ userId: 'tester1', password: 'testpass123' }),
      });
    const plain = (await loginWith({})).headers.get('set-cookie') ?? '';
    const viaHttps = (await loginWith({ 'x-forwarded-proto': 'https' })).headers.get('set-cookie') ?? '';
    check('社内の http では、ログインの印に Secure を付けない（付けるとログインできない）', !/;\s*secure/i.test(plain) && /httponly/i.test(plain));
    check('HTTPS（暗号化された通信）で届いたときは、Secure を付ける', /;\s*secure/i.test(viaHttps) && /samesite=lax/i.test(viaHttps));
  }
  const noCookie = await fetch(`${base}/api/projects`);
  check('ログインせずには案件を見られない', noCookie.status === 401, `${noCookie.status}`);

  // 使っている間は、ログインの期限が延びる（開いたまま10日を超えても、保存できるように）
  {
    const c = await login('tester1');
    const rawToken = c.split('=')[1] ?? '';
    const token = createHash('sha256').update(rawToken).digest('hex');
    const sdb = new DatabaseSync(join(dataDir, 'zumen.db'));
    check(
      'ログインの印は、データベースにそのままの形では置かない',
      (sdb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(rawToken) as { n: number }).n === 0 &&
        (sdb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(token) as { n: number }).n === 1,
    );
    const left = () =>
      (new Date((sdb.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as { expires_at: string }).expires_at).getTime() - Date.now()) /
      86400_000;
    sdb.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(new Date(Date.now() + 2 * 86400_000).toISOString(), token);
    const used = await call(c, '/api/projects');
    check('使うと、ログインの期限が10日先まで延びる', used.status === 200 && left() > 9.9, `残り${left().toFixed(1)}日`);
    check('延ばしたことが、ブラウザにも伝わる', (used.headers.get('set-cookie') ?? '').includes('zumen_session='));
    sdb.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(new Date(Date.now() - 1000).toISOString(), token);
    const late = await call(c, '/api/projects');
    check('期限が切れたあとは、延ばさずに断る', late.status === 401, `${late.status}`);
    sdb.close();
  }

  // SQLインジェクション：IDやパスワードに細工をして、認証をすり抜けられないか
  const attacks: [string, string][] = [
    ["' OR '1'='1", "' OR '1'='1"],
    ["' OR 1=1 --", 'なんでもよい'],
    ["admin' --", 'なんでもよい'],
    ["tester1' --", 'でたらめなパスワード'],
    ['tester1', "' OR '1'='1' --"],
    ["'; DROP TABLE users; --", 'なんでもよい'],
    ['" OR ""="', '" OR ""="'],
  ];
  let broke = 0;
  for (const [id, pw] of attacks) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: id, password: pw }),
    });
    if (r.ok) {
      broke++;
      say(`  ✗ 細工したIDで入れてしまいました: ${id} / ${pw}`);
    }
  }
  check('細工したIDやパスワードで入れない（SQLインジェクション）', broke === 0, `${attacks.length}通り試して全部拒否`);

  // 総当たり対策：まちがえ続けると、しばらく受け付けなくなるか
  const tryLogin = (userId: string, password: string) =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
  let locked = 0;
  let firstWarn = 0;
  for (let i = 1; i <= 11; i++) {
    const r = await tryLogin('tester3', `でたらめ${i}`);
    const j = (await r.json()) as { remaining?: number };
    if (!firstWarn && j.remaining !== undefined) firstWarn = i;
    if (r.status === 429 && !locked) locked = i;
  }
  check('5回目から「あと何回」を知らせる', firstWarn === 5, `${firstWarn}回目から`);
  check('10回まちがえると止まる', locked === 11, `${locked}回目の試行で断られた`);
  const rightButLocked = await tryLogin('tester3', 'testpass123');
  const lockBody = (await rightButLocked.json()) as { lockedSec?: number };
  check('止まっている間は正しいパスワードでも入れない', rightButLocked.status === 429, `${rightButLocked.status}`);
  check(
    '止まる時間は30分',
    Math.abs((lockBody.lockedSec ?? 0) - 1800) < 10,
    `あと${lockBody.lockedSec}秒`,
  );
  const other = await tryLogin('tester1', 'testpass123');
  check('止まるのはそのIDだけ（他の人は使える）', other.ok, `${other.status}`);

  // 存在しないIDと、実在するIDで、返ってくる速さに差が出ないか
  const timeOf = async (userId: string): Promise<number> => {
    const t = Date.now();
    await tryLogin(userId, 'まちがったパスワード');
    return Date.now() - t;
  };
  const exists = await timeOf('tester2');
  const missing = await timeOf('こんなIDはない');
  const ratio = Math.max(exists, missing) / Math.max(1, Math.min(exists, missing));
  check(
    'IDが実在するかを、返事の速さで見分けられない',
    ratio < 3,
    `実在 ${exists}ms / 架空 ${missing}ms`,
  );

  // 攻撃のあとも利用者の表が壊れていないか
  const afterAttack = (await (await fetch(`${base}/api/health`)).json()) as { userCount: number };
  check('攻撃のあとも利用者が消えていない', afterAttack.userCount === 5, `${afterAttack.userCount}人`);

  /* ---------- 6. 案件の保存と呼び出し ---------- */
  say('\n■ 案件の保存と呼び出し');
  const created = (await (
    await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '診断用の案件' }) })
  ).json()) as { id: string };
  check('案件を作れる', Boolean(created.id));
  // 最初から入れておく回答（図面の名称を、事業場名称の初期値にする）
  {
    const seeded = (await (
      await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '初期値の案件', answers: { siteName: '初期値の案件' } }) })
    ).json()) as { id: string };
    const got = (await (await call(a, `/api/projects/${seeded.id}`)).json()) as { answers: Record<string, unknown> };
    check('作ったときに、事業場名称の初期値を入れられる', got.answers.siteName === '初期値の案件', JSON.stringify(got.answers));
    const bad = (await (
      await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '不正な初期値', answers: 'これは回答ではない' }) })
    ).json()) as { id: string };
    const gotBad = (await (await call(a, `/api/projects/${bad.id}`)).json()) as { answers: unknown };
    check('回答の形でない初期値は無視する', JSON.stringify(gotBad.answers) === '{}', JSON.stringify(gotBad.answers));
    await call(a, `/api/projects/${seeded.id}`, { method: 'DELETE' });
    await call(a, `/api/projects/${bad.id}`, { method: 'DELETE' });
  }

  const answers = {
    siteName: '試験事業場',
    hasPas: 'yes',
    pasControl: 'dgr',
    pasBuiltinVt: 'yes',
    pasBuiltinLa: 'yes',
    pasRatedVoltage: '7200',
    pasRatedCurrent: '300',
  };
  const saved = await call(a, `/api/projects/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ answers }),
  });
  check('ヒアリングの回答を保存できる', saved.ok, `${saved.status}`);

  const back = (await (await call(a, `/api/projects/${created.id}`)).json()) as {
    name: string;
    answers: Record<string, unknown>;
  };
  check('保存した内容がそのまま戻る', back.answers.siteName === answers.siteName, String(back.answers.siteName ?? ''));
  check('日本語が化けていない', back.name === '診断用の案件', back.name);

  /* ---------- 6b. 同じ人が別の端末で保存したとき ---------- */
  say('\n■ 別の端末での更新の検知');
  {
    const get = async (c: string) =>
      (await (await call(c, `/api/projects/${created.id}`)).json()) as { name: string; updatedAt: string };
    const put = (c: string, body: unknown) =>
      call(c, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify(body) });
    const a2 = await login('tester1'); // 同じ人の、もう1台の端末
    const loaded = (await get(a)).updatedAt;

    const first = await put(a2, { name: '別の端末で直した', baseUpdatedAt: loaded });
    check('読み込んだ時点のままなら、保存できる', first.ok, `${first.status}`);
    const firstAt = ((await first.json()) as { updatedAt: string }).updatedAt;

    const clash = await put(a, { name: '古い画面からの保存', baseUpdatedAt: loaded });
    const clashBody = (await clash.json()) as { stale?: boolean; updatedAt?: string; updatedByName?: string };
    check('別の端末が先に保存していたら、上書きせず断る', clash.status === 409 && clashBody.stale === true, `${clash.status}`);
    check('断るとき、いつ・だれが更新したかを返す', clashBody.updatedAt === firstAt && Boolean(clashBody.updatedByName), `${clashBody.updatedByName ?? ''}`);
    check('断られたあとも、先に保存された内容が残っている', (await get(a)).name === '別の端末で直した');

    const forcedPut = await put(a, { name: '上書きした', baseUpdatedAt: loaded, force: true });
    check('「上書きする」を選べば保存できる', forcedPut.ok, `${forcedPut.status}`);
    const latest = ((await forcedPut.json()) as { updatedAt: string }).updatedAt;
    const again = await put(a, { name: '続けて保存', baseUpdatedAt: latest });
    check('保存したあとは、続けて保存できる', again.ok, `${again.status}`);
    const legacy = await put(a, { name: '診断用の案件' });
    check('更新時刻を送らない古い画面は、これまでどおり保存できる', legacy.ok, `${legacy.status}`);
  }

  /* ---------- 6c. 案件を消す・戻す（ごみ箱） ---------- */
  say('\n■ 案件の削除とごみ箱');
  {
    const mine = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'ごみ箱の試験' }) })).json()) as { id: string };
    const photo = (await (
      await call(a, `/api/projects/${mine.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ fileName: 'a.png', mediaType: 'image/png', data: Buffer.from('dummy-image').toString('base64') }),
      })
    ).json()) as { id: string };
    await call(a, `/api/projects/${mine.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '消す前の内容' } }) });
    await call(a, `/api/projects/${mine.id}/lock`, { method: 'DELETE' });

    const names = async (c: string) =>
      ((await (await call(c, '/api/projects')).json()) as { projects: { id: string }[] }).projects.map((p) => p.id);
    const trashOf = async (c: string) =>
      (await (await call(c, '/api/projects/trash')).json()) as {
        retainDays: number;
        projects: { id: string; name: string; deletedBy: string; purgeAt: string; fileCount: number }[];
      };

    const del = await call(a, `/api/projects/${mine.id}`, { method: 'DELETE' });
    check('案件を消せる', del.ok, `${del.status}`);
    check('消した案件は、一覧に出ない', !(await names(a)).includes(mine.id));
    check('消した案件は、開けない', (await call(a, `/api/projects/${mine.id}`)).status === 404);
    check('消した案件には、保存できない', (await call(a, `/api/projects/${mine.id}`, { method: 'PUT', body: JSON.stringify({ name: 'x' }) })).status === 404);
    check('消した案件の写真は、見られない', (await call(a, `/api/projects/${mine.id}/files/${photo.id}`)).status === 404);

    const t1 = await trashOf(b); // 別の人（tester2）からも見える
    const inTrash = t1.projects.find((p) => p.id === mine.id);
    check('ごみ箱に入っている（別の人にも見える）', Boolean(inTrash), `${t1.projects.length}件`);
    check('ごみ箱に、消した人・完全に消える日・写真の枚数がある', Boolean(inTrash?.deletedBy) && Boolean(inTrash?.purgeAt) && inTrash?.fileCount === 1 && t1.retainDays === 30);

    const rb = await call(b, `/api/projects/${mine.id}/restore`, { method: 'POST' }); // 消した人とは別の人が戻す
    check('別の人でも、戻せる', rb.ok, `${rb.status}`);
    check('戻した案件は、一覧に出る', (await names(a)).includes(mine.id));
    const back2 = (await (await call(a, `/api/projects/${mine.id}`)).json()) as { answers: Record<string, unknown>; files: unknown[] };
    check('戻すと、回答も写真もそのまま', back2.answers.siteName === '消す前の内容' && back2.files.length === 1);
    check('戻したあと、ごみ箱は空', !(await trashOf(a)).projects.some((p) => p.id === mine.id));
    check('ごみ箱に無い案件は、戻せない', (await call(a, `/api/projects/${mine.id}/restore`, { method: 'POST' })).status === 404);

    // 30日を過ぎたら、写真ごと完全に消える
    await call(a, `/api/projects/${mine.id}`, { method: 'DELETE' });
    const sdb = new DatabaseSync(join(dataDir, 'zumen.db'));
    sdb.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 86400_000).toISOString(), mine.id);
    check('期限切れの案件は、ごみ箱から消える', !(await trashOf(a)).projects.some((p) => p.id === mine.id));
    check('期限切れの案件は、戻せない', (await call(a, `/api/projects/${mine.id}/restore`, { method: 'POST' })).status === 404);
    check('完全に消えたあとは、写真のファイルも無い', !existsSync(join(dataDir, 'files', photo.id)));
    check('データベースにも残っていない', sdb.prepare('SELECT 1 FROM projects WHERE id = ?').get(mine.id) === undefined);
    sdb.close();
  }

  /* ---------- 7. 同時編集の排他 ---------- */
  say('\n■ 同時編集の排他');
  const grab = await call(b, `/api/projects/${created.id}/lock`, { method: 'POST', body: '{}' });
  check('他の人は編集を始められない', grab.status === 409, `${grab.status}`);
  const steal = await call(b, `/api/projects/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '横取り' }),
  });
  check('他の人は保存できない', steal.status === 409, `${steal.status}`);
  const forced = await call(b, `/api/projects/${created.id}/lock`, {
    method: 'POST',
    body: JSON.stringify({ force: true }),
  });
  check('「編集を引き継ぐ」で奪える', forced.ok, `${forced.status}`);
  const nowRejected = await call(a, `/api/projects/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '戻せない' }),
  });
  check('奪われた側は保存できなくなる', nowRejected.status === 409, `${nowRejected.status}`);
  const stillOriginal = (await (await call(a, `/api/projects/${created.id}`)).json()) as { name: string };
  check('横取りで名前が変わっていない', stillOriginal.name === '診断用の案件', stillOriginal.name);
  await call(b, `/api/projects/${created.id}/lock`, { method: 'DELETE' });

  /* ---------- 7b. アカウントの種類ごとの振る舞い ---------- */
  say('\n■ アカウントの種類');
  const kanri = await login('kanri');
  const renshu = await login('renshu');

  // 管理用は、他の人が編集中でも確認なしで奪える
  await call(a, `/api/projects/${created.id}/lock`, { method: 'POST', body: '{}' });
  const adminGrab = await call(kanri, `/api/projects/${created.id}/lock`, { method: 'POST', body: '{}' });
  check('管理用は編集中でも引き継げる', adminGrab.ok, `${adminGrab.status}`);
  const adminSave = await call(kanri, `/api/projects/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '管理者が直した' }),
  });
  check('管理用は編集中でも保存できる', adminSave.ok, `${adminSave.status}`);
  // 名前と編集中の印を元に戻し、続きの検査に影響させない
  await call(kanri, `/api/projects/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '診断用の案件' }),
  });
  await call(kanri, `/api/projects/${created.id}/lock`, { method: 'DELETE' });
  await call(a, `/api/projects/${created.id}/lock`, { method: 'POST', body: '{}' });

  // 練習用は自分のものだけ
  const renshuList = (await (await call(renshu, '/api/projects')).json()) as { projects: unknown[] };
  check('練習用には他の人の案件が見えない', renshuList.projects.length === 0, `${renshuList.projects.length}件`);
  const renshuPeek = await call(renshu, `/api/projects/${created.id}`);
  check('練習用は他の人の案件を開けない', renshuPeek.status === 404, `${renshuPeek.status}`);
  const renshuMade = (await (
    await call(renshu, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '練習' }) })
  ).json()) as { id: string };
  const renshuOwn = (await (await call(renshu, '/api/projects')).json()) as { projects: unknown[] };
  check('練習用は自分の案件を作れて見える', renshuOwn.projects.length === 1, `${renshuOwn.projects.length}件`);
  const memberPeek = (await (await call(a, '/api/projects')).json()) as { projects: { id: string }[] };
  check(
    '練習用の案件は他の人に見えない',
    !memberPeek.projects.some((x) => x.id === renshuMade.id),
    `${memberPeek.projects.length}件`,
  );
  // 練習用の案件を消しても、ごみ箱で他の人に見えない（自分には見えて、戻せる）
  await call(renshu, `/api/projects/${renshuMade.id}`, { method: 'DELETE' });
  const trashIds = async (c: string) =>
    ((await (await call(c, '/api/projects/trash')).json()) as { projects: { id: string }[] }).projects.map((p) => p.id);
  check('練習用の消した案件は、他の人のごみ箱に出ない', !(await trashIds(a)).includes(renshuMade.id));
  check('練習用の消した案件は、本人のごみ箱に出る', (await trashIds(renshu)).includes(renshuMade.id));
  check('他の人は、練習用の消した案件を戻せない', (await call(a, `/api/projects/${renshuMade.id}/restore`, { method: 'POST' })).status === 404);
  check('練習用は、自分の消した案件を戻せる', (await call(renshu, `/api/projects/${renshuMade.id}/restore`, { method: 'POST' })).ok);

  // 受電設備エリアが2か所以上：2か所目の答え（a2:〜）も、そのまま保存して読み出せる
  {
    const multi = { areaCount: 2, siteName: '2か所の案件', 'a2:areaIntake': 'lbs-pf', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', areaForm__2: 'room-open' };
    const made = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '2か所の案件', answers: multi }) })).json()) as { id: string };
    const got = (await (await call(a, `/api/projects/${made.id}`)).json()) as { answers: Record<string, unknown> };
    check('2か所目以降の答え（a2:〜）が、そのまま保存・読み出しできる', JSON.stringify(got.answers) === JSON.stringify(multi), JSON.stringify(got.answers));
    await call(a, `/api/projects/${made.id}`, { method: 'DELETE' });
  }

  // PDF（手書きメモのスキャン・既存の図面・仕様書）：案件に残せる。ページ数を数える。写真以外の種類は、これまでどおり断る
  {
    const fakePdf = '%PDF-1.4\n1 0 obj<</Type /Pages /Count 3>>endobj\n2 0 obj<</Type /Page>>endobj\n3 0 obj<</Type/Page>>endobj\n4 0 obj<< /Type /Page >>endobj\n%%EOF';
    check('PDFのページ数を数えられる（「Pages」は数えない）', pdfPageCount(Buffer.from(fakePdf).toString('base64')) === 3, String(pdfPageCount(Buffer.from(fakePdf).toString('base64'))));
    const up = await call(a, `/api/projects/${created.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileName: '既存の図面.pdf', mediaType: 'application/pdf', data: Buffer.from(fakePdf).toString('base64') }),
    });
    check('PDFを案件に残せる', up.status === 201, `${up.status}`);
    const got = (await (await call(a, `/api/projects/${created.id}`)).json()) as { files: { id: string; media_type: string }[] };
    const pdf = got.files.find((f) => f.media_type === 'application/pdf');
    check('案件に、PDFとして保存されている', !!pdf);
    if (pdf) {
      const r = await call(a, `/api/projects/${created.id}/files/${pdf.id}`);
      check('PDFを開ける（PDFとして返る）', r.ok && r.headers.get('content-type') === 'application/pdf');
      await call(a, `/api/projects/${created.id}/files/${pdf.id}`, { method: 'DELETE' });
    }
    const exe = await call(a, `/api/projects/${created.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileName: 'x.exe', mediaType: 'application/x-msdownload', data: Buffer.from('MZ').toString('base64') }),
    });
    check('写真・PDF以外の種類は、これまでどおり断る', exe.status === 400, `${exe.status}`);
  }

  // 図面を複製して新しい案件を作る（本番のアカウント）：設備の内容と手直しは残し、名前・番号・メモは空にする
  {
    const J = (r: Response) => r.json() as Promise<any>;
    const drawing = {
      items: [
        { kind: 'text', id: 'auto-t', x: 0, y: 0, lines: ['埋設ケーブル'], anchor: 'start' },
        { kind: 'text', id: 'memo-t', x: 10, y: 10, lines: ['手書きの注記'], anchor: 'start' },
        { kind: 'symbol', id: 'vcb', symbolId: 'vcb', x: 100, y: 200, rotate: 0, label: ['VCB（手で直した）'], labelDx: 0, labelDy: 0 },
      ],
      edited: true,
      base: { symbols: {}, wires: [], wireIds: [], textIds: ['auto-t'] },
      overrides: { moved: { vcb: { dx: 5, dy: 6 } }, removed: [], wiresRemoved: [], added: [{ kind: 'text', item: { kind: 'text', id: 'memo-t' }, at: { ndx: 0, ndy: 0 } }] },
    };
    const srcAnswers = { siteName: '複製元の現場', drawingName: '複製元の図面', poleName: '中電柱：元の電柱', earthingNotes: 'A種10Ω', mainBreakerForm: 'cb', trCapacity: 100 };
    await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ answers: srcAnswers, drawing }) });
    const up = await call(a, `/api/projects/${created.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileName: '現地.png', mediaType: 'image/png', data: Buffer.from('dummy-image').toString('base64') }),
    });
    const before = await J(await call(a, `/api/projects/${created.id}`));
    const r = await call(a, `/api/projects/${created.id}/duplicate`, { method: 'POST' });
    check('標準のアカウントも、図面を複製して新しく作れる', r.status === 201, `${r.status}`);
    const dup = await J(r);
    const d = await J(await call(a, `/api/projects/${dup.id}`));
    check('複製：事業場名称・図面名称・電柱名称・特記事項が空になる', d.answers.siteName === undefined && d.answers.drawingName === undefined && d.answers.poleName === undefined && d.answers.earthingNotes === undefined, JSON.stringify(d.answers));
    check('複製：設備の内容は、そのまま残る', d.answers.mainBreakerForm === 'cb' && d.answers.trCapacity === 100);
    check('複製：案件の名前は「無題の案件」になる', d.name === '無題の案件', String(d.name));
    check('複製：手で足したメモは消え、自動の文字は残る', d.drawing.items.some((x: { id: string }) => x.id === 'auto-t') && !d.drawing.items.some((x: { id: string }) => x.id === 'memo-t') && d.drawing.overrides.added.length === 0);
    check('複製：手で直した記号は、そのまま使う', d.drawing.items.find((x: { id: string }) => x.id === 'vcb')?.label?.[0] === 'VCB（手で直した）' && d.drawing.overrides.moved.vcb.dx === 5 && d.drawing.edited === true);
    check('複製：写真はコピーしない', d.files.length === 0 && before.files.length === 1);
    const after = await J(await call(a, `/api/projects/${created.id}`));
    check('複製しても、もとの案件は変わらない', JSON.stringify(after.answers) === JSON.stringify(before.answers) && JSON.stringify(after.drawing) === JSON.stringify(before.drawing));
    check('複製は、一覧に並ぶ', ((await J(await call(a, '/api/projects'))).projects as { id: string }[]).some((x) => x.id === dup.id));
    check('存在しない案件は、複製できない', (await call(a, '/api/projects/nai/duplicate', { method: 'POST' })).status === 404);
    check('練習用の案件は、標準が複製できない', (await call(a, `/api/projects/${renshuMade.id}/duplicate`, { method: 'POST' })).status === 404);
    await call(a, `/api/projects/${dup.id}`, { method: 'DELETE' });
    await call(a, `/api/projects/${created.id}/files/${before.files[0].id}`, { method: 'DELETE' });
    await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ answers: before.answers, drawing: before.drawing }) });
    void up;
  }

  // 練習環境：本番の案件をコピーして練習する（もとの案件は変わらない）
  {
    const J = (r: Response) => r.json() as Promise<any>;
    const srcSave = await call(a, `/api/projects/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ answers: { siteName: '本番の現場', trCapacity: 100 }, drawing: { items: [{ kind: 'text', id: 't1' }] } }),
    });
    check('（練習のコピー元）本番の案件に回答と図面を入れられる', srcSave.ok, `${srcSave.status}`);
    const up = await call(a, `/api/projects/${created.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileName: '現地.png', mediaType: 'image/png', data: Buffer.from('dummy-image').toString('base64') }),
    });
    check('（練習のコピー元）本番の案件に写真を入れられる', up.status === 201, `${up.status}`);
    const before = await J(await call(a, `/api/projects/${created.id}`));

    check('標準は、練習用のコピー元の一覧を使えない', (await call(a, '/api/projects/practice/sources')).status === 403);
    check('管理用も、練習用のコピーは使えない', (await call(kanri, '/api/projects/practice/copy', { method: 'POST', body: JSON.stringify({ sourceId: created.id }) })).status === 403);
    const sources = await J(await call(renshu, '/api/projects/practice/sources'));
    check('練習用には、本番の案件がコピー元として並ぶ', sources.projects.some((x: { id: string }) => x.id === created.id), `${sources.projects.length}件`);
    check('練習用の案件は、コピー元に並ばない', !sources.projects.some((x: { id: string }) => x.id === renshuMade.id));

    const copied = await call(renshu, '/api/projects/practice/copy', { method: 'POST', body: JSON.stringify({ sourceId: created.id }) });
    check('練習用は、本番の案件をコピーできる', copied.status === 201, `${copied.status}`);
    const copy = await J(copied);
    const copyDetail = await J(await call(renshu, `/api/projects/${copy.id}`));
    check('コピーに、回答と図面がそのまま入っている', JSON.stringify(copyDetail.answers) === JSON.stringify(before.answers) && JSON.stringify(copyDetail.drawing) === JSON.stringify(before.drawing));
    check('コピーの名前に「（練習）」が付く', String(copyDetail.name).startsWith('（練習）'), String(copyDetail.name));
    check('コピーに写真も入っている（別のファイルとして）', copyDetail.files.length === 1 && copyDetail.files[0].id !== before.files[0].id, `${copyDetail.files.length}枚`);
    const copyPhoto = await call(renshu, `/api/projects/${copy.id}/files/${copyDetail.files[0].id}`);
    check('コピーの写真が開ける', copyPhoto.ok && Buffer.from(await copyPhoto.arrayBuffer()).toString() === 'dummy-image');
    check('コピーは、練習用にだけ見える（標準の一覧に出ない）', !((await J(await call(a, '/api/projects'))).projects as { id: string }[]).some((x) => x.id === copy.id));
    check('コピーは、標準が直接開こうとしても開けない', (await call(a, `/api/projects/${copy.id}`)).status === 404);

    // コピーを編集しても、もとの案件は変わらない
    const edit = await call(renshu, `/api/projects/${copy.id}`, {
      method: 'PUT',
      body: JSON.stringify({ answers: { siteName: '練習で変えた' }, drawing: null }),
    });
    check('練習用は、コピーを編集できる', edit.ok, `${edit.status}`);
    const after = await J(await call(a, `/api/projects/${created.id}`));
    check('コピーを編集しても、本番の案件は変わらない', JSON.stringify(after.answers) === JSON.stringify(before.answers) && JSON.stringify(after.drawing) === JSON.stringify(before.drawing) && after.updatedAt === before.updatedAt);
    // コピーを消しても、もとの写真は残る
    await call(renshu, `/api/projects/${copy.id}`, { method: 'DELETE' });
    check('コピーを消しても、本番の案件の写真は残る', (await call(a, `/api/projects/${created.id}/files/${before.files[0].id}`)).ok);
    check('存在しないコピー元は断る', (await call(renshu, '/api/projects/practice/copy', { method: 'POST', body: JSON.stringify({ sourceId: 'nai' }) })).status === 404);
    // 続きの検査に影響しないよう、入れたものを戻す
    await call(a, `/api/projects/${created.id}/files/${before.files[0].id}`, { method: 'DELETE' });
    await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ answers: before.answers, drawing: before.drawing }) });
  }

  // 利用者の管理は管理用だけ
  const memberAdmin = await call(a, '/api/admin/users');
  check('標準は利用者の管理を使えない', memberAdmin.status === 403, `${memberAdmin.status}`);
  const adminUsers = (await (await call(kanri, '/api/admin/users')).json()) as { users: unknown[] };
  check('管理用は利用者の一覧を見られる', adminUsers.users.length === 5, `${adminUsers.users.length}人`);
  const made = await call(kanri, '/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ id: 'tsuika', name: '追加した人', password: 'Mizu-Kawa-7391', role: 'member' }),
  });
  check('管理用は利用者を追加できる', made.status === 201, `${made.status}`);
  const shortPw = await call(kanri, '/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ id: 'mijikai', name: '短い', password: 'abc', role: 'member' }),
  });
  check('短すぎるパスワードは断る', shortPw.status === 400, `${shortPw.status}`);
  {
    const tryPw = (id: string, password: string) =>
      call(kanri, '/api/admin/users', { method: 'POST', body: JSON.stringify({ id, name: '試験', password, role: 'member' }) });
    const weak: [string, string, string][] = [
      ['9文字', 'Abcd-1234', 'ninemoji1'],
      ['IDと同じ', 'sameasid01', 'sameasid01'],
      ['IDを含む', 'sameasid01-Xy7', 'sameasid01'],
      ['よくある言葉', 'Password2026', 'weak01'],
      ['連番（数字）', '9876543210', 'weak02'],
      ['連番（英字）', 'abcdefghij12', 'weak03'],
      ['キーボードの並び', 'Qwertyuiop-7', 'weak04'],
      ['同じ文字', 'aaaaaaaaaaaa', 'weak05'],
      ['短い並びの繰り返し', 'x7Kx7Kx7Kx7K', 'weak06'],
      ['数字だけ', '48203957164', 'weak07'],
      ['アプリの名前', 'Zumen-Kakunin-93', 'weak08'],
    ];
    for (const [label, pw, id] of weak) {
      const r = await tryPw(id, pw);
      check(`弱いパスワード（${label}）は断る`, r.status === 400, `${r.status}`);
    }
    const good = await tryPw('strong01', 'Mizu-Hikari-4729');
    check('十分なパスワードは受け付ける', good.status === 201, `${good.status}`);
    await call(kanri, '/api/admin/users/strong01', { method: 'DELETE' });
    const weakChange = await call(kanri, '/api/admin/users/tester1/password', { method: 'PUT', body: JSON.stringify({ password: 'Password2026' }) });
    check('パスワードの変更でも、弱いものは断る', weakChange.status === 400, `${weakChange.status}`);
  }
  {
    const tsuika = await login2('tsuika', 'Mizu-Kawa-7391');
    const before = await call(tsuika, '/api/auth/me');
    const tsuika2 = await login2('tsuika', 'Mizu-Kawa-7391'); // 同じ人の、もう1台の端末
    const change = await call(kanri, '/api/admin/users/tsuika/password', { method: 'PUT', body: JSON.stringify({ password: 'Kawari-Pw-5820' }) });
    const afterOld = (await (await call(tsuika, '/api/auth/me')).json()) as { user: unknown };
    const afterOld2 = (await (await call(tsuika2, '/api/auth/me')).json()) as { user: unknown };
    check(
      'パスワードを変えると、その人のすでに入っているログインが切れる',
      change.ok && ((await before.json()) as { user: unknown }).user !== null && afterOld.user === null && afterOld2.user === null,
    );
    const kanriStill = (await (await call(kanri, '/api/auth/me')).json()) as { user: unknown };
    check('他の人には影響しない', kanriStill.user !== null);
    const selfChange = await call(kanri, '/api/admin/users/kanri/password', { method: 'PUT', body: JSON.stringify({ password: 'testpass123' }) });
    const kanriAfterSelf = (await (await call(kanri, '/api/auth/me')).json()) as { user: unknown };
    check('自分のパスワードを変えても、いまの画面のログインは切れない', selfChange.ok && kanriAfterSelf.user !== null);
  }
  const removed = await call(kanri, '/api/admin/users/tsuika', { method: 'DELETE' });
  check('管理用は利用者を消せる', removed.ok, `${removed.status}`);
  const selfRemove = await call(kanri, '/api/admin/users/kanri', { method: 'DELETE' });
  check('自分自身は消せない', selfRemove.status === 400, `${selfRemove.status}`);
  const unlocked = await call(kanri, '/api/admin/users/tester3/unlock', { method: 'POST' });
  check('管理用は止まったログインを解除できる', unlocked.ok, `${unlocked.status}`);
  const afterUnlock = await tryLogin('tester3', 'testpass123');
  check('解除すると、すぐ入れる', afterUnlock.ok, `${afterUnlock.status}`);

  /* ---------- 8. 現地写真 ---------- */
  say('\n■ 現地写真');
  // 1×1の小さなPNG
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const upload = await call(a, `/api/projects/${created.id}/files`, {
    method: 'POST',
    body: JSON.stringify({ fileName: '現地.png', mediaType: 'image/png', data: png }),
  });
  check('写真を添付できる', upload.status === 201, `${upload.status}`);
  const fileId = ((await upload.json()) as { id: string }).id;
  const got = await call(a, `/api/projects/${created.id}/files/${fileId}`);
  check('添付した写真を取り出せる', got.ok && (got.headers.get('content-type') ?? '').includes('image/png'));
  check(
    '取り出した写真では、スクリプトが動かない決まりが付いている',
    (got.headers.get('content-security-policy') ?? '').includes('sandbox') && got.headers.get('x-content-type-options') === 'nosniff',
  );
  for (const bad of ['text/html', 'image/svg+xml', 'application/javascript']) {
    const r = await call(a, `/api/projects/${created.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileName: 'x', mediaType: bad, data: Buffer.from('<script>alert(1)</script>').toString('base64') }),
    });
    check(`写真ではない種類（${bad}）は、添付できない`, r.status === 400, `${r.status}`);
  }
  {
    const big = 'x'.repeat(11 * 1024 * 1024);
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'a', password: big }) }).catch(() => null);
    check('極端に大きな通信は、読み込む前に断る', r !== null && r.status === 413, `${r?.status}`);
  }

  /* ---------- 9. 控え（バックアップ） ---------- */
  say('\n■ 控え（バックアップ）');
  const bk = await runNode(['apps/server/src/cli.ts', 'backup', backupDir], env);
  check('控えを作れる', bk.code === 0, bk.code === 0 ? '' : bk.out.trim().split('\n').pop() ?? '');
  const copies = readdirSync(backupDir).filter((n) => /^\d{8}-\d{6}$/.test(n));
  check('控えのフォルダができている', copies.length > 0, `${copies.length}世代`);
  if (copies.length) {
    const latest = join(backupDir, copies.sort().at(-1)!);
    const dbPath = join(latest, 'zumen.db');
    check('控えに案件のデータが入っている', existsSync(dbPath), `${(statSync(dbPath).size / 1024).toFixed(0)}KB`);
    try {
      const copy = new DatabaseSync(dbPath);
      const row = copy.prepare('SELECT name FROM projects LIMIT 1').get() as { name: string } | undefined;
      check('控えから案件を読み出せる', row?.name === '診断用の案件', row?.name ?? '（空）');
      copy.close();
    } catch (e) {
      ng('控えから案件を読み出せる', e instanceof Error ? e.message : String(e));
    }
    check('控えに写真が入っている', readdirSync(join(latest, 'files')).length > 0);
  }

  /* ---------- 10. 作図 ---------- */
  say('\n■ 作図');
  const { buildComposition } = await import('../packages/knowledge/src/index.ts');
  const { layout } = await import('../packages/layout/src/index.ts');
  const { renderSvg } = await import('../packages/layout/src/index.ts');
  const items = buildComposition(answers);
  const drawing = layout(items, answers);
  check('記号を組み立てられる', drawing.symbols.length > 5, `記号${drawing.symbols.length}個 / 線${drawing.wires.length}本`);
  const svg = renderSvg(drawing, {
    site: '試験事業場',
    name: 'キュービクル式高圧受電設備単線結線図',
    footer: '試験',
  });
  check('図面を描き出せる', svg.includes('<svg') && svg.length > 2000, `${(svg.length / 1024).toFixed(0)}KB`);
  check('日本語のフォント指定が入っている', svg.includes('IPAGothic'));
  check('PASの内蔵表記が出ている', svg.includes('VT,LA内蔵型'));

  /* ---------- 11. 片付け ---------- */
  say('\n■ 片付け');
  const del = await call(a, `/api/projects/${created.id}`, { method: 'DELETE' });
  check('案件を削除できる', del.ok, `${del.status}`);
} catch (e) {
  ng('診断そのもの', e instanceof Error ? e.message : String(e));
} finally {
  server?.kill();
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */

say('\n' + '─'.repeat(52));
if (failed === 0) {
  say(`✓ ${passed}件すべて正常です。このまま進めて問題ありません。`);
} else {
  say(`✗ ${passed}件は正常、${failed}件に問題があります。`);
  say('\n【問題のあった項目】');
  for (const p of problems) say(`  ・${p}`);
  say('\nこの画面をそのままコピーして渡してください。');
  if (serverLog.trim()) {
    say('\n【サーバーの記録】');
    say(serverLog.trim().split('\n').slice(-15).join('\n'));
  }
}
// 記録を残す（Windowsの診断バッチから渡される）
const logPath = process.env.SELFTEST_LOG;
if (logPath) {
  try {
    appendFileSync(logPath, transcript.join('\n') + '\n');
  } catch {
    // 書けなくても診断そのものは成立するので黙って進む
  }
}

process.exit(failed === 0 ? 0 : 1);
