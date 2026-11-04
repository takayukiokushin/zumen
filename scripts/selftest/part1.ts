/**
 * 自己診断（selftest）の1つ目：動かすのに必要なもの・利用者の登録・サーバーの起動・画面の配信・ログイン。
 * 共有する道具は common.ts。scripts/selftest.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, WEB_DIST, st, say, ok, ng, check, freePort, sleep, runNode, dataDir, backupDir } from './common.ts';

export async function part1() {
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
  st.server = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'],
    {
      cwd: ROOT,
      env: { ...process.env, ...env, PORT: String(port), BACKUP_DIR: backupDir },
    },
  );
  st.server.stdout?.on('data', (d) => (st.serverLog += String(d)));
  st.server.stderr?.on('data', (d) => (st.serverLog += String(d)));

  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(500);
    up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
  }
  check('起動して応答する', up, up ? base : st.serverLog.trim().split('\n').slice(-3).join(' / '));
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

  // 使っている間は、ログインの期限が延びる（開いたまま30日を超えても、保存できるように）
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
    check('使うと、ログインの期限が30日先まで延びる', used.status === 200 && left() > 29.9, `残り${left().toFixed(1)}日`);
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
  return { env, base, login, login2, call, a, b, tryLogin, other };
}
