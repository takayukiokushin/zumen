/**
 * ナレッジベースの検証（check-knowledge）の2つ目：VT・CT・変圧器・PC・LBS・エリア・引込ケーブル・図面名称・記号を足したときの文字・エリアごとの入力。
 * 共有するものは common.ts。scripts/check-knowledge.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { fillLabelLines, findSymbol, initialLabelValues, labelFields, SYMBOLS } from '../../packages/symbols/src/index.ts';
import { buildComposition, evaluate, missingRequired, QUESTIONS, QUESTION_GROUPS, areaView, areaKey, dropHiddenChoices, resolveDrawingName, viewAt, visibleQuestions, withAutoValues, QUESTION_DEFAULTS, withDerived } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { fail } from './common.ts';
import { answers } from './part1.ts';

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
  const ctLabel = buildComposition({ ...answers, mainBreakerForm: 'cb', ctCount: '1', ctRatio: '100' }).find((i) => i.role === 'ct')?.label ?? [];
  const vtLabel = buildComposition({ ...answers, mainBreakerForm: 'cb', vtRatio: '6600/110V' }).find((i) => i.role === 'ds-vt-pf')?.label ?? [];
  if (JSON.stringify(ctLabel) !== JSON.stringify(['CT', '100/5A'])) fail(`CTの図面の文字が違います（${ctLabel.join(' / ')}）`);
  else console.log(`  図面の文字：CT → ${ctLabel.join(' / ')}、VT → ${vtLabel.join(' / ')}`);
}

console.log('\n■ CT・VTの台数（「CT×2」「VT＋PF×2」）と、受電設備の構成の見出し');
{
  const lab = (a: Answers, role: string) => buildComposition({ ...answers, mainBreakerForm: 'cb', ...a }).find((i) => i.role === role)?.label ?? [];
  const rows: [string, string[], string[]][] = [
    ['CT 1台', lab({ ctCount: '1', ctRatio: '100' }, 'ct'), ['CT', '100/5A']],
    ['CT 台数が未入力（初期値の2台）', lab({ ctCount: undefined, ctRatio: '100' }, 'ct'), ['CT×2', '100/5A']],
    ['CT 2台', lab({ ctCount: '2', ctRatio: '100' }, 'ct'), ['CT×2', '100/5A']],
    ['CT 3台（数）', lab({ ctCount: 3, ctRatio: '100' }, 'ct'), ['CT×3', '100/5A']],
    ['VT＋PF 1台', lab({ vtCount: '1' }, 'ds-vt-pf'), ['VT＋PF', '6600/110V']],
    ['VT＋PF 2台（接続は、初期値のV結線）', lab({ vtCount: '2' }, 'ds-vt-pf'), ['VT＋PF×2', 'V結線', '6600/110V']],
    ['VT＋PF 2台（数）', lab({ vtCount: 2 }, 'ds-vt-pf'), ['VT＋PF×2', 'V結線', '6600/110V']],
    ['VT＋PF 2台（独立を、自分で選んだ）', lab({ vtCount: '2', vtConnection: 'independent' }, 'ds-vt-pf'), ['VT＋PF×2', '6600/110V']],
    ['VT＋PF 3台（接続は、初期値の独立）', lab({ vtCount: '3' }, 'ds-vt-pf'), ['VT＋PF×3', '6600/110V']],
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
    const group = QUESTION_GROUPS.find((g) => g.id === q?.group);
    if (!q || q.type !== 'select' || q.defaultValue !== '2' || !(q.showIf || group?.showIf)) fail(`${id} の質問が、台数を選ぶ形（初期値2・条件つき）になっていません`);
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

  // 蓄電池ユニットをつなぐ変圧器：初期値は、1台目。「つながない」を選べば、単独で置く
  const q = QUESTIONS.find((x) => x.id === 'batteryTransformer');
  if (q?.defaultValue !== '1') fail(`蓄電池ユニットをつなぐ変圧器の初期値が、1台目になっていません（${q?.defaultValue}）`);
  const batt = (a: Answers) => buildComposition({ ...answers, mainBreakerForm: 'cb', transformerCount: 2, hasBattery: 'yes', batteryCapacity: '2,000kW', ...a }).find((i) => i.role === 'battery');
  const dflt = batt({});
  const none = batt({ batteryTransformer: 'none' });
  const second = batt({ batteryTransformer: '2' });
  if (dflt?.kind !== 'feeder') fail('蓄電池ユニットが、変圧器につながる形（feeder）で入っていません');
  else if (none?.kind !== 'free') fail('「つながない」を選んでも、単独（free）になっていません');
  else if (second?.kind !== 'feeder') fail('2台目を選んでも、つながる形になっていません');
  else console.log('  蓄電池ユニット：何も選ばなければ1台目の変圧器につなぐ／「つながない」なら単独／2台目も選べる');
}

console.log('\n■ 変圧器の用途で、結線方式の選択肢を絞る／電灯および動力のV結線の容量');
{
  const conn = QUESTIONS.find((q) => q.id === 'trConnection')!;
  const offered = (a: Answers) => (conn.options ?? []).filter((o) => evaluate(o.showIf, a)).map((o) => o.value);
  const single = ['tr-1p', 'tr-1p-2w', 'tr-1p-parallel'];
  const three = ['tr-3p-dy', 'tr-3p-yd', 'tr-3p-dd', 'tr-3p-dd-1p3', 'tr-3p-yy'];
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
  const ok = (cond: boolean, msg: string) => (cond ? undefined : fail(msg));
  // 三相 Δ-Δ結線（単相変圧器×3）：動力変圧器1台として、三相 Δ-Δ結線の記号で描き、文字に「単相変圧器×3」と入る。容量は3台の合計
  const dd3 = buildComposition({ ...answers, transformerCount: 1, trUsage: '動力', trConnection: 'tr-3p-dd-1p3', trCapacity: 300 }).filter((i) => i.role === 'transformer');
  ok(conn.options?.find((o) => o.value === 'tr-3p-dd-1p3')?.label === '三相 Δ-Δ結線（単相変圧器×3）', '「三相 Δ-Δ結線（単相変圧器×3）」の選択肢の名前が違います');
  ok(dd3.length === 1 && dd3[0]!.symbolId === 'tr-3p-dd', `単相変圧器×3のΔ-Δ結線が、1台の三相 Δ-Δ結線の記号になっていません（${dd3.length}台／${dd3[0]?.symbolId}）`);
  ok(dd3[0]?.label.join('|').includes('単相変圧器×3') === true && dd3[0]?.label.join('|').includes('3φ300kVA') === true, `単相変圧器×3のΔ-Δ結線の文字が違います（${dd3[0]?.label.join('|')}）`);
  const ddOwn = buildComposition({ ...answers, transformerCount: 1, trUsage: '動力', trConnection: 'tr-3p-dd-1p3', trCapacity: 300, trComposition: '単相100kVA×3' }).find((i) => i.role === 'transformer');
  ok(ddOwn?.label.join('|').includes('単相100kVA×3') === true && !ddOwn.label.join('|').includes('単相変圧器×3'), '手で書いた構成が優先されていません');
  const ddPlain = buildComposition({ ...answers, transformerCount: 1, trUsage: '動力', trConnection: 'tr-3p-dd', trCapacity: 300 }).find((i) => i.role === 'transformer');
  ok(ddPlain?.label.join('|').includes('単相変圧器×3') !== true, '通常のΔ-Δ結線に、「単相変圧器×3」が入っています');
  ok(!offered({ trUsage: '電灯' }).includes('tr-3p-dd-1p3'), '用途が電灯なのに、単相変圧器×3のΔ-Δ結線が出ています');
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
  const m = lbl({ trUsage: '電灯・動力', trConnection: 'tr-vv', trCapacityLight: 30, trCapacityPower: 50, trVoltage: '6600/210-105V', trComposition: '' });
  const wantM = ['Tr', '電灯 30kVA', '動力 50kVA', '6600/210-105V'];
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

console.log('\n■ 変圧器ごとのPC・LBS（1台目は無し、2台目だけ有り）');
{
  // 件ごとに独立して答える。1台目が「なし」でも、2台目で「あり」と答えたら、2台目に、定格・ヒューズを入力する欄が出て、図面にも出る
  const a2: Answers = {
    ...answers, transformerCount: 3, trHasPc: 'no', trHasLbs: 'no',
    trHasPc__2: 'no', trHasLbs__2: 'yes', trLbsRating__2: '300A', trPfG__2: '50A', trPfLoad__2: 'T', trPfLoadAmp__2: '30A',
    trHasPc__3: 'yes', trHasLbs__3: 'no', trPcRating__3: '50A', trPcFuse__3: '12.5A',
  };
  const ids = (n: number) => visibleQuestions(viewAt(a2, n), {}).filter((q) => q.group === 'transformer').map((q) => q.id);
  const lbsIds = ['trLbsRating', 'trPfG', 'trPfLoad', 'trPfLoadAmp', 'trPfKa'];
  const pcIds = ['trPcRating', 'trPcFuse'];
  const u1 = ids(0), u2 = ids(1), u3 = ids(2);
  if (lbsIds.some((id) => u1.includes(id)) || pcIds.some((id) => u1.includes(id))) fail('1台目は「なし」なのに、PC・LBSの定格の欄が出ています');
  else if (!lbsIds.every((id) => u2.includes(id)) || pcIds.some((id) => u2.includes(id))) fail('2台目（LBSあり）に、LBSの定格・ヒューズの欄が出ていません');
  else if (!pcIds.every((id) => u3.includes(id)) || lbsIds.some((id) => u3.includes(id))) fail('3台目（PCあり）に、PCの定格・ヒューズの欄が出ていません');
  else console.log('  1台目なし・2台目LBSあり・3台目PCあり：それぞれの台に、定格・ヒューズの入力欄が出る');
  const comp = buildComposition(a2);
  const lbs = comp.filter((i) => i.role === 'tr-lbs');
  const pc = comp.filter((i) => i.role === 'tr-pc');
  if (lbs.length !== 1 || pc.length !== 1) fail(`図面に出るPC・LBSの数が違います（LBS ${lbs.length}・PC ${pc.length}）`);
  else if (!lbs[0]!.label.join('|').includes('300A') || !pc[0]!.label.join('|').includes('50A|F:12.5A')) fail(`図面の文字が違います（${lbs[0]!.label.join('|')} / ${pc[0]!.label.join('|')}）`);
  else console.log(`  図面：LBS（2台目だけ）${lbs[0]!.label.join('|')} ／ PC（3台目だけ）${pc[0]!.label.join('|')}`);
  // 画面に出ている既定値（LBS本体の電圧・電流、PFの負荷側 T、短絡電流 40kA）は、2台目以降も、図面に出る。
  // 以前は、2台目以降では、既定値が図面に出ず、「LBS／G30A」だけになっていた
  const dflt: Answers = { ...QUESTION_DEFAULTS, ...answers, transformerCount: 2, trUsage: '電灯', trConnection: 'tr-1p', trUsage__2: '動力', trConnection__2: 'tr-3p-yd', trHasLbs: 'yes', trHasLbs__2: 'yes', trPfG: '20A', trPfLoadAmp: '10A', trPfG__2: '30A', trPfLoadAmp__2: '20A' };
  const lbsLabels = buildComposition(dflt).filter((i) => i.role === 'tr-lbs').map((i) => i.label.join('/'));
  if (lbsLabels.join(' | ') !== 'LBS/7200V 200A/PF×2/G20A T10A 40kA | LBS/7200V 200A/PF×3/G30A T20A 40kA') fail(`LBSの表記が違います（${lbsLabels.join(' | ')}）`);
  else console.log(`  LBSの表記（1台目・2台目とも同じ形）：${lbsLabels.join(' ／ ')}`);
  // PFの本数：電灯（単相3線）は×2、動力は×3、電灯でもV結線は×3、電灯・動力は×3。用途が未入力なら書かない。コンデンサの手前は×3
  const pfOf = (usage: string | undefined, conn: string): string => {
    const q: Answers = { ...QUESTION_DEFAULTS, ...answers, transformerCount: 1, trHasLbs: 'yes', trConnection: conn, ...(usage === undefined ? { trUsage: undefined as never } : { trUsage: usage }) };
    return buildComposition(q).find((i) => i.role === 'tr-lbs')?.label.find((l) => l.startsWith('PF×')) ?? '（なし）';
  };
  const pfCases: [string, string | undefined, string, string][] = [
    ['電灯・単相3線', '電灯', 'tr-1p', 'PF×2'],
    ['動力', '動力', 'tr-3p-yd', 'PF×3'],
    ['電灯でもV結線', '電灯', 'tr-vv', 'PF×3'],
    ['電灯・動力（V結線）', '電灯・動力', 'tr-vv', 'PF×3'],
    ['用途が未入力', undefined, 'tr-3p-yd', '（なし）'],
  ];
  for (const [name, usage, conn, want] of pfCases) {
    const got = pfOf(usage, conn);
    if (got !== want) fail(`PFの本数（${name}）が違います（${got}、期待 ${want}）`);
  }
  const capPf = buildComposition({ ...QUESTION_DEFAULTS, ...answers, hasCapacitor: 'yes', capacitorCount: 1, capHasLbs: 'yes' }).find((i) => i.role === 'cap-lbs')?.label.join('/');
  if (!capPf?.includes('PF×3')) fail(`コンデンサの手前のLBSに、PF×3 が出ていません（${capPf}）`);
  else console.log(`  PFの本数：電灯（単相3線）×2／動力×3／電灯でもV結線×3／電灯・動力×3／用途が未入力なら書かない。コンデンサの手前×3（${capPf}）`);
  // コンデンサも同じ（1台目は無し、2台目だけLBSあり）
  const ac: Answers = { ...answers, hasCapacitor: 'yes', capacitorCount: 2, capHasPc: 'no', capHasLbs: 'no', capHasPc__2: 'no', capHasLbs__2: 'yes', capLbsRating__2: '200A' };
  const capIds = (n: number) => visibleQuestions(viewAt(ac, n), {}).filter((q) => q.group === 'compensation').map((q) => q.id);
  if (capIds(0).includes('capLbsRating') || !capIds(1).includes('capLbsRating') || !capIds(1).includes('capPfG')) fail('コンデンサ：1台目なし・2台目LBSありのとき、2台目にだけ、LBSの定格の欄が出ていません');
  else console.log('  コンデンサ：1台目なし・2台目LBSあり → 2台目にだけ、LBSの定格・ヒューズの入力欄が出る');
  // 直列リアクトルは、標準が「なし」（2台目以降も、未入力のままにしない）。答えていなくても、リアクトルは描かない
  const q = QUESTIONS.find((x) => x.id === 'hasReactor');
  const noRe = buildComposition({ ...answers, hasCapacitor: 'yes', capacitorCount: 3, hasReactor: 'yes', hasReactor__2: undefined as never }).filter((i) => i.role === 'reactor').length;
  if (q?.defaultValue !== 'no') fail('直列リアクトルの標準が「なし」になっていません');
  else if (noRe !== 1) fail(`答えていない2台目以降に、リアクトルが描かれています（${noRe}個）`);
  else console.log('  直列リアクトル：標準は「なし」。答えていない2台目以降には、リアクトルを描かない');
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
  if (q?.type !== 'select' || !q.dropdown || JSON.stringify(vals) !== JSON.stringify(['3300', '6600', '7200'])) {
    fail(`区分開閉器の定格電圧が、3300・6600・7200のドロップダウンになっていません（${q?.type}／${vals.join('・')}）`);
  } else console.log('  ドロップダウン（3300V／6600V／7200V）');
  // 選んだ値が、図面の「PAS 3300V 200A」のように書かれる
  for (const v of ['3300', '6600', '7200']) {
    const t = String(withDerived({ sectionalizer: 'pas', pasRatedVoltage: v, pasRatedCurrent: '200' }).pasRatingText);
    if (t !== `${v}V 200A`) fail(`定格 ${v}V の書き方が違います（${t}）`);
  }
  console.log('  図面の書き方：7200V 200A／3300V 200A のように、選んだ電圧が書かれる');
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
  if (volt?.type !== 'select' || !volt.dropdown || JSON.stringify(vOpts) !== JSON.stringify(['3300', '6600'])) {
    fail(`定格電圧が、3300・6600のドロップダウンになっていません（${volt?.type}／${vOpts.join('・')}）`);
  } else console.log('  定格電圧：ドロップダウン（3300V／6600V）。初期値は6600V');
  const rv = QUESTIONS.find((q) => q.id === 'receivingVoltage');
  const rvOpts = rv?.options?.map((o) => o.value) ?? [];
  if (rv?.type !== 'select' || !rv.dropdown || JSON.stringify(rvOpts) !== JSON.stringify(['3300', '6600']) || rv.defaultValue !== '6600') {
    fail(`受電電圧が、3300・6600のドロップダウン（初期値6600）になっていません（${rv?.type}／${rvOpts.join('・')}／${String(rv?.defaultValue)}）`);
  } else console.log('  受電電圧：ドロップダウン（3300V／6600V）。初期値は6600V');
  // 古い案件の数値（6600）も、ケーブルの注記にそのまま出る
  const spec = String(withDerived({ cableVoltage: 6600, cableCrossSection: '38', cableLength: 14 }).cableSpecLine);
  const spec2 = String(withDerived({ cableVoltage: '3300', cableCrossSection: '38', cableLength: 14 }).cableSpecLine);
  if (spec !== '6600V 38mm2 14m' || spec2 !== '3300V 38mm2 14m') fail(`注記が違います（${spec} ／ ${spec2}）`);
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
    // 客柱は、名称を基本的に空白にする決まり（「中電柱」「客柱」などの文字も付けない）
    if (blank.length === 0 && d.id !== 'pole-customer') fail(`${d.id}：足した直後に何も書かれません`);
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
  // 2か所目以降の受電側：PASの有無・ASの有無（別々に「ある」「ない」を選ぶ。1か所目には出ない）
  ok(a2.has('areaPas') && a2.has('areaAs') && !a1.has('areaPas') && !a1.has('areaAs'), '2か所目だけに、PASの有無・ASの有無が出ていません');
  const optsOf = (id: string) => (QUESTIONS.find((q) => q.id === id)?.options ?? []).map((o) => `${o.value}:${o.label}`).join(',');
  ok(optsOf('areaPas') === 'yes:ある,no:ない' && optsOf('areaAs') === 'yes:ある,no:ない', 'PAS・ASの選択肢が「ある／ない」になっていません');
  const withAreaSwitch = (extra: Answers) =>
    buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', ...extra }).filter((i) => i.area === 1);
  const none2 = withAreaSwitch({}).map((i) => i.role);
  ok(!none2.includes('a2:area-pas') && !none2.includes('a2:area-as'), '初期値（ない）なのに、2か所目にPAS・ASが入っています');
  const pasOnly = withAreaSwitch({ 'a2:areaPas': 'yes' });
  ok(pasOnly.find((i) => i.role === 'a2:area-pas')?.symbolId === 'pas' && !pasOnly.some((i) => i.role === 'a2:area-as'), 'PASだけ「ある」のとき、PAS（ASは無し）になっていません');
  const asOnly = withAreaSwitch({ 'a2:areaAs': 'yes' });
  ok(asOnly.find((i) => i.role === 'a2:area-as')?.symbolId === 'as' && !asOnly.some((i) => i.role === 'a2:area-pas'), 'ASだけ「ある」のとき、AS（PASは無し）になっていません');
  const both = withAreaSwitch({ 'a2:areaPas': 'yes', 'a2:areaAs': 'yes' }).map((i) => i.role);
  ok(both.indexOf('a2:area-pas') >= 0 && both.indexOf('a2:area-pas') < both.indexOf('a2:area-as') && both.indexOf('a2:area-as') < both.indexOf('a2:ds'), '両方「ある」のとき、PAS → AS → DS の順になっていません');
  ok(!buildComposition({ ...answers, areaCount: 1, 'a2:areaPas': 'yes' }).some((i) => /area-pas/.test(i.role)), '2か所目が無いのに、PASが入っています');
  // 1か所目の最後：送り出しの開閉器（エリアが2か所以上のときだけ。1か所目の質問として出る）
  const send = (extra: Answers) => buildComposition({ ...answers, areaCount: 2, ...extra }).filter((i) => i.kind === 'sendout').map((i) => `${i.role}:${i.symbolId}:${i.label.join('/')}`);
  ok(a1.has('sendoutSwitch') && !a2.has('sendoutSwitch'), '送り出しの開閉器の質問が、最後のエリア以外に出ていません（2か所のとき、1か所目だけ）');
  const three = { areaCount: 3 };
  ok(ids(areaView(three, 1)).has('sendoutSwitch') && !ids(areaView(three, 2)).has('sendoutSwitch') && ids(areaView(three, 0)).has('sendoutSwitch'), '3か所のとき、1か所目・2か所目だけに、送り出しの質問が出ていません');
  ok(!ids({ areaCount: 1 }).has('sendoutSwitch') && !ids({ areaCount: 1 }).has('sendoutFuseCurrent'), 'エリアが1か所のときに、送り出しの質問が出ています');
  ok(ids(areaView({ areaCount: 2, sendoutSwitch: 'lbs' }, 0)).has('sendoutFuseCurrent') && !ids(areaView({ areaCount: 2, sendoutSwitch: 'ds' }, 0)).has('sendoutFuseCurrent'), 'LBSのときだけ、パワーヒューズの容量を聞く、になっていません');
  const sendOpts = (QUESTIONS.find((q) => q.id === 'sendoutSwitch')?.options ?? []).map((o) => o.value).join(',');
  ok(sendOpts === 'none,ds,vcb,lbs,ds-vcb', `送り出しの選択肢が違います（${sendOpts}）`);
  ok(send({}).length === 0 && send({ sendoutSwitch: 'none' }).length === 0, '「なし」のとき、送り出しの開閉器が入っています');
  ok(send({ sendoutSwitch: 'ds' }).join() === 'sendout-ds:ds:DS', `DSの送り出しが違います（${send({ sendoutSwitch: 'ds' }).join()}）`);
  ok(send({ sendoutSwitch: 'vcb' }).join() === 'sendout-vcb:vcb:VCB', 'VCBの送り出しが違います');
  ok(send({ sendoutSwitch: 'ds-vcb' }).join() === 'sendout-ds:ds:DS,sendout-vcb:vcb:VCB', 'DS＋VCBの送り出しが違います（DS → VCB の順）');
  ok(send({ sendoutSwitch: 'lbs', sendoutFuseCurrent: '30' }).join() === 'sendout-lbs:lbs-pf:LBS/PF 30A', `LBSの送り出し（PF 30A）が違います（${send({ sendoutSwitch: 'lbs', sendoutFuseCurrent: '30' }).join()}）`);
  ok(send({ sendoutSwitch: 'lbs' }).join() === 'sendout-lbs:lbs-pf:LBS', 'PFの容量が空のとき、LBSの文字だけになっていません');
  ok(buildComposition({ ...answers, areaCount: 1, sendoutSwitch: 'vcb' }).every((i) => i.kind !== 'sendout'), 'エリアが1か所なのに、送り出しの開閉器が入っています');
  // 2か所目以降のエリアの名前（任意）：エリアの枠の文字の、いちばん前に書く。1か所目には付かない
  const frameLabel = (extra: Answers, role: string) => buildComposition({ ...answers, areaCount: 3, ...extra }).find((i) => i.role === role)?.label.join('|');
  ok(frameLabel({ areaName__2: '第2電気室' }, 'a2:area-frame')?.startsWith('第2電気室　') === true, '2か所目のエリアの名前が、枠の文字の前に書かれていません');
  ok(frameLabel({ areaName__3: '第3キュービクル' }, 'a3:area-frame')?.startsWith('第3キュービクル　') === true, '3か所目のエリアの名前が、枠の文字の前に書かれていません');
  ok(frameLabel({ areaName: '1か所目の名前' }, 'area-frame')?.includes('1か所目の名前') === false, '1か所目には、エリアの名前を付けないはずが、付いています');
  ok(frameLabel({}, 'a2:area-frame')?.startsWith('第') !== true, '名前が空のとき、枠の文字に名前が入っています');
  const nameQ = QUESTIONS.find((q) => q.id === 'areaName');
  ok(nameQ?.group === 'area' && evaluate(nameQ.showIf, { unitNo: 2 }) && evaluate(nameQ.showIf, { unitNo: 3 }) && !evaluate(nameQ.showIf, { unitNo: 1 }), 'エリアの名前の質問が、2か所目以降だけに出る形になっていません');
    // 定格（電圧・電流）：「ある」のときだけ聞き、図面には 7200V 200A のように書く
  const asked = (extra: Answers) => ids(areaView({ areaCount: 2, ...extra }, 1));
  ok(!asked({}).has('areaPasRatedVoltage') && !asked({}).has('areaAsRatedCurrent'), 'PAS・ASが「ない」のに、定格を聞いています');
  ok(asked({ 'a2:areaPas': 'yes' }).has('areaPasRatedVoltage') && asked({ 'a2:areaPas': 'yes' }).has('areaPasRatedCurrent') && !asked({ 'a2:areaPas': 'yes' }).has('areaAsRatedVoltage'), 'PASが「ある」とき、PASの定格だけを聞いていません');
  ok(asked({ 'a2:areaAs': 'yes' }).has('areaAsRatedVoltage') && asked({ 'a2:areaAs': 'yes' }).has('areaAsRatedCurrent') && !asked({ 'a2:areaAs': 'yes' }).has('areaPasRatedCurrent'), 'ASが「ある」とき、ASの定格だけを聞いていません');
  const rated = withAreaSwitch({ 'a2:areaPas': 'yes', 'a2:areaPasRatedVoltage': '7200', 'a2:areaPasRatedCurrent': '200', 'a2:areaAs': 'yes', 'a2:areaAsRatedVoltage': '6600' });
  ok(rated.find((i) => i.role === 'a2:area-pas')?.label.join('|') === 'PAS|7200V 200A', `PASの文字が違います（${rated.find((i) => i.role === 'a2:area-pas')?.label.join('|')}）`);
  ok(rated.find((i) => i.role === 'a2:area-as')?.label.join('|') === 'AS|6600V', `ASの文字（片方だけ分かるとき）が違います（${rated.find((i) => i.role === 'a2:area-as')?.label.join('|')}）`);
  ok(withAreaSwitch({ 'a2:areaPas': 'yes' }).find((i) => i.role === 'a2:area-pas')?.label.join('|') === 'PAS', '定格が未入力のとき、PASの文字が「PAS」だけになっていません');
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
  // ケーブルでつなぐ・つながないで、聞くことは同じ（分岐の位置は、どちらでも聞く。ケーブルの種類・断面積・長さだけ、ケーブルのとき）
  const noCableQs = ids(areaView({ areaCount: 3, 'a2:linkCable': 'no' }, 1));
  ok(noCableQs.has('linkTap') && noCableQs.has('linkCable') && !noCableQs.has('linkCableInstallation') && !noCableQs.has('linkCableCrossSection') && !noCableQs.has('linkCableLength'), '「いいえ」のとき、分岐の位置は聞き、ケーブルの種類・断面積・長さは聞かない、になっていません');
  ok(ids(areaView({ areaCount: 3, 'a3:linkCable': 'no' }, 2)).has('linkFrom'), '3か所目：「いいえ」でも、どのエリアから分岐するかを聞くはずです');
  ok(ids(areaView({ areaCount: 2 }, 1)).has('linkCableInstallation') && ids(areaView({ areaCount: 2 }, 1)).has('linkCableLength'), 'ケーブルのとき、ケーブルの種類・長さを聞いていません');
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
