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
  evaluate,
  missingRequired,
  questionsByGroup,
  QUESTIONS,
  referencedKeys,
  normalizeAnswers,
  dropHiddenChoices,
  resolveDrawingName,
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
/** 回答から組み立てる値（質問ではないが、構成ルールから参照してよい） */
const derivedKeys = new Set(Object.keys(withDerived({})));
const known = (key: string) => questionIds.has(key) || derivedKeys.has(key);

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
  const kind =
    { series: '直列', 'branch-left': '左分岐', 'branch-right': '右分岐', inside: '内蔵', frame: '枠', parallel: '並列', feeder: '回線', free: '独立', overlay: '重ね' }[
      item.kind
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
  // 引込元は電柱だけ。電柱かキャビネットかの質問・キャビネットの名称や中身の質問は無い
  const ids = new Set(QUESTIONS.map((q) => q.id));
  for (const gone of ['sourceType', 'cabinetName', 'cabinetContent', 'hasPas']) {
    if (ids.has(gone)) fail(`なくしたはずの質問 ${gone} が残っています`);
  }
  const labels = (id: string) => QUESTIONS.find((q) => q.id === id)?.label;
  if (labels('polePrefix') !== '電柱番号の区分') fail(`「電柱番号の区分」の名前が違います（${labels('polePrefix')}）`);
  else console.log('  引込元：電柱番号の区分 → 電柱の名称 → ASの有無（電柱かキャビネットかの質問は無い）');
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
    if (!q || q.type !== 'select' || q.defaultValue !== '1' || !q.showIf) fail(`${id} の質問が、台数を選ぶ形（初期値1・条件つき）になっていません`);
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
  const pcFuse = ['5A', '7.5A', '10A', '15A', '20A', '25A', '30A', '50A', '75A', '100A'];
  const pf = ['5A', '7.5A', '10A', '15A', '20A', '30A', '40A', '50A', '60A', '75A', '100A'];
  for (const prefix of ['tr', 'cap']) {
    if (!same(opts(`${prefix}PcFuse`), pcFuse)) fail(`${prefix}：PCのヒューズの選択肢が違います（${opts(`${prefix}PcFuse`).join('・')}）`);
    if (!same(opts(`${prefix}PfG`), pf)) fail(`${prefix}：LBSのパワーヒューズの選択肢が違います（${opts(`${prefix}PfG`).join('・')}）`);
    if (opts(`${prefix}PfG`).includes('150A')) fail(`${prefix}：パワーヒューズに150Aが残っています`);
  }
  console.log(`  PCのヒューズ：${pcFuse.join(' / ')}`);
  console.log(`  LBSのパワーヒューズ：${pf.join(' / ')}（150Aは無し）`);
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

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
