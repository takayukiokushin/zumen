/**
 * 通信がうまくいかなかったときの文言の検証。
 *
 * 「Failed to fetch」のような英語の文が、画面にそのまま出ないこと。
 * 「何が起きたか」と「どうすればよいか」が、平易な日本語で伝わること。
 *
 *   node --experimental-strip-types scripts/check-messages.ts
 */
import { readFileSync } from 'node:fs';
import { NETWORK_DOWN, SAVE_RETRY, describeFailure, isGateway } from '../apps/web/src/session/messages.ts';
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
if (down !== NETWORK_DOWN) fail('通信が届かなかったときの文言が NETWORK_DOWN ではありません');
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
if (!SAVE_RETRY.includes('「保存」')) fail('保存のやり直しの案内に、ボタンの名前がありません');
else console.log(`  保存に失敗したときの案内：${SAVE_RETRY}`);


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

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
