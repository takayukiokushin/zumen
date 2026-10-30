import { bodyLimit } from 'hono/body-limit';
import type { Context, MiddlewareHandler } from 'hono';

/** 通信まわりの安全対策。ここに集めておく（index.ts から使う） */

/**
 * 画面を配るときに付ける「ブラウザへの決まり」。
 * - 自分のサーバー以外から読み込んだ文字（スクリプト）は動かさない
 * - ほかのサイトの中に、この画面を埋め込ませない
 * - 中身の種類を、ブラウザが勝手に決め直さない
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // 画面の部品の見た目を、その場で指定している箇所があるため
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('x-frame-options', 'DENY');
  c.header('referrer-policy', 'same-origin');
  // 現地写真など、自分で個別に決めているときは、そちらを優先する
  if (!c.res.headers.has('content-security-policy')) c.header('content-security-policy', CSP);
};

/** アップロードされたファイルを返すときの決まり。中のスクリプトが動かないようにする */
export const FILE_CSP = "default-src 'none'; sandbox";

/** 現地写真として受け付ける種類（SVGは、中にスクリプトを書けるので受け付けない） */
const PHOTO_TYPES = /^image\/(jpeg|png|gif|webp|heic|heif|avif|bmp|tiff)$/;

export function isPhotoType(mediaType: string): boolean {
  return PHOTO_TYPES.test(mediaType);
}

const MB = 1024 * 1024;

/** 1回の通信で受け取る大きさの上限。大きすぎるものは、読み込む前に断る */
function limit(maxMb: number): MiddlewareHandler {
  return bodyLimit({
    maxSize: maxMb * MB,
    onError: (c) => c.json({ error: 'データが大きすぎます。小さくしてから、もう一度お試しください。' }, 413),
  });
}

/** 画像を含む通信（読み取り・現地写真）はやや大きく、それ以外は小さく */
export const bodyLimits: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const isImage = path === '/api/analyze' || /^\/api\/projects\/[^/]+\/files$/.test(path);
  return limit(isImage ? 80 : 10)(c, next);
};

/** この通信は、HTTPS（暗号化された通信）で届いたものか。社内の http でのつなぎ方では false */
export function isHttps(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (proto) return proto === 'https';
  if (c.req.header('cf-visitor')?.includes('"scheme":"https"')) return true;
  return new URL(c.req.url).protocol === 'https:';
}
