/**
 * パスワードの条件。新しく決めるとき・変えるときだけ確かめる
 * （すでに登録してあるパスワードでのログインには、影響しない）。
 *
 * - 10文字以上
 * - IDと同じ、または、IDを含むもの
 * - よくあるパスワード・推測されやすいもの（同じ文字の繰り返し・数字や文字の連番・キーボードの並び など）
 */
export const MIN_PASSWORD = 10;

/** よく使われる、または、このアプリ・会社名・年号から推測されやすい言葉。小文字にして、含んでいたら断る */
const WEAK_WORDS = [
  'password', 'passw0rd', 'pass1234', 'passwd', 'qwerty', 'asdfgh', 'zxcvbn', 'qazwsx', '1qaz2wsx',
  'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'login', 'monkey', 'dragon', 'master',
  'abc123', '123abc', 'zumen', 'fuji', 'elex', 'kanri', 'hoan', 'jimu', 'rensyu', 'tester',
  'sakura', 'tanaka', 'suzuki', 'nippon', 'japan', 'tokyo', 'denki', 'kouatsu', 'denryoku',
  'パスワード', 'ぱすわーど',
];

/** 数字・英字の連番や、キーボードの並び。この中の長い一続きが入っていたら断る */
const SEQUENCES = [
  '0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba',
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r5t6y7u8i9o0p', '1qaz2wsx3edc',
];

function hasLongRun(lower: string, run = 6): boolean {
  for (const seq of SEQUENCES) {
    for (let i = 0; i + run <= seq.length; i++) {
      if (lower.includes(seq.slice(i, i + run))) return true;
    }
  }
  return false;
}

/** 同じ文字だけ、または、短い並びの繰り返し（abcabcabc…, 1212121212） */
function isRepeating(p: string): boolean {
  if (new Set(p).size <= 2) return true;
  for (let n = 1; n <= 4; n++) {
    if (p.length >= n * 3 && p === p.slice(0, n).repeat(Math.ceil(p.length / n)).slice(0, p.length)) return true;
  }
  return false;
}

/** 条件に合っていれば null。合っていなければ、利用者に見せる説明を返す */
export function checkPassword(password: string, userId: string): string | null {
  if ([...password].length < MIN_PASSWORD) return `パスワードは${MIN_PASSWORD}文字以上にしてください。`;
  const lower = password.toLowerCase();
  const id = userId.trim().toLowerCase();
  if (id && (lower === id || (id.length >= 3 && lower.includes(id)))) {
    return 'IDと同じ、またはIDを含むパスワードは使えません。別のパスワードにしてください。';
  }
  if (isRepeating(lower)) return '同じ文字の繰り返しなど、推測されやすいパスワードは使えません。別のパスワードにしてください。';
  if (hasLongRun(lower)) return '「123456」「abcdef」「qwerty」のような連続した並びを含むパスワードは使えません。別のパスワードにしてください。';
  if (WEAK_WORDS.some((w) => lower.includes(w))) {
    return 'よくある言葉（password など）や、会社・アプリの名前を含むパスワードは使えません。別のパスワードにしてください。';
  }
  if (/^\d+$/.test(password)) return '数字だけのパスワードは使えません。英字なども混ぜてください。';
  return null;
}
