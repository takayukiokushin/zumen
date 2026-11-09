/**
 * 通信がうまくいかなかったときに、画面に出す言葉。
 *
 * ブラウザが返す「Failed to fetch」などは英語で、何をすればよいか分からない。
 * 「何が起きたか」と「どうすればよいか」を、やさしい言葉で伝える（選んでいる言葉に合わせる）。
 * 画面の部品に依存しないよう、ここは文字を返すだけにしてある（試験しやすいように）。
 */

import { tr } from '../i18n/index.ts';
import { translateServerMessage } from './serverMessages.ts';

/** サーバーに届かなかった（電波・Wi-Fi・社内ネットワーク・サーバーの停止など）。入力した内容は画面に残っていることも伝える */
export const networkDown = (): string => tr('msg.networkDown');

/** 返事が決めた時間（30秒）たっても来なかった（電波が途中で切れて、切れた知らせも来ない、など）。保存は、届いていたかもしれないことも伝える */
export const networkTimeout = (): string => tr('msg.timeout');

/** 「サーバーまで届かなかった」ことを表す状態の番号（中継の502・503・504、Cloudflare の520番台） */
export function isGateway(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 527);
}

/**
 * 失敗の理由を、画面に出す文章にする。
 * @param status 返ってきた状態の番号。通信そのものが届かなかったときは null
 * @param serverMessage サーバーが返した文章（あれば、それがいちばん具体的なのでそのまま使う。選んでいる言葉に訳せるものは、訳す）
 */
export function describeFailure(status: number | null, serverMessage?: string): string {
  if (serverMessage) return translateServerMessage(serverMessage);
  if (status === null) return networkDown();
  if (isGateway(status)) return tr('msg.gateway');
  if (status >= 500) return tr('msg.serverError');
  if (status === 401) return tr('msg.401');
  if (status === 403) return tr('msg.403');
  if (status === 413) return tr('msg.413');
  return tr('msg.generic');
}

/** 保存に失敗したときに、続けて案内すること */
export const saveRetry = (): string => tr('msg.saveRetry');
