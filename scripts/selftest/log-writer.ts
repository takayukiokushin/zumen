/**
 * 自己診断の道具。自動起動のときのサーバーのように、標準出力を追記で開いたファイルへ、書き続ける。
 *
 *   node ... log-writer.ts   （標準出力を、server.log に追記で向けて起動する）
 */
let i = 0;
const t = setInterval(() => {
  for (let k = 0; k < 20; k++) console.log(`line ${i++} ${'x'.repeat(80)}`);
}, 5);
process.on('SIGTERM', () => {
  clearInterval(t);
  process.exit(0);
});
