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
import { fillLabelLines, findSymbol, initialLabelValues, labelFields, SYMBOLS } from '../packages/symbols/src/index.ts';
import {
  buildComposition,
  evaluate,
  missingRequired,
  questionsByGroup,
  QUESTIONS,
  areaView,
  areaKey,
  referencedKeys,
  normalizeAnswers,
  dropHiddenChoices,
  resolveDrawingName,
  suggestMainBreakerForm,
  visibleQuestions,
  VIEW_KEYS,
  withAutoValues,
  withDerived,
} from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, FEEDERS, TRANSFORMER, UPSTREAM } from '../packages/knowledge/src/composition.ts';
import { layout } from '../packages/layout/src/index.ts';
import { buildAnalysisSchema, buildReview, buildSystemPrompt } from '../packages/ai/src/index.ts';
import { checkConsistency } from '../packages/ai/src/review.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/* ---------- 1. 定義そのものの整合性 ---------- */
console.log('■ 定義の整合性');
const questionIds = new Set(QUESTIONS.map((q) => q.id));
if (questionIds.size !== QUESTIONS.length) fail('質問IDが重複しています');
/** 回答から組み立てる値（質問ではないが、構成ルールから参照してよい） */
const derivedKeys = new Set(Object.keys(withDerived({})));
const known = (key: string) => questionIds.has(key) || derivedKeys.has(key);

for (const q of QUESTIONS) {
  for (const key of referencedKeys(q.showIf)) {
    if (!questionIds.has(key) && !VIEW_KEYS.has(key)) fail(`質問 ${q.id} の表示条件が未定義の質問 ${key} を参照しています`);
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
    if (!known(key)) fail(`構成ルール ${p.role} が未定義の質問 ${key} を参照しています`);
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
  siteName: 'カニエ竹原太陽光発電所',
  receivingType: 'high',
  receivingVoltage: 6600,

  sourceType: 'pole',
  poleName: '中電柱:大井(分)7T1H1',
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
  const kind =
    { series: '直列', 'branch-left': '左分岐', 'branch-right': '右分岐', inside: '内蔵', frame: '枠', parallel: '並列', feeder: '回線', free: '独立', overlay: '重ね', link: 'つなぎ' }[
      item.kind as string
    ] ?? item.kind;
  const label = item.label.length ? `  「${item.label.join(' / ')}」` : '';
  const parent = item.parent ? ` → ${item.parent}.${item.slot}` : '';
  console.log(`    ${kind.padEnd(4, '　')} ${item.symbolId.padEnd(16)}${parent}${label}`);
  if (!findSymbol(item.symbolId)) fail(`構成に未登録の記号 ${item.symbolId} が入っています`);
}

/* 実図面と同じ並びになっているか（主要な機器の順序） */
// 別表記（PASの枠を広げたものなど）は、もとの記号と同じものとして見る
const order = composition
  .filter((i) => i.kind === 'series')
  .map((i) => findSymbol(i.symbolId)?.altOf ?? i.symbolId);
// 変圧器は主回路から分岐して並列に入るため、直列の並びには出てこない
const expected = [
  'pole-utility', 'incoming-point', 'boundary-both', 'pas',
  'cable-head', 'cable-head', 'vct', 'vct', 'lbs-pf', 'ct',
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

/* 変圧器と高圧進相設備は並列に入るか */
{
  const parallel = composition.filter((i) => i.kind === 'parallel').map((i) => i.symbolId);
  if (!parallel.includes('tr-3p-dy')) fail('変圧器が主回路から分岐していません（直列になっています）');
  console.log(`  高圧母線から並列に入るもの: ${parallel.join(' / ')}`);

  // 変圧器3台＋コンデンサ2台のとき、それぞれが別の列になるか
  // 件ごとに独立して答えるので、2台目以降もそれぞれ結線方式を入れる
  const many = buildComposition({
    ...answers,
    transformerCount: '3',
    trConnection: 'tr-3p-dy',
    trConnection__2: 'tr-3p-dy',
    trConnection__3: 'tr-3p-dy',
    hasCapacitor: 'yes',
    capacitorCount: '2',
    hasReactor: 'yes',
    hasReactor__2: 'yes',
  });
  const lanes = many.filter((i) => i.kind === 'parallel').map((i) => i.lane);
  const unique = [...new Set(lanes)].sort((a, b) => Number(a) - Number(b));
  if (unique.length !== 5) {
    fail(`変圧器3台＋コンデンサ2台で5列になるはずが ${unique.length} 列でした（${unique.join(',')}）`);
  }
  console.log(`  変圧器3台＋コンデンサ2台 → ${unique.length}列`);

  // 1台だけのときは、母線を描かずに主回路の上に乗る（実図面と同じ見た目を保つ）
  const single = layout(buildComposition(answers), answers);
  const tr = single.symbols.find((x) => x.role === 'transformer');
  if (!tr) fail('変圧器1台のときに記号が置かれていません');
  else if (Math.abs(tr.x + 0) > 40 && Math.abs(tr.x) > 40) {
    // 主回路（x=0付近）から大きく外れていないこと
    fail(`変圧器1台なのに主回路から離れています（x=${tr.x}）`);
  }
}

/* ---------- 4b. PASの内蔵機器（SOGの有無で決まる） ---------- */
console.log('\n■ PASの内蔵機器');
{
  /** そのPASに内蔵される記号を並べる */
  const builtin = (control: string, vt: string, la: string): string[] => {
    const a: Answers = { ...answers, hasPas: 'yes', pasControl: control, pasBuiltinVt: vt, pasBuiltinLa: la };
    return buildComposition(a)
      .filter((i) => i.kind === 'inside' && i.parent === 'pas')
      .map((i) => i.symbolId);
  };
  /** 図面のPASに添える文字（例: VT,LA内蔵型） */
  const text = (control: string, vt: string, la: string): string =>
    String(withDerived({ ...answers, hasPas: 'yes', pasControl: control, pasBuiltinVt: vt, pasBuiltinLa: la }).pasBuiltinText);

  const cases: [string, string, string, string, string[]][] = [
    ['SOGなし・VTなし・LAなし', 'none', 'no', 'no', []],
    ['SOGなし・LAのみ', 'none', 'no', 'yes', ['la']],
    ['SOGなし（VT内蔵と読み違えても無視する）', 'none', 'yes', 'yes', ['la']],
    ['GR・VTなし・LAなし', 'gr', 'no', 'no', ['zct']],
    ['GR・LAのみ', 'gr', 'no', 'yes', ['zct', 'la']],
    ['DGR・VTのみ', 'dgr', 'yes', 'no', ['zct', 'vt']],
    ['DGR・VTとLA', 'dgr', 'yes', 'yes', ['zct', 'vt', 'la']],
  ];
  for (const [name, control, vt, la, want] of cases) {
    const got = builtin(control, vt, la);
    const ok = got.length === want.length && want.every((w) => got.includes(w));
    console.log(`  ${ok ? ' ' : '✗'} ${name}: ${got.join('・') || 'なし'}${text(control, vt, la) ? `（${text(control, vt, la)}）` : ''}`);
    if (!ok) fail(`PASの内蔵機器が想定と違います（${name}）: 期待 ${want.join('・') || 'なし'} / 実際 ${got.join('・') || 'なし'}`);
  }
  // SOGが無ければVTの質問そのものを出さない
  const asked = visibleQuestions({ ...answers, hasPas: 'yes', pasControl: 'none' }).map((q) => q.id);
  if (asked.includes('pasBuiltinVt')) fail('SOGが無いのにVT内蔵の質問が出ています');
  if (!asked.includes('pasBuiltinLa')) fail('SOGが無くてもLA内蔵は聞く必要があります');
}

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

const sogless = buildReview(
  {
    answers: { hasPas: 'yes', pasControl: 'none', pasBuiltinVt: 'yes' },
    uncertain: [],
    evidence: {},
    notes: [],
    questions: [],
  },
  {},
);
if (!sogless.some((r) => r.level === 'error' && r.label.includes('内蔵VT'))) {
  fail('SOGが無いPASにVTという矛盾を検出できませんでした');
}
console.log(`  矛盾の検出: ${bad.filter((r) => r.level === 'error').length}件のエラー / 全${bad.length}件の確認事項`);
for (const r of bad.filter((x) => x.level === 'error')) console.log(`    ${r.label}: ${r.message}`);

console.log('\n■ 責任分界点の質問（3点不一致のとき、主遮断装置が未入力のときだけ聞く）');
{
  const asked = (a: Answers) => visibleQuestions(withDerived(a), {}).some((q) => q.id === 'boundarySafetyDevice');
  const reviewAsks = (a: Answers) =>
    buildReview({ answers: a as Record<string, string | number | boolean>, uncertain: [], evidence: {}, notes: [], questions: [] }, {}).some(
      (r) => r.questionId === 'boundarySafetyDevice',
    );
  const cases: [string, Answers, boolean][] = [
    ['3点一致', { boundaryPattern: 'coincident' }, false],
    ['3点不一致・CB形', { boundaryPattern: 'split', mainBreakerForm: 'cb' }, false],
    ['3点不一致・PFS形', { boundaryPattern: 'split', mainBreakerForm: 'pfs' }, false],
    ['3点不一致・主遮断装置が未入力', { boundaryPattern: 'split' }, true],
    ['3点不一致・主遮断装置が電柱上構成（それ以外）', { boundaryPattern: 'split', mainBreakerForm: 'pole-top' }, true],
  ];
  for (const [name, ans, want] of cases) {
    if (asked(ans) !== want) fail(`${name}：質問を${asked(ans) ? '出して' : '出さずに'}います（期待：${want ? '出す' : '出さない'}）`);
    else console.log(`  ${name}：${want ? '聞く' : '聞かない'}`);
  }
  // AIの読み取り結果の確認事項も、同じ条件にそろえる
  if (reviewAsks({ boundaryPattern: 'split', mainBreakerForm: 'cb' })) fail('CB形なのに、責任分界点の位置を確認事項に出しています');
  if (!reviewAsks({ boundaryPattern: 'split' })) fail('主遮断装置が未入力なのに、責任分界点の位置を確認事項に出していません');
}

console.log('\n■ 区分開閉器（PAS／PGS／なし）と地上キャビネットの質問');
{
  const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  const rows: [string, Answers, string[], string[]][] = [
    // [名前, 回答, 出る質問, 出ない質問]
    ['PAS', { sectionalizer: 'pas' }, ['pasControl', 'pasBuiltinLa', 'pasRatedVoltage'], ['groundCabinet', 'groundCabinetType']],
    ['PGS（SOGなどの質問はPASと同じ）', { sectionalizer: 'pgs' }, ['pasControl', 'pasBuiltinLa', 'pasRatedVoltage'], ['groundCabinet', 'groundCabinetType']],
    ['なし', { sectionalizer: 'none' }, ['groundCabinet'], ['pasControl', 'pasBuiltinVt', 'pasBuiltinLa', 'pasRatedVoltage', 'groundCabinetType']],
    ['なし・地上キャビネットあり', { sectionalizer: 'none', groundCabinet: 'yes' }, ['groundCabinet', 'groundCabinetType'], ['pasControl']],
    ['なし・地上キャビネットなし', { sectionalizer: 'none', groundCabinet: 'no' }, ['groundCabinet'], ['groundCabinetType', 'pasControl']],
  ];
  for (const [name, ans, want, notWant] of rows) {
    const ids = shown(ans);
    const miss = want.filter((id) => !ids.has(id));
    const extra = notWant.filter((id) => ids.has(id));
    if (miss.length) fail(`${name}：出るはずの質問が出ません（${miss.join('・')}）`);
    else if (extra.length) fail(`${name}：出ないはずの質問が出ています（${extra.join('・')}）`);
    else console.log(`  ${name}：質問の出方が正しい`);
  }
  // 引込元は電柱か地上キャビネット。選んだほうの質問だけが出る
  const ids = new Set(QUESTIONS.map((q) => q.id));
  for (const gone of ['cabinetContent', 'hasPas']) {
    if (ids.has(gone)) fail(`なくしたはずの質問 ${gone} が残っています`);
  }
  const labels = (id: string) => QUESTIONS.find((q) => q.id === id)?.label;
  // 「区分」と「名称」は1つの欄にまとめた（最初から「中電柱：」「キャビネット番号：」が入っている）
  for (const gone of ['polePrefix', 'cabinetPrefix']) {
    if (ids.has(gone)) fail(`1つにまとめたはずの質問 ${gone} が残っています`);
  }
  if (labels('poleName') !== '電柱名称') fail(`「電柱名称」の名前が違います（${labels('poleName')}）`);
  if (labels('cabinetName') !== 'キャビネット名称') fail(`「キャビネット名称」の名前が違います（${labels('cabinetName')}）`);
  const poleName = QUESTIONS.find((q) => q.id === 'poleName');
  const cabName = QUESTIONS.find((q) => q.id === 'cabinetName');
  if (poleName?.defaultValue !== '中電柱：') fail(`電柱名称の最初の文字が「中電柱：」ではありません（${poleName?.defaultValue}）`);
  if (cabName?.defaultValue !== 'キャビネット番号：') fail(`キャビネット名称の最初の文字が「キャビネット番号：」ではありません（${cabName?.defaultValue}）`);
  if (/（分）|（幹）/.test(cabName?.help ?? '')) fail('キャビネット名称に、電柱の（分）（幹）の注意書きが残っています');
  const visibleIds = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  const pole = visibleIds({ sourceType: 'pole' });
  const cab = visibleIds({ sourceType: 'cabinet' });
  for (const id of ['poleName', 'hasAs']) {
    if (!pole.has(id)) fail(`引込元が電柱のとき、${id} が出ていません`);
    if (cab.has(id)) fail(`引込元がキャビネットのとき、${id} が出ています`);
  }
  for (const id of ['cabinetName']) {
    if (pole.has(id)) fail(`引込元が電柱のとき、${id} が出ています`);
    if (!cab.has(id)) fail(`引込元がキャビネットのとき、${id} が出ていません`);
  }
  // 古い案件（引込元の種類が未入力）は電柱として扱う
  if (!visibleIds({}).has('poleName')) fail('引込元の種類が未入力のとき、電柱として扱っていません');
  // キャビネットを選んだら、前に「AS あり」と答えていても AS は描かない
  const hasAsRole = (a: Answers) => buildComposition({ ...answers, ...a }).some((i) => i.role === 'as');
  if (!hasAsRole({ sourceType: 'pole', hasAs: 'yes' })) fail('電柱でASありのとき、ASが描かれていません');
  if (hasAsRole({ sourceType: 'cabinet', hasAs: 'yes' })) fail('キャビネットなのにASが描かれています');
  // 地上キャビネットのときは、電柱の代わりに「DS＋外枠」の記号を一番上に描き、脇に「キャビネット番号：名称」を書く
  {
    const comp = buildComposition({ ...answers, sourceType: 'cabinet', cabinetName: 'キャビネット番号：地下佐東西11号' });
    const first = comp.find((i) => i.kind === 'series');
    if (first?.symbolId !== 'cabinet') fail(`引込元がキャビネットのとき、一番上が「${first?.symbolId}」です（cabinet のはず）`);
    if (comp.some((i) => i.symbolId === 'pole-utility')) fail('引込元がキャビネットなのに、電柱の記号が描かれています');
    if (first?.label.join('') !== 'キャビネット番号：地下佐東西11号') fail(`キャビネットの脇の文字が違います（${first?.label.join('')}）`);
    const cabDef = findSymbol('cabinet');
    if (!cabDef || cabDef.ports.length !== 1 || cabDef.ports[0]?.id !== 'out') fail('キャビネットの記号の接続点が、下の1つだけになっていません');
    // 縦線が、枠の上端から上へ少し突き出ている
    const frame = cabDef?.shapes.find((x) => x.k === 'rect') as { y: number } | undefined;
    const topLine = cabDef?.shapes.find((x) => x.k === 'line' && x.x1 === x.x2 && Math.min(x.y1, x.y2) < (frame?.y ?? 0));
    if (!frame || !topLine) fail('キャビネットの記号の縦線が、枠の上端から突き出ていません');
    else {
      const out = frame.y - Math.min((topLine as { y1: number; y2: number }).y1, (topLine as { y1: number; y2: number }).y2);
      if (out < 3 || out > 10) fail(`キャビネットの縦線の突き出しが ${out} です（3〜10の「少し」のはず）`);
    }
    const poleComp = buildComposition({ ...answers, sourceType: 'pole' });
    if (poleComp.find((i) => i.kind === 'series')?.symbolId !== 'pole-utility') fail('引込元が電柱のとき、一番上が電柱の記号ではありません');
    console.log('  引込元がキャビネット：一番上は「DS＋外枠」の記号、脇に「キャビネット番号：地下佐東西11号」');
  }
  // 引込元が地上キャビネットのときの区分開閉器は、PASではなくUGS（同じ図記号で、名前だけ違う）
  {
    const secLabel = (a: Answers) => buildComposition({ ...answers, ...a, hasPas: undefined }).find((i) => i.role === 'pas');
    const cabinetDefault = secLabel({ sourceType: 'cabinet' });
    if (cabinetDefault?.label[0] !== 'UGS') fail(`引込元がキャビネット（区分開閉器は未回答）のとき、区分開閉器の文字が「${cabinetDefault?.label[0]}」です（UGSのはず）`);
    if ((findSymbol(cabinetDefault?.symbolId ?? '')?.altOf ?? cabinetDefault?.symbolId) !== 'pas') fail('UGSの図記号が、PASと同じ図記号ではありません');
    if (secLabel({ sourceType: 'cabinet', sectionalizer: 'pas' })?.label[0] !== 'UGS') fail('キャビネットなのにPASのまま描かれています');
    if (secLabel({ sourceType: 'cabinet', sectionalizer: 'pgs' })?.label[0] !== 'UGS') fail('キャビネットなのにPGS（電柱上）のまま描かれています');
    if (secLabel({ sourceType: 'pole' })?.label[0] !== 'PAS') fail('電柱のとき、区分開閉器がPASになっていません');
    if (secLabel({ sourceType: 'pole', sectionalizer: 'ugs' })?.label[0] !== 'UGS') fail('電柱でUGSを選んだのに、UGSで描かれていません');
    if (secLabel({ sourceType: 'pole', sectionalizer: 'pgs' })?.label[0] !== 'PGS') fail('電柱でPGSを選んだのに、PGSで描かれていません');
    const secQ = QUESTIONS.find((q) => q.id === 'sectionalizer');
    const shownOpts = (a: Answers) => (secQ?.options ?? []).filter((o) => evaluate(o.showIf, a)).map((o) => o.value);
    const cabOpts = shownOpts({ sourceType: 'cabinet' }).join(',');
    const poleOpts = shownOpts({ sourceType: 'pole' }).join(',');
    if (cabOpts !== 'ugs,none') fail(`キャビネットのときの区分開閉器の選択肢が「${cabOpts}」です（ugs,none のはず）`);
    if (poleOpts !== 'pas,pgs,ugs,none') fail(`電柱のときの区分開閉器の選択肢が「${poleOpts}」です（pas,pgs,ugs,none のはず）`);
    // UGSのときも、PASと同じ質問（定格・制御装置・内蔵機器）が出る
    const ugsQs = new Set(visibleQuestions({ sourceType: 'cabinet', sectionalizer: 'ugs' }, {}).map((q) => q.id));
    for (const id of ['pasRatedVoltage', 'pasRatedCurrent', 'pasControl']) if (!ugsQs.has(id)) fail(`UGSのとき、${id} の質問が出ていません`);
    const cleared = dropHiddenChoices({ sourceType: 'cabinet', sectionalizer: 'pas' });
    if (cleared.sectionalizer !== undefined) fail('キャビネットに切り替えたのに、選んでいたPASが残っています');
    if (!findSymbol('ugs') || findSymbol('ugs')?.abbr !== 'UGS') fail('編集画面に出す UGS の記号がありません');
    // 区分開閉器の選択肢の表示名
    const optLabels = (secQ?.options ?? []).map((o) => `${o.value}=${o.label}`).join('、');
    if (optLabels !== 'pas=PAS、pgs=PGS（電柱上）、ugs=UGS（キャビネット内）、none=なし') fail(`区分開閉器の選択肢の表示名が違います（${optLabels}）`);
    // UGSのときだけ、UGS用のキャビネット名称を聞き、定格の欄のすぐ上（先頭）に書く
    const ugsAsked = (a: Answers) => visibleQuestions(a, {}).some((q) => q.id === 'ugsCabinetName');
    if (!ugsAsked({ sourceType: 'cabinet' }) || !ugsAsked({ sourceType: 'pole', sectionalizer: 'ugs' })) fail('UGSのとき、UGSのキャビネット名称を聞いていません');
    if (ugsAsked({ sourceType: 'pole', sectionalizer: 'pas' }) || ugsAsked({ sourceType: 'pole', sectionalizer: 'pgs' })) fail('UGSでないのに、UGSのキャビネット名称を聞いています');
    const ugsLines = secLabel({ sourceType: 'cabinet', ugsCabinetName: 'キャビネット番号：地下西3号', pasRatedVoltage: '7200', pasRatedCurrent: '300' })?.label.slice(0, 3).join('|');
    if (ugsLines !== 'キャビネット番号：地下西3号|UGS|7200V300A') fail(`UGSの文字の並びが違います（${ugsLines}）`);
    const ugsBlank = secLabel({ sourceType: 'cabinet', ugsCabinetName: 'キャビネット番号：' })?.label[0];
    if (ugsBlank !== 'UGS') fail(`UGSのキャビネット名称が空のとき、先頭が「${ugsBlank}」です（UGSのはず）`);
    const notUgs = secLabel({ sourceType: 'pole', sectionalizer: 'pas', ugsCabinetName: 'キャビネット番号：残り' })?.label.join('|');
    if (notUgs?.includes('残り')) fail('UGSでないのに、UGSのキャビネット名称が図面に書かれています');
    console.log('  区分開閉器の選択肢：電柱＝PAS／PGS（電柱上）／UGS（キャビネット内）／なし、キャビネット＝UGS／なし。UGSの上にキャビネット名称');
  }
  // 文字の組み立て：入力した文字をそのまま書く。「中電柱：」だけで名称が無いときは書かない
  {
    const src = (a: Answers) => buildComposition({ ...answers, ...a }).find((i) => i.kind === 'series')?.label.join('|');
    const rows: [string, string | undefined, string][] = [
      ['電柱：名称あり', src({ sourceType: 'pole', poleName: '中電柱：猪子山（分）81' }), '中電柱：猪子山（分）81'],
      ['電柱：「中電柱：」だけ（名称が無い）', src({ sourceType: 'pole', poleName: '中電柱：' }), ''],
      ['電柱：書き換えてもそのまま書く', src({ sourceType: 'pole', poleName: '関電柱：大井1' }), '関電柱：大井1'],
      ['キャビネット：名称あり', src({ sourceType: 'cabinet', cabinetName: 'キャビネット番号：地下佐東西11号' }), 'キャビネット番号：地下佐東西11号'],
      ['キャビネット：「キャビネット番号：」だけ', src({ sourceType: 'cabinet', cabinetName: 'キャビネット番号：' }), ''],
      ['古い案件（区分と名称が別々）→つなげて読む', src({ sourceType: 'pole', polePrefix: '中電柱：', poleName: '大井1' } as Answers), '中電柱：大井1'],
      ['古い案件（キャビネットの区分と名称）', src({ sourceType: 'cabinet', cabinetPrefix: 'キャビネット番号：', cabinetName: '地下1号' } as Answers), 'キャビネット番号：地下1号'],
    ];
    for (const [name, got, want] of rows) {
      if ((got ?? '') !== want) fail(`${name}：「${got}」になっています（期待：「${want}」）`);
      else console.log(`  ${name}：${want || '（書かない）'}`);
    }
  }
  console.log('  引込元：電柱 → 電柱名称（「中電柱：」入り）・ASの有無／地上キャビネット → キャビネット名称（「キャビネット番号：」入り）（ASは無し）');
  // 古い回答（hasPas だけ入っている）を読み替える
  const legacyNo = normalizeAnswers({ hasPas: 'no' });
  const legacyYes = normalizeAnswers({ hasPas: 'yes' });
  const both = normalizeAnswers({ hasPas: 'no', sectionalizer: 'pgs' });
  if (legacyNo.sectionalizer !== 'none' || legacyYes.sectionalizer !== 'pas' || both.sectionalizer !== 'pgs') {
    fail('古い回答（hasPas）の読み替えが違います');
  } else console.log('  古い案件の回答（PASの設置：なし／あり）は、区分開閉器の回答（なし／PAS）に読み替える');
}

console.log('\n■ VTの変圧比（6600/110V固定の初期値）とCTの変流比（/5Aを自動で付ける）');
{
  const vt = QUESTIONS.find((q) => q.id === 'vtRatio');
  if (vt?.defaultValue !== '6600/110V' || vt.type !== 'text') fail(`VTの変圧比の初期値が 6600/110V の入力欄になっていません（${String(vt?.defaultValue)}）`);
  else console.log('  VTの変圧比：最初から 6600/110V が入っていて、手で直せる（文字を入れる欄）');
  const ct = QUESTIONS.find((q) => q.id === 'ctRatio');
  if (ct?.appendOnBlur !== '/5A') fail('CTの変流比の欄に、「/5A」を自動で付ける指定がありません');
  const text = (v: unknown) => String(withDerived({ ctRatio: v as string }).ctRatioText);
  const rows: [string, unknown, string][] = [
    ['数字だけ（文字）', '100', '100/5A'],
    ['数字だけ（数）', 100, '100/5A'],
    ['小数', '7.5', '7.5/5A'],
    ['すでに /5A まで書いてある', '100/5A', '100/5A'],
    ['古い案件の書き方', '40A/5A', '40A/5A'],
    ['空', '', ''],
  ];
  for (const [name, input, want] of rows) {
    if (text(input) !== want) fail(`CT ${name}：「${text(input)}」になっています（期待：「${want}」）`);
  }
  console.log('  CTの変流比：100 → 100/5A（数でも文字でも）。すでに /5A まで書いてあるもの・古い案件の書き方は、そのまま。空は空');
  const ctLabel = buildComposition({ ...answers, mainBreakerForm: 'cb', ctRatio: '100' }).find((i) => i.role === 'ct')?.label ?? [];
  const vtLabel = buildComposition({ ...answers, mainBreakerForm: 'cb', vtRatio: '6600/110V' }).find((i) => i.role === 'ds-vt-pf')?.label ?? [];
  if (JSON.stringify(ctLabel) !== JSON.stringify(['CT', '100/5A'])) fail(`CTの図面の文字が違います（${ctLabel.join(' / ')}）`);
  else console.log(`  図面の文字：CT → ${ctLabel.join(' / ')}、VT → ${vtLabel.join(' / ')}`);
}

console.log('\n■ CT・VTの台数（「CT×2」「VT＋PF×2」）と、受電設備の構成の見出し');
{
  const lab = (a: Answers, role: string) => buildComposition({ ...answers, mainBreakerForm: 'cb', ...a }).find((i) => i.role === role)?.label ?? [];
  const rows: [string, string[], string[]][] = [
    ['CT 1台', lab({ ctCount: '1', ctRatio: '100' }, 'ct'), ['CT', '100/5A']],
    ['CT 台数が未入力', lab({ ctCount: undefined, ctRatio: '100' }, 'ct'), ['CT', '100/5A']],
    ['CT 2台', lab({ ctCount: '2', ctRatio: '100' }, 'ct'), ['CT×2', '100/5A']],
    ['CT 3台（数）', lab({ ctCount: 3, ctRatio: '100' }, 'ct'), ['CT×3', '100/5A']],
    ['VT＋PF 1台', lab({ vtCount: '1' }, 'ds-vt-pf'), ['VT＋PF', '6600/110V']],
    ['VT＋PF 2台', lab({ vtCount: '2' }, 'ds-vt-pf'), ['VT＋PF×2', '6600/110V']],
  ];
  for (const [name, got, want] of rows) {
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${name}：「${got.join(' / ')}」になっています（期待：「${want.join(' / ')}」）`);
    else console.log(`  ${name}：${got.join(' / ')}`);
  }
  // PFS形の「受電設備内のVT」も同じ書き方
  const pfs = buildComposition({ ...answers, mainBreakerForm: 'pfs', hasSiteVt: 'yes', vtCount: '2' }).find((i) => i.role === 'site-vt-pf')?.label ?? [];
  if (pfs[0] !== 'VT＋PF×2') fail(`PFS形のVT：「${pfs[0]}」です（「VT＋PF×2」のはず）`);
  for (const id of ['vtCount', 'ctCount']) {
    const q = QUESTIONS.find((x) => x.id === id);
    if (!q || q.type !== 'select' || q.defaultValue !== '2' || !q.showIf) fail(`${id} の質問が、台数を選ぶ形（初期値2・条件つき）になっていません`);
  }
  // 受電設備の構成が、見出しつきの行に分かれ、同じ見出しの質問が続けて並んでいる
  const recv = QUESTIONS.filter((q) => q.group === 'receiving');
  const secs = recv.map((q) => q.section);
  const order: string[] = [];
  for (const sc of secs) if (sc !== order.at(-1)) order.push(String(sc));
  if (secs.some((sc) => !sc)) fail('受電設備の構成に、見出しの無い質問があります');
  else if (new Set(order).size !== order.length) fail(`同じ見出しが、離れて何度も出ます（${order.join(' → ')}）`);
  else console.log(`  受電設備の構成の見出し（上から）：${order.join(' → ')}`);
  const vtRow = recv.filter((q) => q.section === 'VT（計器用変圧器）').map((q) => q.id).join('・');
  const ctRow = recv.filter((q) => q.section === 'CT（変流器）').map((q) => q.id).join('・');
  console.log(`  VTの行：${vtRow} ／ CTの行：${ctRow}`);
}

console.log('\n■ 発電機・太陽光発電設備：「なし」のときは、入力欄を出さない');
{
  const shown = (a: Answers) => visibleQuestions(a, {});
  const ofGroup = (a: Answers, g: string) => shown(a).filter((q) => q.group === g).map((q) => q.id);
  const rows: [string, Answers, { gen: boolean; pv: boolean }][] = [
    ['まだ何も答えていない', {}, { gen: false, pv: false }],
    ['発電機なし・太陽光なし', { hasGenerator: 'no', hasPv: 'no' }, { gen: false, pv: false }],
    ['発電機あり', { hasGenerator: 'yes', hasPv: 'no' }, { gen: true, pv: false }],
    ['太陽光あり', { hasGenerator: 'no', hasPv: 'yes' }, { gen: false, pv: true }],
    ['両方あり', { hasGenerator: 'yes', hasPv: 'yes' }, { gen: true, pv: true }],
  ];
  for (const [name, a, want] of rows) {
    const gen = ofGroup(a, 'generator');
    const pv = ofGroup(a, 'pv');
    if ((gen.length > 0) !== want.gen) fail(`${name}：発電機の入力欄を${gen.length > 0 ? '出して' : '出さずに'}います（期待：${want.gen ? '出す' : '出さない'}）`);
    else if ((pv.length > 0) !== want.pv) fail(`${name}：PCSの入力欄を${pv.length > 0 ? '出して' : '出さずに'}います（期待：${want.pv ? '出す' : '出さない'}）`);
    else console.log(`  ${name}：発電機の入力欄 ${want.gen ? `あり（${gen.length}問）` : 'なし'}／PCSの入力欄 ${want.pv ? `あり（${pv.length}問）` : 'なし'}`);
  }
  // 「ありますか？」の質問そのものは、いつも出る。なしのときに、必須の入力漏れとして数えない
  const always = ['hasGenerator', 'hasPv', 'hasBattery'];
  const miss = new Set(missingRequired({ hasGenerator: 'no', hasPv: 'no' }).map((q) => q.id));
  const ids = new Set(shown({ hasGenerator: 'no', hasPv: 'no' }).map((q) => q.id));
  if (!always.every((id) => ids.has(id))) fail('「ありますか？」の質問が出なくなっています');
  if (miss.has('generatorCapacity') || miss.has('generatorUsage') || miss.has('pcsCapacity')) fail('なしのときに、発電機・PCSの質問が、必須の入力漏れになっています');
  // 蓄電所：「いいえ」なら、規模や変圧器の質問を出さない
  const bat = (a: Answers) => shown(a).filter((q) => ['batteryCapacity', 'batteryTransformer'].includes(q.id)).map((q) => q.id);
  if (bat({ hasBattery: 'no' }).length > 0 || bat({ hasBattery: 'yes' }).length === 0) fail('蓄電所の質問の出方が違います');
  else console.log('  「ありますか？」の3つの質問は、いつも出る。蓄電所も、いいえなら規模・変圧器の質問は出ない');
}

console.log('\n■ 変圧器の用途で、結線方式の選択肢を絞る／電灯および動力のV結線の容量');
{
  const conn = QUESTIONS.find((q) => q.id === 'trConnection')!;
  const offered = (a: Answers) => (conn.options ?? []).filter((o) => evaluate(o.showIf, a)).map((o) => o.value);
  const single = ['tr-1p', 'tr-1p-2w', 'tr-1p-parallel'];
  const three = ['tr-3p-dy', 'tr-3p-yd', 'tr-3p-dd', 'tr-3p-yy'];
  const sameSet = (x: string[], y: string[]) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
  const rows: [string, Answers, string[]][] = [
    ['電灯', { trUsage: '電灯' }, [...single, 'tr-vv']],
    ['動力', { trUsage: '動力' }, [...three, 'tr-vv']],
    ['電灯および動力', { trUsage: '電灯・動力' }, [...single, ...three, 'tr-vv']],
    ['まだ用途を選んでいない', {}, [...single, ...three, 'tr-vv']],
  ];
  for (const [name, a, want] of rows) {
    const got = offered(a);
    if (!sameSet(got, want)) fail(`用途「${name}」：出る結線方式が違います（${got.join('・')}）`);
    else console.log(`  用途「${name}」：結線方式 ${got.length}個（${single.some((s) => got.includes(s)) ? '単相系' : '単相系なし'}／${three.some((s) => got.includes(s)) ? '三相' : '三相なし'}／V結線あり）`);
  }
  // 用途を変えて、選んでいた結線方式が出なくなったら、空に戻す
  const a1 = dropHiddenChoices({ trUsage: '電灯', trConnection: 'tr-3p-dy' });
  const a2 = dropHiddenChoices({ trUsage: '動力', trConnection: 'tr-1p' });
  const a3 = dropHiddenChoices({ trUsage: '電灯', trConnection: 'tr-vv' });
  const a4 = dropHiddenChoices({ trUsage: '電灯・動力', trConnection: 'tr-3p-dy' });
  const a5 = dropHiddenChoices({ trUsage: '動力', trConnection: 'tr-3p-dy', trUsage__2: '電灯', trConnection__2: 'tr-3p-yy', trConnection__3: 'tr-3p-dd' });
  if (a1.trConnection !== undefined || a2.trConnection !== undefined) fail('用途に合わない結線方式が、空に戻っていません');
  else if (a3.trConnection !== 'tr-vv' || a4.trConnection !== 'tr-3p-dy') fail('合う結線方式まで空に戻っています');
  else if (a5.trConnection !== 'tr-3p-dy' || a5.trConnection__2 !== undefined || a5.trConnection__3 !== 'tr-3p-dd') fail('2台目以降の結線方式の扱いが違います');
  else console.log('  用途を変えて、選んでいた結線方式が出なくなったとき：空に戻す（V結線と、合うものは残す。2台目以降はその台の用途で見る）');
  // 容量の聞き方
  const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  const mixedV = shown({ trUsage: '電灯・動力', trConnection: 'tr-vv' });
  const plainV = shown({ trUsage: '電灯', trConnection: 'tr-vv' });
  const mixed3 = shown({ trUsage: '電灯・動力', trConnection: 'tr-3p-dy' });
  if (!mixedV.has('trCapacityLight') || !mixedV.has('trCapacityPower') || mixedV.has('trCapacity') || mixedV.has('trCapacity2')) {
    fail('電灯および動力のV結線：容量は「電灯の容量」「動力の容量」の2つだけを聞くはず');
  } else if (plainV.has('trCapacityLight') || !plainV.has('trCapacity') || !plainV.has('trCapacity2')) {
    fail('電灯のみのV結線：これまでどおり「容量」と「2台目の容量」を聞くはず');
  } else if (mixed3.has('trCapacityLight') || !mixed3.has('trCapacity')) {
    fail('電灯および動力の三相：「容量」を1つだけ聞くはず');
  } else console.log('  電灯および動力のV結線：「電灯の容量」「動力の容量」を聞く。ほかは、これまでどおり「容量」（V結線は2台目も）');
  const req = (a: Answers) => missingRequired(a).map((q) => q.id);
  if (!req({ trUsage: '電灯・動力', trConnection: 'tr-vv' }).includes('trCapacityLight') || req({ trUsage: '電灯・動力', trConnection: 'tr-vv' }).includes('trCapacity')) fail('必須の扱いが違います');
  // 図面の文字
  const lbl = (a: Answers) => buildComposition({ ...answers, transformerCount: 1, ...a }).find((i) => i.role === 'transformer')?.label ?? [];
  const m = lbl({ trUsage: '電灯・動力', trConnection: 'tr-vv', trCapacityLight: 30, trCapacityPower: 50, trVoltage: '6600V/210-105V', trComposition: '' });
  const wantM = ['Tr', '電灯 30kVA', '動力 50kVA', '6600V/210-105V'];
  if (JSON.stringify(m) !== JSON.stringify(wantM)) fail(`電灯および動力のV結線の文字が違います（${m.join(' / ')}）`);
  else console.log(`  図面の文字（電灯および動力・V結線）：${m.join(' / ')}`);
  const only = lbl({ trUsage: '電灯・動力', trConnection: 'tr-vv', trCapacityLight: 30, trVoltage: '', trComposition: '' });
  if (JSON.stringify(only) !== JSON.stringify(['Tr', '電灯 30kVA'])) fail(`動力が未入力のとき：${only.join(' / ')}`);
  const lightV = lbl({ trUsage: '電灯', trConnection: 'tr-vv', trCapacity: 30, trCapacity2: 30, trVoltage: '', trComposition: '' });
  if (JSON.stringify(lightV) !== JSON.stringify(['電灯', 'Tr', '1φ30kVA / 1φ30kVA'])) fail(`電灯のV結線の文字が、これまでと違います（${lightV.join(' / ')}）`);
  else console.log(`  電灯のみのV結線の文字は、これまでどおり：${lightV.join(' / ')}`);
  const mixed3p = lbl({ trUsage: '電灯・動力', trConnection: 'tr-3p-dy', trCapacity: 300, trVoltage: '', trComposition: '' });
  console.log(`  電灯および動力の三相の文字：${mixed3p.join(' / ')}`);
}

console.log('\n■ 主遮断装置「それ以外（高圧マンション・電柱上構成）」と、ヒューズの選択肢');
{
  const ids = new Set(QUESTIONS.map((q) => q.id));
  if (ids.has('isHighRiseApartment')) fail('「高圧マンションで、電柱上に受電設備が構成されていますか？」の質問が残っています');
  const shown = new Set(visibleQuestions({ mainBreakerForm: 'pole-top' }, {}).map((q) => q.id));
  const receiving = [...shown].filter((id) => QUESTIONS.find((q) => q.id === id)?.group === 'receiving');
  if (shown.has('isHighRiseApartment')) fail('電柱上構成を選んだのに、追加の質問が出ています');
  else console.log(`  電柱上構成を選んだとき、「電柱上に構成されていますか？」とは聞かない（そのまま電柱上として扱う）。出る質問：${receiving.join('・')}`);
  const opts = (id: string) => QUESTIONS.find((q) => q.id === id)?.options?.map((o) => o.value) ?? [];
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  const pcFuse = ['5A', '7.5A', '10A', '12.5A', '15A', '20A', '25A', '30A', '50A', '60A', '75A', '100A'];
  const pcBody = ['30A', '50A', '100A'];
  const pf = ['5A', '7.5A', '10A', '15A', '20A', '30A', '40A', '50A', '60A', '75A', '100A'];
  for (const prefix of ['tr', 'cap']) {
    if (!same(opts(`${prefix}PcRating`), pcBody)) fail(`${prefix}：PC本体の定格電流の選択肢が違います（${opts(`${prefix}PcRating`).join('・')}）`);
    for (const id of [`${prefix}PcRating`, `${prefix}PcFuse`]) {
      const q = QUESTIONS.find((x) => x.id === id);
      if (q?.type !== 'select' || !q.allowFreeInput) fail(`${id}：一覧から選べて、手入力もできる形ではありません`);
    }
    // PCに使うのは「パワーヒューズ」ではなく「ヒューズ」
    if (/パワーヒューズ/.test(QUESTIONS.find((x) => x.id === `${prefix}PcFuse`)?.label ?? '')) fail(`${prefix}：PCの項目名に「パワーヒューズ」が使われています`);
    if (!same(opts(`${prefix}PcFuse`), pcFuse)) fail(`${prefix}：PCのヒューズの選択肢が違います（${opts(`${prefix}PcFuse`).join('・')}）`);
    if (!same(opts(`${prefix}PfG`), pf)) fail(`${prefix}：LBSのパワーヒューズの選択肢が違います（${opts(`${prefix}PfG`).join('・')}）`);
    if (opts(`${prefix}PfG`).includes('150A')) fail(`${prefix}：パワーヒューズに150Aが残っています`);
  }
  console.log(`  PC本体：${pcBody.join(' / ')}（手入力もできる）`);
  console.log(`  PCのヒューズ：${pcFuse.join(' / ')}（手入力もできる）`);
  console.log(`  LBSのパワーヒューズ：${pf.join(' / ')}（150Aは無し）`);
  // 図面には、PC本体は「50A」、ヒューズは「F:」から始めて書く
  const pcLabel = buildComposition({ ...answers, transformerCount: 1, trHasPc: 'yes', trPcRating: '50A', trPcFuse: '12.5A' }).find((i) => i.role === 'tr-pc')?.label.join('|');
  if (pcLabel !== '50A|F:12.5A') fail(`PCの図面の文字が違います（${pcLabel}）`);
  else console.log(`  図面の文字：${pcLabel}`);
}

console.log('\n■ 受電設備エリア：高圧マンション（電柱上構成）');
{
  const form = QUESTIONS.find((q) => q.id === 'areaForm');
  const vals = form?.options?.map((o) => o.value) ?? [];
  if (JSON.stringify(vals) !== JSON.stringify(['cubicle', 'room-cubicle', 'room-open', 'apartment-pole'])) {
    fail(`形態の選択肢が違います（${vals.join('・')}）`);
  } else console.log(`  形態の選択肢：${form?.options?.map((o) => o.label).join(' ／ ')}`);
  const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  if (shown({ areaForm: 'apartment-pole' }).has('areaPlacement')) fail('高圧マンションなのに、設置場所の質問が出ています');
  else if (!shown({ areaForm: 'cubicle' }).has('areaPlacement') || !shown({}).has('areaPlacement')) fail('高圧マンション以外で、設置場所の質問が出ません');
  else console.log('  設置場所の質問：高圧マンションのときは出ない（電柱上に決まる）。ほかの形態・未入力のときは聞く');
  // 必須の設置場所が、高圧マンションのときは「未入力」にならない
  const miss = (a: Answers) => missingRequired(a).some((q) => q.id === 'areaPlacement');
  if (miss({ areaForm: 'apartment-pole' }) || !miss({ areaForm: 'cubicle' })) fail('設置場所の「必須」の扱いが違います');
  // 図面のラベルと名前
  const label = String(withDerived({ areaForm: 'apartment-pole', areaPlacement: 'outdoor' }).areaLabel);
  const label2 = String(withDerived({ areaForm: 'apartment-pole', areaFloor: '2階' }).areaLabel);
  if (label !== '高圧マンション（電柱上）') fail(`ラベルが「${label}」です（以前の設置場所の回答が残っていても、電柱上になるはず）`);
  else console.log(`  図面のラベル：「${label}」（以前の設置場所の回答が残っていても電柱上）／ 階層ありなら「${label2}」`);
  const nm = resolveDrawingName({ areaCount: 1, areaForm: 'apartment-pole' });
  const nm2 = resolveDrawingName({ areaCount: 2, areaForm: 'apartment-pole', areaForm__2: 'cubicle' });
  if (nm !== '高圧受電設備単線結線図' || nm2 !== '高圧受電設備単線結線図') fail(`図面名称が違います（${nm} ／ ${nm2}）`);
  else console.log(`  図面名称：「${nm}」（「〜式」は付けない）`);
}

console.log('\n■ 区分開閉器の定格電圧');
{
  const q = QUESTIONS.find((x) => x.id === 'pasRatedVoltage');
  const vals = q?.options?.map((o) => o.value) ?? [];
  if (q?.type !== 'select' || !q.dropdown || JSON.stringify(vals) !== JSON.stringify(['3300', '6600', '7200', '22000'])) {
    fail(`区分開閉器の定格電圧が、3300・6600・7200・22000のドロップダウンになっていません（${q?.type}／${vals.join('・')}）`);
  } else console.log('  ドロップダウン（3300V／6600V／7200V／22000V）');
  // 選んだ値が、図面の「PAS 22000V200A」のように書かれる
  for (const v of ['3300', '6600', '7200', '22000']) {
    const t = String(withDerived({ sectionalizer: 'pas', pasRatedVoltage: v, pasRatedCurrent: '200' }).pasRatingText);
    if (t !== `${v}V${200}A`) fail(`定格 ${v}V の書き方が違います（${t}）`);
  }
  console.log('  図面の書き方：7200V200A／22000V200A のように、選んだ電圧が書かれる');
}

console.log('\n■ 引込ケーブル（埋設・架空・なし）と定格電圧');
{
  const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  const detail = ['cableStructure', 'cableVoltage', 'cableCrossSection', 'cableLength'];
  for (const [name, ans, expectShown] of [
    ['埋設', { cableInstallation: 'buried' }, true],
    ['架空', { cableInstallation: 'overhead' }, true],
    ['なし', { cableInstallation: 'none' }, false],
    ['まだ答えていない', {}, true],
  ] as [string, Answers, boolean][]) {
    const ids = shown(ans);
    const bad = detail.filter((id) => ids.has(id) !== expectShown);
    if (!ids.has('cableInstallation')) fail(`${name}：引込ケーブルの質問そのものが出ません`);
    else if (bad.length) fail(`${name}：ケーブルの詳細の質問が${expectShown ? '出ない' : '出てしまう'}（${bad.join('・')}）`);
    else console.log(`  ${name}：構造・定格電圧・断面積・長さの質問を${expectShown ? '聞く' : '聞かない'}`);
  }
  const opts = QUESTIONS.find((q) => q.id === 'cableInstallation')?.options?.map((o) => o.value) ?? [];
  if (JSON.stringify(opts) !== JSON.stringify(['buried', 'overhead', 'none'])) fail(`付設方法の選択肢が違います（${opts.join('・')}）`);
  const volt = QUESTIONS.find((q) => q.id === 'cableVoltage');
  const vOpts = volt?.options?.map((o) => o.value) ?? [];
  if (volt?.type !== 'select' || !volt.dropdown || JSON.stringify(vOpts) !== JSON.stringify(['3300', '6600', '22000'])) {
    fail(`定格電圧が、3300・6600・22000のドロップダウンになっていません（${volt?.type}／${vOpts.join('・')}）`);
  } else console.log('  定格電圧：ドロップダウン（3300V／6600V／22000V）。初期値は6600V');
  const rv = QUESTIONS.find((q) => q.id === 'receivingVoltage');
  const rvOpts = rv?.options?.map((o) => o.value) ?? [];
  if (rv?.type !== 'select' || !rv.dropdown || JSON.stringify(rvOpts) !== JSON.stringify(['3300', '6600', '22000']) || rv.defaultValue !== '6600') {
    fail(`受電電圧が、3300・6600・22000のドロップダウン（初期値6600）になっていません（${rv?.type}／${rvOpts.join('・')}／${String(rv?.defaultValue)}）`);
  } else console.log('  受電電圧：ドロップダウン（3300V／6600V／22000V）。初期値は6600V');
  // 古い案件の数値（6600）も、ケーブルの注記にそのまま出る
  const spec = String(withDerived({ cableVoltage: 6600, cableCrossSection: '38', cableLength: 14 }).cableSpecLine);
  const spec2 = String(withDerived({ cableVoltage: '22000', cableCrossSection: '38', cableLength: 14 }).cableSpecLine);
  if (spec !== '6600V 38mm2 14m' || spec2 !== '22000V 38mm2 14m') fail(`注記が違います（${spec} ／ ${spec2}）`);
  else console.log(`  ケーブルの注記：${spec}（数値でも文字でも同じ）／ ${spec2}`);
}

console.log('\n■ 図面名称（受電設備の形態から自動で決まる）');
{
  const cases: [string, Answers, string][] = [
    ['キュービクル式', { areaCount: 1, areaForm: 'cubicle' }, 'キュービクル式高圧受電設備単線結線図'],
    ['電気室（内にキュービクル）', { areaCount: 1, areaForm: 'room-cubicle' }, 'キュービクル式高圧受電設備単線結線図'],
    ['オープンフレーム式', { areaCount: 1, areaForm: 'room-open' }, 'オープンフレーム式高圧受電設備単線結線図'],
    ['形態がまだ未入力', { areaCount: 1 }, 'キュービクル式高圧受電設備単線結線図'],
    ['2か所ともオープンフレーム式', { areaCount: 2, areaForm: 'room-open', areaForm__2: 'room-open' }, 'オープンフレーム式高圧受電設備単線結線図'],
    ['キュービクル式と電気室の中のキュービクル', { areaCount: 2, areaForm: 'cubicle', areaForm__2: 'room-cubicle' }, 'キュービクル式高圧受電設備単線結線図'],
    ['形態が混在（キュービクル式とオープンフレーム式）', { areaCount: 2, areaForm: 'cubicle', areaForm__2: 'room-open' }, '高圧受電設備単線結線図'],
    ['3か所のうち3か所目だけ違う', { areaCount: 3, areaForm: 'room-open', areaForm__2: 'room-open', areaForm__3: 'cubicle' }, '高圧受電設備単線結線図'],
    ['2か所目が未入力（1か所目だけで決める）', { areaCount: 2, areaForm: 'room-open' }, 'オープンフレーム式高圧受電設備単線結線図'],
    ['図面名称に書いてあれば、それを優先', { areaCount: 1, areaForm: 'room-open', drawingName: '特別な名称' }, '特別な名称'],
    ['図面名称が空白だけなら、形態から決める', { areaCount: 1, areaForm: 'room-open', drawingName: '  ' }, 'オープンフレーム式高圧受電設備単線結線図'],
  ];
  for (const [name, ans, want] of cases) {
    const got = resolveDrawingName(ans);
    if (got !== want) fail(`${name}：「${got}」になっています（期待：「${want}」）`);
    else console.log(`  ${name}：${got}`);
  }
}

console.log('\n■ 編集画面で記号を足したときの文字（定格電圧・定格電流などの入力欄）');
{
  const withLines = SYMBOLS.filter((d) => d.labelLines);
  for (const d of withLines) {
    const keys = new Set((d.fields ?? []).map((f) => f.key));
    const used = [...new Set((d.labelLines ?? []).flatMap((l) => [...l.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))];
    const unknown = used.filter((k) => !keys.has(k));
    if (unknown.length > 0) fail(`${d.id}：文字の雛形に、入力欄のない項目 ${unknown.join('、')} があります`);
    const blank = fillLabelLines(d, initialLabelValues(d));
    if (blank.length === 0) fail(`${d.id}：足した直後に何も書かれません`);
    if (blank.some((l) => l.includes('{'))) fail(`${d.id}：足した直後の文字に {…} が残っています`);
    if (labelFields(d).length !== used.length) fail(`${d.id}：入力欄の数が雛形と合いません`);
  }
  // 定格電圧・定格電流の入力欄を持つ記号は、すべて雛形も持っている（足しても空白のままにしない）
  for (const d of SYMBOLS) {
    const rated = (d.fields ?? []).some((f) => f.key === 'ratedVoltage' || f.key === 'ratedCurrent');
    if (rated && !d.labelLines) fail(`${d.id}：定格の入力欄があるのに、足したときの文字の雛形がありません`);
  }
  const at = (id: string, v: Record<string, string>) => fillLabelLines(findSymbol(id)!, { ...initialLabelValues(findSymbol(id)!), ...v });
  const rows: [string, string[], string[]][] = [
    ['PC（足した直後）', at('pc', {}), ['PC', '7200V', 'A', 'F:A']],
    ['PC（数字を入れたあと）', at('pc', { ratedCurrent: '100', fuseCurrent: '50' }), ['PC', '7200V', '100A', 'F:50A']],
    ['DS（足した直後）', at('ds', {}), ['DS', '7200V', 'A']],
    ['LBS（PF付）', at('lbs-pf', { ratedCurrent: '200', fuseSpec: '7200V G50A T40A' }), ['LBS', '7200V', '200A', 'PF×3', '7200V G50A T40A']],
    ['変圧器（用途を選ぶと、日本語で書く）', at('tr-3p-dy', { usage: 'light', capacity: '100' }), ['電灯', 'Tr', '3φ100kVA']],
    ['CT（変流比が空なら、記号名だけ）', at('ct', {}), ['CT']],
    ['VT（変圧比は 6600/110V が最初から）', at('vt', {}), ['VT', '6600/110V']],
  ];
  for (const [name, got, want] of rows) {
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${name}：「${got.join(' / ')}」になっています（期待：「${want.join(' / ')}」）`);
    else console.log(`  ${name}：${got.join(' / ')}`);
  }
  console.log(`  雛形のある記号：${withLines.length}種類`);
}

console.log('\n■ 引込点のジグザグ記号の大きさ（以前：横40×縦32 → 横1.5倍・縦0.8倍）');
{
  const d = findSymbol('incoming-point');
  const lines = (d?.shapes ?? []).filter((x) => x.k === 'line') as { x1: number; y1: number; x2: number; y2: number }[];
  const zig = lines.filter((l) => l.x1 !== l.x2);
  const xs = zig.flatMap((l) => [l.x1, l.x2]);
  const ys = zig.flatMap((l) => [l.y1, l.y2]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const close = (a: number, b: number) => Math.abs(a - b) < 0.05;
  if (!close(w, 60)) fail(`ジグザグの横幅が ${w} です（以前の40の1.5倍＝60のはず）`);
  if (!close(h, 25.6)) fail(`ジグザグの縦の長さが ${h} です（以前の32の0.8倍＝25.6のはず）`);
  const center = (Math.max(...xs) + Math.min(...xs)) / 2;
  if (!d || d.ports.some((p) => p.x !== center)) fail('ジグザグの中心と、接続点の位置が合っていません');
  if (close(w, 60) && close(h, 25.6)) console.log(`  横${w}（左右に${w / 2}ずつ）× 縦${h}`);
}

console.log('\n■ 受電設備エリアごとの入力（2か所以上のとき）');
{
  const ids = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  const two: Answers = {
    areaCount: 2, mainBreakerForm: 'cb', trUsage: '動力', trConnection: 'tr-3p-yd', trCapacity: 300,
    'a2:areaIntake': 'lbs-pf', 'a2:trUsage': '電灯', 'a2:trCapacity': 50, 'a2:hasCapacitor': 'yes',
  };
  const v1 = areaView(two, 0);
  const v2 = areaView(two, 1);
  const ok = (cond: boolean, msg: string) => (cond ? undefined : fail(msg));
  ok(v1 === two, '1か所目の答えが、そのまま使われていません');
  ok(v2.trUsage === '電灯' && v2.trCapacity === 50, '2か所目の答えが、ふつうのキーに直っていません');
  ok(v2.mainBreakerForm === undefined && v2.trConnection === undefined, '1か所目の答えが、2か所目に入り込んでいます');
  ok(v2.areaNo === 2 && v2.areaIntake === 'lbs-pf', '2か所目の番号・受電側の開閉器が入っていません');
  ok(Number(v2.transformerCount) === 1 && v2.trHasPc === 'no', '2か所目の、まだ答えていない質問が、既定値になっていません');
  ok(areaKey('trCapacity', 0) === 'trCapacity' && areaKey('trCapacity__2', 2) === 'a3:trCapacity__2', 'エリアのキーの付け方が違います');
  const a1 = ids(v1);
  const a2 = ids(v2);
  ok(a1.has('mainBreakerForm') && !a1.has('areaIntake') && !a1.has('linkTap'), '1か所目に、主遮断装置の形式だけが出ていません');
  ok(!a2.has('mainBreakerForm') && a2.has('areaIntake') && a2.has('linkCable') && a2.has('linkTap'), '2か所目に、受電側の開閉器とエリア間の接続が出ていません');
  // 受電側の開閉器で、聞くことが変わる
  const intakeQs = (kind: string) => ids(areaView({ areaCount: 2, 'a2:areaIntake': kind }, 1));
  ok(intakeQs('lbs-pf').has('lbsRatedCurrent') && intakeQs('lbs-pf').has('lbsFuseCount') && !intakeQs('lbs-pf').has('dsRating'), 'LBS（PF付）のとき、LBSの定格だけを聞いていません');
  ok(intakeQs('lbs').has('lbsRatedCurrent') && !intakeQs('lbs').has('lbsFuseCount'), 'LBS（PFなし）のとき、ヒューズの質問が出ています');
  ok(intakeQs('vcb').has('vcbRating') && !intakeQs('vcb').has('dsRating') && intakeQs('vcb').has('hasSiteVt'), 'VCBのみのとき、VCBの定格だけを聞いて、VTの有無を聞いていません');
  ok(intakeQs('ds-vcb').has('dsRating') && intakeQs('ds-vcb').has('vcbRating') && intakeQs('ds-vcb').has('vtRatio') && !intakeQs('ds-vcb').has('hasSiteVt'), 'DS＋VCBのとき、標準構成の質問になっていません');
  ok(intakeQs('none').has('hasSiteVt') && !intakeQs('none').has('dsRating') && !intakeQs('none').has('lbsRatedCurrent'), '開閉器なしのとき、開閉器の質問が出ています');
  // 2か所目以降は、分岐元のエリアを選べる（3か所目から）。分岐の位置も、選ぶ
  const link2 = ids(areaView({ areaCount: 3 }, 1));
  const link3 = ids(areaView({ areaCount: 3 }, 2));
  ok(!link2.has('linkFrom') && link3.has('linkFrom'), '分岐元のエリアは、3か所目から選べるはずです');
  const from = QUESTIONS.find((q) => q.id === 'linkFrom');
  const fromOpts = (n: number) => (from?.options ?? []).filter((o) => evaluate(o.showIf, { areaNo: n })).map((o) => o.value).join(',');
  ok(fromOpts(3) === '1,2' && fromOpts(2) === '1', `分岐元の選択肢が違います（3か所目：${fromOpts(3)}）`);
  const tap = QUESTIONS.find((q) => q.id === 'linkTap')?.options?.map((o) => o.value).join(',');
  ok(tap === 'ds-source,ds-vcb,vcb-load,bus', `分岐の位置の選択肢が違います（${tap}）`);
  ok(!ids(areaView({ areaCount: 2, 'a2:linkCable': 'no' }, 1)).has('linkTap'), '「つながない」なのに、分岐の位置を聞いています');
  // 自動入力・選択肢の整理は、エリアごと
  const auto = withAutoValues({ receivingVoltage: '6600', ...two });
  ok(auto['a2:trConnection'] === 'tr-1p' && auto['a2:trVoltage'] === '6600/210-105V', '2か所目の変圧器の初期値が、2か所目の用途で決まっていません');
  ok(auto.trConnection === 'tr-3p-yd', '1か所目の結線方式が、2か所目の用途に引きずられています');
  const dropped = dropHiddenChoices({ areaCount: 2, 'a2:trUsage': '電灯', 'a2:trConnection': 'tr-3p-dy', trUsage: '動力', trConnection: 'tr-3p-dy' });
  ok(dropped['a2:trConnection'] === undefined && dropped.trConnection === 'tr-3p-dy', '2か所目の、選べなくなった結線方式だけが外れるはずです');
  // 1か所だけの案件は、これまでどおり（キーも付けない）
  const one = withAutoValues({ receivingVoltage: '6600', trUsage: '動力' });
  ok(one.trConnection === 'tr-3p-yd' && !Object.keys(one).some((k) => /^a\d+:/.test(k)), '1か所の案件の初期値が、変わっています');
  // 以前の案件（1か所）の、主遮断装置のあとの質問は、これまでと同じ
  const pfs = ids({ mainBreakerForm: 'pfs' });
  const cbq = ids({ mainBreakerForm: 'cb' });
  ok(pfs.has('lbsRatedCurrent') && pfs.has('lbsFuseCount') && pfs.has('hasSiteVt') && !pfs.has('dsRating') && !pfs.has('vtRatio'), 'PFS形（1か所）の質問が、これまでと違います');
  ok(cbq.has('dsRating') && cbq.has('vcbRating') && cbq.has('vtRatio') && cbq.has('ctRatio') && !cbq.has('hasSiteVt') && !cbq.has('lbsRatedCurrent'), 'CB形（1か所）の質問が、これまでと違います');
  console.log('  2か所目の答えは「a2:〜」で別に持ち、1か所目・以前の案件とは混ざらない');
  console.log('  受電側の開閉器（DS＋VCB／VCBのみ／LBS（PF付）／LBS／DSのみ／なし）で、聞く質問が変わる');
  console.log('  エリア間の接続：ケーブルの有無・分岐元（3か所目から）・分岐の位置・ケーブルの記載');
}

console.log('\n■ 受電設備エリアが2か所以上のときの構成（エリアごとの機器・エリア間のケーブル）');
{
  const ok = (cond: boolean | undefined, msg: string) => (cond ? undefined : fail(msg));
  const multi: Answers = {
    ...answers,
    areaCount: 3,
    areaForm: 'cubicle', areaPlacement: 'outdoor',
    areaForm__2: 'room-open', areaPlacement__2: 'indoor', areaFloor__2: '1階',
    areaForm__3: 'cubicle', areaPlacement__3: 'rooftop',
    // 2か所目：LBS（PF付）で受ける。変圧器2台。1か所目の1か所目から母線で分岐、埋設ケーブル
    'a2:areaIntake': 'lbs-pf', 'a2:lbsRatedVoltage': '7200', 'a2:lbsRatedCurrent': 200, 'a2:lbsFuseCount': 3,
    'a2:linkCable': 'yes', 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried', 'a2:linkCableStructure': 'CVT',
    'a2:linkCableCrossSection': '38', 'a2:linkCableLength': 20,
    'a2:transformerCount': 2, 'a2:trConnection': 'tr-3p-dy', 'a2:trCapacity': 100, 'a2:trCapacity__2': 50, 'a2:trConnection__2': 'tr-3p-dy',
    'a2:hasSiteVt': 'yes', 'a2:hasZpd': 'yes',
    // 3か所目：DSのみで受ける。2か所目から、DSとVCBの間で分岐。変圧器1台
    'a3:areaIntake': 'ds', 'a3:dsRating': '7200V 200A', 'a3:linkFrom': '2', 'a3:linkTap': 'ds-vcb',
    'a3:trConnection': 'tr-3p-yd', 'a3:trCapacity': 75,
  };
  const all = buildComposition(multi);
  const firstArea = all.filter((i) => i.area === undefined);
  const baseline = buildComposition({ ...answers, areaCount: 1 });
  ok(JSON.stringify(firstArea) === JSON.stringify(baseline), '2か所以上でも、1か所目の機器は、1か所だけのときと同じはずです');
  ok(new Set(all.map((i) => i.id)).size === all.length, '機器のIDが重複しています');
  const a2 = all.filter((i) => i.area === 1);
  const a3 = all.filter((i) => i.area === 2);
  ok(a2.length > 0 && a2.every((i) => i.role.startsWith('a2:') && i.id.startsWith('a2:')), '2か所目の機器の役割に「a2:」が付いていません');
  ok(a3.length > 0 && a3.every((i) => i.role.startsWith('a3:')), '3か所目の機器の役割に「a3:」が付いていません');
  const role = (list: typeof all, r: string) => list.find((i) => i.role === r);
  // 2か所目：LBS（PF付）
  ok(role(a2, 'a2:main-breaker')?.symbolId === 'lbs-pf', '2か所目の受電側がLBS（PF付）になっていません');
  ok(role(a2, 'a2:main-breaker')?.label.join('|') === 'LBS|7200V|200A|PF×3', `2か所目のLBSの文字：${role(a2, 'a2:main-breaker')?.label.join('|')}`);
  ok(!role(a2, 'a2:ds') && !role(a2, 'a2:ct-test-terminal'), '2か所目（LBS）に、DS・試験端子が入っています');
  ok(role(a2, 'a2:site-vt')?.kind === 'branch-right' && Boolean(role(a2, 'a2:zpd')) && Boolean(role(a2, 'a2:ovgr')), '2か所目のVT・ZPD・OVGRが入っていません');
  ok(role(a2, 'a2:area-frame')?.label[0]?.startsWith('オープンフレーム式'), `2か所目の枠の文字：${role(a2, 'a2:area-frame')?.label[0]}`);
  const link2 = role(a2, 'a2:link');
  ok(link2?.kind === 'link' && link2.link?.from === 0 && link2.link.tap === 'bus' && link2.link.dashed === true, '2か所目のつなぎ方（1か所目の高圧母線から・埋設）が違います');
  ok(link2?.label.join('|') === '埋ケ|CVT|38mm2 20m', `2か所目のケーブルの文字：${link2?.label.join('|')}`);
  const trs2 = a2.filter((i) => i.role === 'a2:transformer');
  ok(trs2.length === 2 && trs2.map((t) => t.lane).join() === '0,1', `2か所目の変圧器：${trs2.length}台・列 ${trs2.map((t) => t.lane).join(',')}（2台・列0,1のはず）`);
  ok(trs2[0]!.label.join('|').includes('3φ100kVA') && trs2[1]!.label.join('|').includes('3φ50kVA'), '2か所目の変圧器の容量が、台ごとに入っていません');
  // 3か所目：DSのみ。2か所目から分岐
  ok(Boolean(role(a3, 'a3:ds')) && !role(a3, 'a3:main-breaker') && !role(a3, 'a3:ct'), '3か所目（DSのみ）の受電側が違います');
  const link3 = role(a3, 'a3:link');
  ok(link3?.link?.from === 1 && link3.link.tap === 'ds-vcb' && link3.link.dashed === false, '3か所目のつなぎ方（2か所目のDSとVCBの間から）が違います');
  ok(a3.filter((i) => i.role === 'a3:transformer').length === 1, '3か所目の変圧器が1台になっていません');
  // 受電側の開閉器ごとの機器
  const intake = (kind: string, extra: Answers = {}) =>
    buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': kind, ...extra }).filter((i) => i.area === 1).map((i) => i.role.replace('a2:', ''));
  const std = intake('ds-vcb');
  ok(['ds', 'ds-vt-pf', 'ds-vt', 'main-breaker', 'ct', 'ct-test-terminal', 'ocr'].every((r) => std.includes(r)), `DS＋VCBの標準構成が揃っていません（${std.join(',')}）`);
  const vcbOnly = intake('vcb');
  ok(vcbOnly.includes('main-breaker') && !vcbOnly.includes('ds') && !vcbOnly.includes('ct') && !vcbOnly.includes('ocr'), `VCBのみ（CTなし）：${vcbOnly.join(',')}`);
  const vcbCt = intake('vcb', { 'a2:hasSiteCt': 'yes' });
  ok(vcbCt.includes('ct') && vcbCt.includes('ocr') && vcbCt.includes('ct-test-terminal'), `VCBのみ（CTあり）：${vcbCt.join(',')}`);
  const lbsPlain = buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'lbs' }).find((i) => i.role === 'a2:main-breaker');
  ok(lbsPlain?.symbolId === 'lbs', 'LBS（PFなし）が、PFなしのLBSの記号になっていません');
  const none = intake('none');
  ok(!none.includes('ds') && !none.includes('main-breaker') && none.includes('area-frame') && none.includes('link'), `開閉器なし：${none.join(',')}`);
  // つながないとき
  const noLink = buildComposition({ ...answers, areaCount: 2, 'a2:linkCable': 'no' }).find((i) => i.role === 'a2:link');
  ok(!noLink, '「つながない」のに、ケーブルが入っています');
  // 以前の案件（エリア1か所・キーに a2: なし）は、機器の数も同じ
  ok(baseline.every((i) => i.area === undefined), '1か所の案件に、エリアの印が付いています');
  // 未回答の必須項目は、「2か所目：」を付けて知らせる
  const miss = missingRequired({ areaCount: 2, mainBreakerForm: 'cb', areaForm: 'cubicle', areaPlacement: 'indoor', trConnection: 'tr-3p-dy', trCapacity: 1 }).map((q) => q.label);
  ok(miss.some((l) => l.startsWith('2か所目：')), `2か所目の未回答が、知らされていません（${miss.join(' / ')}）`);
  console.log(`  1か所目は、1か所だけのときと同じ。2か所目 ${a2.length}件・3か所目 ${a3.length}件が、「a2:」「a3:」の役割で続く`);
  console.log('  2か所目：LBS（PF付）・VT・ZPD・変圧器2台、1か所目の母線から埋設ケーブル。3か所目：DSのみ、2か所目のDSとVCBの間から');
  console.log('  受電側の開閉器ごとの機器：DS＋VCB（標準）／VCBのみ／LBS／DSのみ／なし');
}

console.log('\n■ 設備容量と主遮断装置の形式（エリアが複数あるときは、すべてのエリアの合計）');
{
  const msgs = (a: Answers) => checkConsistency(a).filter((i) => i.questionId === 'mainBreakerForm').map((i) => `${i.level}:${i.value}`);
  const one = { mainBreakerForm: 'pfs', trCapacity: 280, transformerCount: 1 };
  const okOne = msgs(one).length === 0;
  const bad2 = msgs({ ...one, areaCount: 2, 'a2:trCapacity': 100, 'a2:transformerCount': 1 });
  const cb2 = msgs({ mainBreakerForm: 'cb', trCapacity: 100, transformerCount: 1, areaCount: 2, 'a2:trCapacity': 100 });
  const cbUnknown = msgs({ mainBreakerForm: 'cb', trCapacity: 100, transformerCount: 1, areaCount: 2 });
  const cbOne = msgs({ mainBreakerForm: 'cb', trCapacity: 100, transformerCount: 1 });
  if (!okOne) fail('1か所で280kVA・PFS形に、指摘が出ています');
  if (!bad2.includes('error:PFS形')) fail(`1か所目280＋2か所目100＝380kVAなのに、PFS形が誤りと指摘されていません（${bad2.join(',')}）`);
  if (!cb2.includes('confirm:CB形')) fail(`合計200kVAなのに、CB形の確認が出ていません（${cb2.join(',')}）`);
  if (cbUnknown.length > 0) fail(`2か所目の容量が未入力のときは、「PFS形も選べます」とは言えません（${cbUnknown.join(',')}）`);
  if (!cbOne.includes('confirm:CB形')) fail('1か所で100kVA・CB形の確認が、これまでどおり出ていません');
  console.log('  1か所目280kVA＋2か所目100kVA＝380kVA → PFS形は誤り。合計200kVA → CB形は確認。2か所目の容量が未入力のときは、「選べる」とは言わない');
}

console.log('\n■ 変圧器の初期値の自動入力（用途→結線方式→電圧、受電電圧との連動）');
{
  const auto = (a: Answers) => withAutoValues({ receivingVoltage: '6600', ...a });
  const rows: [string, Answers, Record<string, unknown>][] = [
    ['電灯 → 単相三線式・6600/210-105V', { trUsage: '電灯' }, { trConnection: 'tr-1p', trVoltage: '6600/210-105V' }],
    ['動力 → Y-Δ結線・6600/210V', { trUsage: '動力' }, { trConnection: 'tr-3p-yd', trVoltage: '6600/210V' }],
    ['電灯および動力 → V結線・6600/210-105V', { trUsage: '電灯・動力' }, { trConnection: 'tr-vv', trVoltage: '6600/210-105V' }],
    ['結線方式を自分で選んだら、それを優先（電圧は6600/だけ）', { trUsage: '動力', trConnection: 'tr-3p-dy' }, { trConnection: 'tr-3p-dy', trVoltage: '6600/' }],
    ['結線方式を単相に変えると、電圧も変わる', { trUsage: '動力', trConnection: 'tr-1p' }, { trVoltage: '6600/210-105V' }],
    ['用途が未入力でも、電圧は「6600/」が入る', {}, { trVoltage: '6600/' }],
    ['自分で書いた電圧は、そのまま', { trUsage: '電灯', trVoltage: '6600V/210-105V' }, { trVoltage: '6600V/210-105V' }],
    ['電圧を空にしたら、空のまま（また自動で入らない）', { trUsage: '電灯', trVoltage: '' }, { trVoltage: '' }],
    ['受電電圧が6600V以外のときは、電圧を自動で入れない', { receivingVoltage: '22000', trUsage: '電灯' }, { trVoltage: undefined, trConnection: 'tr-1p' }],
    ['受電電圧が数（6600）で入っていても同じ', { receivingVoltage: 6600, trUsage: '動力' }, { trVoltage: '6600/210V' }],
    [
      '2台目以降は、その台の用途で決まる',
      { transformerCount: 2, trUsage: '電灯', trUsage__2: '動力' },
      { trConnection: 'tr-1p', trVoltage: '6600/210-105V', trConnection__2: 'tr-3p-yd', trVoltage__2: '6600/210V' },
    ],
    ['2台目の用途が未入力でも、電圧は「6600/」が入る', { transformerCount: 2, trUsage: '電灯' }, { trVoltage__2: '6600/' }],
  ];
  for (const [name, input, want] of rows) {
    const got = auto(input);
    const bad = Object.entries(want).filter(([k, v]) => got[k] !== v);
    if (bad.length > 0) fail(`${name}：${bad.map(([k, v]) => `${k}=${JSON.stringify(got[k])}（期待：${JSON.stringify(v)}）`).join('、')}`);
    else console.log(`  ${name}`);
  }
  // 電圧が「6600/」だけ（後ろが未入力）のときは、図面に書かない。書き終えたものは書く
  {
    const trLabel = (v: string) => buildComposition({ ...answers, trVoltage: v, transformerCount: 1 }).find((i) => i.role === 'transformer')?.label.join('|') ?? '';
    if (trLabel('6600/').includes('6600')) fail('電圧が「6600/」だけなのに、図面に書かれています');
    if (!trLabel('6600/210V').includes('6600/210V')) fail('入力し終えた電圧が、図面に書かれていません');
    console.log('  電圧が「6600/」だけのときは、図面に書かない');
  }
  // 自動で入れた値は、元の回答には書き込まない
  const raw: Answers = { trUsage: '電灯', receivingVoltage: '6600' };
  withAutoValues(raw);
  if (raw.trConnection !== undefined || raw.trVoltage !== undefined) fail('自動で入れた値が、元の回答に書き込まれています');
  // 項目名：LBSの手前・後ろのパワーヒューズの項目
  const lab = (id: string) => QUESTIONS.find((q) => q.id === id)?.label;
  if (lab('trPfG') !== 'パワーヒューズ（PF）の定格電流（G）') fail(`変圧器のPFの項目名が違います（${lab('trPfG')}）`);
  if (lab('trPfLoadAmp') !== 'パワーヒューズの用途ごとの定格電流') fail(`変圧器のPFの用途ごとの項目名が違います（${lab('trPfLoadAmp')}）`);
  // 変圧器の手前も、コンデンサの手前も、すべてのLBSで同じ項目名
  if (lab('capPfG') !== 'パワーヒューズ（PF）の定格電流（G）') fail(`コンデンサのPFの項目名が違います（${lab('capPfG')}）`);
  if (lab('capPfLoadAmp') !== 'パワーヒューズの用途ごとの定格電流') fail(`コンデンサのPFの用途ごとの項目名が違います（${lab('capPfLoadAmp')}）`);
  console.log('  項目名：パワーヒューズ（PF）の定格電流（G）／パワーヒューズの用途ごとの定格電流');
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
