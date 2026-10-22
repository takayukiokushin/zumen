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
import type { ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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
  const noCookie = await fetch(`${base}/api/projects`);
  check('ログインせずには案件を見られない', noCookie.status === 401, `${noCookie.status}`);

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

  const answers = {
    customerName: 'フジエレックス株式会社',
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
  check('保存した内容がそのまま戻る', back.answers.customerName === answers.customerName, String(back.answers.customerName ?? ''));
  check('日本語が化けていない', back.name === '診断用の案件', back.name);

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

  // 利用者の管理は管理用だけ
  const memberAdmin = await call(a, '/api/admin/users');
  check('標準は利用者の管理を使えない', memberAdmin.status === 403, `${memberAdmin.status}`);
  const adminUsers = (await (await call(kanri, '/api/admin/users')).json()) as { users: unknown[] };
  check('管理用は利用者の一覧を見られる', adminUsers.users.length === 5, `${adminUsers.users.length}人`);
  const made = await call(kanri, '/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ id: 'tsuika', name: '追加した人', password: 'password123', role: 'member' }),
  });
  check('管理用は利用者を追加できる', made.status === 201, `${made.status}`);
  const shortPw = await call(kanri, '/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ id: 'mijikai', name: '短い', password: 'abc', role: 'member' }),
  });
  check('短すぎるパスワードは断る', shortPw.status === 400, `${shortPw.status}`);
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
    title: '試験事業場　キュービクル式高圧受電設備単線結線図',
    footer: '試験',
    draftNotice: '※ 診断用',
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
