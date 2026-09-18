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
import { findSymbol, SYMBOLS } from '../packages/symbols/src/index.ts';
import {
  buildComposition,
  missingRequired,
  questionsByGroup,
  QUESTIONS,
  referencedKeys,
  suggestMainBreakerForm,
  visibleQuestions,
  withDerived,
} from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, TRANSFORMER, UPSTREAM } from '../packages/knowledge/src/composition.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/* ---------- 1. 定義そのものの整合性 ---------- */
console.log('■ 定義の整合性');
const questionIds = new Set(QUESTIONS.map((q) => q.id));
if (questionIds.size !== QUESTIONS.length) fail('質問IDが重複しています');

for (const q of QUESTIONS) {
  for (const key of referencedKeys(q.showIf)) {
    if (!questionIds.has(key)) fail(`質問 ${q.id} の表示条件が未定義の質問 ${key} を参照しています`);
  }
  if (q.type === 'select' && !q.options?.length) fail(`質問 ${q.id} は選択式なのに選択肢がありません`);
}

const allPlacements = [
  ...UPSTREAM,
  ...Object.values(CHAIN_BY_FORM).flat(),
  ...DOWNSTREAM,
  ...TRANSFORMER,
  ...EXTRAS,
];
for (const p of allPlacements) {
  if (!p.symbolId.includes('{') && !findSymbol(p.symbolId)) {
    fail(`構成ルール ${p.role} が未登録の記号 ${p.symbolId} を参照しています`);
  }
  for (const key of referencedKeys(p.when)) {
    if (!questionIds.has(key)) fail(`構成ルール ${p.role} が未定義の質問 ${key} を参照しています`);
  }
  if (p.repeatCountKey && !questionIds.has(p.repeatCountKey)) {
    fail(`構成ルール ${p.role} の件数 ${p.repeatCountKey} が未定義です`);
  }
  if (p.kind === 'inside') {
    const parent = allPlacements.find((q) => q.role === p.parent);
    if (!parent) fail(`構成ルール ${p.role} の親 ${p.parent} が見つかりません`);
    else {
      const def = findSymbol(parent.symbolId);
      if (def && !def.slots?.some((s) => s.id === p.slot)) {
        fail(`記号 ${parent.symbolId} にスロット ${p.slot} がありません`);
      }
    }
  }
}
console.log(`  質問 ${QUESTIONS.length}件 / 構成ルール ${allPlacements.length}件 / 記号 ${SYMBOLS.length}件`);

/* ---------- 2. 実案件で構成を組み立てる ---------- */
console.log('\n■ カニエ竹原太陽光発電所（PFS形・PAS VT/LA内蔵・DGR・VCT2台）');

const answers: Answers = {
  customerName: 'カニエ竹原太陽光発電所',
  siteName: 'カニエ竹原太陽光発電所',
  receivingType: 'high',
  receivingVoltage: 6600,

  sourceType: 'pole',
  polePrefix: '中電柱:',
  poleName: '大井(分)7T1H1',
  hasAs: 'no',

  boundaryPattern: 'coincident',

  hasPas: 'yes',
  pasControl: 'dgr',
  pasBuiltinVt: 'yes',
  pasBuiltinLa: 'yes',
  pasRatedVoltage: '7200',
  pasRatedCurrent: '200',

  vctLocation: 'indoor',
  vctCount: 2,

  cableInstallation: 'buried',
  cableStructure: 'CVT',
  cableVoltage: 6600,
  cableCrossSection: 38,
  cableLength: 14,

  areaCount: 1,
  areaForm: 'cubicle',
  areaPlacement: 'outdoor',

  mainBreakerForm: 'pfs',
  lbsRatedVoltage: '7200',
  lbsRatedCurrent: 200,
  lbsFuseCount: 3,
  lbsFuseSpec: '7200V 50A 40kA',
  ctRatio: '40A/5A',
  vtRatio: '6600/110V',
  hasZpd: 'yes',

  transformerCount: 1,
  trUsage: '動力',
  trConnection: 'tr-3p-dy',
  trCapacity: 300,
  trVoltage: '6600V/440-254V',

  hasPv: 'yes',
  pvCapacity: '50kW×2',
};

const derived = withDerived(answers);
console.log(`  PASの内蔵表記: 「${derived.pasBuiltinText}」`);
console.log(`  ケーブル注記: ${derived.cableInstallationLabel} / ${answers.cableStructure} / ${derived.cableSpecLine}`);
console.log(`  エリアのラベル: 「${derived.areaLabel}」`);
console.log(`  設備容量300kVAからの提案: ${suggestMainBreakerForm(300)}（回答は ${answers.mainBreakerForm}）`);

const composition = buildComposition(answers);
console.log(`\n  組み立てた構成（${composition.length}件）:`);
for (const item of composition) {
  const kind = { series: '直列', 'branch-left': '左分岐', 'branch-right': '右分岐', inside: '内蔵' }[item.kind];
  const label = item.label.length ? `  「${item.label.join(' / ')}」` : '';
  const parent = item.parent ? ` → ${item.parent}.${item.slot}` : '';
  console.log(`    ${kind.padEnd(4, '　')} ${item.symbolId.padEnd(16)}${parent}${label}`);
  if (!findSymbol(item.symbolId)) fail(`構成に未登録の記号 ${item.symbolId} が入っています`);
}

/* 実図面と同じ並びになっているか（主要な機器の順序） */
const order = composition.filter((i) => i.kind === 'series').map((i) => i.symbolId);
const expected = [
  'pole-utility', 'incoming-point', 'boundary-both', 'pas',
  'cable-head', 'cable-head', 'vct', 'vct', 'lbs-pf', 'ct', 'tr-3p-dy', 'pv',
];
if (JSON.stringify(order) !== JSON.stringify(expected)) {
  fail(`主回路の並びが実図面と一致しません\n      期待: ${expected.join(' → ')}\n      実際: ${order.join(' → ')}`);
} else {
  console.log(`\n  主回路の並びは実図面と一致しました`);
}

/* ---------- 3. 質問の出し分け ---------- */
console.log('\n■ 質問の出し分け');
const empty: Answers = {};
console.log(`  未回答のとき: ${visibleQuestions(empty).length}件`);
console.log(`  この案件の回答後: ${visibleQuestions(answers).length}件`);
const resolvedByAi = new Set(['sourceType', 'boundaryPattern', 'hasPas', 'pasControl', 'areaCount', 'mainBreakerForm']);
console.log(`  AIが画像から判定できた6件を除くと: ${visibleQuestions(answers, { resolvedByAi }).length}件`);

const missing = missingRequired(answers);
if (missing.length) console.log(`  未回答の必須項目: ${missing.map((q) => q.label).join(' / ')}`);
else console.log('  未回答の必須項目: なし');

console.log('\n  グループ別（この案件の回答時）:');
for (const { group, questions } of questionsByGroup(answers)) {
  console.log(`    ${group.label}: ${questions.length}件`);
}

/* ---------- 4. CB形でも組み立てられるか ---------- */
console.log('\n■ CB形に切り替えたとき');
const cbComposition = buildComposition({ ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 600A 12.5kA' });
const cbSeries = cbComposition.filter((i) => i.kind === 'series').map((i) => i.symbolId);
console.log(`    ${cbSeries.join(' → ')}`);
if (!cbSeries.includes('ds') || !cbSeries.includes('vcb')) fail('CB形なのにDS/VCBが入っていません');
if (!cbComposition.some((i) => i.symbolId === 'relay-ocr')) fail('CB形なのにOCRが入っていません');

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
