/**
 * 図面の結線の検証。
 *
 * 「記号を動かしても線が離れない」「印刷しても寸分の狂いがない」
 * 「記号を差し替えると前後の線が自動で伸縮する」を、実案件の図面で確かめる。
 *
 *   node --experimental-strip-types scripts/check-drawing.ts
 */
import { state } from './check-drawing/common.ts';
import './check-drawing/part1.ts';
import './check-drawing/part2.ts';
import './check-drawing/part3.ts';
import './check-drawing/part4.ts';
import './check-drawing/part5.ts';
import './check-drawing/part6.ts';
import './check-drawing/part7.ts';
import './check-drawing/part8.ts';
import './check-drawing/part9.ts';

console.log(state.failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${state.failed}件の問題があります`);
process.exit(state.failed === 0 ? 0 : 1);
