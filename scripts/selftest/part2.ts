/**
 * 自己診断（selftest）の2つ目：案件の保存と呼び出し・ごみ箱・同時編集の排他・アカウントの種類。
 * 共有する道具は common.ts。scripts/selftest.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pdfPageCount } from '../../apps/server/src/analyze.ts';
import { say, check, dataDir } from './common.ts';
import type { part1 } from './part1.ts';

export async function part2(c: Awaited<ReturnType<typeof part1>>) {
  const { base, login, login2, call, a, b, tryLogin } = c;
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
    await call(a, `/api/projects/${mine.id}`, { method: 'PUT', body: JSON.stringify({ answers: { siteName: '消す前の内容' } }) });
    // 写真は「保存」を押すと消えるので、保存のあとに入れる（保存前の写真が、ごみ箱でどう扱われるかを見る）
    const photo = (await (
      await call(a, `/api/projects/${mine.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ fileName: 'a.png', mediaType: 'image/png', data: Buffer.from('dummy-image').toString('base64') }),
      })
    ).json()) as { id: string };
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
    const srcAnswers = { siteName: '複製元の現場', customerNo: 'C-0042', drawingName: '複製元の図面', poleName: '中電柱：元の電柱', earthingNotes: 'A種10Ω', mainBreakerForm: 'cb', trCapacity: 100 };
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
    check('複製：事業場名称・お客様番号・図面名称・電柱名称・特記事項が空になる', d.answers.siteName === undefined && d.answers.customerNo === undefined && d.answers.drawingName === undefined && d.answers.poleName === undefined && d.answers.earthingNotes === undefined, JSON.stringify(d.answers));
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

  // レイヤー（停電範囲図など）：複製のときの選択・一覧・古い画面からの保存を止める
  {
    const J = (r: Response) => r.json() as Promise<any>;
    const before = await J(await call(a, `/api/projects/${created.id}`));
    const withLayers = {
      items: [{ kind: 'text', id: 'auto-t', x: 0, y: 0, lines: ['埋設ケーブル'], anchor: 'start' }],
      layers: [
        { id: 'outage', items: [{ id: 'k1', kind: 'cross' }, { id: 'k2', kind: 'cross' }] },
        { id: 'withstand', items: [] },
        { id: 'custom-1', name: '夜間停電', items: [] },
        { id: 'custom-2', name: '予備', items: [{ id: 'k3', kind: 'cross' }] },
      ],
    };
    const save = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: withLayers }) });
    check('レイヤーつきの図面を保存できる', save.ok, `${save.status}`);
    const got = await J(await call(a, `/api/projects/${created.id}`));
    check('レイヤーは、保存して開いても、そのまま戻る', JSON.stringify(got.drawing.layers) === JSON.stringify(withLayers.layers));

    // 赤い印のすべての種類（文字・×印・接地・枠・点・矢印・渡り線）と、元の図面の記録（seen）・向きが、そのまま保存されて戻る
    const rich = {
      items: withLayers.items,
      layers: [
        {
          id: 'outage',
          orientation: 'landscape',
          seen: 'abc123',
          items: [
            { kind: 'text', id: 't1', x: 1, y: 2, lines: ['メモ'], anchor: 'start', red: true, ndx: 1, ndy: 2 },
            { kind: 'cross', id: 'c1', target: 'vcb', size: 'M', dx: 4, dy: -2 },
            { kind: 'ground', id: 'g1', anchor: { kind: 'wire', key: 'k', id: 'w1', t: 0.5 }, lead: 30, drop: 20, label: ['No.1'], size: 2, bold: true },
            { kind: 'area', id: 'a1', x: 0, y: 0, w: 100, h: 80, near: 'vcb', ndx: -10, ndy: -5, hatch: true, label: ['充電範囲'], labelPos: 'br' },
            { kind: 'dot', id: 'd1', anchor: { kind: 'port', item: 'vcb', port: 'top' }, x: 5, y: 6, near: 'vcb', ndx: 1, ndy: 2 },
            { kind: 'dot', id: 'd2', x: 50, y: 60, ndx: 50, ndy: 60 },
            { kind: 'arrow', id: 'r1', dot: 'd1', dir: 'ne', len: 60, label: ['印加点'], size: 2 },
            { kind: 'link', id: 'l1', a: 'd1', b: 'd2', shape: 'round', flip: true },
          ],
        },
      ],
    };
    const saveRich = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: rich }) });
    const gotRich = await J(await call(a, `/api/projects/${created.id}`));
    check('赤い印のすべての種類・元の図面の記録・向きを含むレイヤーが、保存して開いても、そのまま戻る', saveRich.ok && JSON.stringify(gotRich.drawing.layers) === JSON.stringify(rich.layers));
    const richList = (await J(await call(a, `/api/projects/${created.id}/layers`))).layers as { id: string; count: number }[];
    check('レイヤーの一覧：赤い印のすべての種類が、置いたものの数に入る', richList.find((l) => l.id === 'outage')?.count === 8);
    await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: withLayers }) });

    const list = (await J(await call(a, `/api/projects/${created.id}/layers`))).layers as { id: string; name: string | null; count: number }[];
    check('レイヤーの一覧：追加したレイヤーは、置いたものが無くても出る', list.some((l) => l.id === 'custom-1' && l.name === '夜間停電' && l.count === 0));
    check('レイヤーの一覧：固定のレイヤーは、置いたものがあるときだけ出る（名前は画面が持つので null）', list.some((l) => l.id === 'outage' && l.name === null && l.count === 2) && !list.some((l) => l.id === 'withstand'));
    check('レイヤーの一覧：置いたものの数が合う', list.find((l) => l.id === 'custom-2')?.count === 1);
    check('レイヤーの一覧：存在しない案件は 404', (await call(a, '/api/projects/nai/layers')).status === 404);
    check('レイヤーの一覧：見られない案件（練習用）は 404', (await call(a, `/api/projects/${renshuMade.id}/layers`)).status === 404);

    const none = await J(await call(a, `/api/projects/${created.id}/duplicate`, { method: 'POST' }));
    const dNone = await J(await call(a, `/api/projects/${none.id}`));
    check('複製：何も選ばなければ、レイヤーは1つも複製されない（意図せず写さない）', dNone.drawing.layers === undefined, JSON.stringify(dNone.drawing.layers));
    check('複製：レイヤー以外（図面の本体）は、そのまま複製される', dNone.drawing.items.some((x: { id: string }) => x.id === 'auto-t'));
    const some = await J(await call(a, `/api/projects/${created.id}/duplicate`, { method: 'POST', body: JSON.stringify({ layers: ['custom-2', 'outage', 'nai'] }) }));
    const dSome = await J(await call(a, `/api/projects/${some.id}`));
    check('複製：選んだレイヤーだけが、置いたものごと複製される', JSON.stringify(dSome.drawing.layers.map((l: { id: string }) => l.id)) === JSON.stringify(['outage', 'custom-2']) && dSome.drawing.layers[0].items.length === 2);
    const junk = await J(await call(a, `/api/projects/${created.id}/duplicate`, { method: 'POST', body: JSON.stringify({ layers: 'custom-1' }) }));
    const dJunk = await J(await call(a, `/api/projects/${junk.id}`));
    check('複製：レイヤーの指定が変な形でも、1つも複製せずに作る', dJunk.drawing.layers === undefined);
    const after = await J(await call(a, `/api/projects/${created.id}`));
    check('複製しても、もとのレイヤーは変わらない', JSON.stringify(after.drawing.layers) === JSON.stringify(withLayers.layers));

    // 古い画面（レイヤーを知らない版）が、そのまま保存すると、レイヤーが消える。それを止める
    const stale = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: { items: [] } }) });
    const staleBody = await J(stale);
    check('古い画面からの保存は、レイヤーが消えるので断る', stale.status === 400 && staleBody.oldScreen === true && String(staleBody.error).includes('古い版'), `${stale.status} ${staleBody.error}`);
    const still = await J(await call(a, `/api/projects/${created.id}`));
    check('断ったときは、保存してあるレイヤーは、そのまま残る', JSON.stringify(still.drawing.layers) === JSON.stringify(withLayers.layers));
    const force = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: { items: [] }, force: true }) });
    check('「上書き」の指定でも、レイヤーが消える保存は断る', force.status === 400);
    const keep = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: { items: [], layers: withLayers.layers } }) });
    check('レイヤーを持ったままの保存は、できる', keep.ok, `${keep.status}`);
    const cleared = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: { items: [], layers: [] } }) });
    check('画面でレイヤーを全部消したとき（layers が空）の保存は、できる', cleared.ok, `${cleared.status}`);
    const plain = await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ drawing: { items: [] } }) });
    check('レイヤーが無い図面は、これまでどおり保存できる', plain.ok, `${plain.status}`);

    for (const x of [none.id, some.id, junk.id]) await call(a, `/api/projects/${x}`, { method: 'DELETE' });
    await call(a, `/api/projects/${created.id}`, { method: 'PUT', body: JSON.stringify({ answers: before.answers, drawing: before.drawing }) });
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
  // 長すぎるパスワード（101文字）は断る。100文字ちょうどは通る
  const mkPw = (pw: string, id: string) => call(kanri, '/api/admin/users', { method: 'POST', body: JSON.stringify({ id, name: '長い', password: pw, role: 'member' }) });
  const longPw = await mkPw('Kx9#mQ2$vL'.repeat(10) + 'a', 'nagai101');
  const longPwMsg = ((await longPw.json().catch(() => ({}))) as { error?: string }).error ?? '';
  check('長すぎる（101文字の）パスワードは断る', longPw.status === 400 && longPwMsg.includes('100文字'), `${longPw.status} ${longPwMsg}`);
  const okPw = await mkPw('Kx9#mQ2$vL'.repeat(10), 'nagai100');
  check('100文字ちょうどのパスワードは、受け付ける', okPw.status === 201, `${okPw.status}`);
  await call(kanri, '/api/admin/users/nagai100', { method: 'DELETE' });
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
  return { ...c, created, answers, kanri };
}
