/**
 * Claude のプロジェクトに入れる指示文を、ファイルに書き出す。
 * 質問を増やしたときは、これを実行して、docs の指示文を更新する（pnpm check が、古いままだと止める）。
 *
 *   node --experimental-strip-types scripts/build-voice-instruction.ts
 */
import { rmSync, writeFileSync } from 'node:fs';
import { buildVoiceInstruction, VOICE_VERSION } from '../packages/ai/src/index.ts';

const dir = new URL('../docs/', import.meta.url);
const text = buildVoiceInstruction();
writeFileSync(new URL('claude-voice-instruction.txt', dir), text, 'utf8');
// 以前は、指示文を2つに分けた版も出していた。いまは、1つの文章が短いので、分けない
for (const old of ['claude-voice-instruction-head.txt', 'claude-voice-item-list.txt']) rmSync(new URL(old, dir), { force: true });
console.log(`生成: docs/claude-voice-instruction.txt（版 ${VOICE_VERSION}・${text.length.toLocaleString()}文字）`);
