/**
 * 「この場所」（このタブ・この端末）の見分け。同じアカウントで、別のタブ・別の端末（Mac・iPad・スマホ・Windows）から、
 * 同じ案件を同時に編集して、あとから保存した内容が、先の内容を上書きして消えないようにするために使う（編集ロック）。
 *
 * ・番号は、タブごとに作る（タブを閉じるまで、ページを読み込み直しても、同じ番号）。サーバーに、通信のたびに伝える。
 * ・タブを複製したときは、番号が重なる（複製は、番号まで写る）ので、重なりに気づいたら、複製のほうが、作り直す。
 */

const KEY = 'zumen.place';
let current: string | null = null;
const startedAt = Date.now();

function make(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function remember(id: string): void {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // 保存できなくても、このページのあいだは、同じ番号で使える
  }
}

/** この場所の番号 */
export function placeId(): string {
  if (current) return current;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(KEY);
  } catch {
    id = null;
  }
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = make();
    remember(id);
  }
  current = id;
  return id;
}

// 複製したタブの見つけ方：開いた直後に「この番号を使っています」と呼びかけ、同じ番号の先客が「重なっている」と答えたら、作り直す
try {
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel('zumen-place');
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { t?: string; id?: string } | null;
      if (!m || m.id !== placeId()) return;
      if (m.t === 'hello') ch.postMessage({ t: 'clash', id: m.id });
      // 開いて間もないほう（複製されたタブ）だけが、作り直す
      else if (m.t === 'clash' && Date.now() - startedAt < 5000) {
        current = make();
        remember(current);
      }
    };
    ch.postMessage({ t: 'hello', id: placeId() });
  }
} catch {
  // 呼びかけができない環境では、複製したタブの見分けは、できない（まれ）
}

/** この場所の名前（「Mac (Chrome)」など）。ほかの場所の画面に、「どこで編集中か」を出すために、サーバーに伝える。iPad の Safari は、Mac と名乗るので、タッチの有無でも見る */
export function placeName(): string {
  const ua = navigator.userAgent;
  const touch = (navigator.maxTouchPoints ?? 0) > 1;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser && `(${browser})`].filter(Boolean).join(' ');
}

/** その編集中の印は、いまの、この人・この場所のものか（サーバーの決め方と同じ。場所の番号が無い、古い印は、人だけで決める） */
export function lockIsMine(lock: { userId: string; clientId?: string }, myUserId: string | undefined): boolean {
  return !!myUserId && lock.userId === myUserId && (!lock.clientId || lock.clientId === placeId());
}
