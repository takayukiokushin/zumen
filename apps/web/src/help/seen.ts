/**
 * 「使い方」の案内を、もう見せたか。このブラウザに覚えさせるだけ（案件のデータには入らない）。
 * ブラウザが記憶を許していないときは、毎回出る（出ても困らない）。
 */
const KEY = 'zumen.helpSeen';

export function helpSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markHelpSeen(): void {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // 覚えられなくても、使うのには困らない
  }
}
