/**
 * ナレッジベースの検証（check-knowledge）の1つ目：定義の整合性・実案件の構成・質問の出し分け・CB形・PAS内蔵機器・自動レイアウト・AI解析・区分開閉器など。
 * 共有するものは common.ts。scripts/check-knowledge.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { findSymbol, SYMBOLS } from '../../packages/symbols/src/index.ts';
import { buildComposition, evaluate, missingRequired, questionsByGroup, QUESTIONS, referencedKeys, normalizeAnswers, dropHiddenChoices, suggestMainBreakerForm, visibleQuestions, VIEW_KEYS, withDerived } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, FEEDERS, TRANSFORMER, UPSTREAM } from '../../packages/knowledge/src/composition.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { buildAnalysisSchema, buildReview, buildSystemPrompt } from '../../packages/ai/src/index.ts';
import { fail } from './common.ts';

/* ---------- 1. 定義そのものの整合性 ---------- */
console.log('■ 定義の整合性');
const questionIds = new Set(QUESTIONS.map((q) => q.id));
if (questionIds.size !== QUESTIONS.length) fail('質問IDが重複しています');
/** 回答から組み立てる値（質問ではないが、構成ルールから参照してよい） */
const derivedKeys = new Set(Object.keys(withDerived({ transformerCount: 100 })));
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

export const answers: Answers = {
  siteName: 'カニエ竹原太陽光発電所',
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
  lbsPfG: '50A',
  lbsPfKa: '40kA',
  hasSiteVt: 'yes',
  hasSiteCt: 'yes',
  ctRatio: '40A/5A',
  vtRatio: '6600/110V',
  hasZpd: 'yes',

  transformerCount: 1,
  trUsage: '動力',
  trConnection: 'tr-3p-dy',
  trCapacity: 300,
  trVoltage: '6600/440-254V',

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
    { series: '直列', 'branch-left': '左分岐', 'branch-right': '右分岐', inside: '内蔵', frame: '枠', parallel: '並列', feeder: '回線', free: '独立', overlay: '重ね', link: 'つなぎ', bypass: '並列' }[
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
    // DGRのときは、零相電圧を得るZPDも、PAS・PGSの中に入る（GR・SOGなしでは入らない）
    ['DGR・VTのみ', 'dgr', 'yes', 'no', ['zct', 'vt', 'zpd-pas']],
    // LAも入るときは、外箱の接地は最大1つなので、接地記号の無いZPD（LAの接地を使う）
    ['DGR・VTとLA', 'dgr', 'yes', 'yes', ['zct', 'vt', 'la', 'zpd-pas-boxed']],
    ['DGR・VTなし・LAのみ', 'dgr', 'no', 'yes', ['zct', 'la', 'zpd-pas-boxed']],
    ['DGR・VTなし・LAなし', 'dgr', 'no', 'no', ['zct', 'zpd-pas']],
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
const schema = buildAnalysisSchema() as {
  properties: { answers: { type: string; items: { properties: Record<string, unknown> } } };
};
// 答えは「項目ID＋値」の並びで受け取る（省略できる項目の上限を超えないため）。
// 項目ごとのスキーマは持たないので、指示文に全質問のIDが載っているかを確かめる。
if (schema.properties.answers.type !== 'array') fail('スキーマの answers が並び（配列）になっていません');
const pairKeys = Object.keys(schema.properties.answers.items.properties);
if (!pairKeys.includes('key') || !pairKeys.includes('value')) fail('スキーマの answers に key / value がありません');
const promptForIds = buildSystemPrompt();
const forAi = QUESTIONS.filter((q) => !q.noAi);
for (const q of forAi) {
  if (!promptForIds.includes(`- ${q.id}:`)) fail(`指示文に質問 ${q.id} がありません`);
}
// AIに渡さない項目（noAi）は、指示文に載せない（数が多く、指示文が長くなりすぎるため）
for (const q of QUESTIONS.filter((y) => y.noAi)) {
  if (promptForIds.includes(`- ${q.id}:`)) fail(`AIに渡さない項目 ${q.id} が、指示文に載っています`);
}
console.log(`  読み取り用スキーマ: 項目ID＋値の並び / 指示文に質問${forAi.length}項目（AIに渡さない${QUESTIONS.length - forAi.length}項目を除く）`);

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
// DGRのときは、PASの中にZPDが内蔵されるので、「VT内蔵もZPDも無い」ことは、矛盾として弾かない
const hasDgrError = bad.some((r) => r.label.includes('零相電圧'));
if (!hasCapacityError) fail('500kVAでPFS形という矛盾を検出できませんでした');
if (hasDgrError) fail('DGRなのに「零相電圧源が無い」と弾いています（DGRのときは、PASの中にZPDが内蔵されます）');

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
    // 電柱上の構成には、LBSもVCBも無いので、聞かない（区分開閉器の位置に、財産・責任分界点を1本引く）
    ['3点不一致・主遮断装置が電柱上構成（それ以外）', { boundaryPattern: 'split', mainBreakerForm: 'pole-top' }, false],
  ];
  for (const [name, ans, want] of cases) {
    if (asked(ans) !== want) fail(`${name}：質問を${asked(ans) ? '出して' : '出さずに'}います（期待：${want ? '出す' : '出さない'}）`);
    else console.log(`  ${name}：${want ? '聞く' : '聞かない'}`);
  }
  // AIの読み取り結果の確認事項も、同じ条件にそろえる
  if (reviewAsks({ boundaryPattern: 'split', mainBreakerForm: 'cb' })) fail('CB形なのに、責任分界点の位置を確認事項に出しています');
  if (!reviewAsks({ boundaryPattern: 'split' })) fail('主遮断装置が未入力なのに、責任分界点の位置を確認事項に出していません');
  if (reviewAsks({ boundaryPattern: 'split', mainBreakerForm: 'pole-top' })) fail('電柱上の構成なのに、責任分界点の位置（LBS・VCB）を確認事項に出しています');
  // 「3点一致ですか？」は、電柱上の構成でも出す
  if (!visibleQuestions(withDerived({ mainBreakerForm: 'pole-top' }), {}).some((q) => q.id === 'boundaryPattern')) fail('電柱上の構成で、「3点一致ですか？」が出ていません');
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
  if (labels('poleName') !== '引込元の名称') fail(`「引込元の名称」の名前が違います（${labels('poleName')}）`);
  if (labels('cabinetName') !== 'キャビネット名称') fail(`「キャビネット名称」の名前が違います（${labels('cabinetName')}）`);
  const poleName = QUESTIONS.find((q) => q.id === 'poleName');
  const cabName = QUESTIONS.find((q) => q.id === 'cabinetName');
  if (poleName?.defaultValue !== '中電柱：') fail(`引込元の名称の最初の文字が「中電柱：」ではありません（${poleName?.defaultValue}）`);
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
    if (optLabels !== 'pas=PAS（電柱上）、pgs=PGS（電柱上）、ugs=UGS（キャビネット内）、none=なし') fail(`区分開閉器の選択肢の表示名が違います（${optLabels}）`);
    // UGSのときだけ、UGS用のキャビネット名称を聞き、定格の欄のすぐ上（先頭）に書く
    const ugsAsked = (a: Answers) => visibleQuestions(a, {}).some((q) => q.id === 'ugsCabinetName');
    if (!ugsAsked({ sourceType: 'cabinet' }) || !ugsAsked({ sourceType: 'pole', sectionalizer: 'ugs' })) fail('UGSのとき、UGSのキャビネット名称を聞いていません');
    if (ugsAsked({ sourceType: 'pole', sectionalizer: 'pas' }) || ugsAsked({ sourceType: 'pole', sectionalizer: 'pgs' })) fail('UGSでないのに、UGSのキャビネット名称を聞いています');
    const ugsLines = secLabel({ sourceType: 'cabinet', ugsCabinetName: 'キャビネット番号：地下西3号', pasRatedVoltage: '7200', pasRatedCurrent: '300' })?.label.slice(0, 3).join('|');
    if (ugsLines !== 'キャビネット番号：地下西3号|UGS|7200V 300A') fail(`UGSの文字の並びが違います（${ugsLines}）`);
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
  console.log('  引込元：電柱 → 引込元の名称（「中電柱：」入り）・ASの有無／地上キャビネット → キャビネット名称（「キャビネット番号：」入り）（ASは無し）');
  // 古い回答（hasPas だけ入っている）を読み替える
  const legacyNo = normalizeAnswers({ hasPas: 'no' });
  const legacyYes = normalizeAnswers({ hasPas: 'yes' });
  const both = normalizeAnswers({ hasPas: 'no', sectionalizer: 'pgs' });
  if (legacyNo.sectionalizer !== 'none' || legacyYes.sectionalizer !== 'pas' || both.sectionalizer !== 'pgs') {
    fail('古い回答（hasPas）の読み替えが違います');
  } else console.log('  古い案件の回答（PASの設置：なし／あり）は、区分開閉器の回答（なし／PAS）に読み替える');
}
