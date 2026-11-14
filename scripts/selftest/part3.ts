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
import { ROOT, say, ok, ng, check, runNode, dataDir, backupDir } from './common.ts';
import type { part2 } from './part2.ts';

export async function part3(c: Awaited<ReturnType<typeof part2>>) {
  const { env, base, login2, call, a, b, created, answers, kanri } = c;
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

  /* ---------- 7b2b. 古い形式の案件（docs/legacy-projects/） ---------- */
  say('\n■ 古い形式の案件');
  {
    const dir = join(ROOT, 'docs', 'legacy-projects');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const smp = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { name: string; answers: Record<string, unknown>; drawing: unknown };
      const mk = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: `見本 ${smp.name}`, answers: smp.answers }) })).json()) as { id: string };
      const put = await call(a, `/api/projects/${mk.id}`, { method: 'PUT', body: JSON.stringify({ answers: smp.answers, ...(smp.drawing ? { drawing: smp.drawing } : {}) }) });
      const back = (await (await call(a, `/api/projects/${mk.id}`)).json()) as { answers: unknown; drawing: unknown };
      const same = put.ok && JSON.stringify(back.answers) === JSON.stringify(smp.answers) && JSON.stringify(back.drawing ?? null) === JSON.stringify(smp.drawing ?? null);
      check(`古い形式の案件「${f}」を、サーバーが受け取って、そのまま返せる`, same, same ? '' : put.ok ? '回答・図面が、保存の前と違います' : `保存できません（${put.status}）`);
      const dup = await call(a, `/api/projects/${mk.id}/duplicate`, { method: 'POST' });
      check(`古い形式の案件「${f}」を、複製できる`, dup.ok, dup.ok ? '' : `（${dup.status}）`);
    }
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

  /* ---------- 9a2. ディスクがいっぱいのとき ---------- */
  say('\n■ ディスクがいっぱいのとき（本物の満杯のディスクを作って、サーバーを動かして確かめる）');
  {
    const J = (r: Response) => r.json() as Promise<any>;
    const { execFileSync, spawn } = await import('node:child_process');
    const { appendFileSync, unlinkSync } = await import('node:fs');
    const { ROOT, sleep, freePort } = await import('./common.ts');
    const mnt = mkdtempSync(join(tmpdir(), 'zumen-full-'));
    let mounted = false;
    // 小さな専用の領域（3MB）を作る。Linux で、管理者の権限があるときだけ作れる
    if (process.platform === 'linux') {
      try {
        execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=3m', 'tmpfs', mnt], { stdio: 'pipe' });
        mounted = true;
      } catch {
        mounted = false;
      }
    }
    if (!mounted) {
      ok('（この環境では、満杯のディスクを作れない（Linux で、管理者の権限が必要）ため、この確認は省略します）');
      rmSync(mnt, { recursive: true, force: true });
    } else {
      const fdata = join(mnt, 'data');
      const fbackups = join(mnt, 'backups');
      mkdirSync(fdata);
      const fenv = { DATA_DIR: fdata, ANTHROPIC_API_KEY: '' };
      let srv: ReturnType<typeof spawn> | null = null;
      try {
        await runNode(['apps/server/src/cli.ts', 'add', 'full1', '満杯試験', 'testpass123'], fenv);
        await runNode(['apps/server/src/cli.ts', 'add', 'fulladmin', '満杯管理', 'testpass123', 'admin'], fenv);
        const fport = await freePort();
        const fb = `http://127.0.0.1:${fport}`;
        srv = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
          cwd: ROOT,
          env: { ...process.env, ...fenv, PORT: String(fport), BACKUP_DIR: fbackups },
        });
        let flog = '';
        srv.stdout?.on('data', (d) => (flog += String(d)));
        srv.stderr?.on('data', (d) => (flog += String(d)));
        let up = false;
        for (let i = 0; i < 40 && !up; i++) {
          await sleep(500);
          up = await fetch(`${fb}/api/health`).then((r) => r.ok).catch(() => false);
        }
        check('満杯の試験用のサーバーが起動する', up);
        // 大きな送信の途中で、サーバーが先に答えて接続を閉じると、使い回していた接続が閉じていることがある（ブラウザは、自動でやり直す）。
        // 試験の道具も、閉じていたときだけ、もう1回やり直す（ディスクの満杯とは関係ない、通信の作法の話）
        const f2 = (url: string, init?: RequestInit): Promise<Response> =>
          fetch(url, init).catch((e: Error & { cause?: { message?: string } }) => {
            if (/other side closed|ECONNRESET/.test(e.cause?.message ?? e.message)) return fetch(url, init);
            throw e;
          });
        const loginF = async (userId: string) => {
          const r = await f2(`${fb}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, password: 'testpass123' }) }).catch((e: Error & { cause?: unknown }) => {
            throw new Error(`${e.message}（${String((e.cause as Error | undefined)?.message ?? e.cause)}）`);
          });
          return { status: r.status, cookie: r.ok ? (r.headers.get('set-cookie') ?? '').split(';')[0]! : '', body: (await r.json().catch(() => ({}))) as { error?: string } };
        };
        const callF = (cookie: string, path: string, init?: RequestInit) =>
          f2(fb + path, { ...init, headers: { cookie, ...(init?.body ? { 'content-type': 'application/json' } : {}) } });
        const u = (await loginF('full1')).cookie;
        const adm = (await loginF('fulladmin')).cookie;
        // 満杯になる前に、ふつうの案件と写真と、控えを1つ作っておく
        const pj = (await J(await callF(u, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '満杯の前の案件' }) }))) as { id: string };
        const normal = { answers: { siteName: '満杯の前に保存した' }, drawing: { items: [{ kind: 'text', id: 't', x: 1, y: 2, lines: ['保存済み'], anchor: 'start' }] } };
        await callF(u, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify(normal) });
        const bk0 = await runNode(['apps/server/src/cli.ts', 'backup', fbackups], fenv);
        check('満杯になる前に、控えを作れる', bk0.code === 0);
        const goodBackups = readdirSync(fbackups).filter((n) => /^\d{8}-\d{6}$/.test(n));
        const filesBefore = readdirSync(join(fdata, 'files')).length;

        // ディスクを満杯にする（空きが 0 になるまで、少しずつ書く）
        const filler = join(mnt, 'filler');
        for (const size of [65536, 4096, 512, 64, 1]) {
          for (;;) {
            try {
              appendFileSync(filler, Buffer.alloc(size));
            } catch {
              break;
            }
          }
        }
        let freeLeft = -1;
        try {
          const { statfsSync } = await import('node:fs');
          const f = statfsSync(mnt);
          freeLeft = Number(f.bavail) * Number(f.bsize);
        } catch {
          freeLeft = -1;
        }
        check('ディスクを満杯にできた（空きがほぼ無い）', freeLeft >= 0 && freeLeft < 4096, `空き ${freeLeft}バイト`);

        const big = { answers: { siteName: '満杯のときに保存しようとした' }, drawing: { items: Array.from({ length: 6000 }, (_, i) => ({ kind: 'text', id: `t${i}`, x: i, y: i, lines: ['あ'.repeat(60)], anchor: 'start' })) } };
        const save = await callF(u, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify(big) });
        const saveBody = (await J(save)) as { error?: string; diskFull?: boolean };
        check('満杯のとき、保存は、サーバーのエラー（500）ではなく、「ディスクがいっぱい」と分かる状態（507）で断られる', save.status === 507 && saveBody.diskFull === true, `${save.status}`);
        check('断るときの文が、原因（ディスクがいっぱい）・入力が残っていること・管理の方に伝えること、を伝える', /ディスクがいっぱい/.test(saveBody.error ?? '') && /残っています/.test(saveBody.error ?? '') && /管理の方/.test(saveBody.error ?? ''), saveBody.error ?? '');
        const photo = await callF(u, `/api/projects/${pj.id}/files`, { method: 'POST', body: JSON.stringify({ fileName: 'a.png', mediaType: 'image/png', data: Buffer.alloc(300_000, 7).toString('base64') }) });
        check('満杯のとき、写真を預かれない旨を、同じ言葉で伝える（507）', photo.status === 507, `${photo.status}`);
        check('写真の書き込みに失敗しても、書きかけのファイルが残らない', readdirSync(join(fdata, 'files')).length === filesBefore, `${filesBefore} → ${readdirSync(join(fdata, 'files')).length}`);
        const lg = await loginF('full1');
        check('満杯のとき、新しくログインできない理由も、同じ言葉で伝える（507）', lg.status === 507 && /ディスクがいっぱい/.test(lg.body.error ?? ''), `${lg.status}`);

        // 見るだけの操作は、続けられる。サーバーも止まらない。保存済みの案件は、そのまま
        const read = await callF(u, `/api/projects/${pj.id}`);
        const readBody = (await J(read)) as { answers: unknown; drawing: unknown };
        check('満杯のあいだも、保存済みの案件を開ける。中身は、満杯になる前のまま（途中まで書かれていない）', read.ok && JSON.stringify(readBody.answers) === JSON.stringify(normal.answers) && JSON.stringify(readBody.drawing) === JSON.stringify(normal.drawing));
        check('満杯のあいだも、案件の一覧を見られる', (await callF(u, '/api/projects')).ok);
        await sleep(1500);
        check('満杯のあいだも、サーバーは止まらず、応答し続ける', (await fetch(`${fb}/api/health`).then((r) => r.ok).catch(() => false)));
        {
          const stat = await callF(adm, '/api/admin/status');
          const sb = (await J(stat)) as { disk: { freePercent: number } | null; warnings: { code: string }[] };
          check('満杯のあいだ、管理者の状態の画面に、「ディスクの空きが少ない」の注意が出る', stat.ok && (sb.disk?.freePercent ?? 100) <= 10 && sb.warnings.some((w) => w.code === 'disk-low'), JSON.stringify(sb.warnings));
        }

        // 控え：満杯のときに作ろうとして失敗しても、空の控え・作りかけが残らず、前の控えも消えない
        const bk1 = await runNode(['apps/server/src/cli.ts', 'backup', fbackups], fenv);
        check('満杯のとき、控えは作れず、失敗として知らせる', bk1.code !== 0);
        const afterNames = readdirSync(fbackups);
        check('控えの作成に失敗しても、空の控え・作りかけが残らない（最新の控えとして、数えられてしまわない）', afterNames.every((n) => goodBackups.includes(n)), afterNames.join(','));
        check('前の控え（満杯になる前のもの）は、そのまま残っている', goodBackups.every((n) => existsSync(join(fbackups, n, 'zumen.db')) && statSync(join(fbackups, n, 'zumen.db')).size > 0));

        // 空きを作ると、サーバーを起動し直さなくても、もとどおり使える
        unlinkSync(filler);
        const lg2 = await loginF('full1');
        check('空きを作ると、起動し直さなくても、ログインできる', lg2.status === 200);
        // 空きを作ったあとは、ふつうの大きさの図面を保存できる（満杯のときに断った巨大な図面は、そもそも入らない大きさ）
        const usual = { answers: { siteName: '空きを作ったあとに保存した' }, drawing: { items: Array.from({ length: 300 }, (_, i) => ({ kind: 'text', id: `t${i}`, x: i, y: i, lines: ['あ'.repeat(30)], anchor: 'start' })) } };
        const save2 = await callF(lg2.cookie, `/api/projects/${pj.id}`, { method: 'PUT', body: JSON.stringify(usual) });
        check('空きを作ると、起動し直さなくても、保存できる', save2.ok, `${save2.status}`);
        const photo2 = await callF(lg2.cookie, `/api/projects/${pj.id}/files`, { method: 'POST', body: JSON.stringify({ fileName: 'a.png', mediaType: 'image/png', data: Buffer.alloc(300_000, 7).toString('base64') }) });
        check('空きを作ると、写真も預かれる', photo2.status === 201, `${photo2.status}`);
        const bk2b = await runNode(['apps/server/src/cli.ts', 'backup', fbackups], fenv);
        check('空きを作ると、控えも作れる', bk2b.code === 0);
        const live = new DatabaseSync(join(fdata, 'zumen.db'), { readOnly: true });
        const qc = (live.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
        live.close();
        check('満杯を経験したデータベースは、壊れていない', qc === 'ok', qc);
      } finally {
        srv?.kill();
        await sleep(300);
        try {
          execFileSync('umount', [mnt], { stdio: 'pipe' });
        } catch {
          // 外せなくても、一時の領域なので、あとで片づく
        }
        rmSync(mnt, { recursive: true, force: true });
      }
    }
  }

  /* ---------- 9a3. アプリの更新と、元の版へ戻す ---------- */
  say('\n■ アプリの更新（update-mac.command）と、更新前の版へ戻す（rollback-mac.command）');
  {
    const { spawnSync } = await import('node:child_process');
    const { cpSync, readFileSync: rf, existsSync: ex, rmSync: rm2, readdirSync: rd } = await import('node:fs');
    const { ROOT } = await import('./common.ts');
    const need = ['bash', 'zip', 'unzip', 'curl', 'tar', 'find'];
    const missing = need.filter((c) => spawnSync('sh', ['-c', `command -v ${c}`]).status !== 0);
    if (missing.length) {
      ok(`（この環境には ${missing.join('・')} が無いため、この確認は省略します）`);
    } else {
      const hasRsync = spawnSync('sh', ['-c', 'command -v rsync']).status === 0;
      const variants: { label: string; noRsync: boolean }[] = [{ label: 'rsync なし（find と tar）', noRsync: true }, ...(hasRsync ? [{ label: 'rsync あり', noRsync: false }] : [])];
      if (!hasRsync) ok('（この環境には rsync が無いため、rsync を使う側の確認は省略します。GitHub の自動確認では動きます）');
      const put = (path: string, text: string) => {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, text);
      };
      const text = (path: string) => (ex(path) ? rf(path, 'utf8') : null);
      const COPIES = '更新前の控え'; // 「zumen-更新前の控え」の後ろ
      for (const v of variants) {
        const tag = `［${v.label}］`;
        const base = mkdtempSync(join(tmpdir(), 'zumen-upd-'));
        const home = join(base, 'home');
        const app = join(base, 'app');
        const copies = join(home, `zumen-${COPIES}`);
        mkdirSync(home);
        // いまのアプリ（版 1.0.0）
        put(join(app, 'package.json'), '{\n  "name": "zumen",\n  "version": "1.0.0"\n}\n');
        put(join(app, 'app-file.txt'), 'v1');
        put(join(app, 'old-only.txt'), '古い版にだけあるファイル');
        put(join(app, 'dir/sub.txt'), 'old');
        put(join(app, '.env'), 'ANTHROPIC_API_KEY=secret');
        put(join(app, 'data/zumen.db'), 'DATA1');
        put(join(app, 'node_modules/dep/index.js'), 'dep');
        put(join(app, 'apps/web/node_modules/x'), 'nested-dep');
        put(join(app, '.git/HEAD'), 'ref');
        for (const f of ['update-mac.command', 'rollback-mac.command']) cpSync(join(ROOT, f), join(app, f));
        // 新しい版（2.0.0）のZIP（展開すると、zumen-main/ という1段深いフォルダになる）
        const src = join(base, 'zip-src', 'zumen-main');
        put(join(src, 'package.json'), '{\n  "name": "zumen",\n  "version": "2.0.0"\n}\n');
        put(join(src, 'app-file.txt'), 'v2');
        put(join(src, 'new-only.txt'), '新しい版にだけあるファイル');
        put(join(src, 'dir/sub.txt'), 'new');
        for (const f of ['update-mac.command', 'rollback-mac.command']) cpSync(join(ROOT, f), join(src, f));
        const zip = join(base, 'new.zip');
        spawnSync('zip', ['-qr', zip, 'zumen-main'], { cwd: join(base, 'zip-src') });
        const run = (script: string, extra: Record<string, string>) =>
          spawnSync('bash', [join(app, script)], {
            env: { ...process.env, HOME: home, ZUMEN_SKIP_INSTALL: '1', ZUMEN_NO_RSYNC: v.noRsync ? '1' : '0', ZUMEN_ZIP_URL: `file://${zip}`, ...extra },
            input: '\n',
            encoding: 'utf8',
            timeout: 60_000,
          });
        const stamps = () => rd(copies).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort();
        try {
          // 1. 更新する
          const up = run('update-mac.command', { ZUMEN_STAMP: '20261101-100000' });
          check(`${tag}更新できる`, up.status === 0, up.status === 0 ? '' : `${up.status} ${up.stdout.split('\n').slice(-4).join(' / ')}`);
          check(`${tag}更新すると、新しい版の中身になる（変わったもの・増えたものが入り、無くなったものが消える）`, text(join(app, 'app-file.txt')) === 'v2' && text(join(app, 'new-only.txt')) !== null && text(join(app, 'old-only.txt')) === null && text(join(app, 'dir/sub.txt')) === 'new' && /2\.0\.0/.test(text(join(app, 'package.json')) ?? ''));
          check(`${tag}更新しても、APIキー（.env）・案件のデータ（data）・部品（node_modules）は、そのまま`, text(join(app, '.env')) === 'ANTHROPIC_API_KEY=secret' && text(join(app, 'data/zumen.db')) === 'DATA1' && text(join(app, 'node_modules/dep/index.js')) === 'dep' && text(join(app, 'apps/web/node_modules/x')) === 'nested-dep' && text(join(app, '.git/HEAD')) === 'ref');
          const c1 = join(copies, '20261101-100000');
          check(`${tag}更新前の控えに、アプリ本体（更新前の版）も入っている`, text(join(c1, 'app/app-file.txt')) === 'v1' && text(join(c1, 'app/old-only.txt')) !== null && /1\.0\.0/.test(text(join(c1, 'app/package.json')) ?? ''));
          check(`${tag}更新前の控えの本体には、データ・APIキー・部品を入れない（データは別に控える）`, !ex(join(c1, 'app/data')) && !ex(join(c1, 'app/.env')) && !ex(join(c1, 'app/node_modules')) && !ex(join(c1, 'app/.git')) && text(join(c1, 'data/zumen.db')) === 'DATA1' && text(join(c1, '.env')) === 'ANTHROPIC_API_KEY=secret');

          // 2. 更新したあとに、案件が増える
          put(join(app, 'data/zumen.db'), 'DATA2');
          put(join(app, 'data/new-project.txt'), '更新のあとに作った案件');

          // 3. 戻す（データは、そのまま）
          const rb = run('rollback-mac.command', { ZUMEN_YES: 'yes', ZUMEN_RESTORE_DATA: 'no', ZUMEN_STAMP: '20261101-110000' });
          check(`${tag}更新前の版に戻せる`, rb.status === 0, rb.status === 0 ? '' : `${rb.status} ${rb.stdout.split('\n').slice(-4).join(' / ')}`);
          check(`${tag}戻すと、更新前の版の中身になる（増えたものが消え、無くなっていたものが戻る）`, text(join(app, 'app-file.txt')) === 'v1' && text(join(app, 'old-only.txt')) !== null && text(join(app, 'new-only.txt')) === null && text(join(app, 'dir/sub.txt')) === 'old' && /1\.0\.0/.test(text(join(app, 'package.json')) ?? ''));
          check(`${tag}戻しても、案件のデータ（更新のあとに作った分も）・APIキー・部品は、そのまま`, text(join(app, 'data/zumen.db')) === 'DATA2' && text(join(app, 'data/new-project.txt')) === '更新のあとに作った案件' && text(join(app, '.env')) === 'ANTHROPIC_API_KEY=secret' && text(join(app, 'node_modules/dep/index.js')) === 'dep');
          const b1 = join(copies, '20261101-110000-戻す前');
          check(`${tag}戻す前の状態（新しい版の本体・そのときのデータ）も、あらためて控える`, text(join(b1, 'app/app-file.txt')) === 'v2' && text(join(b1, 'data/zumen.db')) === 'DATA2');
          check(`${tag}戻す操作の控えは、「更新前の控え」の一覧に混ざらない（次に戻すとき、戻し先に選ばれない）`, stamps().join() === '20261101-100000');

          // 4. もう一度戻しても、同じ（戻す前の控えを、戻し先に選ばない）
          const rb2 = run('rollback-mac.command', { ZUMEN_YES: 'yes', ZUMEN_RESTORE_DATA: 'no', ZUMEN_STAMP: '20261101-110100' });
          check(`${tag}続けてもう一度戻しても、同じ更新前の版のまま（壊れた版を、戻し先に選ばない）`, rb2.status === 0 && text(join(app, 'app-file.txt')) === 'v1' && text(join(app, 'new-only.txt')) === null);

          // 5. 更新し直して、データも一緒に戻す
          run('update-mac.command', { ZUMEN_STAMP: '20261101-120000' });
          check(`${tag}更新し直せる`, text(join(app, 'app-file.txt')) === 'v2' && stamps().join() === '20261101-100000,20261101-120000');
          put(join(app, 'data/zumen.db'), 'DATA3');
          put(join(app, 'data/after-update.txt'), '2回目の更新のあとに作った案件');
          const rb3 = run('rollback-mac.command', { ZUMEN_YES: 'yes', ZUMEN_RESTORE_DATA: 'yes', ZUMEN_STAMP: '20261101-130000' });
          check(`${tag}データも一緒に戻せる（戻し先は、いちばん新しい更新前の控え）`, rb3.status === 0 && text(join(app, 'app-file.txt')) === 'v1' && text(join(app, 'data/zumen.db')) === 'DATA2' && text(join(app, 'data/after-update.txt')) === null);
          check(`${tag}データも戻したとき、戻す前のデータも、控えに残る`, text(join(copies, '20261101-130000-戻す前', 'data/zumen.db')) === 'DATA3' && text(join(copies, '20261101-130000-戻す前', 'data/after-update.txt')) !== null);

          // 6. 更新に失敗したとき（新しい中身を取れない）は、何も変えない
          const before = text(join(app, 'app-file.txt'));
          const failUp = run('update-mac.command', { ZUMEN_ZIP_URL: `file://${base}/nai.zip`, ZUMEN_STAMP: '20261101-140000' });
          check(`${tag}新しい中身を取れなかったとき、更新は止まり、アプリは変わらない`, failUp.status !== 0 && text(join(app, 'app-file.txt')) === before && text(join(app, 'data/zumen.db')) === 'DATA2');

          // 7. 控えは新しい3回分だけ残る（戻す前の控えは、片づけの対象にしない）
          for (const [i, st] of ['20261102-100000', '20261103-100000', '20261104-100000'].entries()) {
            put(join(app, 'app-file.txt'), `v1-${i}`);
            run('update-mac.command', { ZUMEN_STAMP: st });
          }
          check(`${tag}更新前の控えは、新しい3回分だけ残る。戻す前の控えは、残る`, stamps().join() === '20261102-100000,20261103-100000,20261104-100000' && ex(join(copies, '20261101-130000-戻す前')), stamps().join(','));
          check(`${tag}残った控えには、どれもアプリ本体が入っている`, stamps().every((n) => ex(join(copies, n, 'app/package.json'))));
        } finally {
          rm2(base, { recursive: true, force: true });
        }
      }
      // 戻し先が無いとき（アプリ本体を控えるようになる前の更新だけ、のとき）
      {
        const base = mkdtempSync(join(tmpdir(), 'zumen-upd-'));
        const home = join(base, 'home');
        const app = join(base, 'app');
        put(join(app, 'package.json'), '{\n  "name": "zumen",\n  "version": "3.0.0"\n}\n');
        put(join(app, 'app-file.txt'), 'now');
        put(join(app, 'data/zumen.db'), 'DATA');
        cpSync(join(ROOT, 'rollback-mac.command'), join(app, 'rollback-mac.command'));
        put(join(home, `zumen-${COPIES}/20260101-000000/data/zumen.db`), 'OLD'); // 本体の控えが無い、古い形の控え
        const r = spawnSync('bash', [join(app, 'rollback-mac.command')], { env: { ...process.env, HOME: home, ZUMEN_YES: 'yes' }, input: '\n', encoding: 'utf8', timeout: 30_000 });
        check('戻し先（アプリ本体の控え）が無いとき、何も変えずに、分かる言葉で断る', r.status !== 0 && /見つかりません/.test(r.stdout) && text(join(app, 'app-file.txt')) === 'now' && text(join(app, 'data/zumen.db')) === 'DATA');
        rm2(base, { recursive: true, force: true });
      }
    }
  }

  /* ---------- 9a4. AI の読み取り：応答が来ない・遅い・途中で切れる・大きすぎる ---------- */
  say('\n■ AI の読み取り（本物の AI は使わず、わざと応答しない・遅い・途中で切れる、疑似の AI サーバーで確かめる）');
  {
    const J = (r: Response) => r.json() as Promise<any>;
    const { spawn } = await import('node:child_process');
    const { createServer } = await import('node:http');
    const { ROOT, sleep, freePort } = await import('./common.ts');
    // 疑似の AI サーバー（Anthropic の messages API のふりをする）
    type Mode = 'ok' | 'slow' | 'hang' | 'cut' | 'overloaded' | 'maxtokens';
    const fake = { mode: 'ok' as Mode, slowMs: 600, hits: 0, aborted: 0 };
    const reply = (stop: string) =>
      JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: JSON.stringify({ answers: [], evidence: [], uncertain: [], notes: ['試験'], questions: [] }) }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } });
    const sockets = new Set<import('node:net').Socket>();
    const fakeSrv = createServer((req, res) => {
      fake.hits++;
      let done = false;
      req.on('close', () => {
        if (!done) fake.aborted++;
      });
      req.resume();
      req.on('end', () => {
        const send = (code: number, body: string) => {
          done = true;
          res.writeHead(code, { 'content-type': 'application/json' });
          res.end(body);
        };
        if (fake.mode === 'ok') send(200, reply('end_turn'));
        else if (fake.mode === 'maxtokens') send(200, reply('max_tokens'));
        else if (fake.mode === 'overloaded') send(529, JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
        else if (fake.mode === 'slow') setTimeout(() => send(200, reply('end_turn')), fake.slowMs);
        else if (fake.mode === 'cut') {
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': '5000' });
          res.write('{"id":"msg_1","type":"mess');
          setTimeout(() => {
            done = true;
            res.socket?.destroy();
          }, 100);
        }
        // hang：何も返さない
      });
    });
    fakeSrv.on('connection', (sk) => {
      sockets.add(sk);
      sk.on('close', () => sockets.delete(sk));
    });
    await new Promise<void>((r) => fakeSrv.listen(0, '127.0.0.1', r));
    const fakePort = (fakeSrv.address() as { port: number }).port;

    const aiData = mkdtempSync(join(tmpdir(), 'zumen-ai-'));
    const aenv = { DATA_DIR: aiData, ANTHROPIC_API_KEY: 'sk-ant-fake-for-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakePort}`, ANALYZE_TIMEOUT_MS: '1500' };
    await runNode(['apps/server/src/cli.ts', 'add', 'ai1', 'AI一', 'testpass123'], aenv);
    await runNode(['apps/server/src/cli.ts', 'add', 'ai2', 'AI二', 'testpass123'], aenv);
    const aport = await freePort();
    const ab = `http://127.0.0.1:${aport}`;
    const srv = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], { cwd: ROOT, env: { ...process.env, ...aenv, PORT: String(aport) } });
    srv.stdout?.on('data', () => undefined);
    srv.stderr?.on('data', () => undefined);
    try {
      let up = false;
      for (let i = 0; i < 40 && !up; i++) {
        await sleep(500);
        up = await fetch(`${ab}/api/health`).then((r) => r.ok).catch(() => false);
      }
      check('読み取りの試験用のサーバーが起動する', up);
      const loginA = async (id: string) => {
        const r = await fetch(`${ab}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id, password: 'testpass123' }) });
        return (r.headers.get('set-cookie') ?? '').split(';')[0]!;
      };
      const c1 = await loginA('ai1');
      const c2 = await loginA('ai2');
      const png = Buffer.from('dummy').toString('base64');
      const body = (images: { mediaType: string; data: string }[] = [{ mediaType: 'image/png', data: png }]) => JSON.stringify({ images, answers: {} });
      const fetchRetry = async (url: string, init: RequestInit) =>
        fetch(url, init).catch((e: Error & { cause?: { message?: string } }) => {
          // サーバーが、本文を読み終える前に答えたときの、接続の使い回しの癖（アプリの不具合ではない）。1回だけやり直す
          if (/other side closed|ECONNRESET/.test(e.cause?.message ?? e.message)) return fetch(url, init);
          throw e;
        });
      /** 読み取りを頼む（受け付けられたら、状態 202 と jobId。断られたら、その理由） */
      const ask = async (cookie: string, b = body()) => {
        const t0 = Date.now();
        const r = await fetchRetry(`${ab}/api/analyze`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: b });
        const j = (await J(r).catch(() => ({}))) as { error?: string; jobId?: string };
        return { status: r.status, error: j.error ?? '', jobId: j.jobId ?? '', ms: Date.now() - t0 };
      };
      /** 読み取りの様子を聞く */
      const peek = async (cookie: string, id: string) => {
        const t0 = Date.now();
        const r = await fetchRetry(`${ab}/api/analyze/${id}`, { headers: { cookie } });
        const j = (await J(r).catch(() => ({}))) as { state?: string; error?: string; code?: number; result?: unknown };
        return { http: r.status, ...j, ms: Date.now() - t0 };
      };
      /** 画面と同じに、頼んでから、終わるまで聞き続ける。返す状態は、これまでの形（成功 200・失敗は理由の番号）にそろえる */
      const post = async (cookie: string, b = body()) => {
        const t0 = Date.now();
        const q = await ask(cookie, b);
        if (q.status !== 202) return { status: q.status, error: q.error, result: undefined as unknown, ms: Date.now() - t0, maxReqMs: q.ms, polls: 0 };
        let maxReqMs = q.ms;
        let polls = 0;
        for (;;) {
          await sleep(150);
          const r = await peek(cookie, q.jobId);
          polls++;
          maxReqMs = Math.max(maxReqMs, r.ms);
          if (r.http === 404) return { status: 404, error: r.error ?? '', result: undefined as unknown, ms: Date.now() - t0, maxReqMs, polls };
          if (r.state === 'running') continue;
          if (r.state === 'error') return { status: r.code ?? 502, error: r.error ?? '', result: undefined as unknown, ms: Date.now() - t0, maxReqMs, polls };
          await fetch(`${ab}/api/analyze/${q.jobId}`, { method: 'DELETE', headers: { cookie } });
          return { status: 200, error: '', result: r.result, ms: Date.now() - t0, maxReqMs, polls };
        }
      };
      const reset = (mode: Mode) => {
        fake.mode = mode;
        fake.hits = 0;
        fake.aborted = 0;
      };

      // 1. 応答が来ない：「ずっと待たされる」のではなく、決めた時間で止まって、分かる言葉で伝える
      reset('hang');
      const hang = await post(c1);
      check('AI が応答しないとき、ずっと待たされず、決めた時間のうちに止まる（時間切れの状態 504）', hang.status === 504 && hang.ms < 15_000, `${hang.status}・${hang.ms}ms`);
      check('時間切れの案内は、「時間がかかりすぎたので止めた」ことと、どうするかを伝える（「つながらなかった」とは言わない）', /時間がかかりすぎ/.test(hang.error) && /お試しください/.test(hang.error) && !/つながりませんでした/.test(hang.error), hang.error);
      check('やり直しは1回だけ（無駄に長く待たず、料金も二重に増やさない）', fake.hits === 2, `AI への問い合わせ ${fake.hits}回`);
      // 2. 止まったあとは、すぐ、もう一度使える
      reset('ok');
      const again = await post(c1);
      check('時間切れのあと、すぐにもう一度、読み取れる', again.status === 200 && again.result !== undefined, `${again.status}`);

      // 3. 遅いが、時間内に返る
      reset('slow');
      const slow = await post(c1);
      check('時間内に返ってくる遅い応答は、ふつうに読み取れる', slow.status === 200 && slow.ms >= 500, `${slow.status}・${slow.ms}ms`);

      // 4. 途中で切れる
      reset('cut');
      const cut = await post(c1);
      check('AI の応答が途中で切れたとき、すぐに、分かる言葉（日本語）で伝える', cut.status === 502 && /[ぁ-んァ-ン一-龥]/.test(cut.error) && !/ECONN|socket|fetch failed|undefined/i.test(cut.error) && cut.ms < 15_000, `${cut.status}・${cut.ms}ms・${cut.error.slice(0, 50)}`);

      // 5. AI が混み合っている（529）
      reset('overloaded');
      const over = await post(c1);
      check('AI が混み合っているとき、1回だけやり直して、分かる言葉で伝える', over.status === 502 && /混み合って/.test(over.error) && fake.hits === 2, `${over.status}・問い合わせ ${fake.hits}回・${over.error.slice(0, 40)}`);

      // 6. 結果が長すぎて途中で止まった
      reset('maxtokens');
      const tooLong = await post(c1);
      check('結果が長すぎて途中で止まったとき、枚数やページ数を減らすよう伝える', tooLong.status === 502 && /途中で止まりました/.test(tooLong.error) && /減らして/.test(tooLong.error), tooLong.error);

      // 7. 画面が「やめる」を押した：AI への問い合わせも止まり、すぐに次を使える
      reset('hang');
      const q7 = await ask(c1);
      await sleep(700);
      const del7 = await fetch(`${ab}/api/analyze/${q7.jobId}`, { method: 'DELETE', headers: { cookie: c1 } });
      let stopped = false;
      for (let i = 0; i < 20 && !stopped; i++) {
        await sleep(200);
        stopped = fake.aborted >= 1;
      }
      check('「やめる」を押すと、AI への問い合わせも、そこでやめる（待ち続けて料金がかからない）', del7.ok && stopped, `切れた問い合わせ ${fake.aborted}回`);
      check('やめた読み取りの記録は、消えている', (await peek(c1, q7.jobId)).http === 404);
      reset('ok');
      const afterCancel = await post(c1);
      check('やめたあと、すぐにもう一度、読み取れる', afterCancel.status === 200, `${afterCancel.status}`);

      // 8. 通信が切れても、読み取りは続く。1回ずつの通信は短い（外から入る設定の、約100秒の制限に、引っかからない作り）
      reset('slow');
      fake.slowMs = 1000;
      const q8 = await ask(c1);
      check('読み取りを頼むと、すぐに「受け付けました」と返る（読み取りが終わるのを待たない）', q8.status === 202 && q8.jobId !== '' && q8.ms < 500, `${q8.status}・${q8.ms}ms`);
      // ここで、画面の通信が途切れたとする（何も聞きに行かない）。読み取りは、サーバーで続いている
      await sleep(300);
      const mid = await peek(c1, q8.jobId);
      check('読み取りの途中は、「読み取り中」と答える（すぐ返る）', mid.state === 'running' && mid.ms < 500, `${mid.state}・${mid.ms}ms`);
      await sleep(1100);
      const late = await peek(c1, q8.jobId);
      check('通信が途切れていた間に、読み取りが終わっていても、つながり直せば、結果を受け取れる', late.state === 'done' && late.result !== undefined, `${late.state}`);
      check('読み取りの返事には、画面で使わない「確認してほしいこと」の一覧は、含まれない（無駄な計算と通信を、しない）', !('review' in late), Object.keys(late).join(','));
      check('ほかの人の読み取りの記録は、見えない・やめられない', (await peek(c2, q8.jobId)).http === 404 && (await (await fetch(`${ab}/api/analyze/${q8.jobId}`, { method: 'DELETE', headers: { cookie: c2 } })).json()).ok === true && (await peek(c1, q8.jobId)).state === 'done');
      await fetch(`${ab}/api/analyze/${q8.jobId}`, { method: 'DELETE', headers: { cookie: c1 } });
      check('受け取ったあとに記録を消すと、もう受け取れない（読み取った内容が、サーバーに残らない）', (await peek(c1, q8.jobId)).http === 404);
      check('ログインしていない人は、読み取りの様子を聞けない', (await fetch(`${ab}/api/analyze/${q8.jobId}`)).status === 401);
      // 全体として1秒以上かかる読み取りでも、1回ごとの通信は、短い
      reset('slow');
      fake.slowMs = 1200;
      const longJob = await post(c1);
      check('読み取りに1.2秒以上かかっても、1回ごとの通信は、0.5秒以内に終わる（つなぎっぱなしにならない）', longJob.status === 200 && longJob.ms >= 1100 && longJob.maxReqMs < 500 && longJob.polls >= 3, `全体 ${longJob.ms}ms・いちばん長い1回 ${longJob.maxReqMs}ms・聞いた回数 ${longJob.polls}`);

      // 9. 読み取りの途中でもう一度押す（画面を読み込み直して押し直した・別の画面から押した）：前のものはやめて、今回のものを始める。別の人は、そのまま使える
      reset('slow');
      fake.slowMs = 1000;
      const first = await ask(c1);
      await sleep(300);
      const second = await ask(c1);
      const other = await post(c2);
      const firstPeek = await peek(c1, first.jobId);
      let secondPeek = await peek(c1, second.jobId);
      for (let i = 0; i < 30 && secondPeek.state === 'running'; i++) {
        await sleep(150);
        secondPeek = await peek(c1, second.jobId);
      }
      check('読み取りの途中でもう一度押すと、前のものはやめて、今回のものが最後まで読み取られる', second.status === 202 && firstPeek.http === 404 && secondPeek.state === 'done', `前 ${firstPeek.http}・今回 ${secondPeek.state}`);
      check('前の読み取りは、AI への問い合わせも、やめている（料金が二重にかかり続けない）', fake.aborted >= 1, `切れた問い合わせ ${fake.aborted}回`);
      check('別の人の読み取りは、止められない', other.status === 200, `${other.status}`);
      await fetch(`${ab}/api/analyze/${second.jobId}`, { method: 'DELETE', headers: { cookie: c1 } });
      fake.slowMs = 600;

      // 9. 大きすぎる・多すぎる：AI に送る前に、すぐ断る（待たされない・料金がかからない）
      reset('ok');
      const eleven = await post(c1, body(Array.from({ length: 11 }, () => ({ mediaType: 'image/png', data: png }))));
      check('画像が11枚以上のとき、すぐ断る', eleven.status === 400 && /10枚/.test(eleven.error) && fake.hits === 0, `${eleven.status}`);
      const pages = '/Type /Page '.repeat(11);
      const pdf = await post(c1, body([{ mediaType: 'application/pdf', data: Buffer.from(pages).toString('base64') }]));
      check('PDF が11ページ以上のとき、AI に送らず、すぐ断る', pdf.status === 400 && /ページ数が多すぎ/.test(pdf.error) && fake.hits === 0 && pdf.ms < 3000, `${pdf.status}・${pdf.ms}ms`);
      const huge = await post(c1, body([{ mediaType: 'image/png', data: 'A'.repeat(31 * 1024 * 1024) }]));
      check('巨大なファイル（合計30MB超）のとき、AI に送らず、すぐ断る（待たされない）', [400, 413].includes(huge.status) && /大きすぎ/.test(huge.error) && fake.hits === 0 && huge.ms < 15_000, `${huge.status}・${huge.ms}ms・${huge.error.slice(0, 40)}`);
      const badType = await post(c1, body([{ mediaType: 'image/bmp', data: png }]));
      check('対応していない形式のとき、AI に送らず、すぐ断る', badType.status === 400 && /対応していない形式/.test(badType.error) && fake.hits === 0, `${badType.status}`);
      check('断ったあとも、サーバーは動いている', await fetch(`${ab}/api/health`).then((r) => r.ok).catch(() => false));

      // 読み取りの記録（サーバーの記憶の中）の、片づけ・上限・やめる
      const jp = await runNode(['scripts/selftest/job-purge.ts'], {});
      const jr = (() => {
        try {
          return JSON.parse(jp.out.trim().split('\n').pop() ?? '{}') as Record<string, boolean>;
        } catch {
          return {} as Record<string, boolean>;
        }
      })();
      check('終わった読み取りの記録は、1人に5件まで（古いものから消える）。別の人の記録は、巻き込まれない', jr.perUserCap === true && jr.otherUserSeen === true, jp.out.trim().slice(-120));
      check('30分を過ぎた記録は消えるが、読み取りの途中のものは、消えない', jr.expiredRemoved === true && jr.runningKept === true && jr.runningFound === true && jr.doneAfterRelease === true, '');
      check('「やめる」と、AI への問い合わせを止める合図が出て、記録が消える。ほかの人の記録は、やめられない', jr.cancelOk === true && jr.cancelOther === true, '');
    } finally {
      srv.kill();
      for (const sk of sockets) sk.destroy();
      await new Promise<void>((r) => fakeSrv.close(() => r()));
      rmSync(aiData, { recursive: true, force: true });
    }
  }

  /* ---------- 9a5. 停電・強制終了：書き込みの途中でサーバーを止めても、データが壊れないか ---------- */
  say('\n■ 停電・強制終了（保存・写真の預かり・控えを作る途中で、サーバーを強制終了することを繰り返す）');
  {
    const { spawn } = await import('node:child_process');
    const { DatabaseSync: DB } = await import('node:sqlite');
    const { ROOT, sleep, freePort } = await import('./common.ts');
    const { utimesSync } = await import('node:fs');
    const ROUNDS = Number(process.env.CRASH_ROUNDS ?? 6);
    const cdata = mkdtempSync(join(tmpdir(), 'zumen-crash-'));
    const cbackup = mkdtempSync(join(tmpdir(), 'zumen-crash-bk-'));
    const cenv = { DATA_DIR: cdata };
    const flags = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];
    await runNode(['apps/server/src/cli.ts', 'add', 'cr', 'クラッシュ', 'testpass123'], cenv);
    const bad: string[] = [];
    let acked = 0;
    let projectId = '';
    const ackedFiles: { id: string; size: number }[] = [];
    let stray = '';
    let lastSaved = 0;
    let startedOk = 0;
    let killedMid = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const srv = spawn(process.execPath, [...flags, 'apps/server/src/index.ts'], { cwd: ROOT, env: { ...process.env, ...cenv, PORT: String(port) } });
      srv.stdout?.on('data', () => undefined);
      srv.stderr?.on('data', () => undefined);
      let up = false;
      for (let i = 0; i < 80 && !up; i++) {
        await sleep(150);
        up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      }
      if (!up) {
        bad.push(`${round + 1}回目：強制終了のあと、サーバーが起動しない`);
        srv.kill('SIGKILL');
        break;
      }
      startedOk++;
      const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'cr', password: 'testpass123' }) });
      const cookie = (lr.headers.get('set-cookie') ?? '').split(';')[0]!;
      const H = { cookie, 'content-type': 'application/json' };
      if (!projectId) {
        const r = await fetch(`${base}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '停電試験' }) });
        projectId = ((await r.json()) as { id: string }).id;
      }
      // 起動し直した直後：保存できたと返した内容が、残っているか。途中の形になっていないか
      const g = await fetch(`${base}/api/projects/${projectId}`, { headers: H });
      const gj = (await g.json()) as { answers?: { rev?: number; pad?: string }; drawing?: { rev?: number } | null };
      const rev = Number(gj.answers?.rev ?? 0);
      if (g.status !== 200) bad.push(`${round + 1}回目：案件が開けない（${g.status}）`);
      else {
        if (rev < acked) bad.push(`${round + 1}回目：「保存できた」と返した版 ${acked} が、${rev} に戻っている`);
        if (gj.answers?.pad !== undefined && gj.answers.pad.length !== rev * 1000) bad.push(`${round + 1}回目：回答が途中の形になっている`);
        if (gj.drawing && gj.drawing.rev !== rev) bad.push(`${round + 1}回目：回答と図面の版が食い違っている（${rev} / ${gj.drawing.rev}）`);
        acked = Math.max(acked, rev);
      }
      for (const f of ackedFiles) {
        const r = await fetch(`${base}/api/projects/${projectId}/files/${f.id}`, { headers: H });
        if (r.status === 200 && (await r.arrayBuffer()).byteLength !== f.size) bad.push(`${round + 1}回目：預けた写真の大きさが違う`);
      }
      // 前の回に作っておいた「持ち主のいないファイル」（古いもの）が、起動の片づけで消えているか
      if (stray) {
        if (existsSync(stray.split('|')[0]!)) bad.push('古い持ち主のいないファイルが、片づけられていない');
        if (!existsSync(stray.split('|')[1]!)) bad.push('できたばかりのファイルまで、消されている');
        stray = '';
      }
      // 書き込みを続けて、途中で強制終了する
      let n = acked;
      let stop = false;
      const saver = (async () => {
        while (!stop) {
          n++;
          const pad = 'x'.repeat(n * 1000);
          const r = await fetch(`${base}/api/projects/${projectId}`, { method: 'PUT', headers: H, body: JSON.stringify({ answers: { rev: n, pad }, drawing: { rev: n } }) }).catch(() => null);
          if (!r) break;
          if (r.status === 200) {
            acked = Math.max(acked, n);
            lastSaved++;
          }
        }
      })();
      const uploader = (async () => {
        let k = 0;
        while (!stop) {
          const size = 5000 + (k++ % 7) * 20000;
          const r = await fetch(`${base}/api/projects/${projectId}/files`, { method: 'POST', headers: H, body: JSON.stringify({ fileName: 'p.png', mediaType: 'image/png', data: Buffer.alloc(size, 7).toString('base64') }) }).catch(() => null);
          if (!r) break;
          if (r.status === 201) ackedFiles.push({ id: ((await r.json()) as { id: string }).id, size });
        }
      })();
      await sleep(250 + Math.floor(Math.random() * 900));
      srv.kill('SIGKILL');
      killedMid++;
      stop = true;
      await Promise.all([saver, uploader]);
      await sleep(100);
      // 止まったままの状態で、データベースを点検する
      const d = new DB(join(cdata, 'zumen.db'));
      const ic = (d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      if (ic !== 'ok') bad.push(`${round + 1}回目：データベースの点検で異常（${ic}）`);
      const rows = d.prepare('SELECT id, size FROM project_files').all() as { id: string; size: number }[];
      for (const r of rows) {
        const pth = join(cdata, 'files', r.id);
        if (!existsSync(pth)) bad.push(`${round + 1}回目：記録だけあって、写真の中身が無い`);
        else if (statSync(pth).size !== r.size) bad.push(`${round + 1}回目：写真の大きさが、記録と違う`);
      }
      d.close();
      // 次の起動の片づけを確かめるために、持ち主のいないファイルを2つ置く（古いもの・できたばかりのもの）
      const oldF = join(cdata, 'files', `stray-old-${round}`);
      const newF = join(cdata, 'files', `stray-new-${round}`);
      writeFileSync(oldF, 'x');
      writeFileSync(newF, 'x');
      const past = new Date(Date.now() - 3 * 3600_000);
      utimesSync(oldF, past, past);
      stray = `${oldF}|${newF}`;
    }
    check(`強制終了を ${killedMid} 回繰り返しても、そのたびに、サーバーが起動し直せる`, startedOk === ROUNDS && killedMid === ROUNDS, `${startedOk}/${ROUNDS}回`);
    check(`書き込みの途中で強制終了しても、データベースが壊れない・「保存できた」と返した内容が消えない・途中の形にならない（保存 ${lastSaved} 回・写真 ${ackedFiles.length} 枚）`, bad.length === 0, bad.slice(0, 3).join(' ／ '));
    check('写真を預かる途中で止まって残った、持ち主のいないファイルは、起動の片づけで消える（できたばかりのものは残す）', !bad.some((b) => b.includes('片づけ') || b.includes('できたばかり')), bad.filter((b) => b.includes('ファイル')).join(' ／ '));

    // 控えを作る途中で強制終了：作りかけが、本物の控えとして残らない
    const cdest = join(cbackup, 'dest');
    const badB: string[] = [];
    // 控えに時間がかかるよう、大きめの案件を入れておく
    {
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const srv = spawn(process.execPath, [...flags, 'apps/server/src/index.ts'], { cwd: ROOT, env: { ...process.env, ...cenv, PORT: String(port) } });
      srv.stdout?.on('data', () => undefined);
      srv.stderr?.on('data', () => undefined);
      let up = false;
      for (let i = 0; i < 80 && !up; i++) {
        await sleep(150);
        up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      }
      if (up) {
        const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'cr', password: 'testpass123' }) });
        const H = { cookie: (lr.headers.get('set-cookie') ?? '').split(';')[0]!, 'content-type': 'application/json' };
        for (let i = 0; i < 6; i++) {
          const r = await fetch(`${base}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: `大きめ${i}`, answers: { memo: 'y'.repeat(1_500_000) } }) });
          if (r.status !== 201) break;
        }
      }
      srv.kill('SIGKILL');
      await sleep(200);
    }
    let backupKills = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const p = spawn(process.execPath, [...flags, 'scripts/selftest/backup-loop.ts', cdest], { cwd: ROOT, env: { ...process.env, ...cenv } });
      p.stdout?.on('data', () => undefined);
      p.stderr?.on('data', () => undefined);
      await sleep(700 + Math.floor(Math.random() * 2300));
      p.kill('SIGKILL');
      backupKills++;
      await new Promise((r) => p.on('close', r));
      // 控えの名前になっているものは、全部、開けて、案件が読めること
      for (const name of existsSync(cdest) ? readdirSync(cdest) : []) {
        if (!/^\d{8}-\d{6}$/.test(name)) continue;
        try {
          const dd = new DB(join(cdest, name, 'zumen.db'), { readOnly: true });
          const q = (dd.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
          dd.prepare('SELECT COUNT(*) FROM projects').get();
          dd.close();
          if (q !== 'ok') badB.push(`${name}：${q}`);
        } catch (e) {
          badB.push(`${name}：開けない（${e instanceof Error ? e.message.slice(0, 60) : e}）`);
        }
      }
    }
    const names = existsSync(cdest) ? readdirSync(cdest) : [];
    check(`控えを作っている途中で強制終了を ${backupKills} 回繰り返しても、控えの名前が付いたものは、全部開けて、案件が読める（控え ${names.filter((x) => /^\d{8}-\d{6}$/.test(x)).length} 個）`, badB.length === 0, badB.slice(0, 2).join(' ／ '));
    const again = await runNode(['apps/server/src/cli.ts', 'backup', cdest], cenv);
    check('そのあと、もう一度控えを作ると、成功して、作りかけの残りが片づく', again.code === 0 && !readdirSync(cdest).some((x) => x.endsWith('.作成中')), again.out.split('\n').slice(-2).join(' ').slice(0, 80));
    rmSync(cdata, { recursive: true, force: true });
    rmSync(cbackup, { recursive: true, force: true });
  }

  /* ---------- 9a6. 通信が不安定：途中で切れる・とても遅い・返事だけが戻らない ---------- */
  say('\n■ 通信が不安定なとき（送っている途中で切れる・とても遅い・返事だけが戻らない・つなぎっぱなし）');
  {
    const { connect } = await import('node:net');
    const { sleep } = await import('./common.ts');
    const u = new URL(base);
    const nm = (await (await call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '通信不安定の試験' }) })).json()) as { id: string; updatedAt: string };
    const get = async () => (await (await call(a, `/api/projects/${nm.id}`)).json()) as { name: string; updatedAt: string; answers: Record<string, unknown> };
    /** 生の通信で、PUT を送る。bodyParts を、間をあけて送り、最後に何をするか（end：送り終えて返事を待つ／drop：返事を待たずに切る／cut：途中で切る） */
    const rawPut = (body: string, opts: { declared?: number; chunk?: number; gap?: number; finish: 'end' | 'drop' | 'cut' }) =>
      new Promise<{ status: number | null }>((done) => {
        const buf = Buffer.from(body);
        const sock = connect({ host: u.hostname, port: Number(u.port) });
        let resp = '';
        let finished = false;
        const out = (status: number | null) => {
          if (finished) return;
          finished = true;
          sock.destroy();
          done({ status });
        };
        sock.on('data', (d) => {
          resp += String(d);
          const m = /^HTTP\/1\.1 (\d{3})/.exec(resp);
          if (m && opts.finish === 'end') out(Number(m[1]));
        });
        sock.on('error', () => out(null));
        sock.on('close', () => out(/^HTTP\/1\.1 (\d{3})/.exec(resp) ? Number(/^HTTP\/1\.1 (\d{3})/.exec(resp)![1]) : null));
        sock.on('connect', async () => {
          sock.write(`PUT /api/projects/${nm.id} HTTP/1.1\r\nHost: ${u.host}\r\nCookie: ${a}\r\nContent-Type: application/json\r\nContent-Length: ${opts.declared ?? buf.length}\r\n\r\n`);
          const step = opts.chunk ?? buf.length;
          const sendable = opts.finish === 'cut' ? Math.floor(buf.length / 2) : buf.length;
          for (let i = 0; i < sendable; i += step) {
            sock.write(buf.subarray(i, Math.min(i + step, sendable)));
            if (opts.gap) await sleep(opts.gap);
          }
          if (opts.finish === 'cut') {
            await sleep(50);
            out(null);
          } else if (opts.finish === 'drop') {
            await sleep(30);
            out(null);
          }
          setTimeout(() => out(null), 15_000).unref();
        });
      });

    // 1. 送っている途中で切れた：何も保存されない・サーバーは動いている
    const before = await get();
    const whole = JSON.stringify({ name: '途中で切れた', answers: { siteName: 'x'.repeat(60_000) } });
    await rawPut(whole, { declared: whole.length, finish: 'cut' });
    await sleep(300);
    const afterCut = await get();
    check('保存を送っている途中で通信が切れても、案件は何も変わらない（途中までの内容が保存されない）', afterCut.name === before.name && afterCut.updatedAt === before.updatedAt && afterCut.answers.siteName === before.answers.siteName, afterCut.name);
    check('切れたあとも、サーバーは動いている', await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false));

    // 2. とても遅い通信（少しずつ届く）：そのまま、ちゃんと保存できる
    const slowBody = JSON.stringify({ name: '遅い通信の試験', answers: { siteName: '遅い' } });
    const slow = await rawPut(slowBody, { chunk: 8, gap: 25, finish: 'end' });
    const afterSlow = await get();
    check('とても遅い通信（少しずつ届く）でも、保存できて、内容が欠けない', slow.status === 200 && afterSlow.name === '遅い通信の試験' && afterSlow.answers.siteName === '遅い', `${slow.status}`);

    // 3. 保存は届いたが、返事を受け取る前に切れた → 保存はできている。もう一度、前の時刻のまま保存すると断られる。サーバーの内容は、保存した内容と同じ
    const baseAt = (await get()).updatedAt;
    const lost = JSON.stringify({ name: '返事が戻らない試験', answers: { siteName: '届いた', rev: 1 }, baseUpdatedAt: baseAt });
    await rawPut(lost, { finish: 'drop' });
    await sleep(400);
    const afterLost = await get();
    check('保存が届いたあとで、返事を受け取る前に切れても、保存はできている', afterLost.name === '返事が戻らない試験' && afterLost.answers.rev === 1, afterLost.name);
    const retry = await call(a, `/api/projects/${nm.id}`, { method: 'PUT', body: lost });
    const retryJson = (await retry.json()) as { stale?: boolean };
    check('そのまま、もう一度押すと、前の読み込み時刻のため「更新されている」と断られる（画面が、サーバーの内容と同じかを見て、保存できていると判断する）', retry.status === 409 && retryJson.stale === true, `${retry.status}`);
    const forced = await call(a, `/api/projects/${nm.id}`, { method: 'PUT', body: JSON.stringify({ name: '返事が戻らない試験', answers: { siteName: '届いた', rev: 1 }, baseUpdatedAt: afterLost.updatedAt }) });
    check('サーバーから読み直した時刻で保存すれば、保存できる', forced.status === 200, `${forced.status}`);

    // 4. つなぎっぱなしで何も送らない・途中まで送って止まる接続が、たくさんあっても、ほかの人の操作が遅れない
    const idle: import('node:net').Socket[] = [];
    for (let i = 0; i < 60; i++) {
      const sk = connect({ host: u.hostname, port: Number(u.port) });
      sk.on('error', () => undefined);
      if (i % 2) sk.on('connect', () => sk.write('PUT /api/projects/x HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n'));
      idle.push(sk);
    }
    await sleep(300);
    const t0 = Date.now();
    const h = await call(a, '/api/projects?limit=5');
    check('何も送らない・途中で止まった接続が60本あっても、ほかの人の操作は、すぐ返る', h.ok && Date.now() - t0 < 2000, `${h.status}・${Date.now() - t0}ms`);
    for (const sk of idle) sk.destroy();

    // 5. 壊れた・途中で切れた JSON を受け取っても、エラー（500）にならず、何も変わらない
    const cur = await get();
    const trunc = await call(a, `/api/projects/${nm.id}`, { method: 'PUT', body: '{"name":"壊れ","answers":{"siteName":"途' });
    const after = await get();
    check('途中で切れた JSON は、分かる言葉で断り（400）、案件は何も変わらない', trunc.status === 400 && after.updatedAt === cur.updatedAt && after.name === cur.name, `${trunc.status}`);
  }

  /* ---------- 9a7. 連打・同時操作：同じ操作が、同時に何回も届いても、二重にならない・壊れない ---------- */
  say('\n■ 連打・同時操作（同じ操作を、同時に何回も送る）');
  {
    const J = (r: Response) => r.json() as Promise<any>;
    const many = <T,>(n: number, fn: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
    const total = async (q: string) => ((await J(await call(a, `/api/projects?limit=1&q=${encodeURIComponent(q)}`))) as { total: number }).total;

    // 案件を作る：10回同時に送れば、別々の10件ができる（二重にまとまることも、欠けることもない）
    const made = await many(10, () => call(a, '/api/projects', { method: 'POST', body: JSON.stringify({ name: '同時に作る試験' }) }));
    const ids = await Promise.all(made.map(async (r) => ((await J(r)) as { id: string }).id));
    check('10回同時に「作る」と、別々の案件が10件でき、番号は重ならない', made.every((r) => r.status === 201) && new Set(ids).size === 10 && (await total('同時に作る試験')) === 10, `${made.filter((r) => r.status === 201).length}件・番号 ${new Set(ids).size}種類`);

    // 消す：5回同時に送れば、1回だけ成功し、残りは「見つかりません」（エラー500にならない）
    const del = await many(5, () => call(a, `/api/projects/${ids[0]}`, { method: 'DELETE' }));
    const delCodes = del.map((r) => r.status).sort();
    check('同じ案件を5回同時に「消す」と、1回だけ成功し、残りは「見つかりません」（500にならない）', delCodes.filter((x) => x === 200).length === 1 && delCodes.filter((x) => x === 404).length === 4, delCodes.join(','));
    check('消した案件は、一覧から1件だけ減っている', (await total('同時に作る試験')) === 9);

    // 戻す：5回同時に送れば、1回だけ成功し、案件は1件として戻る
    const res = await many(5, () => call(a, `/api/projects/${ids[0]}/restore`, { method: 'POST' }));
    const resCodes = res.map((r) => r.status).sort();
    check('同じ案件を5回同時に「戻す」と、1回だけ成功し、残りは「消した案件にありません」（500にならない）', resCodes.filter((x) => x === 200).length === 1 && resCodes.filter((x) => x === 404).length === 4, resCodes.join(','));
    check('戻した案件は、一覧に1件として戻っている（二重にならない）', (await total('同時に作る試験')) === 10);

    // 複製：5回同時に送れば、5件できる。もとの案件は変わらない
    const srcId = ids[1]!;
    await call(a, `/api/projects/${srcId}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '複製もと', rev: 1 } }) });
    const dup = await many(5, () => call(a, `/api/projects/${srcId}/duplicate`, { method: 'POST', body: JSON.stringify({ layers: [] }) }));
    const dupIds = await Promise.all(dup.map(async (r) => ((await J(r)) as { id: string }).id));
    const srcAfter = (await J(await call(a, `/api/projects/${srcId}`))) as { answers: { siteName?: string } };
    check('5回同時に「複製」すると、別々の5件ができ、もとの案件は変わらない', dup.every((r) => r.status === 201) && new Set(dupIds).size === 5 && srcAfter.answers.siteName === '複製もと', `${dup.map((r) => r.status).join(',')}`);

    // 保存：同じ案件に、30回同時に保存しても、全部成功し、最後の内容は、送ったもののどれか1つ（混ざらない）
    const target = ids[2]!;
    const saves = await many(30, (i) => call(a, `/api/projects/${target}`, { method: 'PUT', body: JSON.stringify({ name: `同時保存${i}`, answers: { siteName: `S${i}`, n: i, pad: String(i).repeat(2000) }, drawing: { n: i } }) }));
    const fin = (await J(await call(a, `/api/projects/${target}`))) as { name: string; answers: { n: number; siteName: string; pad: string }; drawing: { n: number } };
    const n = fin.answers.n;
    check('同じ案件に30回同時に保存しても、全部成功し、最後の内容は1回分そのまま（名前・回答・図面が、別々の保存のものに混ざらない）', saves.every((r) => r.status === 200) && fin.name === `同時保存${n}` && fin.answers.siteName === `S${n}` && fin.drawing.n === n && fin.answers.pad === String(n).repeat(2000), `${saves.filter((r) => r.status === 200).length}/30・最後は ${n}`);
    const found = await J(await call(a, `/api/projects?limit=50&q=${encodeURIComponent(`S${n}`)}`));
    check('一覧の検索も、最後の保存の内容になっている（検索用の文字が、混ざらない）', (found.projects as { id: string }[]).some((p) => p.id === target));

    // 写真を同時に預ける：全部、別々のファイルとして、中身も欠けずに預かる
    const png = (k: number) => Buffer.alloc(3000 + k * 1000, k + 1);
    const ups = await many(8, (k) => call(a, `/api/projects/${ids[3]}/files`, { method: 'POST', body: JSON.stringify({ fileName: `p${k}.png`, mediaType: 'image/png', data: png(k).toString('base64') }) }));
    const fids = await Promise.all(ups.map(async (r) => ((await J(r)) as { id: string }).id));
    let intact = true;
    for (let k = 0; k < 8; k++) {
      const g = await call(a, `/api/projects/${ids[3]}/files/${fids[k]}`);
      if (g.status !== 200 || !Buffer.from(await g.arrayBuffer()).equals(png(k))) intact = false;
    }
    check('写真を8枚同時に預けても、別々に預かり、中身も欠けない', ups.every((r) => r.status === 201) && new Set(fids).size === 8 && intact);

    // 編集中の印：2人が同時に取りに来たら、先の1人だけが取れる（もう1人は「編集中」と断られる）
    const lk = ids[4]!;
    const [l1, l2] = await Promise.all([call(a, `/api/projects/${lk}/lock`, { method: 'POST', body: '{}' }), call(b, `/api/projects/${lk}/lock`, { method: 'POST', body: '{}' })]);
    const lj1 = await J(l1);
    const lj2 = await J(l2);
    const holders = [lj1.lock?.userId, lj2.lock?.userId].filter(Boolean);
    check('2人が同時に編集の印を取りに来ても、印を持つのは1人だけ', new Set(holders).size === 1, `${l1.status}/${l2.status}`);
  }

  /* ---------- 9a8. 長時間つけっぱなし：動き続けても、記憶が増え続けない・古い記録がたまらない ---------- */
  say('\n■ 長時間つけっぱなし（連続して大量に操作しても、サーバーの記憶が増え続けないか）');
  {
    const { spawn } = await import('node:child_process');
    const { ROOT, sleep, freePort } = await import('./common.ts');
    // 期限が切れたログインの記録だけが消え、有効なものは残る
    const sp = await runNode(['scripts/selftest/session-purge.ts'], { DATA_DIR: mkdtempSync(join(tmpdir(), 'zumen-purge-')) });
    const sj = (() => {
      try {
        return JSON.parse(sp.out.trim().split('\n').pop() ?? '{}') as { removed?: number; left?: number };
      } catch {
        return {};
      }
    })();
    check('期限が切れたログインの記録（5件）だけが消え、有効なもの（3件）は残る', sj.removed === 5 && sj.left === 3, sp.out.trim().slice(-80));

    if (process.platform !== 'linux') {
      say('  － サーバーの記憶の増え方の試験は、Linux のときだけ行う（この環境では省略）');
    } else {
      const sdata = mkdtempSync(join(tmpdir(), 'zumen-soak-'));
      const senv = { DATA_DIR: sdata };
      await runNode(['apps/server/src/cli.ts', 'add', 'sk', 'ソーク', 'Tulip-River-4821'], senv);
      const sport = await freePort();
      const sb = `http://127.0.0.1:${sport}`;
      const srv = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], { cwd: ROOT, env: { ...process.env, ...senv, PORT: String(sport) } });
      srv.stdout?.on('data', () => undefined);
      srv.stderr?.on('data', () => undefined);
      try {
        let up = false;
        for (let i = 0; i < 60 && !up; i++) {
          await sleep(200);
          up = await fetch(`${sb}/api/health`).then((r) => r.ok).catch(() => false);
        }
        const rss = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${srv.pid}/status`, 'utf8'))?.[1] ?? 0) / 1024;
        const lr = await fetch(`${sb}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'sk', password: 'Tulip-River-4821' }) });
        const H = { cookie: (lr.headers.get('set-cookie') ?? '').split(';')[0]!, 'content-type': 'application/json' };
        const pids: string[] = [];
        for (let i = 0; i < 12; i++) pids.push(((await (await fetch(`${sb}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: `p${i}` }) })).json()) as { id: string }).id);
        const N = Number(process.env.SOAK_REQUESTS ?? 1500);
        const round = async () => {
          let n = 0;
          const worker = async () => {
            while (n < N) {
              const i = n++;
              const id = pids[i % pids.length];
              const op = i % 6;
              if (op === 0) await fetch(`${sb}/api/health`);
              else if (op === 1) await fetch(`${sb}/api/projects?limit=20`, { headers: H }).then((r) => r.arrayBuffer());
              else if (op === 2) await fetch(`${sb}/api/projects/${id}`, { headers: H }).then((r) => r.arrayBuffer());
              else if (op === 3) await fetch(`${sb}/api/projects/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ answers: { siteName: `S${i}`, pad: 'x'.repeat(50_000) }, drawing: { n: i } }) });
              else if (op === 4) await fetch(`${sb}/api/projects/${id}/draft`, { method: 'PUT', headers: H, body: JSON.stringify({ name: 'd', answers: { pad: 'y'.repeat(20_000) }, drawing: null, sketchRead: false, baseUpdatedAt: null }) });
              else await fetch(`${sb}/api/projects/${id}/lock`, { method: 'POST', headers: H, body: '{}' });
            }
          };
          await Promise.all(Array.from({ length: 12 }, worker));
          return rss();
        };
        const r1 = await round();
        const r2 = await round();
        const r3 = await round();
        check(`連続して大量に操作しても（${N}回ずつ3回）、サーバーの記憶は増え続けない（1回目→3回目で、増えたのが 40MB 以内）`, up && r3 - r1 < 40, `${r1.toFixed(0)}MB → ${r2.toFixed(0)}MB → ${r3.toFixed(0)}MB`);
        check('大量に操作したあとも、サーバーは普通に答える', await fetch(`${sb}/api/health`).then((r) => r.ok).catch(() => false));
      } finally {
        srv.kill('SIGKILL');
        rmSync(sdata, { recursive: true, force: true });
      }
    }
  }

  /* ---------- 9a9. 記録ファイルの入れ替え：error.log・server.log が、大きくなり続けない ---------- */
  say('\n■ 記録ファイルの入れ替え（エラーが大量に起きても、記録が、ディスクを使い切らない）');
  {
    const { spawn } = await import('node:child_process');
    const { openSync, closeSync, appendFileSync } = await import('node:fs');
    const { ROOT, sleep } = await import('./common.ts');
    const { rotateByCopy, LOG_MAX_BYTES } = await import('../../apps/server/src/errors.ts');
    const flags = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];
    const MB = 1024 * 1024;

    // error.log：エラーが2万回起きても、5MB＋5MB（1世代）までしか増えない。新しい記録は残る
    const ldir = mkdtempSync(join(tmpdir(), 'zumen-log-'));
    const storm = await runNode(['scripts/selftest/log-storm.ts', '20000'], { DATA_DIR: ldir });
    const el = join(ldir, 'error.log');
    const sz = (f: string) => (existsSync(f) ? statSync(f).size : 0);
    const written = 20000 * 600; // おおよそ（1件が数百バイト以上）
    check('エラーが2万回起きても、error.log は、決めた大きさ（5MB）を大きく超えない', storm.out.includes('done') && sz(el) <= LOG_MAX_BYTES + 4096, `${(sz(el) / MB).toFixed(1)}MB`);
    check('古い記録は error.log.1 に移り、それも5MB程度まで（全部で、約10MBを超えない）', written > 5 * MB ? existsSync(`${el}.1`) && sz(`${el}.1`) <= LOG_MAX_BYTES + 4096 && sz(el) + sz(`${el}.1`) < 11 * MB : true, `${(sz(`${el}.1`) / MB).toFixed(1)}MB`);
    const lastLine = readFileSync(el, 'utf8').trimEnd().split('\n');
    check('いちばん新しいエラー（19999回目）は、error.log の最後に残っている', lastLine.some((l) => l.includes('嵐 19999')) || lastLine.slice(-12).join('\n').includes('嵐 19999'), '');
    rmSync(ldir, { recursive: true, force: true });

    // server.log：自動起動の仕組みが、追記で開いたまま書き続けるファイル。中身を写して、空にする
    const sdir = mkdtempSync(join(tmpdir(), 'zumen-slog-'));
    const sl = join(sdir, 'server.log');
    const fd = openSync(sl, 'a');
    const wr = spawn(process.execPath, [...flags, 'scripts/selftest/log-writer.ts'], { cwd: ROOT, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    const MAXT = 300 * 1024;
    let waited = 0;
    while (sz(sl) <= MAXT && waited < 20_000) {
      await sleep(100);
      waited += 100;
    }
    const before = sz(sl);
    const did = rotateByCopy(sl, MAXT);
    check('大きくなった server.log を入れ替えると、server.log は空になり、中身は server.log.1 に残る', did && sz(sl) < MAXT / 2 && sz(`${sl}.1`) >= before, `${(before / 1024).toFixed(0)}KB → ${sz(sl)}B・.1 ${(sz(`${sl}.1`) / 1024).toFixed(0)}KB`);
    await sleep(600);
    const after = readFileSync(sl);
    check('入れ替えたあとも、書き続けているほうは、そのまま、新しい server.log の先頭から書き続ける（途中に空白のデータが混ざらない）', after.length > 1000 && !after.includes(0), `${after.length}B`);
    check('サイズが上限以下のときは、何もしない', !rotateByCopy(sl, 100 * MB));
    wr.kill('SIGTERM');
    await new Promise((r) => wr.on('close', r));
    check('ファイルが無いときも、何も起きない（失敗しない）', !rotateByCopy(join(sdir, 'none.log'), 1));
    appendFileSync(sl, '');
    rmSync(sdir, { recursive: true, force: true });
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
