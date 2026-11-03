import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { DATA_DIR } from './data-dir.ts';

/**
 * サーバーの、想定外のエラーの「最終的な受け皿」。
 *
 * - 処理の途中で想定外のエラーが起きても、サーバーは止まらず、利用者には、分かる言葉で「エラーが起きました」と返す
 *   （英語の「Internal Server Error」を、そのまま見せない）。
 * - 何が起きたかは、data/error.log に残す（いつ・どの操作で・どんなエラーか）。
 *   送られてきた内容（案件のデータ・パスワードなど）は、記録に入れない。
 * - サーバー全体が続けられないエラー（想定外の例外）は、記録してから止まる。
 *   自動起動の設定（KeepAlive）が、すぐに起動し直す。
 */

/** 記録ファイルの大きさの上限。超えたら、古い記録を error.log.1 に移して、新しく始める */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

export const ERROR_LOG = resolve(DATA_DIR, 'error.log');

/** 日本時間の「2026-11-03 14:05:09」 */
function nowText(): string {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' });
  return p.format(new Date());
}

/** 上限を超えていたら、古い記録を脇に移す（1世代だけ残す） */
export function rotateIfBig(file: string, max: number = LOG_MAX_BYTES): void {
  try {
    if (existsSync(file) && statSync(file).size > max) renameSync(file, `${file}.1`);
  } catch {
    // 移せなくても、記録は続ける
  }
}

/** エラーを、画面（コンソール）と error.log の両方に残す。記録に失敗しても、サーバーは止めない */
export function logError(kind: string, err: unknown, context = ''): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const stack = (e.stack ?? '').split('\n').slice(0, 8).join('\n');
  const text = `[${nowText()}] ${kind}${context ? ` ${context}` : ''}\n${stack || `${e.name}: ${e.message}`}\n`;
  console.error(text.trimEnd());
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    rotateIfBig(ERROR_LOG);
    appendFileSync(ERROR_LOG, text + '\n');
  } catch {
    // 記録できなくても、画面（コンソール）には出ている
  }
}

/** Hono の onError に渡す。どの処理で想定外のエラーが起きても、ここで受ける */
export function onUnexpectedError(err: Error, c: Context): Response {
  // 入力が大きすぎる等、意図して返しているものは、そのまま返す
  // （HTTPException かどうかは、部品が二重に読み込まれても見分けられるよう、getResponse を持つかで判定する）
  if (err instanceof HTTPException || typeof (err as { getResponse?: unknown }).getResponse === 'function') {
    return (err as HTTPException).getResponse();
  }
  const user = (c.get as (k: string) => { id?: string } | undefined)('user');
  // 送られてきた内容は記録しない。操作（方法と道筋）と、その人のIDだけ
  logError('想定外のエラー', err, `${c.req.method} ${c.req.path}${user?.id ? ` （ID: ${user.id}）` : ''}`);
  // 画面側が、状態の番号（500）から、分かる言葉の案内を出す
  return c.json({}, 500);
}

/** サーバー全体の受け皿（起動したときに1回だけ登録する） */
export function installProcessHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    // 裏で動いていた処理の失敗。サーバーは続けられるので、記録だけ残す
    logError('処理されなかった失敗（動作は続けます）', reason);
  });
  process.on('uncaughtException', (err) => {
    // 状態が分からなくなっているおそれがあるので、記録してから止まる（自動起動が、起動し直す）
    logError('想定外の例外（サーバーを止めて、起動し直します）', err);
    setTimeout(() => process.exit(1), 200);
  });
}
