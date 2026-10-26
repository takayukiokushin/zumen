/**
 * 通信がうまくいかなかったときに、画面に出す言葉。
 *
 * ブラウザが返す「Failed to fetch」などは英語で、何をすればよいか分からない。
 * 「何が起きたか」と「どうすればよいか」を、やさしい日本語で伝える。
 * 画面の部品に依存しないよう、ここは文字を返すだけにしてある（試験しやすいように）。
 */

/**
 * 画面に入力した内容がまだ残っていること、と、閉じると消えること。
 * 「読み込み直してください」とは言わない（未保存の入力が消えてしまうため）。
 */
const KEPT = '入力した内容は、この画面に残っています（画面を閉じたり読み込み直したりすると消えます）。';

/** サーバーに届かなかった（電波・Wi-Fi・社内ネットワーク・サーバーの停止など） */
export const NETWORK_DOWN = `サーバーにつながりません。Wi-Fiや電波、社内のネットワークを確かめてください。${KEPT}`;

/** 途中の中継（Cloudflare など）まで届いたが、先のサーバーが答えない */
const GATEWAY = `サーバーが応答しません。止まっているか、起動中かもしれません。しばらく待ってから、もう一度お試しください。${KEPT}`;

/** サーバーの中で想定していないことが起きた */
const SERVER_ERROR = 'サーバーでエラーが起きました。しばらくしてからもう一度お試しください。続くときは、管理の方に伝えてください。';

/** 「サーバーまで届かなかった」ことを表す状態の番号（中継の502・503・504、Cloudflare の520番台） */
export function isGateway(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527);
}

/**
 * 失敗の理由を、画面に出す文章にする。
 * @param status 返ってきた状態の番号。通信そのものが届かなかったときは null
 * @param serverMessage サーバーが返した文章（あれば、それがいちばん具体的なのでそのまま使う）
 */
export function describeFailure(status: number | null, serverMessage?: string): string {
  if (serverMessage) return serverMessage;
  if (status === null) return NETWORK_DOWN;
  if (isGateway(status)) return GATEWAY;
  if (status >= 500) return SERVER_ERROR;
  if (status === 401) return 'ログインの有効期限が切れました。もう一度ログインしてください。';
  if (status === 403) return 'この操作は許可されていません。';
  if (status === 413) return '送ろうとしたデータが大きすぎます。写真を送ったときは、枚数を減らして、もう一度お試しください。';
  return '通信に失敗しました。もう一度お試しください。';
}

/** 保存に失敗したときに、続けて案内すること */
export const SAVE_RETRY = 'つながってから、もう一度「保存」を押してください。';
