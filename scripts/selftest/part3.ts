/**
 * 自己診断（selftest）の3つ目：現地写真・案件の一覧・検索・並び替え・案件名・想定外の入力・控え・作図・片付け。
 * 共有する道具は common.ts。scripts/selftest.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { KEEP, dayOf, msUntilMidnight, pickToDelete, stamp } from '../../apps/server/src/backup-rules.ts';
import { say, ok, ng, check, runNode, dataDir, backupDir } from './common.ts';
import type { part2 } from './part2.ts';

export async function part3(c: Awaited<ReturnType<typeof part2>>) {
  const { env, base, login, login2, call, a, b, other, created, answers, kanri } = c;
  /* ---------- 8. 現地写真 ---------- */
  say('\n■ 現地写真');

  // 読み取りに使った写真・PDFは、「保存」を押したときに消える（読み取った印は残る）
  {
    const pj = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '写真を消す試験' }) })).json()) as { id: string };
    const up = async (type: string) =>
      (await (await call(a, `/api/projects/${pj.id}/files`, { method: 'POST', body: JSON.stringify({ fileName: 'x', mediaType: type, data: Buffer.from('dummy').toString('base64') }) })).json()) as { id: string };
    const p1 = await up('image/png');
    const p2 = await up('application/pdf');
    const detail = async () => (await (await call(a, `/api/projects/${pj.id}`)).json()) as { files: unknown[]; sketchRead: boolean };
    let d0 = await detail();
    check('保存する前は、写真・PDFが預かられている', d0.files.length === 2 && d0.sketchRead === true);
    await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ name: '写真を消す試験（名前だけ変更）' }) });
    d0 = await detail();
    check('名前だけの保存では、写真は消えない', d0.files.length === 2);
    const sv = await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ name: '写真を消す試験', answers: { siteName: '保存した' }, drawing: null }) });
    check('保存できる', sv.ok, `${sv.status}`);
    const d1 = await detail();
    check('「保存」を押すと、写真もPDFも消える（写真・PDFとも同じ扱い）', d1.files.length === 0);
    check('写真・PDFのファイルも、ディスクから消えている', !existsSync(join(dataDir, 'files', p1.id)) && !existsSync(join(dataDir, 'files', p2.id)));
    check('写真が無くなっても、「読み取った案件」の印は残る', d1.sketchRead === true);
    // 画面が「読み取った」と伝えれば、写真が一度も入っていなくても、印は付く
    const pk = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '印だけの試験' }) })).json()) as { id: string };
    const before = (await (await call(a, `/api/projects/${pk.id}`)).json()) as { sketchRead: boolean };
    await call(a, `/api/projects/${pk.id}`, { method: 'PUT', body: JSON.stringify({ answers: {}, sketchRead: true }) });
    const after = (await (await call(a, `/api/projects/${pk.id}`)).json()) as { sketchRead: boolean };
    check('読み取っていない案件は、印が付いていない', before.sketchRead === false);
    check('画面から「読み取った」と伝えて保存すると、印が付く', after.sketchRead === true);
    // 保存したあとに、あとから届いた写真は、次の保存で消える
    const late = await up('image/jpeg');
    await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '保存した' } }) });
    check('保存のあとに届いた写真も、次の保存で消える', (await detail()).files.length === 0 && !existsSync(join(dataDir, 'files', late.id)));
  }

  // 下書き（保存を押す前の入力を、自動で控える）
  {
    const pj = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '下書きの試験' }) })).json()) as { id: string };
    await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '保存した内容' } }) });
    const getD = async (who: string) =>
      (await (await call(who, `/api/projects/${pj.id}`)).json()) as { answers: Record<string, unknown>; draft: null | { answers: Record<string, unknown>; name: string | null; savedAt: string; baseUpdatedAt: string | null } };
    check('下書きが無いときは、null', (await getD(a)).draft === null);
    const put = await call(a, `/api/projects/${pj.id}/draft`, { method: 'PUT', body: JSON.stringify({ name: '下書きの名前', answers: { siteName: '保存前の入力' }, drawing: null, sketchRead: true, baseUpdatedAt: '2026-01-01T00:00:00.000Z' }) });
    check('下書きを預けられる', put.ok, `${put.status}`);
    const d1 = await getD(a);
    check('開くと、書いた本人に、下書きが返る', d1.draft?.answers.siteName === '保存前の入力' && d1.draft?.name === '下書きの名前' && Boolean(d1.draft?.savedAt) && d1.draft?.baseUpdatedAt === '2026-01-01T00:00:00.000Z');
    check('下書きは、案件そのものを書き換えない', d1.answers.siteName === '保存した内容');
    const put2 = await call(a, `/api/projects/${pj.id}/draft`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '2回目の下書き' } }) });
    check('同じ案件の下書きは、上書きされる（1つだけ）', put2.ok && (await getD(a)).draft?.answers.siteName === '2回目の下書き');
    check('ほかの人には、下書きは見えない', (await getD(b)).draft === null);
    check('中身のない下書きは、断る', (await call(a, `/api/projects/${pj.id}/draft`, { method: 'PUT', body: JSON.stringify({ answers: 'x' }) })).status === 400);
    const other = await call(b, `/api/projects/${pj.id}/draft`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '別の人' } }) });
    check('ほかの人が編集中の案件には、下書きを預けられない', other.status === 409, `${other.status}`);
    await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '保存した内容2' } }) });
    check('「保存」を押すと、下書きは消える', (await getD(a)).draft === null);
    await call(a, `/api/projects/${pj.id}`, { method: 'DELETE' });
    check('消した案件には、下書きを預けられない', (await call(a, `/api/projects/${pj.id}/draft`, { method: 'PUT', body: JSON.stringify({ answers: {} }) })).status === 404);
  }
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

  /* ---------- 7b. 案件の一覧：件数を区切って出す・サーバー側で探す ---------- */
  say('\n■ 案件の一覧（件数の区切り・検索）');
  {
    const names = ['一覧試験-01', '一覧試験-02', '一覧試験-03', '一覧試験-04', '一覧試験-05', '一覧試験_下線', '100%完了の一覧試験'];
    for (const n of names) await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: n }) });
    type L = { projects: { id: string; name: string; lock: unknown }[]; total: number };
    const list = async (qs: string) => (await (await call(a, `/api/projects${qs}`)).json()) as L;
    const all = await list('');
    check('limit も offset も省くと、全件を返す（古い画面との互換）', all.projects.length === all.total && all.total >= names.length, `${all.projects.length}/${all.total}`);
    const found = await list('?q=' + encodeURIComponent('一覧試験') + '&limit=3&offset=0');
    check('名前の一部で、サーバー側で絞れる（全体の件数が返る）', found.total === 7 && found.projects.length === 3 && found.projects.every((p) => p.name.includes('一覧試験')), `${found.total}件中${found.projects.length}件`);
    const next = await list('?q=' + encodeURIComponent('一覧試験') + '&limit=3&offset=3');
    const last = await list('?q=' + encodeURIComponent('一覧試験') + '&limit=3&offset=6');
    const ids = [...found.projects, ...next.projects, ...last.projects].map((p) => p.id);
    check('続き（offset）を足すと、重複も抜けもなく、全部そろう', next.projects.length === 3 && last.projects.length === 1 && new Set(ids).size === 7, `${ids.length}件`);
    check('新しい順に並ぶ（作った順の逆）', found.projects[0]!.name.includes('100%完了') && found.projects[1]!.name.includes('下線'), found.projects.map((p) => p.name).join(' / '));
    const pct = await list('?q=' + encodeURIComponent('%') + '&limit=50');
    check('「%」は、ふつうの文字として探す（全部に一致しない）', pct.total === 1 && pct.projects[0]!.name.includes('100%'), `${pct.total}件`);
    const under = await list('?q=' + encodeURIComponent('_下') + '&limit=50');
    check('「_」も、ふつうの文字として探す', under.total === 1, `${under.total}件`);
    const big = await list('?limit=999');
    check('件数の上限は200件', big.projects.length <= 200);
    const bad = await list('?limit=abc&offset=-5');
    check('件数・開始位置が文字や負の数でも、エラーにならない（標準の50件）', bad.projects.length <= 50 && bad.total >= 7);
    const none = await list('?q=' + encodeURIComponent('存在しない名前zzz') + '&limit=25');
    check('見つからないときは、0件', none.total === 0 && none.projects.length === 0);
    const other = (await (await call(b, '/api/projects?limit=200')).json()) as L;
    check('他の人（標準のアカウント）にも、同じ案件が見える（共有）', other.total >= 7);
  }

  /* ---------- 7b2. 検索：案件名・事業場名称・お客様番号 ---------- */
  say('\n■ 検索（案件名・事業場名称・お客様番号）');
  {
    type L = { projects: { id: string; name: string; site_name: string | null; customer_no: string | null }[]; total: number };
    const find = async (q: string) => (await (await call(a, `/api/projects?limit=50&q=${encodeURIComponent(q)}`)).json()) as L;
    const mk = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'ＡＢＣビル改修', answers: { siteName: 'Ｘ工場　第二棟', customerNo: 'No-９９９' } }) })).json()) as { id: string };
    check('案件名で見つかる', (await find('ビル改修')).projects.some((p) => p.id === mk.id));
    check('事業場名称でも見つかる', (await find('第二棟')).projects.some((p) => p.id === mk.id));
    check('お客様番号でも見つかる', (await find('999')).projects.some((p) => p.id === mk.id));
    check('全角・半角、大文字・小文字の違いは、同じものとして探せる（abc→ＡＢＣ、999→９９９）', (await find('abc')).projects.some((p) => p.id === mk.id) && (await find('no-999')).projects.some((p) => p.id === mk.id));
    check('空白で区切ると、すべての言葉を含むものだけが見つかる', (await find('abc 第二棟 999')).total === 1 && (await find('abc zzz存在しない')).total === 0);
    const hit = (await find('999')).projects.find((p) => p.id === mk.id)!;
    check('一覧に、事業場名称・お客様番号も返る', hit.site_name === 'Ｘ工場　第二棟' && hit.customer_no === 'No-９９９', `${hit.site_name} / ${hit.customer_no}`);
    await call(a, `/api/projects/${mk.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '別の工場', customerNo: 'K-100' } }) });
    check('保存して番号が変わると、新しい番号で見つかり、古い番号では見つからない', (await find('k-100')).projects.some((p) => p.id === mk.id) && !(await find('999')).projects.some((p) => p.id === mk.id));
    await call(a, `/api/projects/${mk.id}`, { method: 'PUT', body: JSON.stringify({ name: '名前を変えた案件' }) });
    check('名前を変えると、新しい名前で見つかる（事業場名称・番号は、そのまま）', (await find('名前を変えた')).projects.some((p) => p.id === mk.id) && (await find('k-100')).projects.some((p) => p.id === mk.id) && !(await find('ビル改修')).projects.some((p) => p.id === mk.id));
    await call(a, `/api/projects/${mk.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '別の工場' } }) });
    check('お客様番号を消すと、その番号では見つからない', !(await find('k-100')).projects.some((p) => p.id === mk.id));
    const dup = (await (await call(a, `/api/projects/${mk.id}/duplicate`, { method: 'POST' })).json()) as { id: string };
    const dl = await find('別の工場');
    check('複製した案件は、事業場名称が空になるので、複製元だけが見つかる', dl.projects.some((p) => p.id === mk.id) && !dl.projects.some((p) => p.id === dup.id));
    check('数字や記号（%・_）だけを探しても、全部には一致しない', (await find('%')).total <= 1);
    // 以前からある案件（探すための列が空）も、更新のとき、一度だけ写される
    const old = mkdtempSync(join(tmpdir(), 'zumen-mig-'));
    mkdirSync(join(old, 'files'), { recursive: true });
    const odb = new DatabaseSync(join(old, 'zumen.db'));
    odb.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT, answers TEXT NOT NULL DEFAULT '{}', drawing TEXT, locked_by TEXT, locked_at TEXT, owner TEXT);`);
    odb.prepare("INSERT INTO projects (id, name, created_at, updated_at, answers) VALUES ('old1', '古い案件', '2026-01-01', '2026-01-01', ?)").run(JSON.stringify({ siteName: '古い工場', customerNo: 'OLD-7' }));
    odb.exec('PRAGMA user_version = 1');
    odb.close();
    const mig = await runNode(['apps/server/src/cli.ts', 'list'], { ...env, DATA_DIR: old });
    const odb2 = new DatabaseSync(join(old, 'zumen.db'));
    const row = odb2.prepare('SELECT site_name, customer_no, search_text, name_sort FROM projects WHERE id = ?').get('old1') as { site_name: string; customer_no: string; search_text: string; name_sort: string };
    const ver = (odb2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    odb2.close();
    rmSync(old, { recursive: true, force: true });
    check('以前からある案件にも、事業場名称・お客様番号・探すための文字・名前順の文字が、更新のときに写される', mig.code === 0 && row.site_name === '古い工場' && row.customer_no === 'OLD-7' && row.search_text.includes('old-7') && row.name_sort === '古い案件' && ver === 3, `${row.site_name}/${row.customer_no}/v${ver}`);
  }

  /* ---------- 7b3. 並び替え ---------- */
  say('\n■ 並び替え');
  {
    type L = { projects: { id: string; name: string }[]; total: number };
    const order = async (sort: string) => ((await (await call(a, `/api/projects?limit=50&sort=${sort}&q=${encodeURIComponent('並び替え試験')}`)).json()) as L).projects.map((p) => p.name.replace('並び替え試験 ', ''));
    const names = ['ソ10', '漢', 'そ1', 'ＡＢ', 'ソ2'];
    const ids: Record<string, string> = {};
    for (const n of names) {
      ids[n] = ((await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: `並び替え試験 ${n}` }) })).json()) as { id: string }).id;
      await new Promise((r) => setTimeout(r, 15));
    }
    const asc = await order('name_asc');
    check('名前順：英数字、ひらがな・カタカナ（同じ並び）、漢字の順。数字は、数の大きさの順（2→10）', asc.join(',') === 'ＡＢ,そ1,ソ2,ソ10,漢', asc.join(','));
    check('名前の逆順', (await order('name_desc')).join(',') === [...asc].reverse().join(','));
    check('新規作成が古い順＝作った順', (await order('created_asc')).join(',') === names.join(','), (await order('created_asc')).join(','));
    check('新規作成が新しい順＝作った順の逆', (await order('created_desc')).join(',') === [...names].reverse().join(','));
    await call(a, `/api/projects/${ids['そ1']}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '更新した' } }) });
    const upd = await order('updated_desc');
    check('更新が新しい順：いま更新したものが先頭', upd[0] === 'そ1', upd.join(','));
    check('更新が古い順：いま更新したものが最後', (await order('updated_asc')).at(-1) === 'そ1');
    check('新規作成の順は、更新しても変わらない', (await order('created_asc')).join(',') === names.join(','));
    const unknown = await order('でたらめ');
    check('知らない並び順は、標準（更新が新しい順）になり、エラーにならない', unknown[0] === 'そ1', unknown.join(','));
    // 名前を変えると、名前順も変わる
    await call(a, `/api/projects/${ids['漢']}`, { method: 'PUT', body: JSON.stringify({ name: '並び替え試験 あ0' }) });
    check('名前を変えると、名前順の位置も変わる', (await order('name_asc')).join(',') === 'ＡＢ,あ0,そ1,ソ2,ソ10', (await order('name_asc')).join(','));
    // ページをまたいでも、順番が崩れない
    const p1 = ((await (await call(a, `/api/projects?limit=2&offset=0&sort=name_asc&q=${encodeURIComponent('並び替え試験')}`)).json()) as L).projects.map((p) => p.name);
    const p2 = ((await (await call(a, `/api/projects?limit=2&offset=2&sort=name_asc&q=${encodeURIComponent('並び替え試験')}`)).json()) as L).projects.map((p) => p.name);
    check('名前順のまま、ページをまたいでも、重複も抜けもない', new Set([...p1, ...p2]).size === 4 && p1[0]!.endsWith('ＡＢ'));
  }

  /* ---------- 7c. 案件名は必須 ---------- */
  say('\n■ 案件名は必須');
  {
    for (const [label, body] of [['空の名前', { name: '' }], ['空白だけの名前', { name: '   　' }], ['名前なし', {}]] as [string, object][]) {
      const r = await call(a, '/api/projects', { method: 'POST', body: JSON.stringify(body) });
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? '';
      check(`案件を作るとき、${label}は受け付けない`, r.status === 400 && msg.includes('案件名を入力してください'), `${r.status} ${msg}`);
    }
    const ok = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '  名前つきの案件  ' }) })).json()) as { id: string };
    const detail = async () => (await (await call(a, `/api/projects/${ok.id}`)).json()) as { name: string };
    check('名前があれば作れる（前後の空白は取る）', (await detail()).name === '名前つきの案件');
    const blank = await call(a, `/api/projects/${ok.id}`, { method: 'PUT', body: JSON.stringify({ name: '   ' }) });
    check('名前を空にして保存しようとしても、受け付けない', blank.status === 400 && ((await blank.json()) as { error?: string }).error?.includes('案件名を入力してください') === true, `${blank.status}`);
    check('受け付けなかったときは、もとの名前のまま', (await detail()).name === '名前つきの案件');
    // 案件名は、100文字まで（画面の入力欄と同じ。サーバーも受け付けない）
    const longName = 'あ'.repeat(101);
    const mkLong = await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: longName }) });
    const mkLongMsg = ((await mkLong.json().catch(() => ({}))) as { error?: string }).error ?? '';
    check('案件を作るとき、101文字の名前は受け付けない', mkLong.status === 400 && mkLongMsg.includes('100文字'), `${mkLong.status} ${mkLongMsg}`);
    const renLong = await call(a, `/api/projects/${ok.id}`, { method: 'PUT', body: JSON.stringify({ name: longName }) });
    check('名前を101文字にして保存しようとしても、受け付けない', renLong.status === 400 && ((await renLong.json()) as { error?: string }).error?.includes('100文字') === true, `${renLong.status}`);
    const ren100 = await call(a, `/api/projects/${ok.id}`, { method: 'PUT', body: JSON.stringify({ name: 'い'.repeat(100) }) });
    check('100文字ちょうどの名前は、保存できる', ren100.ok && (await detail()).name === 'い'.repeat(100), `${ren100.status}`);
    await call(a, `/api/projects/${ok.id}`, { method: 'PUT', body: JSON.stringify({ name: '名前つきの案件' }) });
    const keep = await call(a, `/api/projects/${ok.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: 'x' } }) });
    check('名前を送らない保存は、これまでどおりできる', keep.ok, `${keep.status}`);
  }

  /* ---------- 7d. 回答・図面の形が違う保存と、一覧の巨大な位置指定（全体のデバッグ） ---------- */
  say('\n■ 形の違う保存と、一覧の巨大な位置指定');
  {
    const pj = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '形の確認' }) })).json()) as { id: string };
    const get = async () => (await (await call(a, `/api/projects/${pj.id}`)).json()) as { answers: unknown; drawing: unknown };
    for (const [label, body] of [['文字', { answers: 'x' }], ['数字', { answers: 5 }], ['配列', { answers: [1, 2] }], ['真偽', { answers: true }]] as [string, object][]) {
      const r = await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify(body) });
      check(`回答が「${label}」の保存は、受け付けない`, r.status === 400, `${r.status}`);
    }
    for (const [label, body] of [['文字', { drawing: 'x' }], ['数字', { drawing: 5 }], ['配列', { drawing: [1] }]] as [string, object][]) {
      const r = await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify(body) });
      check(`図面が「${label}」の保存は、受け付けない`, r.status === 400, `${r.status}`);
    }
    const after = await get();
    check('受け付けなかったあとも、案件が開けて、回答は空のまま', typeof after.answers === 'object' && after.answers !== null && !Array.isArray(after.answers) && after.drawing === null);
    const nul = await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ answers: null }) });
    check('回答が null の保存は、これまでどおり（空として）できる', nul.ok, `${nul.status}`);
    const big = await call(a, '/api/projects?limit=5&offset=99999999999999999999');
    const bigBody = (await big.json().catch(() => ({}))) as { projects?: unknown[] };
    check('一覧の位置指定が巨大でも、エラーにならず、空を返す', big.status === 200 && Array.isArray(bigBody.projects) && bigBody.projects.length === 0, `${big.status}`);
    await call(a, `/api/projects/${pj.id}`, { method: 'DELETE' });
  }

  /* ---------- 7e. 利用者を消したとき（標準・管理用は案件を残す／練習用は案件もいっしょに消す） ---------- */
  say('\n■ 利用者を消したときの案件');
  {
    const PW = 'Kx9#mQ2$vL1';
    const mk = (id: string, role: string) => call(kanri, '/api/admin/users', { method: 'POST', body: JSON.stringify({ id, name: id + 'さん', password: PW, role }) });
    await mk('sakujo-m', 'member');
    await mk('sakujo-s', 'sandbox');
    const m = await login2('sakujo-m', PW);
    const s2 = await login2('sakujo-s', PW);
    const mp = (await (await call(m, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '消される人の案件' }) })).json()) as { id: string };
    await call(m, `/api/projects/${mp.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '残る' } }) });
    const sp = (await (await call(s2, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '消される練習の案件' }) })).json()) as { id: string };
    await call(s2, `/api/projects/${sp.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '消える' } }) });
    const names = async (cookie: string, q: string) => ((await (await call(cookie, `/api/projects?q=${encodeURIComponent(q)}`)).json()) as { projects: { id: string }[] }).projects.length;
    check('消す前：標準のアカウントの案件は、ほかの人にも見える', (await names(a, '消される人の案件')) === 1);
    check('消す前：練習用の案件は、標準・管理用には見えない', (await names(a, '消される練習の案件')) === 0 && (await names(kanri, '消される練習の案件')) === 0);
    const d1 = await call(kanri, '/api/admin/users/sakujo-m', { method: 'DELETE' });
    const d2 = await call(kanri, '/api/admin/users/sakujo-s', { method: 'DELETE' });
    check('利用者（標準・練習用）を消せる', d1.ok && d2.ok, `${d1.status} ${d2.status}`);
    check('標準のアカウントを消しても、その人の案件は残り、開ける', (await names(a, '消される人の案件')) === 1 && (await call(a, `/api/projects/${mp.id}`)).ok);
    // その案件を、ほかの人が古い画面から保存すると、「更新した人が削除された利用者」と分かる
    const st = await call(a, `/api/projects/${mp.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: 'x' }, baseUpdatedAt: '2000-01-01T00:00:00.000Z' }) });
    const stBody = (await st.json().catch(() => ({}))) as { stale?: boolean; updatedByName?: string | null; updatedByRemoved?: boolean };
    check('更新した人が消されていると、競合の知らせは、名前なし・「消された」印つき', st.status === 409 && stBody.stale === true && stBody.updatedByName === null && stBody.updatedByRemoved === true, JSON.stringify(stBody));
    // ごみ箱：消した人が、すでに消されている利用者
    await mk('sakujo-m2', 'member');
    const m2 = await login2('sakujo-m2', PW);
    const mp2 = (await (await call(m2, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '消した人がいなくなる案件' }) })).json()) as { id: string };
    const delOk = await call(m2, `/api/projects/${mp2.id}`, { method: 'DELETE' });
    check('（準備）自分の案件をごみ箱に入れられる', delOk.ok, `${delOk.status}`);
    await call(kanri, '/api/admin/users/sakujo-m2', { method: 'DELETE' });
    const trash = (await (await call(a, '/api/projects/trash')).json()) as { projects: { id: string; deletedBy: string | null; deletedByRemoved?: boolean }[] };
    const t2 = trash.projects.find((p) => p.id === mp2.id);
    check('ごみ箱：消した人が消されていると、名前なし・「消された」印つき', t2?.deletedBy === null && t2?.deletedByRemoved === true, JSON.stringify(t2));
    await call(a, `/api/projects/${mp2.id}/restore`, { method: 'POST' });
    await call(a, `/api/projects/${mp2.id}`, { method: 'DELETE' });
    // 練習用：その人の案件も、いっしょに消える（だれにも見えない・開けない・ごみ箱にも残らない）
    const peek = await call(kanri, `/api/projects/${sp.id}`);
    check('練習用のアカウントを消すと、その人の案件も消える（管理用でも開けない）', peek.status === 404, `${peek.status}`);
    check('練習用の案件は、消したあとも、ほかの人の一覧に出ない', (await names(a, '消される練習の案件')) === 0 && (await names(kanri, '消される練習の案件')) === 0);
    const trash2 = (await (await call(kanri, '/api/projects/trash')).json()) as { projects: { id: string }[] };
    check('練習用の案件は、ごみ箱にも残らない', !trash2.projects.some((p) => p.id === sp.id));
    await call(a, `/api/projects/${mp.id}`, { method: 'DELETE' });
  }

  /* ---------- 8a. 想定外の形の入力（数字・配列・空など）でも、エラーにしない ---------- */
  say('\n■ 想定外の形の入力');
  {
    const odd = [5, true, [1], { a: 1 }];
    const status = async (who: string, path: string, init: RequestInit) => (await call(who, path, init)).status;
    const bad500 = (code: number) => code >= 500;
    let wrong = 0;
    for (const w of odd) {
      const bodies: [string, string, RequestInit][] = [
        ['ログイン', '/api/auth/login', { method: 'POST', body: JSON.stringify({ userId: w, password: w }) }],
        ['ログイン（IDだけ）', '/api/auth/login', { method: 'POST', body: JSON.stringify({ userId: w, password: 'abc' }) }],
        ['ログイン（パスワードだけ）', '/api/auth/login', { method: 'POST', body: JSON.stringify({ userId: 'tester1', password: w }) }],
        ['案件を作る', '/api/projects', { method: 'POST', body: JSON.stringify({ name: w, answers: w }) }],
        ['利用者を足す', '/api/admin/users', { method: 'POST', body: JSON.stringify({ id: w, name: w, password: w, role: w }) }],
        ['パスワードを変える', '/api/admin/users/tester1/password', { method: 'PUT', body: JSON.stringify({ password: w }) }],
      ];
      for (const [label, path, init] of bodies) {
        const who = path.startsWith('/api/admin') ? kanri : path.startsWith('/api/auth') ? '' : a;
        if (bad500(await status(who, path, init))) wrong++, ng(`想定外の入力でエラーになる：${label}（${JSON.stringify(w)}）`, '');
      }
    }
    const mk = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '入力の試験' }) })).json()) as { id: string };
    for (const w of odd) {
      const r = await status(a, `/api/projects/${mk.id}/files`, { method: 'POST', body: JSON.stringify({ fileName: 'x', mediaType: 'image/png', data: w }) });
      if (r !== 400) wrong++, ng(`写真のデータが文字ではないとき、400で断る（${JSON.stringify(w)}）`, `${r}`);
    }
    for (const raw of ['null', '[]', '"x"', '123']) {
      for (const [path, init] of [
        ['/api/auth/login', { method: 'POST', body: raw }],
        ['/api/projects', { method: 'POST', body: raw }],
      ] as [string, RequestInit][]) {
        if (bad500(await status(path.startsWith('/api/auth') ? '' : a, path, init))) wrong++, ng(`想定外の本文でエラーになる：${path}（${raw}）`, '');
      }
    }
    if (wrong === 0) check('数字・配列・空などが届いても、エラー（500）にならない', true);
    const lg = await call('', '/api/auth/login', { method: 'POST', body: JSON.stringify({ userId: 123, password: 456 }) });
    check('ログインの欄が文字ではないときは、「入力してください」と返す', lg.status === 400 && ((await lg.json()) as { error?: string }).error?.includes('入力') === true, `${lg.status}`);
  }

  /* ---------- 8b. 想定外のエラーの受け皿 ---------- */
  say('\n■ 想定外のエラーの受け皿');
  {
    const errDir = mkdtempSync(join(tmpdir(), 'zumen-errlog-'));
    process.env.DATA_DIR = errDir; // この診断の中だけ、記録の置き場を、仮の場所にする（本物の data/ には触れない）
    const { onUnexpectedError, logError, rotateIfBig, ERROR_LOG, LOG_MAX_BYTES } = await import('../../apps/server/src/errors.ts');
    check('記録の置き場が、仮の場所になっている（本物のデータに触れない）', ERROR_LOG.startsWith(errDir), ERROR_LOG);
    // hono は、サーバー側の部品なので、サーバーのフォルダから探す
    const req = createRequire(new URL('../../apps/server/package.json', import.meta.url));
    const load = async (name: string) => (await import(pathToFileURL(req.resolve(name)).href)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { Hono } = await load('hono');
    const { HTTPException } = await load('hono/http-exception');
    const t = new Hono();
    t.onError(onUnexpectedError);
    t.use('*', async (c: any, next: () => Promise<void>) => { c.set('user', { id: 'tester9' }); await next(); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    t.post('/boom', async () => { throw new Error('テスト用の想定外のエラー'); });
    t.get('/big', () => { throw new HTTPException(413, { res: new Response(JSON.stringify({ error: '大きすぎます。' }), { status: 413 }) }); });
    const r = await t.request('/boom', { method: 'POST', body: JSON.stringify({ password: 'ひみつの内容123', answers: { siteName: '案件の内容' } }), headers: { 'content-type': 'application/json' } });
    check('想定外のエラーでも、落ちずに、500で返す', r.status === 500, `${r.status}`);
    const rj = (await r.json()) as Record<string, unknown>;
    check('英語の「Internal Server Error」ではなく、画面側が分かる言葉にできる形で返す', typeof rj === 'object' && rj.error === undefined);
    const log = existsSync(ERROR_LOG) ? readFileSync(ERROR_LOG, 'utf8') : '';
    check('error.log に、いつ・どの操作・どんなエラーかが残る', /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] 想定外のエラー POST \/boom/.test(log) && log.includes('テスト用の想定外のエラー') && log.includes('tester9'));
    check('送られてきた内容（パスワード・案件の内容）は、記録に入らない', !log.includes('ひみつの内容123') && !log.includes('案件の内容'));
    const big = await t.request('/big');
    check('意図して返している断り（413など）は、そのまま返す', big.status === 413 && ((await big.json()) as { error?: string }).error === '大きすぎます。');
    // 記録が大きくなりすぎない
    writeFileSync(ERROR_LOG, 'x'.repeat(LOG_MAX_BYTES + 10));
    logError('試験', new Error('回転のあと'));
    check('記録が上限を超えたら、古い記録を脇に移して、新しく始める', existsSync(`${ERROR_LOG}.1`) && statSync(ERROR_LOG).size < 5000, `${statSync(ERROR_LOG).size}バイト`);
    rotateIfBig(join(errDir, 'none.log'));
    check('記録ファイルが無くても、エラーにならない', true);
    rmSync(errDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  }

  /* ---------- 9. 控え（バックアップ） ---------- */
  say('\n■ 控え（バックアップ）');
  {
    // 時刻の決まり：「午前0時」は日本時間。サーバーの時計（世界標準時でも）に左右されない
    const jst = (iso: string) => new Date(iso); // 例：2026-11-03T23:59:30+09:00
    check('残す日数は、10日分', KEEP === 10, `${KEEP}`);
    check('午前0時の30秒前なら、あと31秒（1秒だけ過ぎてから動く）', msUntilMidnight(jst('2026-11-03T23:59:30+09:00'), 'Asia/Tokyo') === 31_000, `${msUntilMidnight(jst('2026-11-03T23:59:30+09:00'), 'Asia/Tokyo')}`);
    check('午前0時ちょうどなら、次の0時まで24時間（と1秒）', msUntilMidnight(jst('2026-11-04T00:00:00+09:00'), 'Asia/Tokyo') === 86_401_000);
    check('昼の12時なら、あと12時間（と1秒）', msUntilMidnight(jst('2026-11-03T12:00:00+09:00'), 'Asia/Tokyo') === 43_201_000);
    check('世界標準時の15時（日本時間の午前0時）は、日本の翌日の名前になる', stamp(new Date('2026-11-03T15:00:00Z'), 'Asia/Tokyo') === '20261104-000000' && dayOf(new Date('2026-11-03T14:59:59Z'), 'Asia/Tokyo') === '20261103');
    const days = Array.from({ length: 12 }, (_, i) => `202611${String(i + 1).padStart(2, '0')}-000000`);
    const del = pickToDelete([...days, '20261112-093000', 'notes', '20261001-000000']);
    check('10日分だけ残し、古い日は消す', del.includes('20261001-000000') && del.includes('20261101-000000') && del.includes('20261102-000000') && !del.includes('20261103-000000'), del.join(' '));
    check('同じ日に2つあれば、新しいほうだけ残る', del.includes('20261112-000000') && !del.includes('20261112-093000'));
    check('控えではない名前のものは、触らない', !del.includes('notes'));
  }
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
    check('控えには、写真・PDFを入れない（案件のデータだけ）', !existsSync(join(latest, 'files')));
  }

  /* ---------- 9a. 控えから戻す（手順書どおり） ---------- */
  say('\n■ 控えから戻す（手順書の「控えから戻す（復元）」のとおりに、新しいデータ置き場へ zumen.db を置いて、サーバーを動かす）');
  {
    const J = (r: Response) => r.json() as Promise<any>;
    // 1. 戻す対象を用意する：赤い印のすべての種類を持つ図面・日本語・記号を含む名前
    const richDrawing = {
      items: [{ kind: 'text', id: 't0', x: 1, y: 2, lines: ['メモ ＆ <b>'], anchor: 'start' }],
      orientation: 'landscape',
      layers: [
        {
          id: 'outage',
          seen: 'abc123',
          items: [
            { kind: 'text', id: 'a1', x: 1, y: 2, lines: ['停電範囲'], anchor: 'start', red: true, ndx: 1, ndy: 2 },
            { kind: 'area', id: 'a2', x: 0, y: 0, w: 100, h: 80, ndx: 0, ndy: 0, hatch: true, label: ['充電範囲'] },
            { kind: 'dot', id: 'd1', x: 5, y: 6, ndx: 5, ndy: 6 },
            { kind: 'dot', id: 'd2', x: 50, y: 60, ndx: 50, ndy: 60 },
            { kind: 'arrow', id: 'r1', dot: 'd1', dir: 'ne', len: 60, label: ['印加点'] },
            { kind: 'link', id: 'l1', a: 'd1', b: 'd2', shape: 'round', flip: true },
          ],
        },
        { id: 'custom-1', name: '作業停電図', items: [] },
      ],
    };
    const mk = async (name: string, i: number) => {
      const pj = (await J(await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name }) }))) as { id: string };
      const put = await call(a, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: `復元の試験 ${i}`, transformerCount: i + 1 }, drawing: richDrawing }) });
      if (!put.ok) throw new Error(`復元の試験の案件を保存できません: ${put.status}`);
      return pj.id;
    };
    const ids = [await mk('復元の試験①（日本語・記号 ＆ <>）', 1), await mk('復元の試験②', 2), await mk('復元の試験③', 3)];
    // ①には、読み取りの写真を1枚預けておく（控えには、写真のファイルは写さない決まり。記録だけが写る）
    const photo = (await J(await call(a, `/api/projects/${ids[0]}/files`, { method: 'POST', body: JSON.stringify({ fileName: 'x.png', mediaType: 'image/png', data: Buffer.from('dummy-restore').toString('base64') }) }))) as { id: string };

    // 2. 控えを作る。作っている最中にも、別の人が保存し続けている（控えが、書き込み中でも壊れないこと）
    const writers = Array.from({ length: 24 }, (_, i) => call(b, '/api/projects', { method: 'POST', body: JSON.stringify({ name: `書き込み中の案件 ${i}` }) }).then((r) => J(r)).then((pj: { id: string }) => call(b, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: `書き込み ${i}` }, drawing: richDrawing }) })));
    const mid = await runNode(['apps/server/src/cli.ts', 'backup', backupDir], env);
    await Promise.all(writers);
    check('書き込みが続いている最中でも、控えを作れる', mid.code === 0, mid.code === 0 ? '' : mid.out.trim().split('\n').pop() ?? '');
    const midCopy = join(backupDir, readdirSync(backupDir).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort().at(-1)!, 'zumen.db');
    {
      const dbm = new DatabaseSync(midCopy, { readOnly: true });
      const integrity = (dbm.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      const rows = dbm.prepare('SELECT id, name, answers, drawing FROM projects').all() as { id: string; name: string; answers: string | null; drawing: string | null }[];
      const broken = rows.filter((r) => {
        try {
          if (r.answers) JSON.parse(r.answers);
          if (r.drawing) JSON.parse(r.drawing);
          return false;
        } catch {
          return true;
        }
      });
      dbm.close();
      check('書き込み中に作った控えも、データベースとして壊れていない', integrity === 'ok', integrity);
      check('書き込み中に作った控えの案件は、どれも中身が読める（途中で切れた案件が無い）', broken.length === 0, `${rows.length}件中 ${broken.length}件が壊れている`);
    }

    // 戻す前の状態を覚える（このあとの控えと同じ時点）
    const snapshot = async (at: string, cookie: string) => {
      const get = (path: string) => fetch(at + path, { headers: { cookie } });
      const list = (await J(await get('/api/projects'))) as { projects: { id: string; name: string }[] };
      const details = [] as { id: string; name: string; answers: unknown; drawing: unknown }[];
      for (const p of list.projects) {
        const d = (await J(await get(`/api/projects/${p.id}`))) as { name: string; answers: unknown; drawing: unknown };
        details.push({ id: p.id, name: d.name, answers: d.answers, drawing: d.drawing });
      }
      details.sort((x, y) => (x.id < y.id ? -1 : 1));
      const users = (((await J(await get('/api/admin/users'))) as { users?: { id: string }[] }).users ?? []).map((u) => u.id).sort();
      return { details, users };
    };
    const before = await snapshot(base, kanri);
    const beforeA = await snapshot(base, a);
    const bk2 = await runNode(['apps/server/src/cli.ts', 'backup', backupDir], env);
    check('戻す元になる控えを作れる', bk2.code === 0);
    const latest = join(backupDir, readdirSync(backupDir).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort().at(-1)!);

    // 3. 手順書どおり：新しい data を作り、控えの zumen.db だけを置く（.env・写真は無い）
    const restored = mkdtempSync(join(tmpdir(), 'zumen-restore-'));
    writeFileSync(join(restored, 'zumen.db'), readFileSync(join(latest, 'zumen.db')));
    const rport = await (await import('./common.ts')).freePort();
    const rbase = `http://127.0.0.1:${rport}`;
    const { spawn } = await import('node:child_process');
    const { ROOT, sleep } = await import('./common.ts');
    const srv = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: restored, ANTHROPIC_API_KEY: '', PORT: String(rport), BACKUP_DIR: '' },
    });
    let log = '';
    srv.stdout?.on('data', (d) => (log += String(d)));
    srv.stderr?.on('data', (d) => (log += String(d)));
    try {
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        await sleep(500);
        up = await fetch(`${rbase}/api/health`).then((r) => r.ok).catch(() => false);
      }
      check('戻したデータで、サーバーが起動する', up, up ? '' : log.trim().split('\n').slice(-3).join(' / '));
      if (up) {
        const loginAt = async (userId: string) => {
          const r = await fetch(`${rbase}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, password: 'testpass123' }) });
          return r.ok ? (r.headers.get('set-cookie') ?? '').split(';')[0]! : '';
        };
        const rk = await loginAt('kanri');
        const ra = await loginAt('tester1');
        check('戻したあとも、同じパスワードでログインできる（利用者とパスワードも、控えの時点に戻る）', rk !== '' && ra !== '');
        const health = (await J(await fetch(`${rbase}/api/health`))) as { userCount: number };
        check('利用者の数が、控えの時点と同じ', health.userCount === 5, `${health.userCount}人`);
        const after = await snapshot(rbase, rk);
        const afterA = await snapshot(rbase, ra);
        check('利用者の一覧が、戻す前と同じ', JSON.stringify(after.users) === JSON.stringify(before.users));
        check('案件が、1件も欠けず、増えもしない（管理用の見え方）', after.details.length === before.details.length, `${after.details.length}件 / 戻す前 ${before.details.length}件`);
        check('案件の名前・回答・図面が、1件ずつ、戻す前と同じ（赤いレイヤーの全種類・日本語・記号を含む）', JSON.stringify(afterA.details) === JSON.stringify(beforeA.details), `${afterA.details.length}件`);
        const first = afterA.details.find((d) => d.id === ids[0]);
        check('赤い印のすべての種類を持つ図面が、そのまま戻っている', JSON.stringify(first?.drawing) === JSON.stringify(richDrawing));
        // 戻したあとも、ふつうに使える
        const put = await fetch(`${rbase}/api/projects/${ids[1]}`, { method: 'PUT', headers: { cookie: ra, 'content-type': 'application/json' }, body: JSON.stringify({ answers: { siteName: '戻したあとに直した' }, drawing: richDrawing }) });
        const reread = (await J(await fetch(`${rbase}/api/projects/${ids[1]}`, { headers: { cookie: ra } }))) as { answers: { siteName?: string } };
        check('戻したあとも、案件を保存できる', put.ok && reread.answers.siteName === '戻したあとに直した', `${put.status}`);
        const add = await fetch(`${rbase}/api/projects`, { method: 'POST', headers: { cookie: ra, 'content-type': 'application/json' }, body: JSON.stringify({ name: '戻したあとの新しい案件' }) });
        check('戻したあとも、新しい案件を作れる', add.ok, `${add.status}`);
        // 戻した先の変更は、もとのデータには及ばない
        const orig = (await J(await call(a, `/api/projects/${ids[1]}`))) as { answers: { siteName?: string } };
        check('戻した先で直しても、もとのサーバーの案件は変わらない（別々のデータ置き場）', orig.answers.siteName === '復元の試験 2');
        // 控えは、写真・PDFを写さない決まり。戻したあと、写真の記録だけが残って、開くとエラーになることがないか
        const filesOfRestored = (await J(await fetch(`${rbase}/api/projects/${ids[0]}`, { headers: { cookie: ra } }))) as { files: { id: string }[] };
        const fileRes = await fetch(`${rbase}/api/projects/${ids[0]}/files/${photo.id}`, { headers: { cookie: ra } });
        check('戻したあと、写真・PDFの記録だけが残っていても、開こうとして、サーバーがエラー（500）にならない', filesOfRestored.files.some((f) => f.id === photo.id) && fileRes.status >= 400 && fileRes.status < 500, `記録 ${filesOfRestored.files.length}件・開くと ${fileRes.status}`);
      }
    } finally {
      srv.kill();
      rmSync(restored, { recursive: true, force: true });
    }
  }

  /* ---------- 9b. 保存されている写真・PDFの一括削除 ---------- */
  say('\n■ 写真・PDFの一括削除（以前の版が預かった分の片付け）');
  {
    const pj = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '一括削除の試験' }) })).json()) as { id: string };
    const ids: string[] = [];
    for (const type of ['image/png', 'application/pdf']) {
      const r = (await (await call(a, `/api/projects/${pj.id}/files`, { method: 'POST', body: JSON.stringify({ fileName: 'x', mediaType: type, data: Buffer.from('dummy-purge').toString('base64') }) })).json()) as { id: string };
      ids.push(r.id);
    }
    // 持ち主の分からないファイル（記録が無いのに残っているもの）
    writeFileSync(join(dataDir, 'files', 'orphan-test-file'), 'x');
    const dry = await runNode(['apps/server/src/cli.ts', 'purge-photos'], env);
    check('数えるだけのときは、何も消さない', dry.code === 0 && ids.every((id) => existsSync(join(dataDir, 'files', id))) && existsSync(join(dataDir, 'files', 'orphan-test-file')), dry.out.trim().split('\n')[0]);
    check('数えた結果に、枚数が出る', /消える写真・PDF: \d+枚/.test(dry.out));
    const run = await runNode(['apps/server/src/cli.ts', 'purge-photos', '--yes'], env);
    check('--yes を付けると、消せる', run.code === 0, run.out.trim().split('\n')[0]);
    check('写真・PDFのファイルが消えている', ids.every((id) => !existsSync(join(dataDir, 'files', id))));
    check('持ち主の分からないファイルも消えている', !existsSync(join(dataDir, 'files', 'orphan-test-file')));
    const after = (await (await call(a, `/api/projects/${pj.id}`)).json()) as { files: unknown[]; sketchRead: boolean; name: string };
    check('案件は残り、写真の記録だけ無い', after.name === '一括削除の試験' && after.files.length === 0);
    check('「読み取った案件」の印は残る', after.sketchRead === true);
    const again = await runNode(['apps/server/src/cli.ts', 'purge-photos'], env);
    check('もう一度数えると、消すものは無い', /消すものはありません/.test(again.out));
  }

  /* ---------- 10. 作図 ---------- */
  say('\n■ 作図');
  const { buildComposition } = await import('../../packages/knowledge/src/index.ts');
  const { layout } = await import('../../packages/layout/src/index.ts');
  const { renderSvg } = await import('../../packages/layout/src/index.ts');
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
}
