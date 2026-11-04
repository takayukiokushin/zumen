/**
 * ナレッジベース（質問定義・構成ルール）の検証。
 *
 * 実際の案件（カニエ竹原太陽光発電所）の回答を入れて、
 *  - 出てくる質問が妥当か
 *  - 構成データが実図面どおりの並びになるか
 *  - 参照している記号IDが記号マスタに存在するか
 * を確認する。
 *
 *   node --experimental-strip-types scripts/check-knowledge.ts
 */
import { state } from './check-knowledge/common.ts';
import './check-knowledge/part1.ts';
import './check-knowledge/part2.ts';
import './check-knowledge/part3.ts';

console.log(state.failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${state.failed}件の問題があります`);
process.exit(state.failed === 0 ? 0 : 1);
