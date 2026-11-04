/**
 * 自己診断。
 *
 *   pnpm selftest
 *
 * サーバーを一時的に立ち上げ、実際に通信して「ちゃんと動くか」を順に確かめる。
 * Windows・macOS・Linux のどれでも同じように動く。
 * 本物の案件には触らず、一時フォルダの中だけで試して、終わったら片付ける。
 */
import { appendFileSync, rmSync } from 'node:fs';
import { ROOT, backupDir, dataDir, ng, say, sleep, st, transcript } from './selftest/common.ts';
import { part1 } from './selftest/part1.ts';
import { part2 } from './selftest/part2.ts';
import { part3 } from './selftest/part3.ts';

/* ------------------------------------------------------------------ */

say('単線結線図作成：自己診断');
say(`  Node ${process.version} / ${process.platform}`);
say(`  場所 ${ROOT}`);

try {
  const c1 = await part1();
  const c2 = await part2(c1);
  await part3(c2);
} catch (e) {
  ng('診断そのもの', e instanceof Error ? e.message : String(e));
} finally {
  st.server?.kill();
  await sleep(300);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */

say('\n' + '─'.repeat(52));
if (st.failed === 0) {
  say(`✓ ${st.passed}件すべて正常です。このまま進めて問題ありません。`);
} else {
  say(`✗ ${st.passed}件は正常、${st.failed}件に問題があります。`);
  say('\n【問題のあった項目】');
  for (const p of st.problems) say(`  ・${p}`);
  say('\nこの画面をそのままコピーして渡してください。');
  if (st.serverLog.trim()) {
    say('\n【サーバーの記録】');
    say(st.serverLog.trim().split('\n').slice(-15).join('\n'));
  }
}
// 記録を残す（Windowsの診断バッチから渡される）
const logPath = process.env.SELFTEST_LOG;
if (logPath) {
  try {
    appendFileSync(logPath, transcript.join('\n') + '\n');
  } catch {
    // 書けなくても診断そのものは成立するので黙って進む
  }
}

process.exit(st.failed === 0 ? 0 : 1);
