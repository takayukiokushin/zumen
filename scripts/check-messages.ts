/**
 * 通信がうまくいかなかったときの文言の検証。
 *
 * 「Failed to fetch」のような英語の文が、画面にそのまま出ないこと。
 * 「何が起きたか」と「どうすればよいか」が、平易な日本語で伝わること。
 *
 *   node --experimental-strip-types scripts/check-messages.ts
 */
import { readFileSync } from 'node:fs';
import { describeFailure, isGateway, networkDown, networkTimeout, saveRetry } from '../apps/web/src/session/messages.ts';
import { sameContent } from '../apps/web/src/session/saveRecovery.ts';
import { makeOnce } from '../apps/web/src/session/once.ts';
import { MAX_UNDO, pushPast } from '../apps/web/src/editor/history.ts';
import { CALL_TIMEOUT_MS } from '../apps/web/src/session/timing.ts';
import { Anthropic, describeAnalyzeFailure } from '../apps/server/src/analyze-errors.ts';

let failed = 0;
/** 利用者が次にすることを示す言い方 */
const NEXT = /ください|お試し|選び直|待って|連絡|頼んで|伝えて/;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

console.log('■ 通信の失敗を伝える文言');

const hasAscii = (s: string) => /Failed to fetch|NetworkError|Load failed/i.test(s);

// 通信が届かなかったとき
const down = describeFailure(null);
if (down !== networkDown()) fail('通信が届かなかったときの文言が networkDown() ではありません');
if (hasAscii(down)) fail('英語のエラー文が混ざっています');
if (!down.includes('入力した内容は')) fail('「入力した内容は残っている」ことが書かれていません');
if (down.includes('読み込み直してください')) fail('「読み込み直して」と案内しています（未保存の入力が消えます）');
if (!down.includes('消えます')) fail('画面を閉じると入力が消えることが書かれていません');
if (!down.includes('確かめて')) fail('どうすればよいかが書かれていません');
else console.log('  通信が届かない：何が起きたか・どうするか・入力が残ること、をすべて伝える');

// 中継まで届いたがサーバーが答えない（社内のサーバーが止まっているとき）
for (const status of [502, 503, 504, 521, 522]) {
  if (!isGateway(status)) fail(`${status} が「サーバーが答えない」扱いになっていません`);
  const m = describeFailure(status);
  if (!m.includes('応答しません') || !m.includes('入力した内容は')) fail(`${status} の文言が不十分です：${m}`);
}
console.log('  502・503・504・Cloudflareの520番台：「サーバーが応答しません」と伝える');

// サーバーが理由を返しているときは、それをそのまま使う（具体的なので）
const given = describeFailure(409, 'Aさんが編集中です。');
if (given !== 'Aさんが編集中です。') fail('サーバーの文言が上書きされています');
else console.log('  サーバーが理由を返したときは、その文言をそのまま使う');

// そのほか
if (!describeFailure(500).includes('サーバーでエラー')) fail('500番台の文言がありません');
if (!describeFailure(401).includes('ログイン')) fail('401の文言がありません');
if (!describeFailure(413).includes('大きすぎ')) fail('413の文言がありません');
if (!describeFailure(418).includes('もう一度')) fail('その他の失敗に、次にすることがありません');
else console.log('  500番台・401・413・その他：どれも次にすることを書く');

// 保存のやり直しの案内
if (!saveRetry().includes('「保存」')) fail('保存のやり直しの案内に、ボタンの名前がありません');
else console.log(`  保存に失敗したときの案内：${saveRetry()}`);

// 返事が来ないとき（電波が途中で切れて、切れた知らせも来ない）
{
  const m = networkTimeout();
  if (hasAscii(m)) fail('返事が来ないときの文言に、英語が混ざっています');
  if (!m.includes(`${CALL_TIMEOUT_MS / 1000}秒`)) fail(`待つ時間（${CALL_TIMEOUT_MS / 1000}秒）が文言に書かれていません`);
  if (!m.includes('入力した内容は')) fail('返事が来ないときの文言に、「入力した内容は残っている」がありません');
  if (!m.includes('保存できているかもしれません')) fail('返事が来ないときの文言に、「保存できているかもしれない」がありません');
  if (!NEXT.test(m)) fail('返事が来ないときの文言に、次にすることがありません');
  if (CALL_TIMEOUT_MS < 10_000 || CALL_TIMEOUT_MS > 60_000) fail('返事を待つ時間が、短すぎる・長すぎる（10〜60秒）');
  if (!m.includes('「保存」')) fail('返事が来ないときの文言に、ボタンの名前がありません');
  else console.log('  返事が来ない：待つ時間・入力が残ること・保存できているかもしれないこと・次にすること、を伝える');
}

// 「保存は届いていたのに、返事だけが戻らなかった」ときの見分け（もう一度押した保存が、自分の保存と衝突しないように）
{
  const stored = { name: '満杯1', answers: { siteName: 'A工場', n: 2 }, drawing: { items: [1, 2], rev: 3 } };
  const same = { name: '満杯1 ', answers: { siteName: 'A工場', n: 2 }, drawing: { items: [1, 2], rev: 3 } };
  if (!sameContent(same, stored)) fail('サーバーの内容と同じ保存が、「同じ」と見分けられていません');
  if (sameContent({ ...same, answers: { siteName: 'A工場', n: 3 } }, stored)) fail('回答が違うのに、「同じ」と見分けています（ほかの人の更新を、上書きしてしまう）');
  if (sameContent({ ...same, drawing: { items: [1], rev: 3 } }, stored)) fail('図面が違うのに、「同じ」と見分けています（ほかの人の更新を、上書きしてしまう）');
  if (sameContent({ ...same, name: '別の名前' }, stored)) fail('案件名が違うのに、「同じ」と見分けています');
  if (!sameContent({ name: '満杯1', answers: stored.answers, drawing: null }, { ...stored, drawing: null })) fail('図面が無い案件で、「同じ」と見分けられていません');
  console.log('  保存の返事が戻らなかったとき：サーバーの内容と同じなら「保存できている」、違えば、これまでどおり、上書きか読み直しを選んでもらう');
}

// 連打の入口：動いている間に呼ばれても、何もしない。終わったら、また使える。失敗しても、詰まらない
{
  const once = makeOnce();
  let runs = 0;
  let release: () => void = () => undefined;
  const first = once(
    () =>
      new Promise<string>((done) => {
        runs++;
        release = () => done('1回目');
      }),
  );
  const second = once(async () => {
    runs++;
    return '2回目';
  });
  const third = once(async () => {
    runs++;
    return '3回目';
  });
  if (!once.running) fail('動いている間なのに、「動いていない」になっています');
  if ((await second) !== undefined || (await third) !== undefined) fail('動いている間に呼ばれた操作が、動いてしまいました（連打で二重になる）');
  release();
  if ((await first) !== '1回目') fail('1回目の操作の結果が返りません');
  if (runs !== 1) fail(`3回呼んで、実際に動いたのが ${runs} 回です（1回のはず）`);
  if (once.running) fail('終わったのに、「動いている」のままです');
  if ((await once(async () => 'また使える')) !== 'また使える') fail('終わったあとに、また使えません');
  let threw = false;
  try {
    await once(async () => {
      throw new Error('失敗');
    });
  } catch {
    threw = true;
  }
  if (!threw || once.running) fail('失敗したあとも「動いている」のままです（以降の操作が、ずっと効かなくなる）');
  if ((await once(async () => 'ok')) !== 'ok') fail('失敗のあとに、また使えません');
  if (!failed) console.log('  連打の入口：動いている間の呼び出しは、何もしない／終わったら、また使える／失敗しても、詰まらない');
}

// 長時間つけっぱなし：「操作を戻す」の履歴は、上限を超えたら、古いものから忘れる（増え続けない）
{
  let past: number[] = [];
  for (let i = 0; i < MAX_UNDO * 5; i++) past = pushPast(past, i);
  if (past.length !== MAX_UNDO) fail(`履歴が ${past.length} 件です（上限 ${MAX_UNDO} 件のはず）`);
  if (past[past.length - 1] !== MAX_UNDO * 5 - 1) fail('いちばん新しい操作が、履歴の最後にありません');
  if (past[0] !== MAX_UNDO * 4) fail('古いものから忘れていません');
  if (pushPast([1, 2], 3).join() !== '1,2,3') fail('上限に達するまでは、全部残るはずです');
  if (MAX_UNDO < 50 || MAX_UNDO > 1000) fail('「操作を戻す」の上限が、少なすぎる・多すぎる（50〜1000）');
  else console.log(`  操作を戻す履歴：${MAX_UNDO}手まで。超えたら、古いものから忘れる（新しい操作は、必ず残る）`);
}

console.log('\n■ 手書きメモの読み取りが失敗したときの文言');

const hdr = new Headers();
const mk = (status: number, msg: string) => Anthropic.APIError.generate(status, { error: { message: msg } }, msg, hdr);
const cases: [string, unknown][] = [
  ['利用券が受け付けられない（401）', mk(401, 'invalid x-api-key')],
  ['権限がない（403）', mk(403, 'forbidden')],
  ['残高がない（400）', mk(400, 'Your credit balance is too low to access the Anthropic API.')],
  ['利用上限・混雑（429）', mk(429, 'rate limit')],
  ['サービスが混み合っている（529）', mk(529, 'overloaded')],
  ['画像が受け付けられない（400）', mk(400, 'image too large')],
  ['読み取りの仕組みの設定（400）', mk(400, 'Schema is too complex for compilation.')],
  ['PDFにパスワード（400）', mk(400, 'The PDF specified is password protected.')],
  ['PDFのページが多い（400）', mk(400, 'A maximum of 100 PDF pages may be provided.')],
  ['PDFが壊れている（400）', mk(400, 'Could not process PDF document')],
  ['原因が分からない（400）', mk(400, 'invalid request')],
  ['つながらない', new Anthropic.APIConnectionError({ message: 'Connection error.' })],
  ['想定外の英語のエラー', new Error('Unexpected token < in JSON')],
];
for (const [name, e] of cases) {
  const m = describeAnalyzeFailure(e);
  if (/[A-Za-z]{4,}/.test(m.replace(/APIキー|JPEG|PNG|GIF|WebP/g, ''))) fail(`${name}：英語が混ざっています：${m}`);
  else if (!NEXT.test(m)) fail(`${name}：次にすることがありません：${m}`);
  else if (/https?:\/\//.test(m)) fail(`${name}：管理画面のURLが画面に出ます：${m}`);
  else console.log(`  ${name}：${m}`);
}
const own = describeAnalyzeFailure(new Error('解析結果を受け取れませんでした。もう一度お試しください。'));
if (!own.startsWith('解析結果を受け取れませんでした')) fail('こちらで書いた日本語の文言が、そのまま使われていません');

console.log('\n■ サーバーが返す文言に「次にすること」があるか（ソースを走査）');

/** 「〜してください」「〜お試しください」「〜待って」など、利用者が次にすることを示す言い方 */
function scan(file: string, re: RegExp): number {
  const src = readFileSync(file, 'utf8');
  let n = 0;
  for (const m of src.matchAll(re)) {
    const text = [...(m[1] ?? '').matchAll(/[`']([^`'']*)[`']/g)].map((x) => x[1] ?? '').join('');
    n++;
    if (!NEXT.test(text)) fail(`${file.replace(/^.*apps\//, 'apps/')}：次にすることがありません：「${text}」`);
  }
  return n;
}
let total = 0;
for (const f of ['admin', 'auth', 'index', 'projects']) {
  total += scan(`apps/server/src/${f}.ts`, /error:\s*((?:[`'][^`']*[`']\s*\+?\s*)+)/g);
}
total += scan('apps/server/src/analyze.ts', /new Error\(\s*((?:[`'][^`']*[`']\s*\+?\s*)+)\)/g);
if (total < 30) fail(`走査できた文言が少なすぎます（${total}件）。走査のしかたが壊れていないか確かめてください`);
else console.log(`  ${total}件の文言すべてに、次にすることが書かれている`);

// 画面のソースに、開発者向けのコマンド（pnpm …）が利用者向けの文として残っていないこと
{
  const src = readFileSync('apps/web/src/analyze/Analyze.tsx', 'utf8');
  if (/pnpm /.test(src)) fail('Analyze.tsx に、開発者向けのコマンド（pnpm …）が画面の文として残っています');
  else console.log('  読み取り画面に、開発者向けのコマンドは出ない');
}

// ディスクがいっぱいのときの案内：サーバーの文と、画面の辞書（日本語）の文が同じ（同じでないと、他の言葉に訳せない）
{
  const src = readFileSync(new URL('../apps/server/src/errors.ts', import.meta.url), 'utf8');
  const serverText = /DISK_FULL_MESSAGE =\s*'([^']+)'/.exec(src)?.[1];
  const dict = readFileSync(new URL('../apps/web/src/i18n/dict-ja.ts', import.meta.url), 'utf8');
  const dictText = /'srv\.diskFull': '([^']+)'/.exec(dict)?.[1];
  if (!serverText || serverText !== dictText) fail('ディスクがいっぱいのときの案内が、サーバー（errors.ts）と日本語の辞書（srv.diskFull）で、同じ文になっていません');
  else if (!/ディスクがいっぱい/.test(serverText) || !/残っています/.test(serverText) || !NEXT.test(serverText)) fail('ディスクがいっぱいのときの案内に、原因・入力が残ること・どうするか、のどれかが書かれていません');
  else console.log('  ディスクがいっぱい：原因・入力が残ること・管理の方に伝えること、を伝え、他の言葉にも訳せる');
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
