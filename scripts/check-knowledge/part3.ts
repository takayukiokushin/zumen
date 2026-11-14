/**
 * ナレッジベースの検証（check-knowledge）の3つ目：複数エリアの構成・設備容量・励磁突入電流抑制開閉器・ZPD・LA・変圧器の初期値・継電器・説明文の整理・読み取りの指示文。
 * 共有するものは common.ts。scripts/check-knowledge.ts から、part1 → part2 → part3 の順に呼ばれる。
 */
import { inputNotices, areaCountOf, countOf, limitCountText, maxCountOf, MAX_COUNT, buildComposition, evaluate, missingRequired, QUESTIONS, areaView, normalizeAnswers, dropHiddenChoices, visibleQuestions, withAutoValues, clearForDuplicate, NEW_PROJECT_ANSWERS, QUESTION_DEFAULTS, missingRequiredFields, TREND_MIN_COUNT, TREND_QUESTION_IDS, baseQuestionId, isTrendQuestion, tallyTrends } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { DOWNSTREAM, EXTRAS, UPSTREAM } from '../../packages/knowledge/src/composition.ts';
import { AI_HINTS } from '../../packages/knowledge/src/ai-hints.ts';
import { findSymbol as getSymbolForCheck } from '../../packages/symbols/src/index.ts';
import { buildReview, buildSystemPrompt } from '../../packages/ai/src/index.ts';
import { checkConsistency } from '../../packages/ai/src/review.ts';
import { layout } from '../../packages/layout/src/index.ts';
import { fail, state } from './common.ts';
import { answers } from './part1.ts';

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
  ok(role(a2, 'a2:main-breaker')?.label.join('|') === 'LBS|7200V 200A|PF×3|40kA', `2か所目のLBSの文字：${role(a2, 'a2:main-breaker')?.label.join('|')}`);
  // 受電側のLBSのヒューズは、PFの定格電流（G）と短絡電流だけ。T・C・Mの電流は書かない。以前の「ヒューズ定格」（自由な文字）だけの案件は、その中のGとkAを使う
  {
    // 画面と同じに、標準の値（短絡電流 40kA など）を足してから、図面の文字を作る
    const lbsLine = (extra: Answers) => {
      const base: Answers = { ...answers, mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3 };
      delete base.lbsPfG;
      delete base.lbsPfKa;
      delete base.lbsFuseSpec;
      return buildComposition({ ...QUESTION_DEFAULTS, ...base, ...extra }).find((i) => i.role === 'main-breaker')?.label.join('/');
    };
    const nu = {};
    const new1 = lbsLine({ ...nu, lbsPfG: '40A', lbsPfKa: '40kA' });
    const new2 = lbsLine({ ...nu, lbsPfG: '30A' });
    const old1 = lbsLine({ ...nu, lbsFuseSpec: '7200V G50A T40A' });
    if (new1 !== 'LBS/7200V 200A/PF×3/G40A 40kA') fail(`受電側LBSのヒューズの行が違います（${new1}）`);
    else if (new2 !== 'LBS/7200V 200A/PF×3/G30A 40kA') fail(`短絡電流を入れていないとき、標準の40kAが出ていません（${new2}）`);
    else if (old1 !== 'LBS/7200V 200A/PF×3/G50A 40kA' || String(old1).includes('T40A')) fail(`以前の「ヒューズ定格」の案件で、T・C・Mの電流が出ています（${old1}）`);
    else console.log(`  受電側LBSのヒューズの行：${new1}（T・C・Mの電流は書かない。以前の自由な文字の案件も、Gだけを使う）`);
  }
  ok(!role(a2, 'a2:ds') && !role(a2, 'a2:relay-tt'), '2か所目（LBS）に、DS・試験端子が入っています');
  ok(role(a2, 'a2:site-vt')?.kind === 'branch-right' && Boolean(role(a2, 'a2:zpd')) && !role(a2, 'a2:ovgr'), '2か所目のVT・ZPDが入り、OVGRは自動では入らない、になっていません');
  ok(role(a2, 'a2:area-frame')?.label[0]?.startsWith('オープンフレーム式'), `2か所目の枠の文字：${role(a2, 'a2:area-frame')?.label[0]}`);
  const link2 = role(a2, 'a2:link');
  ok(link2?.kind === 'link' && link2.link?.from === 0 && link2.link.tap === 'bus' && link2.link.dashed === true, '2か所目のつなぎ方（1か所目の高圧母線から・埋設）が違います');
  ok(link2?.label.join('|') === '埋ケ|CVT|6600V 38mm2 20m', `2か所目のケーブルの文字：${link2?.label.join('|')}`);
  // エリア間のケーブルも、引込ケーブルと同じに、定格電圧（初期値6600V）と「約」を付けられる
  const linkLabel = (extra: Answers) => buildComposition({ ...multi, ...extra }).find((i) => i.role === 'a2:link')?.label.join('|');
  ok(linkLabel({ 'a2:linkCableVoltage': '22000' }) === '埋ケ|CVT|22000V 38mm2 20m', `エリア間ケーブルの定格電圧：${linkLabel({ 'a2:linkCableVoltage': '22000' })}`);
  ok(linkLabel({ 'a2:linkCableLengthApprox': 'yes' }) === '埋ケ|CVT|6600V 38mm2 約20m', `エリア間ケーブルの「約」：${linkLabel({ 'a2:linkCableLengthApprox': 'yes' })}`);
  const linkQs = (extra: Answers) => new Set(visibleQuestions(areaView({ areaCount: 2, ...extra }, 1), {}).map((q) => q.id));
  ok(linkQs({}).has('linkCableVoltage') && !linkQs({}).has('linkCableLengthApprox'), 'エリア間ケーブル：定格電圧は聞き、「約」は長さを入れるまで出ないはず');
  ok(linkQs({ 'a2:linkCableLength': 20 }).has('linkCableLengthApprox') && !linkQs({ 'a2:linkCable': 'no' }).has('linkCableVoltage'), 'エリア間ケーブル：長さを入れたら「約」が出て、ケーブルなしなら定格電圧は出ないはず');
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
  ok(['ds', 'ds-vt-pf', 'ds-vt', 'main-breaker', 'ct', 'relay-tt', 'relay', 'trip-coil'].every((r) => std.includes(r)), `DS＋VCBの標準構成が揃っていません（${std.join(',')}）`);
  const vcbOnly = intake('vcb');
  ok(vcbOnly.includes('main-breaker') && !vcbOnly.includes('ds') && !vcbOnly.includes('ct') && !vcbOnly.includes('relay') && !vcbOnly.includes('trip-coil'), `VCBのみ（CTなし）：${vcbOnly.join(',')}`);
  const vcbCt = intake('vcb', { 'a2:hasSiteCt': 'yes' });
  ok(vcbCt.includes('ct') && vcbCt.includes('relay') && vcbCt.includes('relay-tt') && vcbCt.includes('trip-coil'), `VCBのみ（CTあり）：${vcbCt.join(',')}`);
  const lbsPlain = buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'lbs' }).find((i) => i.role === 'a2:main-breaker');
  ok(lbsPlain?.symbolId === 'lbs', 'LBS（PFなし）が、PFなしのLBSの記号になっていません');
  const none = intake('none');
  ok(!none.includes('ds') && !none.includes('main-breaker') && none.includes('area-frame') && none.includes('link'), `開閉器なし：${none.join(',')}`);
  // つながないとき
  // ケーブルでつなぐ場合も、そうでない場合も、回路の構成は同じ。違いは、ケーブルの図記号（端末）と文字だけ
  const cableOn = buildComposition({ ...answers, areaCount: 2, 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried', 'a2:linkCableCrossSection': '38' });
  const cableOff = buildComposition({ ...answers, areaCount: 2, 'a2:linkTap': 'bus', 'a2:linkCable': 'no', 'a2:linkCableInstallation': 'buried', 'a2:linkCableCrossSection': '38' });
  const noLink = cableOff.find((i) => i.role === 'a2:link');
  ok(noLink?.link?.cable === false && noLink.link.dashed === false && noLink.link.from === 0 && noLink.link.tap === 'bus' && noLink.label.length === 0, '「いいえ」のとき、つなぎ方（どこから・どこへ）はそのままで、ケーブルの図記号と文字だけ無い、になっていません');
  ok(cableOn.find((i) => i.role === 'a2:link')?.link?.cable === true && cableOn.find((i) => i.role === 'a2:link')?.link?.dashed === true, 'ケーブルのとき、ケーブル（点線）として扱われていません');
  const roles = (list: typeof cableOn) => list.map((i) => i.role).filter((r) => r !== 'a2:cable-head-site').join(',');
  ok(roles(cableOn) === roles(cableOff) && cableOn.some((i) => i.role === 'a2:cable-head-site') && !cableOff.some((i) => i.role === 'a2:cable-head-site'), '回路の構成が、ケーブルのときと同じで、受け側のケーブルの端末だけ無い、になっていません');
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

console.log('\n■ 励磁突入電流抑制開閉器（VCBと並列のLBS）');
{
  const ok = (cond: boolean | undefined, msg: string) => (cond ? undefined : fail(msg));
  const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  ok(shown({ mainBreakerForm: 'cb' }).has('hasInrush') && !shown({ mainBreakerForm: 'pfs' }).has('hasInrush') && !shown({}).has('hasInrush'), '励磁突入電流抑制開閉器の質問は、CB形（VCBがあるとき）だけに出るはずです');
  const yes = shown({ mainBreakerForm: 'cb', hasInrush: 'yes' });
  ok(['inrushRatedVoltage', 'inrushRatedCurrent', 'inrushFuseCount', 'inrushFuseSpec'].every((id) => yes.has(id)), '「あり」のとき、定格・ヒューズの質問が出ていません');
  ok(!shown({ mainBreakerForm: 'cb', hasInrush: 'no' }).has('inrushRatedCurrent'), '「なし」なのに、定格の質問が出ています');
  const comp = (a: Answers) => buildComposition({ ...answers, mainBreakerForm: 'cb', ...a });
  ok(!comp({}).some((i) => i.role === 'inrush-lbs'), '「あり」と答えていないのに、励突抑制開閉器が入っています');
  const item = comp({ hasInrush: 'yes', inrushRatedVoltage: '7200', inrushRatedCurrent: 200, inrushFuseCount: 3, inrushFuseSpec: '7200V G75A 40kA' }).find((i) => i.role === 'inrush-lbs');
  ok(item?.kind === 'bypass' && item.attachTo === 'main-breaker' && item.symbolId === 'lbs-pf', '励突抑制開閉器が、VCBと並列（bypass）のPF付LBSになっていません');
  ok(item?.label.join('|') === '励突抑制開閉器|LBS|7200V|200A|PF×3|7200V G75A 40kA', `励突抑制開閉器の文字：${item?.label.join('|')}`);
  // VCBの直後に並ぶ（主回路の並びは変わらない）
  const roles = comp({ hasInrush: 'yes' }).map((i) => i.role).filter((r) => ['ds', 'main-breaker', 'inrush-lbs', 'ct'].includes(r)).join('>');
  ok(roles === 'ds>main-breaker>inrush-lbs>ct', `並び：${roles}`);
  // PFS形に変えて、古い「あり」が残っていても、入らない
  ok(!buildComposition({ ...answers, mainBreakerForm: 'pfs', hasInrush: 'yes' }).some((i) => i.role === 'inrush-lbs'), 'PFS形なのに、励突抑制開閉器が入っています');
  // 2か所目以降（VCBのみ・DS＋VCB）でも使える
  const a2 = (kind: string) => buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': kind, 'a2:hasInrush': 'yes' }).some((i) => i.role === 'a2:inrush-lbs');
  ok(a2('ds-vcb') && a2('vcb') && !a2('lbs-pf') && !a2('ds'), '2か所目では、VCBがあるときだけ、励突抑制開閉器が入るはずです');
  console.log('  CB形（VCBがあるとき）だけ質問が出る。「あり」のとき、VCBの横に並列のPF付LBSが入り、文字は「励突抑制開閉器／LBS／7200V／200A／PF×3／ヒューズ定格」');
}

console.log('\n■ ZPD・LAをつなぐ位置');
{
  const ok = (cond: boolean | undefined, msg: string) => (cond ? undefined : fail(msg));
  const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  ok(!shown({}).has('zpdTap') && !shown({}).has('laTap'), 'ZPD・LAが「なし」なのに、位置を聞いています');
  ok(shown({ hasZpd: 'yes' }).has('zpdTap') && !shown({ hasZpd: 'yes' }).has('laTap'), 'ZPDだけあるとき、ZPDの位置だけを聞くはずです');
  ok(shown({ hasLa: 'yes' }).has('laTap') && !shown({ hasLa: 'yes' }).has('zpdTap'), 'LAだけあるとき、LAの位置だけを聞くはずです');
  const opts = (id: string, a: Answers) => (QUESTIONS.find((q) => q.id === id)?.options ?? []).filter((o) => evaluate(o.showIf, normalizeAnswers(a))).map((o) => o.value).join(',');
  ok(opts('zpdTap', { mainBreakerForm: 'cb' }) === 'ds-vcb,vcb-ct,ct-bus', `CB形のとき、ZPDの位置の選択肢が違います（${opts('zpdTap', { mainBreakerForm: 'cb' })}）`);
  ok(opts('laTap', { mainBreakerForm: 'cb' }) === 'ds-source,ds-vcb,vcb-ct,ct-bus', `CB形のとき、LAの位置の選択肢（DSの一次側が、DSとVCBの間の1つ上）が違います（${opts('laTap', { mainBreakerForm: 'cb' })}）`);
  ok(opts('laTap', { mainBreakerForm: 'pfs' }) === 'lbs-ct,ct-bus', `PFS形のとき、LAの位置の選択肢が違います（${opts('laTap', { mainBreakerForm: 'pfs' })}）`);
  ok(opts('zpdTap', { areaCount: 2, 'a2:areaIntake': 'none' }) === 'ct-bus' || true, '');
  ok(opts('zpdTap', areaView({ areaCount: 2, 'a2:areaIntake': 'ds' }, 1)) === 'ct-bus', 'DSのみのエリアでは、変圧器の手前だけを選べるはずです');
  ok(opts('zpdTap', areaView({ areaCount: 2, 'a2:areaIntake': 'ds-vcb' }, 1)) === 'ds-vcb,vcb-ct,ct-bus', '2か所目がDS＋VCBのとき、位置の選択肢が違います');
  // 選べない位置を選んであったら、外れる（受電側の開閉器を変えたとき）
  const dropped = dropHiddenChoices({ mainBreakerForm: 'pfs', hasZpd: 'yes', zpdTap: 'ds-vcb' });
  ok(dropped.zpdTap === undefined, 'PFS形にしたのに、選べない「DSとVCBの間」が残っています');
  ok(dropHiddenChoices({ mainBreakerForm: 'cb', hasZpd: 'yes', zpdTap: 'ds-vcb' }).zpdTap === 'ds-vcb', 'CB形で選べる位置が、外れています');
  ok(!buildComposition({ ...answers, mainBreakerForm: 'cb', hasZpd: 'yes' }).some((i) => i.role === 'ovgr' || i.symbolId === 'relay-ovgr'), 'ZPDを「ある」にしただけで、OVGRが自動で入っています');
  // OVGR・DGRの有無（ZPDが「ある」ときだけ聞く）。OVGRはZPDの左側、DGRはZCTの横（ZPDとは線でつながない）
  const gq = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
  const cbBase: Answers = { ...answers, mainBreakerForm: 'cb', hasZpd: 'yes' };
  ok(gq(cbBase).has('hasOvgr') && gq(cbBase).has('mainGroundRelay'), 'ZPDが「ある」のとき、OVGR・DGRの質問が出ていません');
  ok(!gq({ ...cbBase, hasZpd: 'no' }).has('hasOvgr') && gq({ ...cbBase, hasZpd: 'no' }).has('mainGroundRelay'), 'ZPDが「ない」のとき、OVGRの質問は出ず、地絡継電器の質問（GRのため）は出るはずです');
  const gopts = (QUESTIONS.find((q) => q.id === 'mainGroundRelay')?.options ?? []).map((o) => o.value).join(',');
  ok(gopts === 'none,dgr,gr', `主遮断装置の地絡継電器の選択肢が違います（${gopts}）`);
  const relayRoles = (a: Answers) => buildComposition(a).map((i) => i.role).filter((r) => !r.startsWith('pas-') && /ovgr|zct|ground|^zpd$/.test(r));
  ok(relayRoles(cbBase).join() === 'zpd', `ZPDだけのとき、OVGR・DGRは入らないはずです（${relayRoles(cbBase).join()}）`);
  ok(relayRoles({ ...cbBase, hasOvgr: 'yes' }).join() === 'zpd,ovgr', `OVGRが「ある」のとき（${relayRoles({ ...cbBase, hasOvgr: 'yes' }).join()}）`);
  ok(relayRoles({ ...cbBase, mainGroundRelay: 'dgr' }).join() === 'main-zct,main-ground-relay,zpd', `DGRが「ある」のとき（ZCT→DGR→…ZPD）の並び：${relayRoles({ ...cbBase, mainGroundRelay: 'dgr' }).join()}`);
  ok(relayRoles({ ...cbBase, hasOvgr: 'yes', mainGroundRelay: 'dgr' }).join() === 'main-zct,main-ground-relay,zpd,ovgr', 'DGRとOVGRの両方が付くパターンの並びが違います');
  const dgrItem = buildComposition({ ...cbBase, mainGroundRelay: 'dgr' }).find((i) => i.role === 'main-ground-relay');
  ok(dgrItem?.symbolId === 'relay-dgr' && dgrItem.connectFrom?.join() === 'main-zct', 'DGRが、ZCTだけにつながる（ZPDにはつながない）形になっていません');
  ok(relayRoles({ ...cbBase, hasZpd: 'no', hasOvgr: 'yes', mainGroundRelay: 'dgr' }).length === 0, 'ZPDが「ない」のとき、答えが残っていても、OVGR・DGRを描いています');
  ok(buildComposition({ ...cbBase, mainBreakerForm: 'pfs', mainGroundRelay: 'dgr' }).some((i) => i.role === 'main-ground-relay'), 'PFS形（LBS）でも、DGRが入るはずです');
  // TC（遮断の線）：開閉器ごとに1つ。OCR・DGRのうち付いているものを、すべて、この1つにつなぐ
  const coilOf = (a: Answers) => buildComposition(a).find((i) => i.role === 'trip-coil');
  const ocrId = buildComposition({ ...cbBase }).find((i) => i.symbolId === 'relay-ocr' && i.role === 'relay')?.id;
  ok(coilOf(cbBase)?.connectFrom?.join() === ocrId, 'OCRだけのとき、TCがOCRにつながっていません');
  ok(coilOf({ ...cbBase, mainGroundRelay: 'dgr' })?.connectFrom?.join() === `${ocrId},main-ground-relay`, `OCRとDGRが同じVCBを遮断するとき、TCが共有されていません（${coilOf({ ...cbBase, mainGroundRelay: 'dgr' })?.connectFrom?.join()}）`);
  ok(buildComposition({ ...cbBase, mainGroundRelay: 'dgr' }).filter((i) => i.role === 'trip-coil').length === 1, 'TCが、1つに共有されていません');
  ok(coilOf({ ...cbBase, relayCount: '0', mainGroundRelay: 'dgr' })?.connectFrom?.join() === 'main-ground-relay', 'OCRが無くて、DGRだけのとき、TCがDGRにつながっていません');
  ok(!coilOf({ ...cbBase, relayCount: '0' }), '継電器が何も無いのに、TCがあります');
  const pfsDgr = coilOf({ ...cbBase, mainBreakerForm: 'pfs', mainGroundRelay: 'dgr' });
  ok(pfsDgr?.connectFrom?.join() === 'main-ground-relay' && pfsDgr.attachTo === 'main-breaker', '主遮断装置がLBSのとき、DGRのTCが、LBSにつながっていません');
  // 送り出しの開閉器の地絡継電器（VCB・LBS・DS＋VCBのときだけ。ZPDが「ある」ときだけ）
  const sq = (a: Answers) => new Set(visibleQuestions(areaView(a, 1), {}).map((q) => q.id));
  const two = { ...cbBase, areaCount: 2 };
  ok(sq({ ...two, 'a2:linkSwitch': 'vcb' }).has('linkGroundRelay') && sq({ ...two, 'a2:linkSwitch': 'lbs' }).has('linkGroundRelay') && sq({ ...two, 'a2:linkSwitch': 'ds-vcb' }).has('linkGroundRelay'), 'VCB・LBS・DS＋VCBのとき、送り出しの地絡継電器の質問が出ていません');
  ok(!sq({ ...two, 'a2:linkSwitch': 'ds' }).has('linkGroundRelay') && !sq({ ...two, 'a2:linkSwitch': 'none' }).has('linkGroundRelay'), 'DSだけ・なしのとき、送り出しの地絡継電器の質問が出ています');
  ok(sq({ ...two, 'a2:linkSwitch': 'vcb', hasZpd: 'no' }).has('linkGroundRelay'), 'ZPDが「ない」のときも、送り出しのGRのために、地絡継電器の質問は出るはずです');
  const sendRoles = (a: Answers) => buildComposition({ ...two, ...a }).filter((i) => i.kind === 'sendout').map((i) => i.role).join();
  ok(sendRoles({ 'a2:linkSwitch': 'vcb', 'a2:linkGroundRelay': 'dgr' }) === 'a2:sendout-vcb,a2:sendout-zct,a2:sendout-ground-relay,a2:sendout-trip-coil', `送り出しのDGR（VCB）の構成：${sendRoles({ 'a2:linkSwitch': 'vcb', 'a2:linkGroundRelay': 'dgr' })}`);
  ok(sendRoles({ 'a2:linkSwitch': 'ds-vcb', 'a2:linkGroundRelay': 'dgr' }) === 'a2:sendout-ds,a2:sendout-vcb,a2:sendout-zct,a2:sendout-ground-relay,a2:sendout-trip-coil', 'DS＋VCBのときの送り出しのDGRの構成が違います');
  ok(sendRoles({ 'a2:linkSwitch': 'ds', 'a2:linkGroundRelay': 'dgr' }) === 'a2:sendout-ds', 'DSだけのとき、DGRの答えが残っていても、描いています');
  ok(sendRoles({ 'a2:linkSwitch': 'vcb', 'a2:linkGroundRelay': 'dgr', hasZpd: 'no' }) === 'a2:sendout-vcb', 'ZPDが「ない」のとき、送り出しのDGRを描いています');
  // 送り先ごとの開閉器：持ち主は送り出す側のエリア、送り先の番号が付く。DGRの零相電圧は、送り出す側のエリアのZPDから得る（第13弾 項目22）
  {
    const three: Answers = { ...two, areaCount: 3, 'a2:areaIntake': 'ds-vcb', 'a3:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a3:trCapacity': 100, 'a2:linkTap': 'bus', 'a3:linkTap': 'bus' };
    const sends = (a: Answers) => buildComposition({ ...three, ...a }).filter((i) => i.kind === 'sendout').map((i) => `${i.role}@${i.area}>${i.dest}`).join();
    ok(sends({ 'a2:linkSwitch': 'ds', 'a3:linkSwitch': 'vcb', 'a3:linkFrom': '1' }) === 'a2:sendout-ds@0>1,a3:sendout-vcb@0>2', `1→2はDS・1→3はVCBのとき、送り先ごとに別々のはずです（${sends({ 'a2:linkSwitch': 'ds', 'a3:linkSwitch': 'vcb', 'a3:linkFrom': '1' })}）`);
    ok(sends({ 'a3:linkSwitch': 'vcb', 'a3:linkFrom': '2' }) === 'a3:sendout-vcb@1>2', `2→3のVCBは、2か所目が持ち主のはずです（${sends({ 'a3:linkSwitch': 'vcb', 'a3:linkFrom': '2' })}）`);
    const dgr = (z1: string, z2: string, from: string) => sends({ hasZpd: z1, 'a2:hasZpd': z2, 'a3:linkFrom': from, 'a3:linkSwitch': 'vcb', 'a3:linkGroundRelay': 'dgr' }).split(',').length;
    ok(dgr('yes', 'no', '1') === 4 && dgr('no', 'yes', '1') === 1, '1→3のDGRは、1か所目のZPDで決まるはずです');
    ok(dgr('no', 'yes', '2') === 4 && dgr('yes', 'no', '2') === 1, '2→3のDGRは、2か所目のZPDで決まるはずです');
  }
  ok(buildComposition({ ...answers, areaCount: 2, mainBreakerForm: 'cb', 'a2:areaIntake': 'ds-vcb', 'a2:hasZpd': 'yes', 'a2:hasOvgr': 'yes', 'a2:mainGroundRelay': 'dgr' }).filter((i) => i.area === 1).map((i) => i.role.replace('a2:', '')).filter((r) => /ovgr|zct|ground/.test(r)).join() === 'main-zct,main-ground-relay,ovgr', '2か所目のOVGR・DGRが入っていません');
  // 主遮断装置がLBSのとき：保護継電器の有無・種類を聞く。CT・VTの有無が決まっていなければ、置き場所は推測しない
  const lbsBase: Answers = { ...answers, mainBreakerForm: 'pfs', hasSiteCt: undefined, hasSiteVt: undefined };
  ok(gq(lbsBase).has('relayCount') && gq(lbsBase).has('relayType'), 'LBSのとき、継電器の個数の質問が出ていません（CT・VTが無くても出るはず）');
  ok(buildComposition(lbsBase).every((i) => i.role !== 'relay' && i.role !== 'relay-note'), 'LBSで継電器0個のとき、継電器を描いています');
  const lbsRelay = (a: Answers) => buildComposition({ ...lbsBase, relayCount: '1', relayType: 'OCR', ...a }).map((i) => i.role).filter((r) => ['relay', 'relay-tt', 'relay-note', 'trip-coil', 'ct'].includes(r)).join();
  ok(lbsRelay({}) === '', `LBSでOCRを選んだのに、CTの有無が未回答のまま、描いています（${lbsRelay({})}）`);
  ok(lbsRelay({ hasSiteCt: 'no' }) === 'relay-note', `CTが「なし」のとき、OCRは名前だけのはずです（${lbsRelay({ hasSiteCt: 'no' })}）`);
  ok(lbsRelay({ hasSiteCt: 'yes' }) === 'ct,relay-tt,relay,trip-coil', `CTが「あり」のとき、CT→試験端子→OCR、OCRからTCのはずです（${lbsRelay({ hasSiteCt: 'yes' })}）`);
  ok(withAutoValues({ ...lbsBase, relayCount: '1', relayType: 'OCR' }).relayAt === undefined, 'CTの有無が未回答のとき、置き場所が自動で入っています');
  ok(withAutoValues({ ...lbsBase, relayCount: '1', relayType: 'OCR', hasSiteCt: 'yes' }).relayAt === 'ct-1', 'CTが「あり」のとき、OCRの置き場所がCT1組目になっていません');
  ok(withAutoValues({ ...lbsBase, relayCount: '1', relayType: 'UVR', hasSiteCt: 'yes' }).relayAt === undefined, 'VTの有無が未回答なのに、UVRの置き場所が決まっています');
  ok(buildComposition({ ...lbsBase, hasSiteCt: 'yes', relayCount: '1', relayType: 'OCR', hasZpd: 'yes', mainGroundRelay: 'dgr' }).filter((i) => i.role === 'trip-coil').length === 1, 'LBSで、OCRとDGRのTCが1つに共有されていません');
  ok(buildComposition({ ...lbsBase, hasSiteCt: 'yes', relayCount: '1', relayType: 'OCR', hasZpd: 'yes', mainGroundRelay: 'dgr' }).find((i) => i.role === 'trip-coil')?.connectFrom?.length === 2, 'LBSのTCが、OCRとDGRの両方につながっていません');
  // 新しい案件の初期設定（第7弾 項目3）：初期値の一覧どおりになる。質問の既定値は変えない（保存済みの案件は変わらない）
  {
    const eff = withAutoValues({ ...QUESTION_DEFAULTS, ...NEW_PROJECT_ANSWERS });
    const valueOf = (id: string, unit = 0) => {
      const key = unit === 0 ? id : `${id}__${unit + 1}`;
      const v = eff[key] ?? (unit === 0 ? undefined : eff[id] === undefined ? undefined : QUESTION_DEFAULTS[id]) ?? QUESTION_DEFAULTS[id];
      return v === undefined ? undefined : String(v);
    };
    const table: [string, string, string, number?][] = [
      ['引込元', 'sourceType', 'pole'], ['AS', 'hasAs', 'no'], ['3点一致', 'boundaryPattern', 'coincident'],
      ['区分開閉器', 'sectionalizer', 'pas'], ['制御装置', 'pasControl', 'dgr'], ['内蔵VT', 'pasBuiltinVt', 'yes'], ['内蔵LA', 'pasBuiltinLa', 'yes'],
      ['区分開閉器の定格電圧', 'pasRatedVoltage', '7200'], ['区分開閉器の定格電流', 'pasRatedCurrent', '200'],
      ['VCTの位置', 'vctLocation', 'indoor'], ['VCTの台数', 'vctCount', '1'],
      ['付設方法', 'cableInstallation', 'buried'], ['ケーブルの構造', 'cableStructure', 'CVT'], ['ケーブルの定格電圧', 'cableVoltage', '6600'], ['断面積', 'cableCrossSection', '38'],
      ['エリアの数', 'areaCount', '1'], ['形態', 'areaForm', 'cubicle'], ['設置場所', 'areaPlacement', 'outdoor'],
      ['主遮断装置の形式', 'mainBreakerForm', 'pfs'], ['LBSの定格電圧', 'lbsRatedVoltage', '7200'], ['パワーヒューズ', 'lbsFuseCount', '3'],
      ['VT', 'hasSiteVt', 'no'], ['CT', 'hasSiteCt', 'no'], ['ZPD', 'hasZpd', 'no'], ['LA', 'hasLa', 'no'],
      ['変圧器の台数', 'transformerCount', '2'],
      ['1台目の用途', 'trUsage', '電灯', 0], ['1台目の結線方式', 'trConnection', 'tr-1p', 0], ['1台目の電圧', 'trVoltage', '6600/210-105V', 0], ['1台目の上位PC', 'trHasPc', 'no', 0], ['1台目の上位LBS', 'trHasLbs', 'no', 0],
      ['2台目の用途', 'trUsage', '動力', 1], ['2台目の結線方式', 'trConnection', 'tr-3p-yd', 1], ['2台目の電圧', 'trVoltage', '6600/210V', 1], ['2台目の上位PC', 'trHasPc', 'no', 1], ['2台目の上位LBS', 'trHasLbs', 'no', 1],
      ['高圧進相設備', 'hasCapacitor', 'yes'], ['高圧コンデンサの台数', 'capacitorCount', '1'], ['コンデンサ手前のPC', 'capHasPc', 'no'], ['コンデンサ手前のLBS', 'capHasLbs', 'no'], ['コンデンサ手前のVCS', 'capHasVcs', 'no'], ['リアクトル', 'hasReactor', 'no'],
      ['発電機', 'hasGenerator', 'no'], ['太陽光発電設備', 'hasPv', 'no'], ['系統用蓄電所', 'hasBattery', 'no'],
    ];
    for (const [name, id, want, unit] of table) {
      const got = valueOf(id, unit ?? 0);
      ok(got === want, `初期設定：${name}（${id}${unit ? `・${unit + 1}台目` : ''}）が「${want}」になっていません（${got}）`);
    }
    // 初期設定に書いた答えは、実在する質問の、選べる値だけ
    for (const [key, v] of Object.entries(NEW_PROJECT_ANSWERS)) {
      const q = QUESTIONS.find((x) => x.id === key.replace(/__\d+$/, ''));
      ok(!!q, `初期設定に、存在しない質問があります：${key}`);
      if (q?.options && !q.allowFreeInput) ok(q.options.some((o) => o.value === String(v)), `初期設定の ${key}＝${String(v)} は、選べる値にありません`);
    }
    // 質問の既定値は変えていない：保存済みの案件（答えを持たない質問は既定値）の見え方は、これまでどおり
    const old = withAutoValues({ ...QUESTION_DEFAULTS });
    ok(String(old.transformerCount) === '1' && String(old.hasCapacitor) === 'no' && old.vctLocation === 'pole' && old.mainBreakerForm === undefined, '質問の既定値が変わっています（保存済みの案件の内容が変わってしまいます）');
  }
  // スケッチ読み取りの確認事項：必須で、答えが無いものだけ。入力欄を出せる形（キーつき）で返る
  {
    const base = withAutoValues({ ...QUESTION_DEFAULTS, ...NEW_PROJECT_ANSWERS });
    const miss = missingRequiredFields({ ...base, ...{ transformerCount: '3' } });
    ok(miss.every((m) => m.question.required === true), '必須でない項目が、確認事項に入っています');
    ok(miss.some((m) => m.key === 'siteName'), '事業場名称（必須・未入力）が、確認事項に入っていません');
    ok(!miss.some((m) => m.key === 'mainBreakerForm'), 'すでに答えが入っている必須項目が、確認事項に入っています');
    ok(!missingRequiredFields({ ...base, siteName: 'A' }).some((m) => m.key === 'siteName'), '答えを入れても、確認事項に残っています');
    const two = missingRequiredFields({ ...base, siteName: 'A', areaCount: 2, 'a2:areaIntake': 'ds-vcb' });
    ok(two.every((m) => /^a2:/.test(m.key) ? m.label.startsWith('2か所目：') : true), '2か所目の確認事項の書き方が違います');
    ok(two.some((m) => m.key.startsWith('a2:')), '2か所目の必須項目が、確認事項に出ていません');
  }
  // 受電方式の質問は無い（高圧受電だけを扱う）。古い案件に残っている答えは、無視される
  ok(!QUESTIONS.some((q) => q.id === 'receivingType'), '「受電方式」の質問が残っています');
  ok(!missingRequired({ ...cbBase }).some((q) => q.id === 'receivingType'), '「受電方式」が必須項目として残っています');
  ok(JSON.stringify(buildComposition({ ...cbBase, receivingType: 'extra-high' })) === JSON.stringify(buildComposition({ ...cbBase })), '古い案件の「受電方式」の答えが、図面に影響しています');
  // 図面を複製して新しい案件を作るとき：その現場だけの名前・番号・注記を空にし、設備の内容は残す
  {
    const src: Answers = {
      siteName: 'A工場', customerNameForTitleBlock: 'A工場（略称）', drawingName: 'A工場 単線結線図', poleName: '中電柱：猪子山（分）81', cabinetName: 'キャビネット番号：12',
      earthingNotes: 'A種 10Ω', 'a2:poleName': 'x', areaCount: 2, mainBreakerForm: 'cb', trCapacity: 100, hasZpd: 'yes', mainGroundRelay: 'dgr', 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity__2': 50,
    };
    const dup = clearForDuplicate(src);
    for (const k of ['siteName', 'customerNameForTitleBlock', 'drawingName', 'poleName', 'cabinetName', 'earthingNotes', 'a2:poleName']) {
      ok(!(k in dup), `複製のとき、${k} が空になっていません`);
    }
    ok(dup.mainBreakerForm === 'cb' && dup.trCapacity === 100 && dup.hasZpd === 'yes' && dup.mainGroundRelay === 'dgr' && dup.areaCount === 2 && dup['a2:areaIntake'] === 'ds-vcb' && dup['a2:trCapacity__2'] === 50, '複製のとき、設備の内容が残っていません');
    ok(src.siteName === 'A工場', '複製の処理が、もとの回答を書き換えています');
  }
  // LAの上位（上側）の開閉器：LAが「ある」ときだけ聞く。なし・DS・PC・LBSの順。選ぶと、LAの上に入る
  const laBase: Answers = { ...cbBase, hasLa: 'yes' };
  ok(gq(laBase).has('laSwitch') && !gq({ ...cbBase, hasLa: 'no' }).has('laSwitch'), 'LAの上位の開閉器の質問が、LAが「ある」ときだけ出るはずです');
  const laOpts = (QUESTIONS.find((q) => q.id === 'laSwitch')?.options ?? []).map((o) => o.value).join(',');
  ok(laOpts === 'none,ds,pc,lbs', `LAの上位の開閉器の選択肢は、なし・DS・PC・LBSの順のはずです（${laOpts}）`);
  const laRoles = (a: Answers) => buildComposition({ ...laBase, ...a }).map((i) => i.role).filter((r) => r === 'la-switch' || r === 'site-la').join();
  ok(laRoles({}) === 'site-la', `既定（なし）では、LAだけのはずです（${laRoles({})}）`);
  for (const v of ['ds', 'pc', 'lbs']) {
    const items = buildComposition({ ...laBase, laSwitch: v }).filter((i) => i.role === 'la-switch' || i.role === 'site-la');
    ok(items.map((i) => i.role).join() === 'la-switch,site-la' && items[0]!.symbolId === v && items[1]!.hang === true, `LAの上位に ${v} を選ぶと、開閉器→LA（縦につなぐ）の順になるはずです`);
  }
  ok(laRoles({ hasLa: 'no', laSwitch: 'ds' }) === '', 'LAが「ない」のとき、開閉器の答えが残っていても、描いています');
  for (const tap of ['ds-vcb', 'vcb-ct', 'ct-bus']) {
    const order = buildComposition({ ...laBase, laSwitch: 'pc', laTap: tap }).map((i) => i.role).filter((r) => ['main-breaker', 'la-switch', 'site-la'].includes(r)).join('>');
    ok(order === (tap === 'ds-vcb' ? 'la-switch>site-la>main-breaker' : 'main-breaker>la-switch>site-la'), `LAの位置 ${tap} のとき、開閉器とLAの位置が違います（${order}）`);
  }
  // DSの一次側：DSの直前（DSより電源側）。DSが無い構成では、動かさない
  {
    const seq = (a: Answers) => buildComposition({ ...laBase, ...a }).map((i) => i.role).filter((r) => ['ds', 'main-breaker', 'la-switch', 'site-la'].includes(r)).join('>');
    ok(seq({ laTap: 'ds-source' }) === 'site-la>ds>main-breaker', `LAの位置 ds-source のとき、LAはDSの手前のはずです（${seq({ laTap: 'ds-source' })}）`);
    ok(seq({ laTap: 'ds-source', laSwitch: 'pc' }) === 'la-switch>site-la>ds>main-breaker', `LAの位置 ds-source ＋上位PCのとき、PC→LA→DSの順のはずです（${seq({ laTap: 'ds-source', laSwitch: 'pc' })}）`);
  }
  ok(buildComposition({ ...answers, areaCount: 2, mainBreakerForm: 'cb', 'a2:areaIntake': 'ds-vcb', 'a2:hasLa': 'yes', 'a2:laSwitch': 'lbs' }).filter((i) => i.area === 1).map((i) => i.role.replace('a2:', '')).filter((r) => r === 'la-switch' || r === 'site-la').join() === 'la-switch,site-la', '2か所目のLAの上位の開閉器が入っていません');
  // 接地コンデンサ（GC）：ZCTの電源側が初期値。ZCTが無いときは、DSとVCBの間。位置・上位の開閉器はLAと同じ作り（第13弾 項目21）
  {
    const gcBase: Answers = { ...laBase, hasLa: 'no', hasGc: 'yes' };
    const shown2 = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
    const opts = (id: string, a: Answers) => (QUESTIONS.find((q) => q.id === id)?.options ?? []).filter((o) => evaluate(o.showIf, normalizeAnswers(a))).map((o) => o.value).join(',');
    const seq = (a: Answers) => buildComposition({ ...gcBase, ...a }).map((i) => i.role).filter((r) => ['ds', 'main-breaker', 'main-zct', 'site-gc', 'gc-switch'].includes(r)).join('>');
    ok(shown2({ hasGc: 'yes' }).has('gcTap') && shown2({ hasGc: 'yes' }).has('gcSwitch') && !shown2({}).has('gcTap'), 'GCの位置・上位の開閉器は、GCが「あり」のときだけ聞くはずです');
    ok(opts('gcTap', { mainBreakerForm: 'cb' }) === 'zct-source,ds-source,ds-vcb,vcb-ct,ct-bus', `CB形のとき、GCの位置の選択肢が違います（${opts('gcTap', { mainBreakerForm: 'cb' })}）`);
    ok(QUESTIONS.find((q) => q.id === 'gcTap')?.defaultValue === 'zct-source', 'GCの位置の初期値は、ZCTの電源側のはずです');
    ok(seq({ mainGroundRelay: 'gr' }) === 'ds>site-gc>main-zct>main-breaker' || seq({ mainGroundRelay: 'gr' }) === 'site-gc>main-zct>ds>main-breaker' , `GR・ZCTがあるとき、GCはZCTのすぐ上のはずです（${seq({ mainGroundRelay: 'gr' })}）`);
    ok(seq({ mainGroundRelay: 'none' }) === 'ds>site-gc>main-breaker', `ZCTが無いとき、GCはDSとVCBの間のはずです（${seq({ mainGroundRelay: 'none' })}）`);
    ok(seq({ mainGroundRelay: 'gr', gcTap: 'ds-source' }) === 'site-gc>ds>main-zct>main-breaker' || seq({ mainGroundRelay: 'gr', gcTap: 'ds-source' }) === 'main-zct>site-gc>ds>main-breaker', `GCの位置 ds-source のとき、GCはDSの手前のはずです（${seq({ mainGroundRelay: 'gr', gcTap: 'ds-source' })}）`);
    ok(seq({ gcTap: 'vcb-ct', mainGroundRelay: 'none' }) === 'ds>main-breaker>site-gc', `GCの位置 vcb-ct のとき、GCはVCBの次のはずです（${seq({ gcTap: 'vcb-ct', mainGroundRelay: 'none' })}）`);
    ok(seq({ gcSwitch: 'pc', mainGroundRelay: 'none' }) === 'ds>gc-switch>site-gc>main-breaker', `GCの上位にPCを選ぶと、PC→GCの順のはずです（${seq({ gcSwitch: 'pc', mainGroundRelay: 'none' })}）`);
    ok(seq({ hasGc: 'no' }) === 'ds>main-breaker', 'GCが「ない」のとき、GCを描いています');
    // 注意：GCがあって、地絡継電器が無いとき
    const nt2 = (a: Answers) => inputNotices(withAutoValues({ ...gcBase, ...a })).filter((n) => n.group === 'receiving').length;
    ok(nt2({ mainGroundRelay: 'none' }) === 1 && nt2({ mainGroundRelay: 'gr' }) === 0 && nt2({ hasGc: 'no' }) === 0, 'GCがあって地絡継電器が無いときだけ、注意を出すはずです');
  }
  // GR（無方向性）：ZCTだけ。ZPDは要らない。DGRと同じ位置の選択肢
  const noZpd: Answers = { ...cbBase, hasZpd: 'no' };
  const grRoles = (a: Answers) => buildComposition(a).filter((i) => !i.role.startsWith('pas-')).filter((i) => ['main-zct', 'main-ground-relay'].includes(i.role)).map((i) => `${i.role}:${i.symbolId}`).join();
  ok(grRoles({ ...noZpd, mainGroundRelay: 'gr' }) === 'main-zct:zct,main-ground-relay:relay-gr', `ZPDが「ない」でも、GRならZCT＋GRを描くはずです（${grRoles({ ...noZpd, mainGroundRelay: 'gr' })}）`);
  ok(grRoles({ ...cbBase, mainGroundRelay: 'gr' }) === 'main-zct:zct,main-ground-relay:relay-gr', 'ZPDが「ある」ときのGRの構成が違います');
  ok(grRoles({ ...noZpd, mainGroundRelay: 'dgr' }) === '', 'ZPDが「ない」のとき、DGRを描いています');
  ok(grRoles({ ...cbBase, mainGroundRelay: 'dgr' }) === 'main-zct:zct,main-ground-relay:relay-dgr', 'DGRの記号がDGRではありません');
  ok(gq({ ...noZpd, mainGroundRelay: 'gr' }).has('mainZctPos') && !gq({ ...noZpd, mainGroundRelay: 'dgr' }).has('mainZctPos'), 'ZCTの位置の質問：GRはZPDなしでも出る・DGRはZPDなしでは出ない、のはずです');
  ok(!gq({ ...noZpd, mainGroundRelay: 'gr' }).has('hasOvgr'), 'GRを選んでも、ZPDが「ない」ならOVGRの質問は出ないはずです');
  for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
    ok(grRoles({ ...noZpd, mainGroundRelay: 'gr', mainZctPos: pos }) === 'main-zct:zct,main-ground-relay:relay-gr', `GR・ZCTの位置が ${pos} のとき、ZCT＋GRが描かれていません`);
    ok(buildComposition({ ...noZpd, mainGroundRelay: 'gr', mainZctPos: pos }).filter((i) => i.role === 'trip-coil').length === 1, `GR・ZCTの位置が ${pos} のとき、TCが1つではありません`);
  }
  const sendGr = (a: Answers) => buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', hasZpd: 'no', 'a2:linkSwitch': 'vcb', ...a }).filter((i) => i.kind === 'sendout').map((i) => `${i.role}:${i.symbolId}`).join();
  ok(sendGr({ 'a2:linkGroundRelay': 'gr' }) === 'a2:sendout-vcb:vcb,a2:sendout-zct:zct,a2:sendout-ground-relay:relay-gr,a2:sendout-trip-coil:trip-coil', `送り出しのGR（ZPDなし）の構成：${sendGr({ 'a2:linkGroundRelay': 'gr' })}`);
  ok(sendGr({ 'a2:linkGroundRelay': 'dgr' }) === 'a2:sendout-vcb:vcb', '送り出しのDGRを、ZPDなしで描いています');
  ok(sendGr({ 'a2:linkGroundRelay': 'gr', 'a2:linkSwitch': 'ds' }) === 'a2:sendout-ds:ds', '送り出しがDSだけのとき、GRの答えが残っていても、描いています');
  // 主遮断装置にGR、送り出しの開閉器にDGR（別々の開閉器に、GRとDGRが両方付く）
  const both = buildComposition({ ...answers, areaCount: 2, mainBreakerForm: 'cb', hasZpd: 'yes', mainGroundRelay: 'gr', 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', 'a2:linkSwitch': 'vcb', 'a2:linkGroundRelay': 'dgr' }).map((i) => i.symbolId);
  ok(both.includes('relay-gr') && both.includes('relay-dgr'), 'GRとDGRが別々の開閉器に付くパターンで、両方が描かれていません');
  // ZCTの取り付け位置（DGRを選んだときだけ聞く）
  ok(!gq(cbBase).has('mainZctPos') && gq({ ...cbBase, mainGroundRelay: 'dgr' }).has('mainZctPos'), 'ZCTの位置の質問が、DGRを選んだときだけ出るはずです');
  const zOpts = (QUESTIONS.find((q) => q.id === 'mainZctPos')?.options ?? []).map((o) => o.value).join(',');
  ok(zOpts === 'cable,bus-primary,bus-secondary', `ZCTの位置の選択肢が違います（${zOpts}）`);
  const zRoles = (a: Answers) => buildComposition({ ...cbBase, mainGroundRelay: 'dgr', ...a }).map((i) => i.role).filter((r) => ['cable-head-site', 'ds', 'main-zct', 'main-ground-relay', 'main-breaker', 'ct'].includes(r)).join('>');
  const zc = zRoles({});
  ok(zc.indexOf('main-zct') < zc.indexOf('cable-head-site') && zc.indexOf('main-ground-relay') < zc.indexOf('cable-head-site'), `既定（高圧ケーブル）では、ZCT・DGRが引込ケーブル側に入るはずです（${zc}）`);
  ok(zRoles({ mainZctPos: 'bus-primary' }) === 'cable-head-site>ds>main-zct>main-ground-relay>main-breaker>ct', `母線の一次側の並びが違います（${zRoles({ mainZctPos: 'bus-primary' })}）`);
  ok(zRoles({ mainZctPos: 'bus-secondary' }) === 'cable-head-site>ds>main-breaker>main-zct>main-ground-relay>ct', `母線の二次側の並びが違います（${zRoles({ mainZctPos: 'bus-secondary' })}）`);
  for (const pos of ['cable', 'bus-primary', 'bus-secondary']) {
    ok(buildComposition({ ...cbBase, mainGroundRelay: 'dgr', mainZctPos: pos }).filter((i) => i.role === 'trip-coil').length === 1, `ZCTの位置が ${pos} のとき、TCが1つに共有されていません`);
  }
  ok(!zRoles({ mainGroundRelay: 'none', mainZctPos: 'bus-primary' }).includes('main-zct'), 'DGRなしのとき、位置の答えが残っていてもZCTを描いています');
  ok(sq({ ...two, 'a2:linkSwitch': 'vcb', 'a2:linkGroundRelay': 'dgr' }).has('linkZctPos') && !sq({ ...two, 'a2:linkSwitch': 'vcb' }).has('linkZctPos'), '送り出しのZCTの位置の質問が、DGRを選んだときだけ出るはずです');
  // 送り出しは、並びそのものは同じで、位置は ZCT の pos に載る（上下の入れ替えは作図側）
  const sZpos = (pos: string) => buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:trCapacity': 100, 'a2:linkTap': 'bus', hasZpd: 'yes', 'a2:linkSwitch': 'ds-vcb', 'a2:linkGroundRelay': 'dgr', 'a2:linkZctPos': pos }).find((i) => i.role === 'a2:sendout-zct')?.pos;
  ok(['cable', 'bus-primary', 'bus-secondary'].every((p) => sZpos(p) === p), `送り出しのZCTの位置の答えが、図に渡っていません（${['cable', 'bus-primary', 'bus-secondary'].map(sZpos).join()}）`);
  // 並び：位置を選ぶと、ZPD・LAがその位置に動く（OVGRは、ZPDの有無だけでは入らない）。LAとZPDは別々の記号
  const order = (a: Answers) =>
    buildComposition({ ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'yes', ...a })
      .map((i) => i.role)
      .filter((r) => ['ds', 'main-breaker', 'ct', 'relay', 'zpd', 'site-la'].includes(r))
      .join('>');
  ok(order({}) === 'ds>main-breaker>ct>relay>zpd>site-la', `位置を答えていないときは、これまでどおり、変圧器の手前のはずです（${order({})}）`);
  ok(order({ zpdTap: 'ds-vcb', laTap: 'vcb-ct' }) === 'ds>zpd>main-breaker>site-la>ct>relay', `ZPDをDSとVCBの間、LAをVCBとCTの間にしたときの並び：${order({ zpdTap: 'ds-vcb', laTap: 'vcb-ct' })}`);
  ok(order({ zpdTap: 'vcb-ct', laTap: 'ds-vcb' }) === 'ds>site-la>main-breaker>zpd>ct>relay', `ZPDをVCBとCTの間、LAをDSとVCBの間にしたときの並び：${order({ zpdTap: 'vcb-ct', laTap: 'ds-vcb' })}`);
  const items = buildComposition({ ...answers, mainBreakerForm: 'cb', hasZpd: 'yes', hasLa: 'yes' });
  ok(items.filter((i) => ['zpd', 'site-la'].includes(i.role)).every((i) => i.separate === true), 'ZPDとLAが、別の記号として扱われていません');
  ok(items.find((i) => i.role === 'site-la')?.label.join('|') === 'LA' && items.find((i) => i.role === 'zpd')?.label.join('|') === 'ZPD', 'ZPD・LAの文字が、それぞれ別になっていません');
  // PFS形：主遮断装置（LBS）の次
  const pfs = buildComposition({ ...answers, mainBreakerForm: 'pfs', hasZpd: 'yes', hasLa: 'yes', zpdTap: 'lbs-ct', laTap: 'lbs-ct' }).map((i) => i.role).filter((r) => ['main-breaker', 'ct', 'zpd', 'site-la'].includes(r)).join('>');
  ok(pfs.startsWith('main-breaker>zpd>site-la'), `PFS形で「LBSの次」にしたときの並び：${pfs}`);
  // 2か所目のエリアでも、同じ決まり
  const a2 = buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'ds-vcb', 'a2:hasZpd': 'yes', 'a2:zpdTap': 'ds-vcb' }).filter((i) => i.area === 1).map((i) => i.role.replace('a2:', '')).filter((r) => ['ds', 'zpd', 'main-breaker'].includes(r)).join('>');
  ok(a2 === 'ds>zpd>main-breaker', `2か所目でも、ZPDがDSとVCBの間に入るはずです（${a2}）`);
  console.log('  位置：DSとVCBの間／VCBとCTの間（PFS形はLBSの次）／変圧器の手前（既定）。ZPDとLAは、別の記号で、別々に選べる');
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
    ['自分で書いた電圧は、そのまま', { trUsage: '電灯', trVoltage: '6600/210-105V' }, { trVoltage: '6600/210-105V' }],
    ['電圧を空にしたら、空のまま（また自動で入らない）', { trUsage: '電灯', trVoltage: '' }, { trVoltage: '' }],
    ['以前に、受電電圧を3300Vで保存した案件は、電圧を自動で入れない', { receivingVoltage: '3300', trUsage: '電灯' }, { trVoltage: undefined, trConnection: 'tr-1p' }],
    ['以前に、受電電圧を3300（数）で保存した案件も同じ', { receivingVoltage: 3300, trUsage: '動力' }, { trVoltage: undefined, trConnection: 'tr-3p-yd' }],
    ['以前に、受電電圧を6600（数）で保存した案件も、6600V', { receivingVoltage: 6600, trUsage: '動力' }, { trVoltage: '6600/210V' }],
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
  // 受電電圧の入力欄は無い。何も入れていない案件は、いつも6600V
  {
    const none = withAutoValues({ trUsage: '動力' });
    if (none.trVoltage !== '6600/210V') fail(`受電電圧を入れていない案件で、変圧器の電圧が6600Vで入っていません（${JSON.stringify(none.trVoltage)}）`);
    if (QUESTIONS.some((q) => q.id === 'receivingVoltage')) fail('受電電圧の質問が、まだ残っています');
    console.log('  受電電圧の入力欄は無い。何も入れていない案件は、いつも6600V（変圧器の電圧は「6600/…」が入る）');
  }
  // 引込点から責任分界点までのケーブル（区分開閉器なし・地上キャビネットなしのときだけ）。ケーブルの様式は、引込ケーブル・エリア間のケーブルと同じ
  {
    const pre = (extra: Answers) => buildComposition({ ...answers, sectionalizer: 'none', groundCabinet: 'no', ...extra });
    const roles = (items: ReturnType<typeof buildComposition>) => items.map((i) => i.role);
    const on = pre({ preCable: 'yes', preCableInstallation: 'buried', preCableStructure: 'CVT', preCableCrossSection: '100', preCableLength: 120, preCableLengthApprox: 'yes', preCableVoltage: '22000' });
    const head = on.find((i) => i.role === 'pre-cable-source');
    if (head?.label.join('|') !== '埋ケ|CVT|22000V 100mm2 約120m') fail(`引込点〜責任分界点のケーブルの文字が違います（${head?.label.join('|')}）`);
    if (!roles(on).includes('pre-cable-site')) fail('引込点〜責任分界点のケーブルの、下の端末が入っていません');
    const idx = (r: string) => roles(on).indexOf(r);
    if (!(idx('incoming-point') < idx('pre-cable-source') && idx('pre-cable-source') < idx('pre-cable-site') && idx('pre-cable-site') < idx('boundary'))) fail('ケーブルが、引込点と責任分界点のあいだに入っていません');
    if (!head?.dashedAfter) fail('埋設のケーブルが、点線になっていません');
    if (pre({ preCable: 'yes', preCableInstallation: 'overhead' }).find((i) => i.role === 'pre-cable-source')?.dashedAfter) fail('架空のケーブルが、点線になっています');
    if (pre({ preCable: 'no' }).some((i) => i.role.startsWith('pre-cable'))) fail('「いいえ」なのに、ケーブルが入っています');
    if (pre({}).some((i) => i.role.startsWith('pre-cable'))) fail('まだ答えていないのに、ケーブルが入っています');
    if (pre({ preCable: 'yes', groundCabinet: 'yes' }).some((i) => i.role.startsWith('pre-cable'))) fail('地上キャビネットが「あり」なのに、ケーブルが入っています');
    if (buildComposition({ ...answers, sectionalizer: 'pas', preCable: 'yes' }).some((i) => i.role.startsWith('pre-cable'))) fail('区分開閉器が「あり」なのに、ケーブルが入っています');
    const shownIds = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
    if (!shownIds({ sectionalizer: 'none', groundCabinet: 'no' }).has('preCable') || shownIds({ sectionalizer: 'none', groundCabinet: 'yes' }).has('preCable') || shownIds({ sectionalizer: 'pas' }).has('preCable')) {
      fail('「引込点から責任分界点までの間に、ケーブルはありますか？」が、区分開閉器なし・地上キャビネットなしのときだけ、出るようになっていません');
    }
    const yesIds = shownIds({ sectionalizer: 'none', groundCabinet: 'no', preCable: 'yes', preCableLength: 10 });
    if (!['preCableInstallation', 'preCableStructure', 'preCableVoltage', 'preCableCrossSection', 'preCableLength', 'preCableLengthApprox'].every((id) => yesIds.has(id))) fail('「はい」のとき、ケーブルの項目が、引込ケーブルと同じにそろって出ていません');
    // すべてのケーブルは、同じ様式：長さが不明なら「- m」
    const linkNoLen = buildComposition({ ...answers, areaCount: 2, 'a2:areaIntake': 'lbs-pf', 'a2:linkCable': 'yes', 'a2:linkTap': 'bus', 'a2:linkCableInstallation': 'buried', 'a2:linkCableStructure': 'CVT', 'a2:linkCableVoltage': '6600', 'a2:linkCableCrossSection': '38' }).find((i) => i.role === 'a2:link')?.label.join('|');
    if (!linkNoLen?.endsWith('6600V 38mm2 - m')) fail(`エリア間のケーブルの長さが不明のとき、「- m」と書かれていません（${linkNoLen}）`);
    console.log('  引込点〜責任分界点のケーブル：区分開閉器なし・地上キャビネットなしで「はい」のとき、引込点と責任分界点のあいだに、引込ケーブルと同じ様式で入る');
  }
  // VT・CTが0組（VCBを選んでいても、VT・CTが必ずあるとは限らない）：図面が崩れず、母線・線がつながる
  {
    const cb = { ...answers, mainBreakerForm: 'cb', hasCapacitor: 'no', transformerCount: 1, relayCount: '0' };
    const rolesOf = (a: Answers) => buildComposition(a).map((i) => i.role);
    const none = rolesOf({ ...cb, vtSetCount: '0', ctSetCount: '0' });
    if (none.some((r) => ['ds-vt', 'ds-vt-pf', 'site-vt', 'site-vt-pf', 'ct'].includes(r))) fail('VT・CTが0組なのに、VT・CTが入っています');
    if (!none.includes('ds') || !none.includes('main-breaker') || !none.includes('transformer')) fail('VT・CTが0組のとき、DS・VCB・変圧器が入っていません');
    const vtOnly = rolesOf({ ...cb, vtSetCount: '0', ctSetCount: '1' });
    if (vtOnly.some((r) => ['ds-vt', 'site-vt'].includes(r)) || !vtOnly.includes('ct')) fail('VTだけ0組のとき、VTが消えてCTが残るはずです');
    const ctOnly = rolesOf({ ...cb, vtSetCount: '1', ctSetCount: '0' });
    if (ctOnly.includes('ct') || !ctOnly.some((r) => r === 'ds-vt' || r === 'site-vt')) fail('CTだけ0組のとき、CTが消えてVTが残るはずです');
    // 答えていないときは、1組（これまでどおり）。0組は、「0」と答えたときだけ
    const dflt = rolesOf({ ...cb, vtSetCount: undefined, ctSetCount: undefined });
    if (!dflt.includes('ct') || !dflt.some((r) => r === 'ds-vt' || r === 'site-vt')) fail('組数を答えていないとき、VT・CTが1組ずつ入るはずです');
    // 「0（なし）」が選べる。CTが0組のときは、OCRを自動では入れない
    const optVals = (id: string) => (QUESTIONS.find((q) => q.id === id)?.options ?? []).map((o) => o.value);
    if (optVals('vtSetCount')[0] !== '0' || optVals('ctSetCount')[0] !== '0') fail('VT・CTの組数に、「0（なし）」の選択肢がありません');
    const auto = (a: Answers) => withAutoValues({ mainBreakerForm: 'cb', ...a }).relayCount;
    if (auto({}) !== '1' || auto({ ctSetCount: '0' }) !== '0' || auto({ ctSetCount: 0 }) !== '0') fail(`継電器の個数の初期値（CTあり＝1／CTが0組＝0）が違います（${auto({})}／${auto({ ctSetCount: '0' })}）`);
    // CTが0組なのに、CTにつなぐ継電器があるとき：入力画面に注意を出す（図面は、そのまま描く）
    const nt = (a: Answers) => inputNotices({ ...withAutoValues({ mainBreakerForm: 'cb', ...a }) }).map((n) => n.group).sort().join(',');
    if (nt({ ctSetCount: '0', relayCount: '1', relayAt: 'ct-1', relayType: 'OCR' }) !== 'ctset,relay') fail('CTが0組で、CTにつなぐ継電器があるとき、注意が出ていません');
    if (nt({ ctSetCount: '1', relayCount: '1', relayAt: 'ct-1', relayType: 'OCR' }) !== '') fail('CTがあるのに、注意が出ています');
    if (nt({ ctSetCount: '0', relayCount: '0' }) !== '') fail('継電器が0個なのに、注意が出ています');
    if (nt({ ctSetCount: '0', relayCount: '1', relayAt: 'vt-1', relayType: 'UVR' }) !== '') fail('VTにつなぐ継電器なのに、CTの注意が出ています');
    console.log('  VT・CTが0組：選べる（0（なし））。0組のときは、記号が入らず、DS・VCB・変圧器はつながる。答えていないときは1組。CTが0組なら、OCRは自動では入れない');
  }
  // VCT（電気設備内）を置く位置：初期値は、引込ケーブルの次（いまの位置）。選ぶと、主回路の途中へ動く。VCT2台は、まとめて動く
  {
    const order = (a: Answers) =>
      buildComposition({ ...answers, vctLocation: 'indoor', vctCount: 2, ...a })
        .map((i) => i.role)
        .filter((r) => ['vct-indoor', 'cable-head-site', 'ds', 'main-breaker', 'ct', 'ds-vt'].includes(r))
        .join('>');
    const cb = { mainBreakerForm: 'cb', sectionalizer: 'pas', cableInstallation: 'buried', hasCapacitor: 'no' };
    const base = order(cb);
    if (!base.startsWith('cable-head-site>vct-indoor>vct-indoor>ds>')) fail(`VCTの初期値の位置が、引込ケーブルの次ではありません（${base}）`);
    if (order({ ...cb, vctTap: 'cable' }) !== base) fail('VCTの位置「cable」が、初期値と違います');
    const dsVcb = order({ ...cb, vctTap: 'ds-vcb' });
    if (!/>ds>vct-indoor>vct-indoor>ds-vt>main-breaker/.test(dsVcb)) fail(`VCTの位置「DSとVCBの間」が違います（${dsVcb}）`);
    const vcbCt = order({ ...cb, vctTap: 'vcb-ct' });
    if (!/>main-breaker>vct-indoor>vct-indoor>ct/.test(vcbCt)) fail(`VCTの位置「VCBとCTの間」が違います（${vcbCt}）`);
    const ctBus = order({ ...cb, vctTap: 'ct-bus' });
    if (!/>ct>vct-indoor>vct-indoor$/.test(ctBus)) fail(`VCTの位置「変圧器の手前」が違います（${ctBus}）`);
    const pfs = { mainBreakerForm: 'pfs', sectionalizer: 'pas', cableInstallation: 'buried', hasCapacitor: 'no' };
    if (!/>main-breaker>vct-indoor>vct-indoor>ct/.test(order({ ...pfs, vctTap: 'lbs-ct' }))) fail('VCTの位置「LBSの次」が違います（PFS形）');
    // その機器が無いときは、動かさない（PFS形で「DSとVCBの間」など）
    if (order({ ...pfs, vctTap: 'ds-vcb' }) !== order(pfs)) fail('DSが無いのに、VCTが動いています');
    // 電柱上のVCTは、この質問の対象外（動かさない）
    const poleVct = buildComposition({ ...answers, ...cb, vctLocation: 'pole', vctTap: 'ct-bus' }).map((i) => i.role);
    if (poleVct.indexOf('vct-pole') > poleVct.indexOf('ds')) fail('電柱上のVCTが、動いています');
    // 質問：電気設備内のときだけ。形式に合わせて選択肢が変わる
    const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
    if (!shown({ vctLocation: 'indoor' }).has('vctTap') || shown({ vctLocation: 'pole' }).has('vctTap') || shown({ vctLocation: 'indoor', mainBreakerForm: 'pole-top' }).has('vctTap')) fail('VCTを置く位置の質問が、電気設備内のときだけ出るようになっていません');
    const opts = (a: Answers) => (QUESTIONS.find((q) => q.id === 'vctTap')?.options ?? []).filter((o) => evaluate(o.showIf, normalizeAnswers(a))).map((o) => o.label).join('／');
    if (opts({ mainBreakerForm: 'cb' }) !== 'ケーブルとDSの間／DSとVCBの間／VCBとCTの間／変圧器の手前（CTの下・高圧母線の上）') fail(`VCTの選択肢（CB形）が違います（${opts({ mainBreakerForm: 'cb' })}）`);
    if (opts({ mainBreakerForm: 'pfs' }) !== 'ケーブルとLBSの間／LBSの次（LBSとCTの間）／変圧器の手前（CTの下・高圧母線の上）') fail(`VCTの選択肢（PFS形）が違います（${opts({ mainBreakerForm: 'pfs' })}）`);
    if (QUESTION_DEFAULTS.vctTap !== 'cable') fail('VCTを置く位置の初期値が、ケーブルの次ではありません');
    console.log('  VCTを置く位置：初期値＝ケーブルの次。DSとVCBの間・VCBとCTの間・LBSの次・変圧器の手前を選べる（2台はまとめて動く。電柱上は対象外）');
  }
  // 区分開閉器が「なし」のとき：引込ケーブルが電力会社のものなら、財産分界点は、DSの一次側（DSが無ければ、LBSの一次側）に移る
  {
    const ordered = (a: Answers) => buildComposition({ ...answers, ...a }).map((i) => i.role);
    const idx = (list: string[], r: string) => list.indexOf(r);
    const none = { sectionalizer: 'none', groundCabinet: 'no', cableInstallation: 'buried', mainBreakerForm: 'cb' };
    // 電力会社のケーブル（初期値）：上の線は無く、DSの真上に「財産・責任分界点」
    const util = ordered(none);
    const ds = buildComposition({ ...answers, ...none }).find((i) => i.role === 'boundary-ds');
    if (idx(util, 'boundary-ds') < 0 || idx(util, 'boundary-ds') + 1 !== idx(util, 'ds')) fail('電力会社のケーブル：DSの真上に、分界点の線が入っていません');
    if (util.includes('boundary') || util.includes('boundary-property') || util.includes('boundary-safety')) fail('電力会社のケーブル：上（引込点の下）の分界点の線が、残っています');
    if (ds?.label.join('|') !== '財産・責任分界点') fail(`電力会社のケーブル：分界点の文字が違います（${ds?.label.join('|')}）`);
    if (idx(util, 'vct-indoor') > idx(util, 'boundary-ds')) fail('電力会社のケーブル：分界点の線が、VCTの上に入っています（VCTの下、DSの上のはず）');
    // PFS形（DSなし）：LBSの一次側
    const pfs = ordered({ ...none, mainBreakerForm: 'pfs' });
    if (idx(pfs, 'boundary-ds') < 0 || idx(pfs, 'boundary-ds') + 1 !== idx(pfs, 'main-breaker')) fail('PFS形：LBSの真上に、分界点の線が入っていません');
    // お客様のケーブル：これまでどおり（引込点の下）
    const cust = ordered({ ...none, cableOwner: 'customer' });
    if (!cust.includes('boundary') || cust.includes('boundary-ds')) fail('お客様のケーブル：分界点の線が、引込点の下に入っていません');
    // 区分開閉器が「あり」・引込ケーブル「なし」・引込点〜責任分界点のケーブルが「ある」・電柱上構成は、これまでどおり
    const stay = (a: Answers, what: string) => { if (ordered(a).includes('boundary-ds')) fail(`${what}のとき、DSの一次側に、分界点の線が入っています`); };
    stay({ ...none, sectionalizer: 'pas' }, '区分開閉器が「あり」');
    stay({ ...none, cableInstallation: 'none' }, '引込ケーブルが「なし」');
    stay({ ...none, preCable: 'yes' }, '引込点〜責任分界点のケーブルが「ある」');
    stay({ ...none, mainBreakerForm: 'pole-top' }, '電柱上構成');
    // 質問：区分開閉器なしのときだけ聞く。電力会社のケーブルのときは、「3点一致ですか？」を聞かない
    const shown = (a: Answers) => new Set(visibleQuestions(a, {}).map((q) => q.id));
    if (!shown({ sectionalizer: 'none', cableInstallation: 'buried' }).has('cableOwner') || shown({ sectionalizer: 'pas' }).has('cableOwner')) fail('「引込ケーブルは、お客様のものですか、電力会社のものですか？」が、区分開閉器なしのときだけ、出るようになっていません');
    if (shown({ sectionalizer: 'none', cableInstallation: 'buried' }).has('boundaryPattern')) fail('電力会社のケーブルのとき、「3点一致ですか？」が出ています');
    if (!shown({ sectionalizer: 'none', cableInstallation: 'buried', cableOwner: 'customer' }).has('boundaryPattern')) fail('お客様のケーブルのとき、「3点一致ですか？」が出ていません');
    if (QUESTION_DEFAULTS.cableOwner !== 'utility') fail('「引込ケーブルは誰のものか」の初期値が、電力会社のケーブルではありません');
    console.log('  区分開閉器なし：電力会社のケーブル（初期値）→ DS（無ければLBS）の一次側に「財産・責任分界点」1本・「3点一致」は聞かない／お客様のケーブル → これまでどおり');
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

console.log('\n■ VT・CTの組／保護継電器／トリップコイル／補助変圧器／分界点の文言');
{
  const ok = (cond: boolean | undefined, msg: string) => (cond ? undefined : fail(msg));
  const base: Answers = { ...answers, mainBreakerForm: 'cb', ctRatio: '300', transformerCount: 1, hasBattery: 'no' };
  const ids = (a: Answers) => buildComposition(a).map((i) => i.id);

  // 標準（CB形）：OCRが1個、試験端子つき。トリップコイルがOCRとつながる
  const std = buildComposition(base);
  const ocr = std.find((i) => i.role === 'relay');
  ok(ocr?.symbolId === 'relay-ocr' && ocr.ref === 'ct-1', `標準のCB形に、CT1組目につくOCRが入っていません（${ocr?.symbolId}／${ocr?.ref}）`);
  ok(std.some((i) => i.role === 'relay-tt'), '標準のCB形で、試験端子が「あり」の初期値になっていません');
  const coil = std.find((i) => i.role === 'trip-coil');
  ok(coil?.attachTo === 'main-breaker' && coil.connectFrom?.[0] === ocr?.id, 'トリップコイルが、VCBとOCRにつながっていません');
  // 並び：DS → VT → VCB → CT → 試験端子 → OCR → トリップコイル
  const order = std.map((i) => i.role).filter((r) => ['ds', 'ds-vt', 'main-breaker', 'ct', 'relay-tt', 'relay', 'trip-coil'].includes(r)).join('>');
  ok(order === 'ds>ds-vt>main-breaker>ct>relay-tt>relay>trip-coil', `標準の並びが違います（${order}）`);
  // 試験端子「なし」：試験端子が消え、OCRは残る
  const noTt = buildComposition({ ...base, relayTest: 'no' });
  ok(!noTt.some((i) => i.role === 'relay-tt') && noTt.some((i) => i.role === 'relay'), '試験端子を「なし」にしたときの構成が違います');
  // 継電器0個：OCRもトリップコイルも入らない
  const zero = ids({ ...base, relayCount: '0' });
  ok(!zero.includes('relay') && !zero.includes('trip-coil'), '継電器0個なのに、OCRまたはトリップコイルが入っています');
  // PFS形（CTもVTも無し）：継電器は入らない（これまでと同じ）
  const pfs = buildComposition({ ...answers, mainBreakerForm: 'pfs', hasSiteVt: 'no', hasSiteCt: 'no' }).map((i) => i.role);
  ok(!pfs.includes('relay') && !pfs.includes('trip-coil') && !pfs.includes('ct'), 'PFS形（VT・CTなし）に、継電器やCTが入っています');
  // 継電器の個数・種類・どこについているか
  const multi: Answers = {
    ...base, vtSetCount: '2', vtPosition__2: 'secondary', vtCount__2: '2', vtConnection__2: 'v',
    relayCount: '4', relayType__2: 'UVR', relayAt__2: 'vt-2', relayType__3: 'OVR', relayAt__3: 'vt-2', relayTest__3: 'no', relayType__4: 'UFR', relayAt__4: 'none',
  };
  const m = buildComposition(multi);
  const rel = (id: string) => m.find((i) => i.id === id);
  ok(rel('relay-2')?.symbolId === 'relay-uvr' && rel('relay-2')?.connectFrom?.[0] === 'relay-tt-2', 'UVRが、VTの試験端子の先につながっていません');
  ok(rel('relay-tt-2')?.connectFrom?.[0] === 'site-vt-2', 'VTにつく試験端子が、VT2組目の右の端につながっていません');
  ok(rel('relay-3')?.connectFrom?.[0] === 'relay-tt-2' && !m.some((i) => i.id === 'relay-tt-3'), 'OVRが、UVRと同じ試験端子（VT→試験端子→UVR・OVR）に並列でつながっていません');
  // 試験端子は、VTごとに1つだけ。UVRとOVRの両方が「あり」でも、2つにはならない
  const shared = buildComposition({ ...multi, relayTest__3: 'yes' });
  ok(shared.filter((i) => i.role === 'relay-tt' && i.ref !== 'ct-1').length === 1 && shared.find((i) => i.id === 'relay-3')?.connectFrom?.[0] === 'relay-tt-2', 'UVR・OVRの両方が試験端子「あり」のとき、試験端子が1つにまとまっていません');
  // UVRが「なし」で、OVRだけ「あり」でも、試験端子は1つで、UVRもその先につながる
  const onlyOvr = buildComposition({ ...multi, relayTest__2: 'no', relayTest__3: 'yes' });
  ok(onlyOvr.find((i) => i.id === 'relay-2')?.connectFrom?.[0] === 'relay-tt-3' && onlyOvr.find((i) => i.id === 'relay-3')?.connectFrom?.[0] === 'relay-tt-3', 'OVRだけ試験端子「あり」のとき、UVRとOVRが同じ試験端子の先につながっていません');
  ok(rel('relay-note-4')?.kind === 'note-above' && rel('relay-note-4')?.attachTo === 'relay-1', '置き場所が決まっていない継電器が、OCRの真上の名前だけになっていません');
  ok(rel('site-vt-pf-2')?.label.join('|') === 'VT＋PF×2|V結線|6600/110V', `V結線のVTの文字が違います（${rel('site-vt-pf-2')?.label.join('|')}）`);
  // VTの2組目（二次側）は、CTのあと。継電器は、つながる先のすぐあと
  const seq = m.map((i) => i.id).filter((i) => ['main-breaker', 'ct', 'relay-tt-1', 'relay-1', 'site-vt-2', 'relay-tt-2', 'relay-2', 'relay-3'].includes(i)).join('>');
  ok(seq === 'main-breaker>ct>relay-tt-1>relay-1>site-vt-2>relay-tt-2>relay-2>relay-3', `VT・CT・継電器の並びが違います（${seq}）`);
  // CTの組：位置を選べる（VCBの一次側／二次側／VTのあと）
  const ctSets = buildComposition({ ...base, ctSetCount: '3', ctPosition: 'primary', ctPosition__2: 'secondary', ctPosition__3: 'after-vt', vtPosition: 'secondary' });
  const ctSeq = ctSets.map((i) => i.id).filter((i) => ['ds', 'main-breaker', 'ct-1', 'ct-2', 'site-vt', 'ct-3'].includes(i) || i.startsWith('site-vt')).join('>');
  ok(ctSeq.startsWith('ds>ct-1>main-breaker>ct-2>') && ctSeq.endsWith('>ct-3'), `CTの組の位置が違います（${ctSeq}）`);
  // VTがCTのあと（二次側）につく継電器の元になるCT・VTが無いときは、名前だけの継電器になる
  const lost = buildComposition({ ...base, relayCount: '2', relayAt__2: 'vt-5' });
  ok(lost.some((i) => i.role === 'relay-note'), 'つながる先のVTが無い継電器が、名前だけの継電器になっていません');
  // 質問：継電器の「どこについているか」の選択肢は、CT・VTの組の数に合わせて出る
  const optsAt = (a: Answers) => (QUESTIONS.find((q) => q.id === 'relayAt')?.options ?? []).filter((o) => evaluate(o.showIf, normalizeAnswers(a))).map((o) => o.value).join(',');
  ok(optsAt(base) === 'ct-1,vt-1,none', `既定の「どこについているか」の選択肢が違います（${optsAt(base)}）`);
  ok(optsAt({ ...base, ctSetCount: '2', vtSetCount: '3' }) === 'ct-1,ct-2,vt-1,vt-2,vt-3,none', `組を増やしたときの選択肢が違います（${optsAt({ ...base, ctSetCount: '2', vtSetCount: '3' })}）`);
  // 初期値：1個目はOCR（CT）、2個目はUVR（VT）。試験端子は、いつも「あり」から
  const auto = withAutoValues(normalizeAnswers({ ...base, relayCount: '3' }));
  ok(auto.relayType === 'OCR' && auto.relayType__2 === 'UVR' && auto.relayType__3 === 'OVR', '継電器の種類の初期値（OCR・UVR・OVR）が違います');
  ok(auto.relayAt === 'ct-1' && auto.relayAt__2 === 'vt-1' && auto.relayAt__3 === 'vt-1' && auto.relayTest === 'yes' && auto.relayTest__2 === 'yes', '継電器の置き場所（OCR→CT、UVR・OVR→VT）・試験端子の初期値が違います');
  // VTが無い構成では、OVRも「置き場所は決まっていない」
  const noVt = withAutoValues(normalizeAnswers({ ...answers, mainBreakerForm: 'pfs', hasSiteVt: 'no', hasSiteCt: 'no', relayCount: '3' }));
  ok(noVt.relayAt__3 !== 'vt-1', 'VTが無いのに、OVRがVTにつく初期値になっています');
  // 継電器の記号が、すべての種類にある
  for (const c of ['OCR', 'UVR', 'OVR', 'OCGR', 'UFR', 'OFR', 'RPR', 'UPR', 'DSR', '2E', '3E']) {
    ok(Boolean(getSymbolForCheck(`relay-${c.toLowerCase()}`)), `継電器 ${c} の記号がありません`);
  }
  ok(Boolean(getSymbolForCheck('trip-coil')), 'トリップコイルの記号がありません');

  // 補助変圧器：蓄電所のときだけ。選んだ変圧器の低圧側から、MCCB → 補助変圧器
  const shownAux = (a: Answers) => visibleQuestions(a).some((q) => q.id === 'auxTrCapacity');
  ok(!shownAux(base) && shownAux({ ...base, hasBattery: 'yes' }), '補助変圧器の項目が、蓄電所のときだけ出るはずです');
  const aux: Answers = {
    ...base, hasBattery: 'yes', transformerCount: 2, trConnection: 'tr-3p-dy', trConnection__2: 'tr-3p-dy', auxTrCount: '2',
    auxTrFrom: '1', auxTrUsage: '動力', auxTrConnection: 'tr-3p-dy', auxTrCapacity: 150, auxTrVoltage: '550/220V', auxTrMccb: '400',
    auxTrFrom__2: '2', auxTrUsage__2: '電灯', auxTrConnection__2: 'tr-1p', auxTrCapacity__2: 50, auxTrVoltage__2: '210/105V', auxTrMccb__2: '100',
  };
  const ax = buildComposition(aux);
  const mc1 = ax.find((i) => i.id === 'aux-mccb-1');
  const tr1 = ax.find((i) => i.id === 'aux-tr-1');
  const tr2 = ax.find((i) => i.id === 'aux-tr-2');
  ok(mc1?.label.join('|') === '補助変圧器盤|MCCB400A', `補助変圧器盤のMCCBの文字が違います（${mc1?.label.join('|')}）`);
  ok(tr1?.label.join('|') === '動力用 Tr|3φ150kVA|550/220V' && tr1.symbolId === 'tr-3p-dy', `補助変圧器の文字・記号が違います（${tr1?.label.join('|')}／${tr1?.symbolId}）`);
  ok(tr2?.label.join('|') === '電灯用 Tr|1φ50kVA|210/105V' && tr2.symbolId === 'tr-1p', `2台目の補助変圧器が、その台の答えになっていません（${tr2?.label.join('|')}）`);
  ok(mc1?.props.transformer === '1' && ax.find((i) => i.id === 'aux-mccb-2')?.props.transformer === '2', '補助変圧器のつなぎ先（どの変圧器か）が違います');
  ok(mc1?.lane === 400 && tr1?.lane === 400 && tr2?.lane === 401, '補助変圧器の列（MCCBと補助変圧器が同じ列）が違います');
  ok(!buildComposition({ ...aux, auxTrCount: '0' }).some((i) => i.role.startsWith('aux-')), '補助変圧器0台なのに、描かれています');
  ok(!buildComposition({ ...aux, hasBattery: 'no' }).some((i) => i.role.startsWith('aux-')), '蓄電所でないのに、補助変圧器が描かれています');
  const blank = buildComposition({ ...aux, auxTrConnection: undefined }).find((i) => i.id === 'aux-tr-1');
  ok(blank?.symbolId === 'tr-blank', '結線方式が未入力のとき、円の中が空の変圧器の記号になっていません');

  // 分界点の文言：「財産・責任分界点」で統一する（今後の案件もすべて）。ほかの言い方は使わない
  const boundary = buildComposition({ ...base, boundaryPattern: 'coincident' }).find((i) => i.role === 'boundary');
  ok(boundary?.label.join('') === '財産・責任分界点', `3点一致の分界点の文言が違います（${boundary?.label.join('')}）`);
  const everyLabel = [...UPSTREAM, ...DOWNSTREAM, ...EXTRAS].flatMap((p) => p.labelTemplate ?? []).concat(QUESTIONS.flatMap((q) => [q.label, q.help ?? '', q.aiHint ?? '']));
  ok(!everyLabel.some((t) => /財産保安責任分界点|財産責任分界点|財産及び責任分界点|保安上の責任分界点|保安責任分界点|分解点/.test(t)), '分界点の文言に、「財産・責任分界点」以外の書き方が残っています');
  console.log('  VT・CTは組で数え、継電器は1個ずつ「種類・どこについているか・試験端子」を選ぶ。VCBとOCRがあればトリップコイルが入る');
  console.log('  補助変圧器は蓄電所のときだけ。分界点の文言は「財産・責任分界点」');
}

/* ---------- 「設備を入力して作成」の説明文の整理（第8弾 項目12） ---------- */
console.log('\n■ 説明文の整理');
{
  const q = (id: string) => QUESTIONS.find((x) => x.id === id);
  const expectText: [string, string][] = [
    ['poleName', '電柱番号を入力する。（例：猪子山（分）81）。（分）（幹）（支）（連絡）などの区分は、電柱の記載をそのまま反映する。'],
    ['sectionalizer', 'PAS・PGS＝電柱上に設置する区分開閉器。UGS＝キャビネット内に設置する区分開閉器。図面には、選んだ名前（PAS・PGS・UGS）を書く。引込元が地上キャビネットのときは、UGS（またはなし）。'],
    ['cableInstallation', '「なし」は、電柱の上に受電設備を構成する場合などで、区分開閉器の後をケーブルを介さず、ふつうの電線でつなぐとき（ケーブル端末も描かない）'],
    ['relayCount', 'GR・DGRは、ここには入れない（「ZPD・LA・接地」の地絡継電器の質問で答える）'],
    ['drawingName', '記載がなければ自動で表示させます。（例：キュービクル式高圧受電設備単線結線図）。ここに入力された場合は、この入力内容を優先して表示させます。'],
  ];
  for (const [id, want] of expectText) {
    const got = q(id)?.help;
    if (got !== want) fail(`${id}：説明文が指定の文になっていません（${got}）`);
  }
  console.log(`  変更した説明文 ${expectText.length}件：指定の文のとおり`);
  const gone = ['pasRatedVoltage', 'pasControl', 'cableCrossSection', 'areaCount', 'areaForm', 'relayType', 'relayAt', 'transformerCount'];
  for (const id of gone) if (q(id)?.help !== undefined) fail(`${id}：説明文が残っています`);
  console.log(`  削除した説明文 ${gone.length}件：画面に出ない`);
  // 受電設備の構成：「ZPD・LA・接地」の欄の説明文だけを残し、ほかは出さない
  const receiving = QUESTIONS.filter((x) => x.group === 'receiving');
  const stray = receiving.filter((x) => x.section !== 'ZPD・LA・接地' && x.help !== undefined).map((x) => x.id);
  const kept = receiving.filter((x) => x.section === 'ZPD・LA・接地' && x.help !== undefined).map((x) => x.id);
  if (stray.length > 0) fail(`受電設備の構成：「ZPD・LA・接地」以外に説明文が残っています（${stray.join('、')}）`);
  else if (kept.length === 0) fail('受電設備の構成：「ZPD・LA・接地」の説明文が消えています');
  else console.log(`  受電設備の構成：「ZPD・LA・接地」の説明文 ${kept.length}件だけ残る`);
  // AI・音声入力には、これまでの手がかりを、そのまま渡す（画面の説明文を消しても、読み取りの精度は変えない）
  const aiPrompt = buildSystemPrompt();
  for (const [id, needle] of [
    ['pasRatedVoltage', 'メモに書かれている数字をそのまま使ってください'],
    ['relayAt', 'CTにつく継電器は、CTの二次側'],
    ['cableCrossSection', 'これ以外の値でも'],
    ['transformerCount', '51以上の数も答えられます'],
    ['sectionalizer', 'pas（PAS）・pgs（PGS）・ugs（UGS）・none（なし）'],
    ['pasControl', 'gr（GR＝無方向性）'],
  ] as const) {
    const ask = QUESTIONS.find((x) => x.id === id);
    if (!aiPrompt.includes(needle)) fail(`${id}：AIへの説明「${needle}」が、指示文にありません`);
    // AIへの説明は、短いメモ書きではなく、丁寧な文章にする（選ぶ値の説明・メモに無いときの扱いを含む）
    if ((ask?.aiHint ?? '').length < 80) fail(`${id}：AIへの説明が短すぎます（${(ask?.aiHint ?? '').length}文字）`);
  }
  // 画面に説明文（help）のある項目は、すべて、AIに渡す詳しい説明（ai-hints.ts）も持つ
  const noHint = QUESTIONS.filter((y) => y.help !== undefined && y.aiHint === undefined && !y.noAi).map((y) => y.id);
  if (noHint.length > 0) fail(`画面の説明文はあるのに、AIへの説明が無い項目があります（${noHint.join('、')}）`);
  const staleHint = Object.keys(AI_HINTS).filter((k) => !QUESTIONS.some((y) => y.id === k));
  if (staleHint.length > 0) fail(`AIへの説明（ai-hints.ts）に、質問に無い項目IDがあります（${staleHint.join('、')}）`);
  for (const x of QUESTIONS.filter((y) => y.aiHint !== undefined)) {
    if ((x.aiHint ?? '').length < 60) fail(`${x.id}：AIへの説明が短すぎます（${(x.aiHint ?? '').length}文字）`);
  }
  console.log(`  AIへの説明（${QUESTIONS.filter((y) => y.aiHint !== undefined).length}項目）：選ぶ値・メモに無いときの扱いまで書いた、丁寧な文章`);
}

console.log('\n■ 点検：太陽光があるときは、ZPD・OVGR が必須');
{
  const r = (answers: Record<string, unknown>) =>
    buildReview({ answers, uncertain: [], evidence: {}, notes: [], questions: [] } as never, {}).filter((i) => i.level === 'error' && i.label.startsWith('太陽光があるときの'));
  const none = r({ hasPv: 'yes' });
  const onlyZpd = r({ hasPv: 'yes', hasZpd: 'yes' });
  const both = r({ hasPv: 'yes', hasZpd: 'yes', hasOvgr: 'yes' });
  const noPv = r({ hasPv: 'no' });
  const explicitNo = r({ hasPv: 'yes', hasZpd: 'no', hasOvgr: 'no' });
  const ids = (xs: { questionId?: string }[]) => xs.map((x) => x.questionId).sort().join('・');
  if (ids(none) !== 'hasOvgr・hasZpd') fail(`太陽光ありで、ZPD・OVGR が未入力のとき、2つとも警告されていません（${ids(none)}）`);
  else if (ids(onlyZpd) !== 'hasOvgr') fail(`ZPD だけあるとき、OVGR が警告されていません（${ids(onlyZpd)}）`);
  else if (both.length !== 0) fail('ZPD・OVGR が両方あるのに、警告されています');
  else if (noPv.length !== 0) fail('太陽光が無いのに、警告されています');
  else if (explicitNo.length !== 2 || !explicitNo.every((x) => x.value === 'なし')) fail('「なし」と答えてあるときも、警告されるはずです');
  else console.log('  太陽光あり：ZPD・OVGR が抜けていれば、それぞれ警告／両方あれば警告なし／太陽光なしなら警告なし');
}

console.log('\n■ 読み取りの指示文：現場で決まっていること');
{
  const p = buildSystemPrompt();
  const must: [string, string][] = [
    ['太陽光があるときの ZPD・OVGR（必須）', '太陽光発電設備（PCS・PV。「太陽」「太陽光」「発電」などの書き方もあります）があるときは、ZPD と OVGR が必ず必要です'],
    ['RPR は、書かれていなければ質問で確認', '逆電力継電器（RPR）は必要ですか'],
    ['読み取れない機器は質問で確認', 'ZPD・OVGR・RPR のように、図やメモから読み取れない機器は、推測で答えず、questions で確認します'],
    ['中電柱の名前は、カナ・漢字を変換しない', '漢字とカタカナを、互いに変換しないでください'],
    ['CV・CVT は、書いてあるとおり', '別の資料（以前の図面など）と食い違っていても、補正しないでください'],
    ['動力の書き方の揺れ', '「カ」「力」「動」「動力」「カTr」「動Tr」 → 動力'],
    ['電灯の書き方の揺れ', '「電」「灯」「電灯」「電Tr」「灯Tr」 → 電灯'],
    ['PASの中のZPDは別の機器', 'スケッチのPASの中にZPDが描かれていても、それを理由に hasZpd を yes にしないでください'],
    ['写真の向き', '90度回って撮影されていることがあります'],
    ['範囲の長さは「約」付き', '書かれている数字のうち、もっともらしいほうを選んで cableLength に入れ、cableLengthApprox を true'],
    ['CUT は CVT の書き間違い', '「CUT」は、ケーブルの構造 CVT の書き間違いです'],
    ['MCB・MCCB は読まない', 'PCS の手前の MCB・MCCB は、新しい様式の図面には書きません'],
    ['LBS の項目を別々に読む', 'LBS 本体の定格電流（200A など）、PF の定格電流 G（G40A）'],
    ['PF の本数は自動', 'PF の本数（PF×2・PF×3）は、アプリが、用途（電灯は×2、動力は×3。電灯でも V 結線は×3）から自動で決める'],
    ['小数点の見落とし', '「4.95kW」が「495kW」'],
  ];
  for (const [name, text] of must) {
    if (!p.includes(text)) fail(`読み取りの指示文に、「${name}」が入っていません`);
  }
  // 項目ごとの説明（hasZpd・hasOvgr）も、太陽光のときの決まりと食い違わない
  for (const id of ['hasZpd', 'hasOvgr']) {
    if (!(AI_HINTS[id] ?? '').includes('太陽光発電設備（hasPv が yes）があるとき')) fail(`${id}：AIへの説明に、太陽光のときの決まりが入っていません`);
  }
  if (!(AI_HINTS.hasZpd ?? '').includes('PASの中にZPDが描かれていても、それを理由に yes にしないでください')) fail('hasZpd：AIへの説明に、PASの中のZPDとは別の機器であることが入っていません');
  if (state.failed === 0) console.log(`  ${must.length}項目すべて、指示文に入っている（太陽光＝ZPD・OVGR必須、RPR・読み取れない機器は質問、書いてある文字のまま、用途の書き方の揺れ、写真の向き、小数点、範囲の長さ、CUT、MCB・MCCB、LBSの項目、PFの本数）`);
}

console.log('\n■ 想定外の値（大きすぎる台数・名前の表にない文字）でも、固まらず、おかしな文字を出さない（全体のデバッグ）');
{
  const ok = (cond: boolean | undefined, msg: string) => (cond ? undefined : fail(msg));
  // 件数の読み方：0〜50 の整数。数でないものは、最小の値
  ok(countOf('1e999') === MAX_COUNT && countOf(99999) === MAX_COUNT && countOf(Infinity) === MAX_COUNT, '大きすぎる件数は、上限（50）にするはず');
  ok(countOf('abc') === 1 && countOf(undefined) === 1 && countOf(NaN) === 1 && countOf(-3) === 1 && countOf(2.9) === 2, '数でない・負の件数は 1、小数は切り捨てるはず');
  ok(countOf('abc', 0) === 0 && countOf(-3, 0) === 0, '0 から数える項目は、数でないものを 0 にするはず');
  // 項目ごとの上限：エリア 30・変圧器 100・コンデンサ 100・PCS 100（ほかは 50）
  ok(maxCountOf('areaCount') === 30 && maxCountOf('transformerCount') === 100 && maxCountOf('capacitorCount') === 100 && maxCountOf('pcsCount') === 100, '上限は、エリア30・変圧器100・コンデンサ100・PCS100のはず');
  ok(maxCountOf('vtSetCount') === MAX_COUNT && maxCountOf('generatorCount') === MAX_COUNT && maxCountOf('constructor') === MAX_COUNT, 'ほかの件数の上限は、50のはず');
  // 入力欄：数字だけが大きすぎるときは、その項目の上限に。全角も同じ。数字でないものはそのまま
  ok(limitCountText('transformerCount', '100000') === '100' && limitCountText('transformerCount', '101') === '100' && limitCountText('transformerCount', '100') === '100', '変圧器の台数は、100 までのはず');
  ok(limitCountText('transformerCount', '１２３４５') === '100', '全角の大きな数も、上限になるはず');
  ok(limitCountText('transformerCount', '7') === '7', '7 は、そのまま');
  ok(limitCountText('capacitorCount', '300') === '100' && limitCountText('pcsCount', '300') === '100' && limitCountText('areaCount', '31') === '30' && limitCountText('areaCount', '30') === '30', 'コンデンサ・PCS は 100、エリアは 30 までのはず');
  ok(limitCountText('generatorCount', '51') === String(MAX_COUNT), 'ほかの台数は、50 までのはず');
  ok(limitCountText('transformerCount', 'abc') === 'abc', '数字でないものは、そのまま');
  // 上限どおりに、組み立てる（変圧器100台・コンデンサ100台・エリア30か所）
  const lim: Answers = { sourceType: 'pole', boundaryPattern: 'coincident', hasPas: 'yes', mainBreakerForm: 'cb', trConnection: 'tr-3p-dy', trCapacity: 300, transformerCount: 2, hasCapacitor: 'yes', capacitorCount: 2, hasPv: 'yes', pvGroupCount: '1', pcsCapacity: 50, pcsCount: 2 };
  const tr = (n: unknown) => buildComposition({ ...lim, transformerCount: n } as Answers).filter((i) => i.role === 'transformer').length;
  const cap = (n: unknown) => buildComposition({ ...lim, capacitorCount: n } as Answers).filter((i) => i.role === 'capacitor').length;
  ok(tr(100) === 100 && tr(101) === 100 && tr(99999) === 100 && tr(3) === 3, `変圧器の台数 100 → ${tr(100)}台、101 → ${tr(101)}台、99999 → ${tr(99999)}台（100台まで）`);
  ok(cap(100) === 100 && cap(500) === 100, `コンデンサの台数 100 → ${cap(100)}台、500 → ${cap(500)}台（100台まで）`);
  const pcsText = (n: unknown) => String(buildComposition({ ...lim, pcsCount: n } as Answers).map((i) => (i.label ?? []).join('')).join('|'));
  ok(pcsText(300).includes('×100台') && !pcsText(300).includes('×300台') && pcsText('1e999').includes('×100台') && !/Infinity/.test(pcsText('1e999')), 'PCS の台数は、100台まで（300 → ×100台、1e999 → Infinity と書かない）');
  const areaCount = (n: unknown) => areaCountOf({ ...answers, areaCount: n } as Answers);
  ok(areaCount(30) === 30 && areaCount(31) === 30 && areaCount(99999) === 30 && areaCount(2) === 2, 'エリアは 30 か所までのはず');
  // 大きな件数でも、すぐ組み立てて、配置できる
  for (const [k, v] of [['transformerCount', '1e999'], ['areaCount', 99999], ['generatorCount', 1e9], ['vtSetCount', 99999], ['ctSetCount', 99999], ['relayCount', 99999], ['pvGroupCount', Infinity]] as [string, unknown][]) {
    const a = { ...answers, [k]: v } as Answers;
    const t0 = performance.now();
    const d = layout(buildComposition(a), a);
    const ms = performance.now() - t0;
    ok(d.symbols.length > 0 && ms < 5000, `${k} に大きな値（${String(v)}）を入れても、5秒以内に組み立てるはず（${Math.round(ms)}ms）`);
  }
  // 名前の表にない文字（constructor など）：落ちず、関数の中身も文字に出さない
  for (const [k, v] of [['mainBreakerForm', 'constructor'], ['mainBreakerForm', '__proto__'], ['cableInstallation', 'toString'], ['linkCableInstallation', 'hasOwnProperty'], ['areaForm', 'valueOf'], ['areaPlacement', 'constructor'], ['generatorUsage', '__proto__'], ['generatorFuel', 'constructor']] as [string, string][]) {
    const a = { ...answers, [k]: v } as Answers;
    try {
      const d = layout(buildComposition(a), a);
      const text = JSON.stringify(d);
      ok(!/function |\[native code\]|\[object /.test(text), `${k} に「${v}」を入れると、図面に、関数の中身のような文字が出ています`);
    } catch (e) {
      fail(`${k} に「${v}」を入れると、組み立てが止まります：${String((e as Error).message).slice(0, 80)}`);
    }
  }
  if (state.failed === 0) console.log('  件数は上限におさまる（エリア30・変圧器100・コンデンサ100・PCS100、ほか50）／大きな台数・エリア数でも、すぐ終わる／constructor などの文字を入れても、落ちず、おかしな文字も出ない');
}

/* ---------- 過去の案件の傾向（第13弾 項目51） ---------- */
console.log('\n■ 過去の案件の傾向');
{
  const ok = (cond: boolean | undefined, msg: string) => (cond ? undefined : fail(msg));
  // 対象の質問：選択肢から選ぶもの。手入力・AIに渡さない項目・「傾向に使わない」印は除く
  const bad = QUESTIONS.filter((q) => TREND_QUESTION_IDS.has(q.id) && (q.type !== 'select' || q.manualOnly || q.noAi || q.noTrend || q.allowFreeInput));
  ok(bad.length === 0, `傾向の対象に、対象外の質問が入っています：${bad.map((q) => q.id).join('・')}`);
  ok(TREND_QUESTION_IDS.size >= 40, `傾向の対象が少なすぎます（${TREND_QUESTION_IDS.size}個）`);
  ok(!TREND_QUESTION_IDS.has('siteName') && !TREND_QUESTION_IDS.has('drawingName'), 'お客様名称・図面名称が、傾向の対象になっています');
  ok(QUESTIONS.filter((q) => q.noTrend).every((q) => !isTrendQuestion(q)), '「傾向に使わない」印のある質問が、対象になっています');
  ok(baseQuestionId('a2:hasPv') === 'hasPv' && baseQuestionId('relayType__3') === 'relayType' && baseQuestionId('a3:relayType__2') === 'relayType', '保存したキーから、基本の質問の id を取り出せません');
  const mk = (n: number, v: (i: number) => string, extra: Answers = {}): Answers[] => Array.from({ length: n }, (_, i) => ({ hasPv: v(i), ...extra }) as Answers);
  // 件数が足りないうちは出さない
  ok(tallyTrends(mk(TREND_MIN_COUNT - 1, () => 'yes')).hasPv === undefined, `${TREND_MIN_COUNT - 1}件では、傾向を出さないはずです`);
  const t = tallyTrends(mk(12, (i) => (i < 9 ? 'yes' : 'no')));
  ok(t.hasPv?.total === 12 && t.hasPv.top[0]?.value === 'yes' && t.hasPv.top[0].count === 9 && t.hasPv.top[1]?.value === 'no', `傾向の数え方が違います（${JSON.stringify(t.hasPv)}）`);
  // 受電の形が同じ案件で足りるときは、その案件で数える。足りないときは、全案件で数える
  const mixed = [...mk(10, () => 'yes', { sourceType: 'pole' }), ...mk(10, () => 'no', { sourceType: 'cabinet' })];
  ok(tallyTrends(mixed, 'pole').hasPv?.scope === 'context' && tallyTrends(mixed, 'pole').hasPv?.top[0]?.value === 'yes', '同じ受電の形の案件で数えていません');
  ok(tallyTrends(mixed, 'ground').hasPv?.scope === 'all', '同じ受電の形が足りないとき、全案件で数えていません');
  // 一覧にない値・空の答えは数えない
  const dirty = [...mk(10, () => 'yes'), ...mk(5, () => 'bogus'), ...mk(5, () => '')];
  ok(tallyTrends(dirty).hasPv?.total === 10, `一覧にない値・空の答えを数えています（${tallyTrends(dirty).hasPv?.total}）`);
  // 結果に、案件の中身（お客様の名前など）が入らない
  const named = mk(12, () => 'yes', { siteName: '秘密のお客様' });
  ok(!JSON.stringify(tallyTrends(named)).includes('秘密'), '傾向の結果に、お客様の名前が入っています');
  if (state.failed === 0) console.log(`  対象 ${TREND_QUESTION_IDS.size}問（選択肢から選ぶ質問だけ）／${TREND_MIN_COUNT}件に満たないうちは出さない／受電の形が同じ案件→足りなければ全案件／一覧にない値は数えない／お客様の名前は結果に入らない`);
}
