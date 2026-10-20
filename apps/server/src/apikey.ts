import Anthropic from '@anthropic-ai/sdk';

/**
 * 利用券（APIキー）がちゃんと使えるかを確かめる。
 *
 *   pnpm --filter @zumen/server apikey
 *
 * ごく短いやり取りを1回だけ行い、通ったかどうかと、かかった金額を出す。
 * 使う金額は1円に満たない。
 */

/** claude-opus-5 の単価（100万トークンあたりの米ドル）。改定されたら直す */
const PRICE_PER_MTOK = { input: 5, output: 25 };

export async function checkApiKey(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      '利用券（ANTHROPIC_API_KEY）が設定されていません。\n' +
        '  .env ファイルに ANTHROPIC_API_KEY=sk-ant-... の行を書いてください。',
    );
  }
  if (!key.startsWith('sk-ant-')) {
    console.warn('※ 利用券は本来 sk-ant- で始まります。貼り間違いがないか確かめてください。');
  }
  console.log(`利用券: ${key.slice(0, 11)}…${key.slice(-4)}（${key.length}文字）`);
  console.log('つながるか試しています…');

  const client = new Anthropic();
  const started = Date.now();
  const res = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 64,
    system: '日本語で、ひとことだけ答えてください。',
    messages: [{ role: 'user', content: '接続確認です。「使えます」とだけ返してください。' }],
  });

  const text = res.content.find((b) => b.type === 'text');
  const usd =
    (res.usage.input_tokens * PRICE_PER_MTOK.input + res.usage.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000;

  console.log();
  console.log('✓ 利用券は使えます。');
  console.log(`  返事: ${text && text.type === 'text' ? text.text.trim() : '（文字なし）'}`);
  console.log(`  かかった時間: ${((Date.now() - started) / 1000).toFixed(1)}秒`);
  console.log(`  使った分量: 入力${res.usage.input_tokens} / 出力${res.usage.output_tokens}トークン`);
  console.log(`  この1回の金額: 約$${usd.toFixed(4)}（1円未満）`);
  console.log();
  console.log('サーバーを起動し直せば、「スケッチ読み取り」が使えるようになります。');
}

/** 失敗したときに、何をすればよいかが分かる言い方に直す */
export function explainApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) {
    return [
      '利用券が受け付けられませんでした（認証エラー）。',
      '  ・貼り間違い（前後の空白、途中で切れている）がないか確かめてください',
      '  ・取り消した利用券ではないか、管理画面で確かめてください',
      '    https://platform.claude.com/settings/keys',
    ].join('\n');
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return [
      'この利用券には、この操作をする権限がありません。',
      '  管理者に、役割を Developer 以上にしてもらってください。',
    ].join('\n');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return [
      '利用上限に達しているか、混み合っています。',
      '  管理画面の Billing → Spend limits で上限額を確かめてください。',
      '    https://platform.claude.com/settings/billing',
    ].join('\n');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return [
      'つながりませんでした（通信エラー）。',
      '  ・インターネットにつながっているか確かめてください',
      '  ・社内のネットワークで api.anthropic.com への通信が止められていないか、',
      '    情報システムの担当者に確かめてください',
    ].join('\n');
  }
  if (e instanceof Anthropic.APIError) {
    return `サーバーから断られました（${e.status}）。\n  ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
