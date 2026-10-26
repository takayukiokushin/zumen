/**
 * 通信がうまくいかなかったときの文言の検証。
 *
 * 「Failed to fetch」のような英語の文が、画面にそのまま出ないこと。
 * 「何が起きたか」と「どうすればよいか」が、平易な日本語で伝わること。
 *
 *   node --experimental-strip-types scripts/check-messages.ts
 */
import { NETWORK_DOWN, SAVE_RETRY, describeFailure, isGateway } from '../apps/web/src/session/messages.ts';

let failed = 0;
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

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
