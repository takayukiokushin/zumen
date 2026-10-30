/**
 * Claude のプロジェクトに入れる指示文を、ファイルに書き出す。
 * 質問を増やしたときは、これを実行して、docs の指示文を更新する（pnpm check が、古いままだと止める）。
 *
 *   node --experimental-strip-types scripts/build-voice-instruction.ts
 */
import { writeFileSync } from 'node:fs';
import { buildVoiceInstruction, buildVoiceItemList, VOICE_VERSION } from '../packages/ai/src/index.ts';

const dir = new URL('../docs/', import.meta.url);
writeFileSync(new URL('claude-voice-instruction.txt', dir), buildVoiceInstruction(), 'utf8');
writeFileSync(new URL('claude-voice-instruction-head.txt', dir), buildVoiceInstruction({ listInline: false }), 'utf8');
writeFileSync(new URL('claude-voice-item-list.txt', dir), buildVoiceItemList(), 'utf8');
console.log(`生成: docs/claude-voice-instruction.txt ほか2件（版 ${VOICE_VERSION}）`);
