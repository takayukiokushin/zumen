/**
 * 手書きメモの読み取りに失敗したとき、画面の利用者に見せる言葉。
 *
 * 画面を使う人は管理者とは限らないので、管理画面のURLや英語の用語は出さない。
 * くわしい原因（管理者向け）はサーバーの記録（console.error）に残る。
 * 管理者が確かめるための文言は apikey.ts の explainApiError にある。
 */
import Anthropic from '@anthropic-ai/sdk';

/** 検証（scripts/check-messages.ts）が、同じ SDK のエラーを作れるように出しておく */
export { Anthropic };

const ASK_ADMIN = '続くときは、管理者に伝えてください。';

/** 日本語の文字を含むか。こちらで書いた文言（そのまま見せてよい）と、英語の生の文を見分ける */
const hasJapanese = (s: string) => /[぀-ヿ一-鿿]/.test(s);

export function describeAnalyzeFailure(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return `手書きメモの読み取りに使う利用券（APIキー）に問題があるようです。管理者に伝えてください。`;
  }
  if (e instanceof Anthropic.APIError && /credit balance is too low/i.test(e.message)) {
    return '手書きメモの読み取りに使う残高がなくなっているようです。管理者に、残高の追加を頼んでください。';
  }
  if (e instanceof Anthropic.RateLimitError) {
    return `いま混み合っているか、利用の上限に達しています。しばらく待ってから、もう一度お試しください。${ASK_ADMIN}`;
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return `読み取りのサービスにつながりませんでした。しばらく待ってから、もう一度お試しください。${ASK_ADMIN}`;
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 400 || e.status === 413) {
      const m = e.message;
      // 原因が分かるものは、そのとおりに伝える（英語の生の文は見せない）
      if (/schema|structured|output_config|grammar|compil|optional param|too complex/i.test(m)) {
        return `読み取りの仕組みの設定に問題があります（ファイルのせいではありません）。管理者に伝えてください。サーバーの画面に、「解析に失敗しました」から始まる行があります。`;
      }
      if (/password|encrypt|protected/i.test(m)) {
        return 'PDF にパスワードがかかっているようです。パスワードを外した PDF にしてから、もう一度お試しください。';
      }
      if (/page/i.test(m) && /pdf|document/i.test(m)) {
        return 'PDF のページ数が多すぎるか、ページを読み取れません。読み取りたいページだけの PDF にしてから、もう一度お試しください。';
      }
      if (e.status === 413 || /too large|too big|exceed|maximum|size|limit/i.test(m)) {
        return 'ファイルが大きすぎます。小さくするか、ページ数の少ない PDF・画像にしてから、もう一度お試しください。';
      }
      if (/pdf|document/i.test(m)) {
        return 'PDF を読み取れませんでした。壊れていないか、別の PDF でお試しください。続くときは、管理者に伝えてください。';
      }
      if (/image/i.test(m)) {
        return '画像を読み取れませんでした。画像を小さくするか、別の画像でお試しください。';
      }
      return `読み取れませんでした。ファイルを小さくするか、別のファイルでお試しください。${ASK_ADMIN}サーバーの画面に、「解析に失敗しました」から始まる行があります。`;
    }
    if (e.status !== undefined && e.status >= 500) {
      return `読み取りのサービスが混み合っています。しばらく待ってから、もう一度お試しください。${ASK_ADMIN}`;
    }
    return `読み取りに失敗しました。もう一度お試しください。${ASK_ADMIN}`;
  }
  // こちらで書いた日本語の文言は、そのまま見せる
  if (e instanceof Error && hasJapanese(e.message)) return e.message;
  return `読み取りに失敗しました。もう一度お試しください。${ASK_ADMIN}`;
}
