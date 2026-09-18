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
import { CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, FEEDERS, TRANSFORMER, UPSTREAM } from '../packages/knowledge/src/composition.ts';
import { layout } from '../packages/layout/src/index.ts';
import { buildAnalysisSchema, buildReview, buildSystemPrompt } from '../packages/ai/src/index.ts';

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
  ...FEEDERS,
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
  hasSiteVt: 'yes',
  hasSiteCt: 'yes',
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
  const kind = { series: '直列', 'branch-left': '左分岐', 'branch-right': '右分岐', inside: '内蔵', frame: '枠', feeder: '回線' }[item.kind];
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

/* ---------- 5. 自動レイアウトが動くか ---------- */
console.log('\n■ 自動レイアウト');
for (const [name, ans] of [
  ['PFS形', answers],
  ['CB形', { ...answers, mainBreakerForm: 'cb', dsRating: '7200V 400A', vcbRating: '7200V 600A 12.5kA' }],
  ['PAS・VCT・ZPDなし', { ...answers, hasPas: 'no', vctLocation: 'pole', vctCount: 1, hasZpd: 'no', hasSiteVt: 'no', hasSiteCt: 'no' }],
] as const) {
  const d = layout(buildComposition(ans as Answers), ans as Answers);
  const w = d.bounds.x1 - d.bounds.x0;
  const h = d.bounds.y1 - d.bounds.y0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) fail(`${name}: 作図範囲が求まりません`);
  console.log(`  ${name}: 記号${d.symbols.length}個 / 線${d.wires.length}本 / 範囲 ${w.toFixed(0)}×${h.toFixed(0)}`);
}

/* ---------- 6. AI解析の受け口 ---------- */
console.log('\n■ AI解析');
const schema = buildAnalysisSchema() as { properties: { answers: { properties: Record<string, unknown> } } };
const schemaKeys = Object.keys(schema.properties.answers.properties);
if (schemaKeys.length !== QUESTIONS.length) {
  fail(`スキーマの項目数（${schemaKeys.length}）が質問数（${QUESTIONS.length}）と合いません`);
}
for (const q of QUESTIONS) {
  if (!schemaKeys.includes(q.id)) fail(`スキーマに質問 ${q.id} がありません`);
}
console.log(`  読み取り用スキーマ: ${schemaKeys.length}項目`);

const prompt = buildSystemPrompt();
for (const must of ['7200V', '6600V', 'PFS形', '300kVA', 'たたき台']) {
  if (!prompt.includes(must)) fail(`指示文に「${must}」の説明がありません`);
}
console.log(`  指示文: ${prompt.length}文字（記号と質問の一覧を含む）`);

/* 矛盾した読み取り結果を弾けるか */
const bad = buildReview(
  {
    answers: { mainBreakerForm: 'pfs', trCapacity: 500, transformerCount: 1, hasPas: 'yes', pasControl: 'dgr' },
    uncertain: ['mainBreakerForm'],
    evidence: { mainBreakerForm: 'メモに「LBS」と記載' },
    notes: [],
    questions: [],
  },
  {},
);
const hasCapacityError = bad.some((r) => r.level === 'error' && r.questionId === 'mainBreakerForm');
const hasDgrError = bad.some((r) => r.level === 'error' && r.label.includes('零相電圧'));
if (!hasCapacityError) fail('500kVAでPFS形という矛盾を検出できませんでした');
if (!hasDgrError) fail('DGRなのに零相電圧源が無い矛盾を検出できませんでした');
console.log(`  矛盾の検出: ${bad.filter((r) => r.level === 'error').length}件のエラー / 全${bad.length}件の確認事項`);
for (const r of bad.filter((x) => x.level === 'error')) console.log(`    ${r.label}: ${r.message}`);

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
