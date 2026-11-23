import type { Answers, Value } from './condition.ts';
import { PCS_INPUT_MAX, countOf, maxCountOf } from './counts.ts';
import { pickOwn } from './own.ts';
import { LINK_PART_CT_COUNT, LINK_PART_MAX, LINK_PART_VT_COUNT, LINK_RELAYS, LINK_RELAY_NO_TEST_KEY, linkPartKey, linkPartOpen, linkRelayKey, linkRelayTtKey } from './link-parts.ts';
import { evaluate, fillTemplate } from './condition.ts';
import { PROPERTY_AT_DS, VCT_BELOW_BREAKER } from './questions/common.ts';
import { BLANK_DEFAULTS, QUESTIONS, QUESTION_DEFAULTS, QUESTION_GROUPS } from './questions.ts';
import type { Question, QuestionGroup } from './questions.ts';
import { AREA_CHAIN, BLANK_AREA_GATES, BLANK_CHAIN_GATE, BLANK_GATES, CHAIN_BY_FORM, CT_SHOWN, DOWNSTREAM, EXTRAS, FEEDERS, MAIN_GROUND_ON, SENDOUT, TRANSFORMER, UPSTREAM } from './composition.ts';
import type { Placement } from './composition.ts';

/* ------------------------------------------------------------------ */
/* 質問の出し分け                                                       */
/* ------------------------------------------------------------------ */

export interface AskOptions {
  /**
   * AIがスケッチ画像から判定できた質問のID。
   * ask==='ai-uncertain' の質問は、ここに入っていれば聞かない。
   */
  resolvedByAi?: ReadonlySet<string>;
}

/** いま聞くべき質問を、表示条件を評価して返す */
/**
 * 選んである答えのうち、いまは一覧に出ない選択肢（Choice.showIf を満たさない）になったものを外す。
 * 例：結線方式に「三相 Δ-Y結線」を選んであるのに、用途を「電灯」に変えた → 結線方式を空に戻す。
 * 繰り返しの2件目以降の答え（trConnection__2 など）も、その件の答えで見る。
 */
function dropHiddenChoicesBase(answers: Answers): Answers {
  let out = answers;
  for (const q of QUESTIONS) {
    if (!q.options?.some((o) => o.showIf)) continue;
    const prefix = `${q.id}__`;
    for (const key of Object.keys(answers)) {
      let index = -1;
      if (key === q.id) index = 0;
      else if (key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))) index = Number(key.slice(prefix.length)) - 1;
      if (index < 0) continue;
      const chosen = answers[key];
      const opt = q.options.find((o) => o.value === chosen);
      if (opt?.showIf && !evaluate(opt.showIf, normalizeAnswers(viewAt(answers, index)))) {
        if (out === answers) out = { ...answers };
        delete out[key];
      }
    }
  }
  return out;
}

/** 一覧に出なくなった選択肢を外す（1か所目と、2か所目以降のエリアの答えの両方） */
export function dropHiddenChoices(answers: Answers): Answers {
  let out = dropHiddenChoicesBase(answers);
  for (let n = 1; n < areaCountOf(out); n++) {
    const view = areaView(out, n);
    const cleaned = dropHiddenChoicesBase(view);
    for (const key of Object.keys(view)) {
      if (key in cleaned) continue;
      const stored = areaKey(key, n);
      if (stored in out) {
        if (out === answers) out = { ...out };
        delete out[stored];
      }
    }
  }
  return out;
}

/**
 * 古い回答を、いまの質問に合わせる。
 *
 * 以前は「PASの設置はありますか？」（hasPas：yes／no）だったが、いまは区分開閉器（sectionalizer：PAS／PGS／なし）。
 * 区分開閉器の回答がまだ無くて、古い hasPas の回答だけが入っているときは、そこから決める
 * （no→なし、それ以外→PAS）。区分開閉器の回答があれば、そちらを使う。
 */
/**
 * 新規作成のとき、完全に白紙から始めた案件の印（第14弾 項目3）。
 *   'blank'      … 白紙で始めて、「設備を入力して作成」を、上から1つずつ開く（画面の動き）
 *   'blank-open' … 白紙で始めた案件のうち、すべての項目を開いて入力するもの（スケッチ・音声で作ったとき、複製したとき、「全部を開く」を押したとき）
 * どちらも、**初期値を使わない**（質問の既定値・条件の無い自動入力）。図面は、答えたことだけで作る。
 * 印が無い案件（以前の案件・古い形式の案件）は、これまでどおり、初期値を使う。
 */
export const START_MODE_KEY = 'startMode';
export const isBlankStart = (answers: Answers): boolean => answers[START_MODE_KEY] === 'blank' || answers[START_MODE_KEY] === 'blank-open';
/** 「設備を入力して作成」を、上から1つずつ開く案件か */
export const isStepStart = (answers: Answers): boolean => answers[START_MODE_KEY] === 'blank';
/** 白紙で始めた案件を、すべての項目を開く形にする（複製・スケッチ・音声。初期値を使わないのは、そのまま） */
export function openStartMode(answers: Answers): Answers {
  return answers[START_MODE_KEY] === 'blank' ? { ...answers, [START_MODE_KEY]: 'blank-open' } : answers;
}
/** 画面・図面・確認で使う、実際に効いている回答（質問の既定値と、状況に応じた初期値を足したもの。白紙で始めた案件は、足さない） */
export function effectiveAnswers(answers: Answers): Answers {
  const normalized = normalizeAnswers(answers);
  // 白紙で始めた案件は、初期値を足さない（ただし、名前の頭の部分「中電柱：」などは、続けて入力できるよう、入れておく）
  if (isBlankStart(normalized)) return withAutoValues({ ...BLANK_DEFAULTS, ...normalized });
  // 以前の案件：「補助変圧器はありますか？」が未回答（かつ、台数でも「あり」と読めなかった）なら、「なし」
  return withAutoValues({ ...QUESTION_DEFAULTS, ...(normalized.hasAuxTr === undefined ? { hasAuxTr: 'no' } : {}), ...normalized });
}

export function normalizeAnswers(answers: Answers): Answers {
  let out = answers;
  if (out.sectionalizer === undefined && out.hasPas !== undefined) {
    out = { ...out, sectionalizer: out.hasPas === 'no' ? 'none' : 'pas' };
  }
  // 補助変圧器：以前は、台数だけで決めていた（蓄電池があれば最初は1台）。「補助変圧器はありますか？」が未回答の古い案件は、
  // 台数が1以上（台数を答えていないときは、蓄電池があれば1台）なら「あり」として読む。図面から、補助変圧器が消えないようにする
  // （白紙で始めた案件には、この読み替えをしない。答えていないのに「あり」と表示され、2か所目以降のエリアでは「未入力」のまま
  // 先へ進めなくなるため。補助変圧器は、蓄電池の有無に関わらず、自分で答える）
  if (out.hasAuxTr === undefined && !isBlankStart(out)) {
    const n = Number(out.auxTrCount);
    const old = out.auxTrCount === undefined || out.auxTrCount === '' ? out.hasBattery === 'yes' : Number.isFinite(n) && n >= 1;
    if (old) out = { ...out, hasAuxTr: 'yes' };
  }
  // 蓄電ユニット：以前は「蓄電ユニットの規模」（batteryCapacity）の文字だけだった。いまの「出力・容量」として読む
  if (out.batteryUnitRating === undefined && out.batteryCapacity !== undefined && out.batteryCapacity !== '') {
    out = { ...out, batteryUnitRating: out.batteryCapacity };
  }
  // 以前は「区分」と「名称」の2つの欄だった（polePrefix＋poleName、cabinetPrefix＋cabinetName）。いまは1つの欄なので、つなげて読み替える
  for (const [prefixKey, nameKey] of [['polePrefix', 'poleName'], ['cabinetPrefix', 'cabinetName']] as const) {
    if (out[prefixKey] === undefined) continue;
    const { [prefixKey]: prefix, ...rest } = out;
    const name = String(rest[nameKey] ?? '');
    out = { ...rest, [nameKey]: name.startsWith(String(prefix ?? '')) ? name : `${prefix ?? ''}${name}` };
  }
  // 受電側の開閉器から決まる目印（質問の出し分けに使う）。
  // 1か所目は「主遮断装置の形式」、2か所目以降は「このエリアの受電側の開閉器」で決まる
  out = { ...out, ...intakeFlags(out), pcsMode: pcsInputMode(out) };
  const cabinet = out.sourceType === 'cabinet';
  // 引込元が地上キャビネットのときは、PAS・PGS（電柱上）は無い。未回答（または古い回答）のときはUGSにする
  // （白紙で始めた案件は、自動で決めない。区分開閉器の有無（UGS か なし）を、自分で選ぶまで、未回答のまま。
  // 自動で選ばれると、間違ったまま進んでしまうおそれがあるため。電柱上のPAS・PGSが残っていたら、選び直してもらう）
  if (cabinet && isBlankStart(out)) {
    if (out.sectionalizer === 'pas' || out.sectionalizer === 'pgs') {
      const { sectionalizer: _drop, ...rest } = out;
      out = rest;
    }
  } else if (cabinet && (out.sectionalizer === undefined || out.sectionalizer === 'pas' || out.sectionalizer === 'pgs')) {
    out = { ...out, sectionalizer: 'ugs' };
  }
  return out;
}

/**
 * まだ答えていない質問に、状況に応じた初期値（Question.autoValue）を足す。
 * 既定値を足したあとの回答に対して使う。足した値は、画面に見せたり図面を作ったりするためのもので、
 * 回答として保存はしない（利用者が自分で入れた値が、いつも優先される）。
 */
export function withAutoValues(given: Answers): Answers {
  // 受電側の開閉器から決まる目印（intake〜）を使う初期値があるので、先に古い回答を読み替えて目印を足す
  const answers = normalizeAnswers(given);
  let out = autoFillView(answers);
  // 2か所目以降のエリアも、そのエリアの答えで初期値を決める
  for (let n = 1; n < areaCountOf(out); n++) {
    const view = areaView(out, n);
    const filled = autoFillView(view);
    for (const [key, value] of Object.entries(filled)) {
      if (view[key] !== undefined) continue;
      if (out === answers) out = { ...out };
      out[areaKey(key, n)] = value;
    }
  }
  return out;
}

function autoFillView(answers: Answers): Answers {
  let out = answers;
  const blank = isBlankStart(answers);
  for (const q of QUESTIONS) {
    if (!q.autoValue) continue;
    const group = QUESTION_GROUPS.find((g) => g.id === q.group);
    const units = group?.repeatCountKey && !q.shared ? countOf(answers[group.repeatCountKey], 1, maxCountOf(group.repeatCountKey)) : 1;
    for (let i = 0; i < units; i++) {
      const key = indexedKey(q.id, i);
      if (out[key] !== undefined) continue;
      const view = viewAt(out, i);
      // 白紙で始めた案件は、条件の無い初期値は使わない。afterAnswered があるものは、その質問に答えたあとだけ
      const rule = q.autoValue.find((r) => (!blank || r.when !== undefined) && (!blank || !r.afterAnswered || !(view[r.afterAnswered] === undefined || view[r.afterAnswered] === null || view[r.afterAnswered] === '')) && evaluate(r.when, view));
      if (rule) {
        if (out === answers) out = { ...answers };
        out[key] = rule.value;
      }
    }
  }
  return out;
}

export function visibleQuestions(rawAnswers: Answers, opts: AskOptions = {}): Question[] {
  const answers = normalizeAnswers(rawAnswers);
  const resolved = opts.resolvedByAi ?? new Set<string>();
  // まとまり（発電機・太陽光発電設備など）に付いている表示条件。
  // 「発電機はありますか？」が「いいえ」なら、発電機のまとまり全体（台数・用途・容量…）を出さない
  const groupCond = new Map(QUESTION_GROUPS.filter((g) => g.showIf).map((g) => [g.id, g.showIf]));
  return QUESTIONS.filter((q) => {
    if (!evaluate(groupCond.get(q.group), answers)) return false;
    if (!evaluate(q.showIf, answers)) return false;
    if (q.ask === 'ai-uncertain' && resolved.has(q.id)) return false;
    return true;
  });
}

/** グループごとにまとめた質問（フォームの見出し単位） */
export function questionsByGroup(answers: Answers, opts: AskOptions = {}): {
  group: QuestionGroup;
  questions: Question[];
}[] {
  const visible = visibleQuestions(answers, opts);
  return QUESTION_GROUPS.map((group) => ({
    group,
    questions: visible.filter((q) => q.group === group.id),
  })).filter((g) => g.questions.length > 0);
}

/**
 * 設備容量から主遮断装置の形式を提案する。
 * 300kVA以下ならPFS形を採用可能、301kVA以上はCB形でなければならない。
 */
export function suggestMainBreakerForm(totalKva: number): 'pfs' | 'cb' | null {
  if (!Number.isFinite(totalKva) || totalKva <= 0) return null;
  return totalKva <= 300 ? 'pfs' : 'cb';
}

/* ------------------------------------------------------------------ */
/* 回答から導出する値（図面の文字に使う）                                 */
/* ------------------------------------------------------------------ */

const CABLE_INSTALLATION_LABEL: Record<string, string> = { buried: '埋ケ', overhead: '架ケ' };
const GENERATOR_USAGE_LABEL: Record<string, string> = { normal: '常用', emergency: '非常用' };
const GENERATOR_FUEL_LABEL: Record<string, string> = {
  diesel: '軽油',
  gas: '天然ガス',
  gasoline: 'ガソリン',
  kerosene: '灯油',
  'heavy-oil': '重油',
};

/**
 * PCSのつなぎ先の、入れ方（入力欄の数が少ないほうを、自動で出す）。
 *   none   … 太陽光が無い・変圧器が1台（全部その1台につながるので、聞かない）
 *   perPcs … PCSごとに、「何台目の変圧器につなぐか」を選ぶ（PCSの台数が、変圧器の台数以下のとき）
 *   perTr  … 変圧器ごとに、「何台つなぐか」を入れる（PCSのほうが多いとき）
 * すでに入れた答えがあるときは、その入れ方を続ける（案件を開き直しても、入れた内容が見えなくならないように）。
 * 入力欄は、PCS・変圧器とも、30台目まで（PCS_INPUT_MAX）。30台を超えるときは、使える入れ方のほうにする。
 * 引数は、1つの容量の種類（1件ぶん）の答え。
 */
export type PcsMode = 'none' | 'perPcs' | 'perTr';
export function pcsInputMode(a: Answers): PcsMode {
  if (a.hasPv !== 'yes') return 'none';
  const tr = countOf(a.transformerCount, 1, maxCountOf('transformerCount'));
  if (tr <= 1) return 'none';
  const n = countOf(a.pcsCount ?? 1, 1, maxCountOf('pcsCount'));
  const answered = (v: unknown) => v !== undefined && v !== null && v !== '';
  for (let k = 1; k <= Math.min(n, PCS_INPUT_MAX); k++) if (answered(a[`pcsDest${k}`])) return 'perPcs';
  for (let t = 1; t <= Math.min(tr, PCS_INPUT_MAX); t++) if (answered(a[`pcsToTr${t}`])) return 'perTr';
  // 入れた答えが無いとき：入力欄が少ないほうにする。PCSが多い（30台超）ときは、変圧器ごと。変圧器が多い（30台超）ときは、PCSごと
  if (n > PCS_INPUT_MAX) return 'perTr';
  return n <= tr || tr > PCS_INPUT_MAX ? 'perPcs' : 'perTr';
}

/**
 * 1つの容量の種類のPCS（total 台）を、変圧器ごとの台数に直す。
 *   ・PCSごとに選んだ答え（pcsDest）が1つでもあれば、それを使う（選んでいないPCSは、1台目の変圧器）
 *   ・無ければ、変圧器ごとの台数（pcsToTr）を使う。どこにも入れていなければ、全部1台目。入れ残しは1台目に足す
 * counts … 変圧器ごとの台数 ／ perPcs … PCSごとの答えから作ったか ／ dest … perPcs のとき、PCSごとのつなぎ先（0始まりの変圧器の番号）
 */
export function pcsShares(
  answers: Answers,
  group: number,
  total: number,
  trCount: number,
): { counts: number[]; perPcs: boolean; dest: number[] } {
  const counts: number[] = Array.from({ length: trCount }, () => 0);
  const dest: number[] = [];
  let anyDest = false;
  for (let k = 1; k <= Math.min(total, PCS_INPUT_MAX); k++) {
    const v = answers[indexedKey(`pcsDest${k}`, group)];
    if (v !== undefined && v !== null && v !== '') anyDest = true;
  }
  if (anyDest) {
    for (let k = 1; k <= total; k++) {
      const v = k <= PCS_INPUT_MAX ? Number(answers[indexedKey(`pcsDest${k}`, group)]) : NaN;
      // 選んでいない・変圧器の台数より大きい番号は、1台目の変圧器
      const t = Number.isInteger(v) && v >= 1 && v <= trCount ? v - 1 : 0;
      dest.push(t);
      counts[t]! += 1;
    }
    return { counts, perPcs: true, dest };
  }
  let assigned = 0;
  for (let t = 0; t < trCount; t++) {
    const n = Math.max(0, Number(answers[indexedKey(`pcsToTr${t + 1}`, group)] ?? 0) || 0);
    counts[t] = n;
    assigned += n;
  }
  // どこにも入れていなければ、全部1台目へ。入れ残しがあれば1台目に足す
  if (assigned === 0) counts[0] = total;
  else if (assigned < total) counts[0] = (counts[0] ?? 0) + (total - assigned);
  return { counts, perPcs: false, dest };
}

/** 回答そのものに加えて、図面の文字に使う導出値を足した集まりを作る */
export function withDerived(rawAnswers: Answers): Answers {
  const answers = normalizeAnswers(rawAnswers);
  const d: Answers = { ...answers };

  // UGSが入っているキャビネットの名称。「キャビネット番号：」だけで名称がまだ無いときは、書かない
  const ugsCabinet = String(answers.ugsCabinetName ?? '').trim();
  d.ugsCabinetLabel = answers.sectionalizer === 'ugs' && !/^キャビネット番号\s*[：:]?$/.test(ugsCabinet) ? ugsCabinet : '';

  // 変圧器の電圧。「6600/」のように、自動で入った前半だけで、後ろがまだ入力されていないときは、図面に書かない
  const trVoltage = String(answers.trVoltage ?? '').trim();
  d.trVoltageText = /^\d+\s*V?\s*\/$/.test(trVoltage) ? '' : trVoltage;

  // 引込元の文字。「中電柱：」「キャビネット番号：」だけで名称がまだ無いときは、書かない
  const sourceText = String(answers.sourceType === 'cabinet' ? (answers.cabinetName ?? '') : (answers.poleName ?? '')).trim();
  // （電力会社の呼び名は、会社の設定で変えられる。「○○柱：」のように、最後が「：」で、名称が無いものは、すべて、書かない）
  d.sourceLabel = /^(中電柱|キャビネット番号)\s*[：:]?$/.test(sourceText) || /^[^：:]{1,20}[：:]\s*$/.test(sourceText) ? '' : sourceText;

  // 区分開閉器（PAS／UGS／PGS／なし）。まだ答えていないときは、これまでどおりPAS（引込元がキャビネットならUGS）
  // （白紙で始めた案件で、引込元がキャビネットのまま未回答のときは、図面だけ、UGSとして描く。必須の未入力として残るので、答えるまで次へは進めない）
  const sectionalizer = String(answers.sectionalizer ?? (answers.sourceType === 'cabinet' ? 'ugs' : 'pas'));
  // 内部の条件式は、これまでの「PASがあるか」の形（hasPas）のまま使えるようにしておく
  d.hasPas = sectionalizer === 'none' ? 'no' : 'yes';
  // 図面に書く名前。PGSはキャビネット内の区分開閉器で、PASとは書かない
  d.sectionalizerName = sectionalizer === 'pgs' ? 'PGS' : sectionalizer === 'ugs' ? 'UGS' : 'PAS';
  // 区分開閉器が無いとき、地上キャビネットの種類の名前（図面に書く）
  d.groundCabinetTypeName =
    ({ 'mold-discon': 'モールドディスコン', 't-shelter': 'T型シェルター', 'three-pole': '三極連動' } as Record<string, string>)[
      String(answers.groundCabinetType)
    ] ?? '';

  // PASの内蔵表記（例: VT,LA内蔵型）。
  // VTはSOG（GR/DGR）があるときだけ入る。回答が残っていても、SOGが無ければ書かない
  const hasSog = answers.pasControl === 'gr' || answers.pasControl === 'dgr';
  const builtin: string[] = [];
  if (hasSog && answers.pasBuiltinVt === 'yes') builtin.push('VT');
  if (answers.pasBuiltinLa === 'yes') builtin.push('LA');
  d.pasBuiltinText = builtin.length ? `${builtin.join(',')}内蔵型` : '';
  // 内蔵機器が入ると枠の中が窮屈になるので、入るときは枠を少し広げた図記号を使う
  d.pasSymbol = builtin.length ? 'pas-builtin' : 'pas';
  // DGRのときにPAS・PGSの中へ入れるZPD。外箱に出す接地の記号は、最大1つまで。
  // LAも入るときは、LAの接地を使い、ZPDの接地は描かない（ZPDの縦線を、外箱まで伸ばす）
  d.pasZpdSymbol = answers.pasBuiltinLa === 'yes' ? 'zpd-pas-boxed' : 'zpd-pas';

  // PASの定格（例: 7200V 300A）。電圧と電流のあいだは半角スペース（LBS・DS・VCBの書き方と同じ）。
  // 片方しか分からないときは分かる方だけ書く
  d.pasRatingText = [
    answers.pasRatedVoltage ? `${answers.pasRatedVoltage}V` : '',
    answers.pasRatedCurrent ? `${answers.pasRatedCurrent}A` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // 区分開閉器と主遮断装置の間の開閉器（第17弾 項目6）。PAS・PGSは、1か所目の区分開閉器と同じ決まり（内蔵表記・図記号・ZPD・定格）
  const midKind = String(answers.midKind ?? '');
  d.midSwitchName = midKind === 'pgs' ? 'PGS' : midKind === 'as' ? 'AS' : 'PAS';
  const midBuiltin: string[] = [];
  if ((answers.midControl === 'gr' || answers.midControl === 'dgr') && answers.midBuiltinVt === 'yes') midBuiltin.push('VT');
  if (answers.midBuiltinLa === 'yes') midBuiltin.push('LA');
  d.midPasBuiltinText = midBuiltin.length ? `${midBuiltin.join(',')}内蔵型` : '';
  d.midPasSymbol = midBuiltin.length ? 'pas-builtin' : 'pas';
  d.midPasZpdSymbol = answers.midBuiltinLa === 'yes' ? 'zpd-pas-boxed' : 'zpd-pas';
  d.midRatingText = [answers.midRatedVoltage ? `${answers.midRatedVoltage}V` : '', answers.midRatedCurrent ? `${answers.midRatedCurrent}A` : ''].filter(Boolean).join(' ');

  // 送り出しのLBSのパワーヒューズ（例: PF 30A）。定格電流が分からないときは、書かない
  d.linkFuseText = answers.linkFuseCurrent ? `PF ${answers.linkFuseCurrent}A` : '';

  // 2か所目以降のPAS・ASの定格（例: 7200V 300A）。片方しか分からないときは分かる方だけ書く
  const rating = (v: unknown, a: unknown) => [v ? `${v}V` : '', a ? `${a}A` : ''].filter(Boolean).join(' ');
  d.areaPasRatingText = rating(answers.areaPasRatedVoltage, answers.areaPasRatedCurrent);
  d.areaAsRatingText = rating(answers.areaAsRatedVoltage, answers.areaAsRatedCurrent);

  // 発電機の注記（例: 非常用 500kVA 軽油）。分かっているものだけ並べる
  d.generatorText = [
    pickOwn(GENERATOR_USAGE_LABEL, String(answers.generatorUsage)) ?? '',
    answers.generatorCapacity ? String(answers.generatorCapacity) : '',
    answers.generatorRatedVoltage ? `${answers.generatorRatedVoltage}V` : '',
    pickOwn(GENERATOR_FUEL_LABEL, String(answers.generatorFuel)) ?? (answers.generatorFuel ? String(answers.generatorFuel) : ''),
  ]
    .filter(Boolean)
    .join(' ');

  // コンデンサ・リアクトルの定格電圧：数字だけなら「V」を付ける（7020 → 7020V）。どんな値でもよい（古いコンデンサは6600V、リアクトルは243Vでないこともある）
  for (const [from, to] of [['capacitorRatedVoltage', 'capacitorVoltageText'], ['reactorRatedVoltage', 'reactorVoltageText']] as const) {
    const v = String(answers[from] ?? '').trim();
    d[to] = /^\d+(\.\d+)?$/.test(v) ? `${v}V` : v;
  }

  // 蓄電池：蓄電ユニットの右に書く文字（出力・容量／台数）と、PCSの右に書く文字（容量ごとに1行。第14弾 項目2）
  d.batteryUnitCountText = answers.batteryUnitCount !== undefined && answers.batteryUnitCount !== '' && Number(answers.batteryUnitCount) >= 1 ? `×${countOf(answers.batteryUnitCount, 1, maxCountOf('batteryUnitCount'))}台` : '';
  {
    const kinds = countOf(answers.batteryPcsGroupCount);
    const lines: string[] = [];
    for (let i = 0; i < kinds; i++) {
      const kw = answers[indexedKey('batteryPcsKw', i)];
      if (kw === undefined || kw === null || kw === '') continue;
      lines.push(`${kw}kW×${countOf(answers[indexedKey('batteryPcsUnits', i)] ?? 1, 1, maxCountOf('pcsCount'))}台`);
    }
    // 以前の案件：「蓄電池のPCSの容量」の文字が残っていて、容量ごとの入力が無いときは、その文字をそのまま書く
    if (lines.length === 0 && answers.batteryPcsCapacity !== undefined && String(answers.batteryPcsCapacity).trim() !== '') lines.push(String(answers.batteryPcsCapacity).trim());
    for (let i = 0; i < 10; i++) d[`batteryPcsLine${i + 1}`] = lines[i] ?? '';
  }

  // PCSの注記（例: 100kW×15台、50kW×7台）。同じ容量はまとめて書く
  const groups = countOf(answers.pvGroupCount);
  const pcs: string[] = [];
  for (let i = 0; i < groups; i++) {
    const kw = answers[indexedKey('pcsCapacity', i)];
    // PCS の台数は、1〜100（数として読めない・大きすぎるものは、1台・100台。「Infinity台」などと書かない）
    const n = countOf(answers[indexedKey('pcsCount', i)] ?? 1, 1, maxCountOf('pcsCount'));
    if (kw === undefined || kw === null || kw === '') continue;
    pcs.push(`${kw}kW×${n}台`);
  }
  d.pcsText = pcs.join('、');

  /*
   * 変圧器ごとのPCSの内訳。
   * 容量の種類ごとに「何台目の変圧器に何台」を入れてあるので、
   * それを変圧器ごとに集め直して「50kW×2台」「5kW×1台」の行にする。
   * どの変圧器にも入れていない種類は、ぜんぶ1台目の変圧器につないだものとして扱う。
   */
  const trCount = countOf(answers.transformerCount, 1, maxCountOf('transformerCount'));
  const perTransformer: string[][] = Array.from({ length: trCount }, () => []);
  /** PCSごとにPVの容量を入れたときの、変圧器ごとの合計（kW） */
  const pvByPcs: number[] = Array.from({ length: trCount }, () => 0);
  const perPcsMode = pcsInputMode(answers) === 'perPcs';
  for (let i = 0; i < groups; i++) {
    const kw = answers[indexedKey('pcsCapacity', i)];
    if (kw === undefined || kw === null || kw === '') continue;
    const total = countOf(answers[indexedKey('pcsCount', i)] ?? 1, 0, maxCountOf('pcsCount'));
    const share = pcsShares(answers, i, total, trCount);
    for (let t = 0; t < trCount; t++) {
      if ((share.counts[t] ?? 0) > 0) perTransformer[t]!.push(`${kw}kW×${share.counts[t]}台`);
    }
    // PCSごとのPVの容量（数として読めるものだけ。同じ変圧器につなぐものは足す）
    if (share.perPcs) {
      for (let k = 0; k < Math.min(total, PCS_INPUT_MAX); k++) {
        const kwPv = parseFloat(String(answers[indexedKey(`pvKwPcs${k + 1}`, i)] ?? ''));
        if (Number.isFinite(kwPv) && kwPv > 0) pvByPcs[share.dest[k] ?? 0]! += kwPv;
      }
    }
  }
  for (let t = 0; t < Math.max(8, trCount); t++) {
    d[`pcsAtTr${t + 1}`] = perTransformer[t]?.join('\n') ?? '';
    d[`pcsTrNo${t + 1}`] = String(t + 1);
    // PCSの枠の真下のPVの容量（任意）。入れてあれば「100kW」と書く。空欄なら書かない
    // PCSごとに入れる入れ方のときは、PCSごとの値を足した合計。変圧器ごとの入れ方のときは、その変圧器の欄の値
    const pvKw = perPcsMode ? (pvByPcs[t] ? String(Math.round(pvByPcs[t]! * 100) / 100) : '') : String(answers[`pvKw${t + 1}`] ?? '').trim();
    d[`pvKwText${t + 1}`] = pvKw ? (/kw$/i.test(pvKw) ? pvKw : `${pvKw}kW`) : '';
  }
  /*
   * 変圧器の記号。結線方式がまだ入っていないときは、円の中が空のものを使う。
   * 決まっていないのに勝手にΔやYを描くと、間違った図面がそのまま使われてしまう。
   */
  // 単相変圧器3台のΔ-Δ結線（tr-3p-dd-1p3）は、3台で1台の動力変圧器として、三相 Δ-Δ結線の記号で、1台として描く
  d.trSymbol = answers.trConnection ? (answers.trConnection === 'tr-3p-dd-1p3' ? 'tr-3p-dd' : String(answers.trConnection)) : 'tr-blank';
  // 構成の文字（変圧器の文字の最後の行）。単相変圧器3台のΔ-Δ結線は、「単相変圧器×3」と入る（手で書いた構成があれば、そちらを使う）
  if (answers.trConnection === 'tr-3p-dd-1p3' && !String(answers.trComposition ?? '').trim()) d.trComposition = '単相変圧器×3';

  /** PCSをどこかの変圧器につないだか（つないでいなければ太陽光は結線せずに置く） */
  d.pcsAssigned = answers.hasPv === 'yes' && perTransformer.some((v) => v.length > 0) ? 'yes' : 'no';

  // ケーブルの注記（3行目：定格電圧 断面積 長さ）。引込ケーブル・エリア間のケーブル・引込点〜責任分界点のケーブルは、すべて同じ書き方
  //   長さ不明は「- m」。実測でないときは「約20m」（現場で歩測しただけ、という場面が多い）
  const cableSpec = (voltage: unknown, crossSection: unknown, length: unknown, approx: unknown): string =>
    [
      voltage ? `${voltage}V` : '',
      crossSection ? `${crossSection}mm2` : '',
      length === undefined || length === null || length === '' ? '- m' : `${approx === 'yes' ? '約' : ''}${length}m`,
    ]
      .filter(Boolean)
      .join(' ');
  d.cableInstallationLabel = pickOwn(CABLE_INSTALLATION_LABEL, String(answers.cableInstallation)) ?? '';
  d.cableSpecLine = cableSpec(answers.cableVoltage, answers.cableCrossSection, answers.cableLength, answers.cableLengthApprox);

  // 送り出しの、最後の段のケーブルの有無（受け側の端末は、これで出る・出ないが決まる。以前は、1段目のケーブルの有無で決めていたので、2段以上のとき、食い違った）
  d.linkLastCable = String(answers[`${linkStagePrefix(linkStageCountOf(answers))}Cable`] ?? 'yes') === 'no' ? 'no' : 'yes';
  // 2か所目以降のエリアの、前のエリアからのケーブルの注記
  d.linkCableInstallationLabel = pickOwn(CABLE_INSTALLATION_LABEL, String(answers.linkCableInstallation)) ?? '';
  d.linkCableSpecLine = cableSpec(answers.linkCableVoltage, answers.linkCableCrossSection, answers.linkCableLength, answers.linkCableLengthApprox);
  // 2段目〜4段目（送り出しの段）：LBSのパワーヒューズの文字・ケーブルの注記
  for (const k of [2, 3, 4]) {
    const p = `link${k}`;
    d[`${p}FuseText`] = answers[`${p}FuseCurrent`] ? `PF ${answers[`${p}FuseCurrent`]}A` : '';
    d[`${p}CableInstallationLabel`] = pickOwn(CABLE_INSTALLATION_LABEL, String(answers[`${p}CableInstallation`])) ?? '';
    d[`${p}CableSpecLine`] = cableSpec(answers[`${p}CableVoltage`], answers[`${p}CableCrossSection`], answers[`${p}CableLength`], answers[`${p}CableLengthApprox`]);
  }

  // 引込点から責任分界点までのケーブルの注記（区分開閉器なし・地上キャビネットなしのとき）
  d.preCableInstallationLabel = pickOwn(CABLE_INSTALLATION_LABEL, String(answers.preCableInstallation)) ?? '';
  d.preCableSpecLine = cableSpec(answers.preCableVoltage, answers.preCableCrossSection, answers.preCableLength, answers.preCableLengthApprox);

  // 区分開閉器と、その後ろの開閉器とのあいだのケーブルの注記
  d.midCableInstallationLabel = pickOwn(CABLE_INSTALLATION_LABEL, String(answers.midCableInstallation)) ?? '';
  d.midCableSpecLine = cableSpec(answers.midCableVoltage, answers.midCableCrossSection, answers.midCableLength, answers.midCableLengthApprox);

  // 変圧器・コンデンサ・高圧の発電機の、電源側の高圧ケーブル（第18弾 F）：開閉器の図記号と文字（選んだ順に、最大3つずつ）・ケーブルの注記
  const SWITCH_SYMBOL: Record<string, { symbol: string; label: string }> = {
    ds: { symbol: 'ds', label: 'DS' },
    vcb: { symbol: 'vcb', label: 'VCB' },
    lbs: { symbol: 'lbs-pf', label: 'LBS' },
    'lbs-plain': { symbol: 'lbs', label: 'LBS' },
    vcs: { symbol: 'vcs', label: 'VCS' },
    as: { symbol: 'as', label: 'AS' },
    gs: { symbol: 'gs', label: 'GS' },
  };
  for (const p of ['tr', 'cap', 'gen', 'motor']) {
    for (const side of ['Up', 'Dn']) {
      for (const k of [1, 2, 3]) {
        const sw = pickOwn(SWITCH_SYMBOL, String(answers[`${p}Cable${side}${k}`]));
        d[`${p}${side}${k}Symbol`] = sw?.symbol ?? '';
        d[`${p}${side}${k}Label`] = sw?.label ?? '';
      }
    }
    d[`${p}CableInstallationLabel`] = pickOwn(CABLE_INSTALLATION_LABEL, String(answers[`${p}CableInstallation`])) ?? '';
    d[`${p}CableSpecLine`] = cableSpec(answers[`${p}CableVoltage`], answers[`${p}CableCrossSection`], answers[`${p}CableLength`], answers[`${p}CableLengthApprox`]);
  }

  // 電動機（台ごとの答えで組み立てる）：途中のケーブルの注記は、ほかのケーブルと同じ書き方。容量は「500kW」、LBSのパワーヒューズは「PF 30A」
  d.motorCableInstallationLabel = pickOwn(CABLE_INSTALLATION_LABEL, String(answers.motorCableInstallation)) ?? '';
  d.motorCableSpecLine = cableSpec(answers.motorCableVoltage, answers.motorCableCrossSection, answers.motorCableLength, answers.motorCableLengthApprox);
  d.motorCapacityText = [
    answers.motorCapacity !== undefined && answers.motorCapacity !== null && answers.motorCapacity !== '' ? `${answers.motorCapacity}kW` : '',
    answers.motorRatedVoltage !== undefined && answers.motorRatedVoltage !== null && answers.motorRatedVoltage !== '' ? `${answers.motorRatedVoltage}V` : '',
  ]
    .filter(Boolean)
    .join(' ');
  d.motorFuseText = answers.motorFuseCurrent ? `PF ${answers.motorFuseCurrent}A` : '';

  // CT・VTの台数。2台以上のときだけ「CT×2」「VT＋PF×2」のように書く
  const times = (v: unknown) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 2 ? `×${n}` : '';
  };
  d.ctHead = `CT${times(answers.ctCount)}`;
  d.vtPfHead = `VT＋PF${times(answers.vtCount)}`;
  // V結線は、VTが2台以上あるときだけ書く
  d.vtConnectionText = answers.vtConnection === 'v' && Math.floor(Number(answers.vtCount)) >= 2 ? 'V結線' : '';

  // 送り出しの途中に付ける部品（VT・CT）の文字（第13弾 項目55 修正19・段階3-1）。VT・CTの書き方は、主回路のものと同じ
  for (let n = 1; n <= LINK_PART_MAX; n++) {
    const cnt = Math.floor(Number(answers[linkPartKey(n, 'VtCount')]));
    const vtCount = Number.isFinite(cnt) && cnt >= 2 ? cnt : 1;
    d[`linkPart${n}VtHead`] = `VT＋PF${vtCount >= 2 ? `×${vtCount}` : ''}`;
    d[`linkPart${n}VtConnText`] = answers[linkPartKey(n, 'VtConn')] === 'v' && vtCount >= 2 ? 'V結線' : '';
    const pct = String(answers[linkPartKey(n, 'CtRatio')] ?? '').trim();
    d[`linkPart${n}CtRatioText`] = /^\d+(\.\d+)?$/.test(pct) ? `${pct}/5A` : pct;
  }

  // 送り出しの途中の継電器（段階3-2）：つなぐ先（途中の機器n個目＝part-n／名前だけ＝none）と、試験端子を入れる機器
  {
    const kinds = linkPartsByKind(answers);
    const tt = new Set<number>();
    for (const r of LINK_RELAYS) {
      const cands = r.on === 'ct' ? kinds.ct : kinds.vt;
      const given = String(answers[linkRelayKey(r.code, 'At')] ?? '');
      // 答えが、いま選べる機器ならそのまま。答えが「名前だけ」ならそのまま。それ以外（まだ・古い答え）は、最初の候補
      const target = cands.some((n) => given === `part-${n}`) ? given : given === 'none' ? 'none' : cands.length > 0 ? `part-${cands[0]}` : 'none';
      d[linkRelayKey(r.code, 'Target')] = target;
      const m = /^part-(\d+)$/.exec(target);
      if (m && answers[linkRelayKey(r.code)] === 'yes') tt.add(Number(m[1]));
    }
    for (let n = 1; n <= LINK_PART_MAX; n++) d[linkRelayTtKey(n)] = tt.has(n) && answers[LINK_RELAY_NO_TEST_KEY] !== 'yes' ? 'yes' : 'no';
  }

  // 継電器の記号（OCR→relay-ocr）。種類がまだ無いときは、記号を決めない
  d.relaySymbol = answers.relayType ? `relay-${String(answers.relayType).toLowerCase()}` : '';

  // 補助変圧器。結線方式がまだ無いときは、円の中が空の記号を使う
  d.auxTrSymbol = answers.auxTrConnection ? String(answers.auxTrConnection) : 'tr-blank';
  d.auxTrUsageLine = answers.auxTrUsage ? `${answers.auxTrUsage}用 Tr` : '補助変圧器';
  const auxPhase = String(answers.auxTrConnection ?? '').startsWith('tr-1p') || answers.auxTrConnection === 'tr-vv' ? '1φ' : '3φ';
  d.auxTrCapacityLine = answers.auxTrCapacity ? `${auxPhase}${answers.auxTrCapacity}kVA` : '';

  // CTの変流比。数字（100）だけなら、2次側の「/5A」を足して「100/5A」にする。
  // 2次側はふつう5Aなので、「100/5A」「40A/5A」のように、すでに書いてあるものは、そのまま使う
  const ct = String(answers.ctRatio ?? '').trim();
  d.ctRatioText = /^\d+(\.\d+)?$/.test(ct) ? `${ct}/5A` : ct;

  // PC・LBSの定格の書き方
  //   PC  … 1行目「30A」／2行目「F:10A」
  //   LBS … 1行目「LBS」／2行目「7200V 200A」／（3行目 PF×本数）／最後「G40A T30A 40kA」（半角スペース区切り）
  const pfLine = (g: Value, kind: Value, amp: Value, ka: Value): string => {
    const parts: string[] = [];
    if (g) parts.push(`G${g}`);
    if (kind && amp) parts.push(`${kind}${amp}`);
    if (ka) parts.push(String(ka));
    return parts.join(' ');
  };
  // 受電側のLBS（主遮断装置・エリアのLBS）の2行目：「7200V 200A」（定格電圧と定格電流。入れてあるものだけ）。
  // 変圧器・コンデンサの手前のLBSと同じ形（LBS／7200V 200A／PF×3／ヒューズの定格）にそろえる
  d.lbsRatingLine = [answers.lbsRatedVoltage ? `${answers.lbsRatedVoltage}V` : '', answers.lbsRatedCurrent ? `${answers.lbsRatedCurrent}A` : ''].filter(Boolean).join(' ');
  // 受電側のLBSのヒューズの行：「G40A 40kA」（PFの定格電流Gと、短絡電流だけ。T・C・Mの電流は書かない）。
  // 以前の「ヒューズ定格」（自由な文字。例：7200V G50A T40A）だけが入っている案件は、その中の G と kA を使う
  const legacySpec = String(answers.lbsFuseSpec ?? '');
  const lbsG = answers.lbsPfG ? String(answers.lbsPfG) : (/G(\d+(?:\.\d+)?A)/.exec(legacySpec)?.[1] ?? '');
  const lbsKa = answers.lbsPfKa ? String(answers.lbsPfKa) : (/(\d+(?:\.\d+)?kA)/i.exec(legacySpec)?.[1] ?? '');
  d.lbsPfLine = [lbsG ? `G${lbsG}` : '', lbsKa].filter(Boolean).join(' ');
  for (const prefix of ['tr', 'cap'] as const) {
    // 定格を入れていないときは、せめて記号名を出す
    d[`${prefix}PcHead`] = answers[`${prefix}PcRating`] || 'PC';
    // PCのヒューズの本数（「F×2」の行）。答えがあればそれ。無ければ、自動（変圧器：電灯（単相）は2本、ほかは3本。コンデンサ：3本）
    {
      const given = String(answers[`${prefix}PcFuseCount`] ?? '').trim();
      const auto = prefix === 'tr' ? (transformerFuseCount(answers) ?? 3) : 3;
      const n = /^[123]$/.test(given) ? Number(given) : auto;
      d[`${prefix}PcFuseCountLine`] = `F×${n}`;
    }
    // LBSの2行目：「7200V 200A」（定格電圧と定格電流。入れてあるものだけ）
    d[`${prefix}LbsRatingLine`] = [answers[`${prefix}LbsVoltage`] ? `${answers[`${prefix}LbsVoltage`]}V` : '', answers[`${prefix}LbsRating`] ? String(answers[`${prefix}LbsRating`]) : ''].filter(Boolean).join(' ');
    d[`${prefix}PfLine`] = pfLine(
      answers[`${prefix}PfG`],
      // 変圧器の手前は、PFの負荷側が必ず変圧器（T）、コンデンサの手前はコンデンサ（C）。答え（以前の案件で別の記号が入っているもの）があれば、それを使う
      answers[`${prefix}PfLoad`] || (prefix === 'tr' ? 'T' : 'C'),
      answers[`${prefix}PfLoadAmp`],
      answers[`${prefix}PfKa`],
    );
  }

  // LAの上位のPCの、ヒューズの本数（「F×3」の行）。答え（1〜3）があればそれ。空欄は3本（第20弾・図面再現の診断から）
  {
    const given = String(answers.laPcFuseCount ?? '').trim();
    d.laPcFuseCountLine = `F×${/^[123]$/.test(given) ? given : '3'}`;
  }

  /*
   * LBSに付くPF（パワーヒューズ）の本数（「PF×3」の行）。
   *   変圧器の手前：単相の変圧器は×2、三相の変圧器は×3（V結線も三相）。結線がまだ入っていないときは、用途から
   *                 （電灯は×2、ほかは×3）。結線も用途も入っていないときは、決められないので、書かない
   *   コンデンサの手前：×3（三相に、1本ずつ）
   * 入力はさせず、結線方式（と用途）から自動で決める
   */
  const trFuses = transformerFuseCount(answers);
  d.trPfCountLine = trFuses === null ? '' : `PF×${trFuses}`;
  d.capPfCountLine = 'PF×3';

  // 変圧器の容量表記（V結線は2台分を別行にする）
  const phase = String(answers.trConnection ?? '').startsWith('tr-1p') || answers.trConnection === 'tr-vv' ? '1φ' : '3φ';
  const mixedV = answers.trConnection === 'tr-vv' && answers.trUsage === '電灯・動力';
  // 用途の行。電灯および動力のV結線は、容量の行に「電灯」「動力」と書くので、ここには出さない
  d.trUsageLine = mixedV ? '' : answers.trUsage ?? '';
  if (mixedV) {
    // 電灯 ○kVA ／ 動力 ○kVA の2行（変圧器ごとではなく、V結線全体の容量）
    d.trCapacityLine = (
      [
        ['電灯', answers.trCapacityLight],
        ['動力', answers.trCapacityPower],
      ] as const
    )
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([name, v]) => `${name} ${v}kVA`)
      .join('\n');
  } else if (answers.trConnection === 'tr-3w-yyd' || answers.trConnection === 'tr-3w-ddy') {
    // 三巻線変圧器：一次・二次・三次の容量は、どれも任意。
    //   3つとも入力：3φ300/300/100kVA ／ 一次だけ：3φ300kVA ／ ほか：入力した巻線だけ「一次300kVA / 三次100kVA」
    const w = [answers.trCapacityW1, answers.trCapacityW2, answers.trCapacityW3].map((v) =>
      v === undefined || v === null || String(v).trim() === '' ? '' : String(v).trim(),
    );
    const names = ['一次', '二次', '三次'];
    if (w.every((v) => v)) d.trCapacityLine = `${phase}${w.join('/')}kVA`;
    else if (w[0] && !w[1] && !w[2]) d.trCapacityLine = `${phase}${w[0]}kVA`;
    else d.trCapacityLine = w.map((v, i) => (v ? `${names[i]}${v}kVA` : '')).filter(Boolean).join(' / ');
  } else if (answers.trConnection === 'tr-vv') {
    d.trCapacityLine = [answers.trCapacity, answers.trCapacity2]
      .filter((v) => v !== undefined && v !== null && v !== '')
      .map((v) => `1φ${v}kVA`)
      .join(' / ');
  } else {
    d.trCapacityLine = answers.trCapacity ? `${phase}${answers.trCapacity}kVA` : '';
  }

  // 受電設備エリアのラベル（例: 電気室（1階、屋内））
  d.areaLabel = areaLabel(answers);

  return d;
}

const AREA_FORM_LABEL: Record<string, string> = {
  cubicle: 'キュービクル式',
  'room-cubicle': '電気室',
  'room-open': 'オープンフレーム式',
  'apartment-pole': '高圧マンション',
};
const AREA_PLACEMENT_LABEL: Record<string, string> = {
  indoor: '屋内',
  rooftop: '屋上',
  outdoor: '地上',
  'semi-outdoor': '半屋外',
  pole: '電柱上',
};

/** 受電設備の形態から、図面名称に入れる「〜式」。電気室の中のキュービクルは、キュービクル式として扱う */
const FORM_KIND: Record<string, string> = {
  cubicle: 'キュービクル式',
  'room-cubicle': 'キュービクル式',
  'room-open': 'オープンフレーム式',
  // 高圧マンション（電柱上構成）は、キュービクル式でもオープンフレーム式でもないので、「〜式」を付けない
  'apartment-pole': '',
};

const DRAWING_NAME_TAIL = '高圧受電設備単線結線図';

/**
 * 受電設備の形態（各エリアの「形態は？」）から決まる図面名称。
 *
 * - 全部のエリアがキュービクル式（電気室の中のキュービクルを含む）→「キュービクル式高圧受電設備単線結線図」
 * - 全部のエリアがオープンフレーム式 →「オープンフレーム式高圧受電設備単線結線図」
 * - エリアによって形態が違う →「高圧受電設備単線結線図」（形態は書かない）
 * - 高圧マンション（電柱上構成）→「高圧受電設備単線結線図」（「〜式」は付けない）
 * - まだ形態が入力されていない →「キュービクル式高圧受電設備単線結線図」（これまでと同じ）
 */
export function drawingNameFromForm(answers: Answers): string {
  const count = countOf(answers.areaCount, 1, maxCountOf('areaCount'));
  const kinds = new Set<string>();
  for (let i = 0; i < count; i++) {
    const kind = pickOwn(FORM_KIND, String(answers[indexedKey('areaForm', i)]));
    if (kind !== undefined) kinds.add(kind);
  }
  if (kinds.size === 0) return `${FORM_KIND.cubicle}${DRAWING_NAME_TAIL}`;
  if (kinds.size > 1 || kinds.has('')) return DRAWING_NAME_TAIL;
  return `${[...kinds][0]}${DRAWING_NAME_TAIL}`;
}

/** 図面に書く図面名称。ヒアリングの「図面名称」に書いてあればそれを優先し、空なら形態から決める */
export function resolveDrawingName(answers: Answers): string {
  const typed = String(answers.drawingName ?? '').trim();
  return typed || drawingNameFromForm(answers);
}

export function areaLabel(answers: Answers): string {
  const head = pickOwn(AREA_FORM_LABEL, String(answers.areaForm)) ?? '受電設備';
  // 高圧マンション（電柱上構成）の設置場所は、必ず電柱上
  const placement = answers.areaForm === 'apartment-pole' ? 'pole' : answers.areaPlacement;
  const inner = [
    answers.areaFloor,
    pickOwn(AREA_PLACEMENT_LABEL, String(placement)) ?? placement,
    answers.areaDetail,
  ]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .join('、');
  const body = inner ? `${head}（${inner}）` : head;
  // エリアの名前（2か所目以降）を、いちばん前に書く
  const name = Number(answers.areaNo) > 1 ? String(answers.areaName ?? '').trim() : '';
  return name ? `${name}　${body}` : body;
}

/* ------------------------------------------------------------------ */
/* 構成データの組み立て                                                  */
/* ------------------------------------------------------------------ */

export interface PlacedItem {
  /** 同じ機器が複数あるときに一意になるID */
  id: string;
  role: string;
  symbolId: string;
  kind: Placement['kind'];
  parent?: string;
  slot?: string;
  /** 図面に添える文字 */
  label: string[];
  /** 記号の入力項目の値 */
  props: Record<string, Value>;
  /** この機器の下に空ける間隔 */
  gapAfter?: number;
  /** この機器の下の線を点線で描くか */
  dashedAfter?: boolean;
  /** 二次側から結線してくる機器のロール */
  connectFrom?: string[];
  /** 文字を記号のどちら側に書くか */
  labelSide?: 'left' | 'right';
  /** kind==='overlay' のとき、重ねる先の記号のロール */
  attachTo?: string;
  /** 低圧の回線のとき、何本目か（0始まり） */
  lane?: number;
  /**
   * 高圧母線から並列にぶら下がる機器の列が、母線ではなく、ほかの機器の列の開閉器の二次側から分かれて出るとき、その開閉器（「役割:何件目」。0始まり）。
   * その列のすべての機器に付く。分かれる元は、自分より前の列の開閉器だけ（第18弾 F-②）
   */
  feedFrom?: string;
  /** この開閉器の二次側から、別のエリアへ出る線の数（その列のすぐ右に、送り出しの並びを、その数だけ置く広さを空ける。第18弾 F-③） */
  linkOut?: number;
  /**
   * 高圧母線から並列にぶら下がるときの「段」（Placement.row と同じ）。
   * 同じ段の機器は、どの列でも同じ高さに揃う。
   */
  row?: number;
  /**
   * 繰り返しの何件目か（0始まり）。
   * コンデンサ1台目のリアクトルとコンデンサ、のように「同じ1台ぶん」をまとめるのに使う。
   */
  unit?: number;
  /**
   * 2か所目以降のエリアの機器のとき、何か所目か（1が2か所目。0始まり）。1か所目の機器には付かない。
   * 役割（role）には、「a2:」のように、エリアの番号が前に付く。
   */
  area?: number;
  /**
   * 送り出す側の開閉器（kind が sendout）のとき、どのエリアへ送る線か（送り先。0始まり）。
   * area は、送り出す側のエリア。役割（role）には、送り先の番号（「a3:」など）が付く（第13弾 項目22）
   */
  dest?: number;
  /** kind==='sendout' のとき、送り出しの何段目か（1始まり）。地絡継電器まわり（ZCT・DGR・GR・TC）は、地絡継電器が付く段 */
  stage?: number;
  /**
   * ZPD・LAをつなぐ位置の答え（ds-vcb／vcb-ct／lbs-ct／ct-bus）。
   * 位置は、構成の並び（主回路の何番目か）で決まっている。ct-bus＝変圧器の手前（高圧母線の上）
   */
  tap?: string;
  /** 直前の同じ向きの分岐と、横につなげずに、別の分岐として出す（ZPDとLAを別の記号にするため） */
  separate?: boolean;
  /** 位置の答え（CT：primary／secondary／after-vt）。並びに使う */
  pos?: string;
  /** つながる先の答え（継電器：ct-1・vt-2・none）。並びとつなぎ方に使う */
  ref?: string;
  /** つなぎ元の記号の文字を、つなぐ線の下へ動かす（VTの右の端に、継電器をつなぐとき） */
  sourceLabel?: 'below';
  /** 分岐するとき、横に回さず、縦のまま置く（LA） */
  upright?: boolean;
  /** 直前の分岐（開閉器）の真下に、縦につなげて置く（LAの上に開閉器が付くとき） */
  hang?: boolean;
  /** hang のとき、直前の分岐との縦の間隔 */
  hangGap?: number;
  /** kind==='link' のとき、前のエリアからのつなぎ方 */
  link?: {
    /** どのエリアから分岐するか（0始まり） */
    from: number;
    /** 分岐の位置：ds-source（DSの電源側）／ds-vcb（DSとVCBの間）／vcb-load（VCBの負荷側）／bus（高圧母線）／tr-secondary（変圧器の二次側） */
    tap: string;
    /** tap が tr-secondary のとき、何台目の変圧器か（1始まり） */
    trNo?: number;
    /** tap が device（ほかの機器の開閉器の二次側）のとき、その開閉器（「役割:何件目」。送り出す側のエリアの役割の名前のまま。第18弾 F-③） */
    devRef?: string;
    /** 送り出しの段ごとの、線の様子（1段目から順に）。最後の段が、送り先のエリアへ向かう */
    stages?: { cable: boolean; dashed: boolean; label: string[] }[];
    /** ケーブルでつなぐか（false のときは、ケーブルの図記号を描かず、ふつうの線でつなぐ） */
    cable: boolean;
    /** ケーブルの線を点線（埋設）で描くか */
    dashed: boolean;
    /** 送り先名称（回路名称）。送り出し側のケーブル端末の近くに書く。無ければ空 */
    name: string[];
  };
  note?: string;
}

/**
 * 繰り返し入力するグループ（受電設備エリア・変圧器）の n 件目のキー。
 * 1件目は基本のキーのままにして、2件目以降だけ接尾辞を付ける。
 */
/** 変圧器の結線が、単相か（単相の変圧器の手前のPF・PCは2本、三相は3本）。結線が未入力なら、null */
const SINGLE_PHASE_CONNECTIONS = new Set(['tr-1p', 'tr-1p-2w', 'tr-1p-parallel']);
/**
 * 変圧器の手前の、PF・PCのヒューズの本数（自動）：単相は2本、三相は3本（第20弾・図面再現の診断から）。
 * 結線方式が分かっていれば、その相で決める。まだ入っていないときは、用途から（電灯は単相のはずなので2本、ほかは3本）。
 * 結線も用途も未入力なら、決められないので、null。
 */
export function transformerFuseCount(answers: Answers): number | null {
  const conn = String(answers.trConnection ?? '').trim();
  if (conn) return SINGLE_PHASE_CONNECTIONS.has(conn) ? 2 : 3;
  const usage = String(answers.trUsage ?? '').trim();
  return usage ? (usage === '電灯' ? 2 : 3) : null;
}

export function indexedKey(id: string, index: number): string {
  return index === 0 ? id : `${id}__${index + 1}`;
}

/**
 * 繰り返しグループの中で、件ごとに別々に答える質問。
 * 件数そのものと、1回だけ聞く質問（shared）は含まない。
 */
export const PER_UNIT_QUESTION_IDS: ReadonlySet<string> = (() => {
  const ids = new Set<string>();
  for (const g of QUESTION_GROUPS) {
    if (!g.repeatCountKey) continue;
    for (const q of QUESTIONS) {
      if (q.group === g.id && q.id !== g.repeatCountKey && !q.shared) ids.add(q.id);
    }
  }
  return ids;
})();

/** 2件目以降の、件ごとの答えのキー（trCapacity__2 など。エリアごとの a2:trCapacity__2 も含む） */
const UNIT_KEY = /__\d+$/;

/** 件ごとの答え（2件目以降）を除いた回答 */
function withoutUnitKeys(answers: Answers): Answers {
  const out: Answers = {};
  for (const key in answers) if (!UNIT_KEY.test(key)) out[key] = answers[key];
  return out;
}

/**
 * n 件目の回答として見た集まりを作る。
 *
 * 件ごとの質問は、**その件に入れた答えだけ**を見る。
 * 以前は2件目以降で空欄だと1件目の答えを引き継いでいたが、
 * 「1台目が単相だから2台目も単相」と勝手に決めてしまうため、件ごとに独立させた。
 * 空欄のままなら、その質問は未回答として扱う（必須なら画面に「未入力あり」が出る）。
 */
export function viewAt(answers: Answers, index: number): Answers {
  // 何件目か（1始まり）は unitNo に入れる（1個目はOCR、2個目はUVR、のように、件ごとの初期値の条件に使う）
  // 件ごとの答え（trCapacity__3 など）は、この件の分だけを、下で取り出す。ほかの件の分まで写すと、台数が増えるほど、
  // 1件ごとに写す量が増えて、全体の時間が台数の2乗で増える（変圧器100台で、組み立てに0.2秒かかっていた）
  if (index === 0) return { ...withoutUnitKeys(answers), unitNo: 1 };
  const out: Answers = { ...withoutUnitKeys(answers), unitNo: index + 1 };
  for (const id of PER_UNIT_QUESTION_IDS) {
    const v = answers[indexedKey(id, index)];
    if (v !== undefined) out[id] = v;
    // まだ答えていない質問は、1件目の答えは引き継がず、質問の既定値で見る（画面にも、既定値が出ているため。
    // 既定値が無ければ、未回答）。既定値を見ないと、画面に「200A」「T」「40kA」と出ているのに、2件目以降の図面に出なかった
    else if (!isBlankStart(answers) && QUESTION_DEFAULTS[id] !== undefined) out[id] = QUESTION_DEFAULTS[id]!;
    else delete out[id];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 受電設備エリアごとの答え                                               */
/* ------------------------------------------------------------------ */

/**
 * エリアが2か所以上のとき、「受電設備の構成」以降（perArea のグループ）は、エリアごとに答える。
 * 1か所目は今までのキー（trCapacity など）、2か所目以降は前に「a2:」「a3:」を付けたキー（a2:trCapacity）で持つ。
 * こうしておくと、1か所だけの案件（以前の案件を含む）は、保存の形が変わらない。
 */
export const areaKey = (key: string, area: number): string => (area === 0 ? key : `a${area + 1}:${key}`);

const AREA_KEY = /^a\d+:/;

/** エリアの数（1以上） */
export function areaCountOf(answers: Answers): number {
  return countOf(answers.areaCount, 1, maxCountOf('areaCount'));
}

/** エリアごとに答える質問のID（繰り返しの件数の質問も含む） */
export const PER_AREA_QUESTION_IDS: ReadonlySet<string> = new Set(
  QUESTIONS.filter((q) => QUESTION_GROUPS.find((g) => g.id === q.group)?.perArea).map((q) => q.id),
);

/** エリアの形態・設置場所など（「か所目」ごとに答える、エリアそのものの質問） */
const AREA_GROUP_IDS: readonly string[] = QUESTIONS.filter((q) => q.group === 'area' && q.id !== 'areaCount').map((q) => q.id);

/**
 * n番目（0始まり）のエリアの答えだけを取り出す。
 * 1か所目はそのまま。2か所目以降は、そのエリアの答え（a2:〜）を、ふつうのキーに直す。
 * 別のエリアの答えは入らず、まだ答えていない質問は、既定値になる。
 * エリアの番号は areaNo（1始まり）に入る（2か所目以降だけの質問の表示条件に使う）。
 */
export function areaView(answers: Answers, area: number): Answers {
  if (area === 0) return answers;
  const out: Answers = {};
  for (const [key, value] of Object.entries(answers)) {
    if (AREA_KEY.test(key)) continue;
    if (PER_AREA_QUESTION_IDS.has(key.split('__')[0]!)) continue;
    out[key] = value;
  }
  for (const id of PER_AREA_QUESTION_IDS) {
    if (!isBlankStart(answers) && QUESTION_DEFAULTS[id] !== undefined) out[id] = QUESTION_DEFAULTS[id]!;
  }
  for (const id of AREA_GROUP_IDS) {
    const v = answers[indexedKey(id, area)];
    if (v === undefined) delete out[id];
    else out[id] = v;
  }
  const prefix = `a${area + 1}:`;
  for (const [key, value] of Object.entries(answers)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  out.areaNo = area + 1;
  // 送り出す側のエリア（このエリアへ線を送るエリア）にZPDがあるか。送り出しのDGRが、零相電圧を、そのZPDから得るため
  const from = linkFromOf(out, area);
  out.linkSenderZpd = (from === 0 ? answers.hasZpd : areaView(answers, from).hasZpd) === 'yes' ? 'yes' : 'no';
  // 送り出しの、地絡継電器（GR・DGR）が付く段：段のうち、はじめに、VCB・LBS（を含む組み合わせ）がある段。DS・VCSだけの段には付かない。無ければ0
  if (area >= 1) out.linkGroundStage = linkGroundStageOf(out);
  // 送り出しの途中のCT・VTの数（継電器のつなぐ先を、2つ以上のときだけ聞くため）
  if (area >= 1) {
    const kinds = linkPartsByKind(out);
    out[LINK_PART_CT_COUNT] = kinds.ct.length;
    out[LINK_PART_VT_COUNT] = kinds.vt.length;
  }
  return normalizeAnswers(out);
}

/** 送り出しの途中に、いま付けられる機器（VT・CT）の番号。種類ごと（個数の範囲内で、位置がいまの構成にあるものだけ） */
export function linkPartsByKind(view: Answers): { ct: number[]; vt: number[] } {
  const ct: number[] = [];
  const vt: number[] = [];
  for (let n = 1; n <= LINK_PART_MAX; n++) {
    if (!evaluate(linkPartOpen(n), view)) continue;
    const kind = String(view[linkPartKey(n, 'Kind')] ?? 'vt');
    if (kind === 'ct') ct.push(n);
    else if (kind === 'vt') vt.push(n);
  }
  return { ct, vt };
}

/** 送り出しの段の数（1〜4）。どの分岐位置でも、2段以上にできる（第18弾 F-③）。答えが無い・おかしいときは1段 */
export function linkStageCountOf(view: Answers): number {
  const n = Math.round(Number(view.linkStageCount ?? 1));
  return Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 1;
}

/** k段目（1始まり）の開閉器の答えのキー */
export const linkSwitchKey = (k: number): string => (k <= 1 ? 'linkSwitch' : `link${k}Switch`);
/** k段目（1始まり）の、ケーブルの質問の接頭辞（1段目は link、2段目以降は link2・link3・link4） */
export const linkStagePrefix = (k: number): string => (k <= 1 ? 'link' : `link${k}`);

/** 遮断できる開閉器（VCB・LBS）を含む組み合わせ。地絡継電器（GR・DGR）は、これらにだけ付く */
const BREAKING_SWITCH = ['vcb', 'lbs', 'ds-vcb', 'ds-vcb-vcs', 'vcb-vcs', 'lbs-vcs'];

/** 地絡継電器が付く段（1始まり）。無ければ0 */
export function linkGroundStageOf(view: Answers): number {
  const n = linkStageCountOf(view);
  for (let k = 1; k <= n; k++) if (BREAKING_SWITCH.includes(String(view[linkSwitchKey(k)] ?? ''))) return k;
  return 0;
}

/**
 * 2か所目以降のエリア（area：0始まり）が、どのエリアから送られてくるか（0始まり）。
 * 答え（linkFrom）が無い・おかしいときは、1か所目。このエリアより前のエリアに寄せる。2か所目は、必ず1か所目から
 */
export function linkFromOf(view: Answers, area: number): number {
  if (area <= 1) return 0;
  const n = Number(view.linkFrom ?? 1);
  return Math.max(0, Math.min(area - 1, (Number.isFinite(n) ? n : 1) - 1));
}

/** 質問ではないが、表示条件から参照してよい値（エリアの番号と、受電側の開閉器・PCSの入れ方から決まる目印） */
export const VIEW_KEYS: ReadonlySet<string> = new Set([
  'pcsMode',
  'areaNo',
  'linkLastCable',
  'linkSenderZpd',
  'linkGroundStage',
  LINK_PART_CT_COUNT,
  LINK_PART_VT_COUNT,
  linkRelayTtKey(1),
  linkRelayTtKey(2),
  linkRelayTtKey(3),
  linkRelayTtKey(4),
  linkRelayTtKey(5),
  linkRelayTtKey(6),
  ...LINK_RELAYS.map((r) => linkRelayKey(r.code, 'Target')),
  'unitNo',
  'intakeDs',
  'intakeVcb',
  'intakeLbs',
  'intakeLbsPf',
  'intakeStandard',
  'intakeOptional',
]);

/**
 * 受電側の開閉器から決まる目印（'yes'／'no'）。
 * - intakeDs・intakeVcb・intakeLbs：DS・VCB・LBSがあるか
 * - intakeLbsPf：LBSがヒューズ付（PF付）か
 * - intakeStandard：DS＋VCBの標準構成か（VT・CTが必ず入る）
 * - intakeOptional：VT・CTがあるかどうかを、答えてもらう構成か
 */
function intakeFlags(answers: Answers): Record<string, string> {
  const yn = (v: boolean) => (v ? 'yes' : 'no');
  if (Number(answers.areaNo) > 1) {
    const kind = String(answers.areaIntake ?? 'ds-vcb');
    const ds = kind === 'ds-vcb' || kind === 'ds';
    const vcb = kind === 'ds-vcb' || kind === 'vcb';
    const lbs = kind === 'lbs' || kind === 'lbs-pf';
    return {
      intakeDs: yn(ds),
      intakeVcb: yn(vcb),
      intakeLbs: yn(lbs),
      intakeLbsPf: yn(kind === 'lbs-pf'),
      intakeStandard: yn(kind === 'ds-vcb'),
      intakeOptional: yn(kind !== 'ds-vcb'),
    };
  }
  const form = answers.mainBreakerForm;
  return {
    intakeDs: yn(form === 'cb'),
    intakeVcb: yn(form === 'cb'),
    intakeLbs: yn(form === 'pfs'),
    intakeLbsPf: yn(form === 'pfs'),
    intakeStandard: yn(form === 'cb'),
    intakeOptional: yn(form === 'pfs'),
  };
}

/**
 * 回答から、上流→下流の順に並んだ機器の一覧を作る。
 * 受電設備エリアが2か所以上のときは、1か所目の機器のあとに、2か所目以降の機器が続く
 * （2か所目以降は、役割に「a2:」などが付き、area に何か所目かが入る）。
 */
const isAnswered = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
/** 白紙で始めた案件：答えが入っていない段の部品を、材料の表から外す */
function gateBlank(chain: Placement[], answers: Answers, gates: Record<string, string[]>): Placement[] {
  return chain.filter((p) => (gates[p.role] ?? []).every((k) => isAnswered(answers[k])));
}
/** 親（枠・付ける先）が描かれていない部品は、描かない */
function dropOrphans(items: PlacedItem[]): PlacedItem[] {
  let cur = items;
  for (;;) {
    const ids = new Set(cur.map((i) => i.role));
    const next = cur.filter((i) => (!i.parent || ids.has(i.parent)) && (!i.attachTo || ids.has(i.attachTo)));
    if (next.length === cur.length) return cur;
    cur = next;
  }
}

export function buildComposition(givenAnswers: Answers): PlacedItem[] {
  // 状況に応じた初期値（継電器の個数など）を、画面と同じように足してから組み立てる。答えた値はそのまま優先される
  const rawAnswers = withAutoValues(normalizeAnswers(givenAnswers));
  const form = String(withDerived(rawAnswers).mainBreakerForm ?? 'pfs');
  // 白紙で始めた案件は、まだ答えていない段を描かない（図面は、答えた分だけ出る）
  const blank = isBlankStart(givenAnswers);
  const first = composeChain(rawAnswers, [
    ...(blank ? gateBlank(UPSTREAM, rawAnswers, BLANK_GATES) : UPSTREAM),
    ...(blank && !isAnswered(rawAnswers[BLANK_CHAIN_GATE]) ? [] : (pickOwn(CHAIN_BY_FORM, form) ?? [])),
    ...DOWNSTREAM,
    ...TRANSFORMER,
    ...EXTRAS,
    ...FEEDERS,
  ]);
  const out = [...first];
  for (let n = 1; n < areaCountOf(rawAnswers); n++) {
    const view = areaView(rawAnswers, n);
    const prefix = `a${n + 1}:`;
    const items = composeChain(view, [...(blank ? gateBlank(AREA_CHAIN, view, BLANK_AREA_GATES) : AREA_CHAIN), ...TRANSFORMER, ...EXTRAS, ...FEEDERS]);
    const asPlaced = (r: string) => `${prefix}${r}`;
    // 送り出しの段（1〜4段）ごとの、線（ケーブル／電線）の様子。最後の段のケーブルが、送り先のエリアにつながる
    const viewD = withDerived(view);
    const stages = Array.from({ length: linkStageCountOf(view) }, (_, i) => {
      const p = linkStagePrefix(i + 1);
      const cable = String(view[`${p}Cable`] ?? 'yes') !== 'no';
      return {
        cable,
        dashed: cable && view[`${p}CableInstallation`] === 'buried',
        label: cable ? fillTemplate([`{${p}CableInstallationLabel}`, `{${p}CableStructure}`, `{${p}CableSpecLine}`], viewD) : [],
      };
    });
    const lastStage = stages[stages.length - 1]!;
    for (const item of items) {
      out.push({
        ...item,
        id: asPlaced(item.id),
        role: asPlaced(item.role),
        parent: item.parent ? asPlaced(item.parent) : undefined,
        attachTo: item.attachTo ? asPlaced(item.attachTo) : undefined,
        connectFrom: item.connectFrom?.map(asPlaced),
        ...(item.feedFrom ? { feedFrom: asPlaced(item.feedFrom) } : {}),
        area: n,
        ...(item.kind === 'link'
          ? {
              // ケーブルでつなぐときも、ふつうの線でつなぐときも、つなぎ方（どこから・どこへ）は同じ。違いは、ケーブルの図記号を描くか
              label: lastStage.label,
              link: {
                from: linkFromOf(view, n),
                tap: String(view.linkTap ?? 'bus'),
                trNo: view.linkTap === 'tr-secondary' ? Math.max(1, Math.round(Number(view.linkSourceTr ?? 1)) || 1) : undefined,
                devRef: view.linkTap === 'device' && isAnswered(view.linkDevice) ? `${linkFromOf(view, n) === 0 ? '' : `a${linkFromOf(view, n) + 1}:`}${String(view.linkDevice)}` : undefined,
                cable: lastStage.cable,
                dashed: lastStage.dashed,
                // 2段以上のとき、段ごとの線の様子（最後の段は、cable・dashed と同じ）
                stages,
                // 送り先名称は、ケーブルの端末があるときだけ（端末の近くに書くため）。空白だけなら、書かない
                name: lastStage.cable && String(view.linkName ?? '').trim() !== '' ? [String(view.linkName).trim()] : [],
              },
            }
          : {}),
      });
    }
    // 送り出す側の開閉器は、送り先（このエリア）ごとに答える。持ち主は、送り出す側のエリア（area）。役割・IDは、送り先の番号つき
    const sends = composeChain(view, SENDOUT);
    const groundStage = Math.max(1, Number(withDerived(view).linkGroundStage ?? 1) || 1);
    for (const item of sends) {
      out.push({
        ...item,
        id: asPlaced(item.id),
        role: asPlaced(item.role),
        area: linkFromOf(view, n),
        dest: n,
        // 地絡継電器まわり（ZCT・DGR・GR・TC）は、地絡継電器が付く段のもの
        stage: item.stage ?? groundStage,
      });
    }
  }
  // ほかの機器の開閉器の二次側から、別のエリアへ出す線：その開閉器に印を付ける（元の列の右に、並びを置く広さを、空けるため）
  for (const l of out) {
    const ref = l.kind === 'link' ? l.link?.devRef : undefined;
    if (!ref) continue;
    const src = out.find((i) => i.kind === 'parallel' && `${i.role}:${i.unit ?? 0}` === ref);
    if (src) src.linkOut = (src.linkOut ?? 0) + 1;
  }
  return blank ? dropOrphans(out) : out;
}


/* ------------------------------------------------------------------ */
/* 接続元（ほかの機器の開閉器の二次側から分かれる）の選択肢（第18弾 F-②）  */
/* ------------------------------------------------------------------ */

/** 分かれる元にできる、開閉器の役割（機器の列にある、手前・あとの開閉器と、機器の手前のPC・LBS・VCS） */
const FEED_SOURCE_ROLE = /^((tr|cap|gen)-cable-(up|dn)[123]|(tr|cap)-(pc|lbs)|cap-vcs|motor-(ds|vcb|lbs|lbs-plain|vcs)|motor-cable-dn[123])$/;
const FEED_DEVICE_ROLE: Record<string, string> = { tr: 'transformer', cap: 'capacitor', gen: 'generator', motor: 'motor' };
const FEED_SWITCH_NAME: Record<string, string> = { ds: 'DS', vcb: 'VCB', lbs: 'LBS', 'lbs-pf': 'LBS', vcs: 'VCS', as: 'AS', gs: 'GS', pc: 'PC' };

/** 開閉器の項目（役割・記号・件）を、選択肢の名前の符号にする（feed:機器:何台目:開閉器:位置:何つ目） */
function feedLabelOf(i: PlacedItem): string {
  const dev = i.role.startsWith('tr') ? 'tr' : i.role.startsWith('cap') ? 'cap' : i.role.startsWith('gen') ? 'gen' : 'motor';
  const m = /(up|dn)([123])$/.exec(i.role);
  const pos = m ? m[1]! : /^motor/.test(i.role) ? 'mup' : 'own';
  const k = m ? m[2]! : '0';
  const sw = FEED_SWITCH_NAME[/^(?:tr|cap)-(pc)$/.test(i.role) ? 'pc' : i.symbolId] ?? i.symbolId.toUpperCase();
  return `feed:${dev}:${(i.unit ?? 0) + 1}:${sw}:${pos}:${k}`;
}

/** そのエリアの、並列の機器の列にある開閉器（分かれる元にできるもの）を、列・段の順に */
function deviceSwitches(view: Answers): PlacedItem[] {
  const clean: Answers = {};
  for (const [k, v] of Object.entries(view)) if (!/^(tr|cap|gen|motor)From(__\d+)?$/.test(k)) clean[k] = v;
  return composeChain(withAutoValues(normalizeAnswers(clean)), [...TRANSFORMER, ...EXTRAS])
    .filter((i) => i.kind === 'parallel' && i.lane !== undefined && FEED_SOURCE_ROLE.test(i.role))
    .sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0) || (a.row ?? 0) - (b.row ?? 0));
}

/**
 * 別のエリアへ出す線（送り先）の、分岐元に選べる開閉器：送り出す側のエリア（sourceView）の、すべての機器の開閉器（第18弾 F-③）。
 * 値は「役割:何件目」（送り出す側のエリアの役割の名前のまま）。無ければ、空
 */
export function linkDeviceChoices(sourceView: Answers): { value: string; label: string }[] {
  return deviceSwitches(sourceView).map((i) => ({ value: `${i.role}:${i.unit ?? 0}`, label: feedLabelOf(i) }));
}

/**
 * 機器（p：tr・cap・gen・motor の、unit 件目＝0始まり）が、接続元として選べる開閉器（自分より前の列の開閉器だけ）。
 * view は、そのエリアの答え（件ごとの答えを含む）。value は「役割:何件目」、label は、画面が言葉に直す符号（feed:機器:何台目:開閉器:位置:何つ目）。
 * 選べるものが無ければ、空。
 */
export function feedChoices(view: Answers, p: string, unit: number): { value: string; label: string }[] {
  const devRole = FEED_DEVICE_ROLE[p];
  if (!devRole) return [];
  // 接続元の答えは、並べ替えに影響するので、いったん外して（どの機器も、母線から出るものとして）数える
  const clean: Answers = {};
  for (const [k, v] of Object.entries(view)) if (!/^(tr|cap|gen|motor)From(__\d+)?$/.test(k)) clean[k] = v;
  const items = composeChain(withAutoValues(normalizeAnswers(clean)), [...TRANSFORMER, ...EXTRAS]).filter((i) => i.kind === 'parallel' && i.lane !== undefined);
  const me = items.find((i) => i.role === devRole && (i.unit ?? 0) === unit);
  if (!me) return [];
  const out: { value: string; label: string; lane: number; row: number }[] = [];
  for (const i of items) {
    if (!FEED_SOURCE_ROLE.test(i.role) || (i.lane ?? 0) >= (me.lane ?? 0)) continue;
    const dev = i.role.startsWith('tr') ? 'tr' : i.role.startsWith('cap') ? 'cap' : i.role.startsWith('gen') ? 'gen' : 'motor';
    const m = /(up|dn)([123])$/.exec(i.role);
    const pos = m ? m[1]! : /^motor/.test(i.role) ? 'up' : 'own';
    const k = m ? m[2]! : '0';
    const sw = FEED_SWITCH_NAME[/^(?:tr|cap)-(pc)$/.test(i.role) ? 'pc' : i.symbolId] ?? i.symbolId.toUpperCase();
    const label = pos === 'up' && !m ? `feed:${dev}:${(i.unit ?? 0) + 1}:${sw}:mup:0` : `feed:${dev}:${(i.unit ?? 0) + 1}:${sw}:${pos}:${k}`;
    out.push({ value: `${i.role}:${i.unit ?? 0}`, label, lane: i.lane ?? 0, row: i.row ?? 0 });
  }
  return out.sort((a, b) => a.lane - b.lane || a.row - b.row).map(({ value, label }) => ({ value, label }));
}

/** 並列の機器の列が、どの質問（接続元）の答えで、母線以外から分かれるか（変圧器 trFrom・コンデンサ capFrom・発電機 genFrom・電動機 motorFrom） */
function feedKeyOf(role: string): string | undefined {
  if (role === 'transformer' || /^tr-/.test(role)) return 'trFrom';
  if (role === 'capacitor' || role === 'reactor' || /^cap-/.test(role)) return 'capFrom';
  if (role === 'generator') return 'genFrom';
  if (/^motor/.test(role)) return 'motorFrom';
  return undefined;
}

/**
 * 母線以外（ほかの機器の開閉器の二次側）から分かれる列を、分かれる元の列の、すぐ右に並べ直す（第18弾 F-②）。
 * ・分かれる元は、自分より前（左）の列の開閉器だけ。元が見つからない・自分より後ろの列のものは、母線から出るものとして扱う（feedFrom を消す）
 * ・同じ元の列の中で、低い位置の開閉器から分かれる列ほど、元の列の近くに置く（横に分かれる線が、ほかの列の縦の線と交わらない）
 * ・並べ直したあとの列の番号（lane）を付け直す。何も分かれていなければ、何も変えない
 */
function arrangeFeeds(out: PlacedItem[]): PlacedItem[] {
  const par = out.filter((i) => i.kind === 'parallel' && i.lane !== undefined);
  if (!par.some((i) => i.feedFrom)) return out;
  const byKey = new Map(par.map((i) => [`${i.role}:${i.unit ?? 0}`, i]));
  const laneOfKey = (k: string) => byKey.get(k)?.lane;
  const lanes = [...new Set(par.map((i) => i.lane!))].sort((a, b) => a - b);
  // 列ごとの、分かれる元（有効なもの）
  const feed = new Map<number, { key: string; fromLane: number; row: number }>();
  for (const lane of lanes) {
    const key = par.find((i) => i.lane === lane && i.feedFrom)?.feedFrom;
    if (!key) continue;
    const src = byKey.get(key);
    if (!src || src.lane === undefined || src.lane >= lane) continue;
    feed.set(lane, { key, fromLane: src.lane, row: src.row ?? 0 });
  }
  const children = new Map<number, number[]>();
  for (const [lane, f] of feed) children.set(f.fromLane, [...(children.get(f.fromLane) ?? []), lane]);
  for (const list of children.values()) list.sort((a, b) => feed.get(b)!.row - feed.get(a)!.row || a - b);
  const order: number[] = [];
  const visit = (lane: number) => {
    order.push(lane);
    for (const c of children.get(lane) ?? []) visit(c);
  };
  for (const lane of lanes) if (!feed.has(lane)) visit(lane);
  const newLane = new Map(order.map((l, i) => [l, i]));
  void laneOfKey;
  return out.map((i) => {
    if (i.kind !== 'parallel' || i.lane === undefined) return i;
    const { feedFrom: _drop, ...rest } = i;
    return { ...rest, lane: newLane.get(i.lane) ?? i.lane, ...(feed.has(i.lane) ? { feedFrom: feed.get(i.lane)!.key } : {}) };
  });
}

/** 機器の並びの定義（chain）から、回答に合う機器の一覧を作る */
function composeChain(rawAnswers: Answers, chain: Placement[]): PlacedItem[] {
  const answers = withDerived(rawAnswers);
  const out: PlacedItem[] = [];

  // 同じ件数で繰り返す機器が隣り合っているときは、件ごとにまとめて出す。
  // （コンデンサとそのリアクトルが SR1→SC1→SR2→SC2 の順に並ぶように）
  const runs: Placement[][] = [];
  for (const p of chain) {
    const prev = runs.at(-1);
    if (prev && p.repeatCountKey && prev[0]!.repeatCountKey === p.repeatCountKey) prev.push(p);
    else runs.push([p]);
  }

  // 高圧母線から並列にぶら下がるものは、1台ぶんで1列になる。
  // 変圧器→高圧進相設備の順に、列を左から詰めていく
  let parallelLane = 0;

  for (const run of runs) {
    const countKey = run[0]!.repeatCountKey;
    const count = countKey ? countOf(answers[countKey], run.some((p) => p.zeroOk) ? 0 : 1, maxCountOf(countKey)) : 1;
    const isParallel = run.some((p) => p.kind === 'parallel');
    const laneBase = parallelLane;
    if (isParallel) parallelLane += count;
    for (let i = 0; i < count; i++) {
      // 2件目以降は、そのぶんの回答で文字と入力値を組み立てる
      const a = countKey && i > 0 ? withDerived(viewAt(rawAnswers, i)) : answers;
      for (const p of run) {
        // 条件も件ごとに見る（4台あって1台だけリアクトル付き、のような現場があるため）
        if (!evaluate(p.when, a)) continue;
        const symbolId = p.symbolId.replace(/\{([\w.]+)\}/g, (_, k: string) => String(a[k] ?? ''));
        if (!symbolId) continue;
        out.push({
          id: count > 1 ? `${p.role}-${i + 1}` : p.role,
          role: p.role,
          symbolId,
          kind: p.kind,
          parent: p.parent,
          slot: p.slot,
          label: p.labelTemplate ? fillTemplate(p.labelTemplate, a) : [],
          props: Object.fromEntries(
            Object.entries(p.props ?? {}).map(([field, key]) => [field, a[key]]),
          ),
          gapAfter: p.gapAfter,
          dashedAfter: evaluate(p.dashedAfter, a) && p.dashedAfter !== undefined,
          connectFrom: p.connectFrom,
          labelSide: p.labelSide,
          attachTo: p.attachTo,
          lane: p.kind === 'feeder' ? (p.laneBase ?? 0) + i : p.kind === 'parallel' ? laneBase + i : undefined,
          ...(p.kind === 'parallel' && feedKeyOf(p.role) && isAnswered(a[feedKeyOf(p.role)!]) && a[feedKeyOf(p.role)!] !== 'bus' ? { feedFrom: String(a[feedKeyOf(p.role)!]) } : {}),
          row: p.row,
          unit: countKey ? i : undefined,
          ...(p.stage !== undefined ? { stage: p.stage } : {}),
          ...(p.tapFrom ? { tap: String(a[p.tapFrom] ?? p.tapDefault ?? 'ct-bus'), separate: true } : {}),
          ...(p.upright ? { upright: true } : {}),
          ...(p.hang ? { hang: true } : {}),
          ...(p.hangGap !== undefined ? { hangGap: p.hangGap } : {}),
          ...(p.posFrom ? { pos: String(a[p.posFrom] ?? '') } : {}),
          ...(p.refFrom ? { ref: String(a[p.refFrom] ?? '') } : {}),
          note: p.note,
        });
      }
    }
  }
  // 区分開閉器なし＋電力会社のケーブルのときは、VCTを主遮断装置より下には置けない（古い案件に、その位置が残っていても、「ケーブルの次」として描く）
  const vctTap = String(answers.vctTap ?? 'cable');
  const vctAt = evaluate(PROPERTY_AT_DS, answers) && (VCT_BELOW_BREAKER as readonly string[]).includes(vctTap) ? 'cable' : vctTap;
  return placeVct(placeByTap(arrangeInstruments(arrangeFeeds(out))), vctAt);
}


/* ------------------------------------------------------------------ */
/* VT・CT・継電器の並べ方                                                */
/* ------------------------------------------------------------------ */

const VT_ROLES: readonly string[] = ['ds-vt-pf', 'ds-vt', 'site-vt-pf', 'site-vt'];
const INSTRUMENT_ROLES: ReadonlySet<string> = new Set([...VT_ROLES, 'ct', 'relay-tt', 'relay', 'relay-note', 'trip-coil']);

/**
 * VT・CT・継電器を、主回路の上から順に並べ直し、つなぎ方を決める。
 *
 * 並び順（上から）：
 *   1 VT（主遮断装置の一次側）→ 2 CT（一次側）→ [主遮断装置] → 4 CT（二次側）→ 5 VT（二次側）→ 6 CT（VTのあと）
 *   継電器は、つながる先のCT・VTのすぐあと。置き場所が決まっていない継電器は、最後に置く。
 * つなぎ方：
 *   - CTにつく継電器：主回路から右へ。試験端子があれば、試験端子→継電器の順に線でつなぐ
 *   - VTにつく継電器：VTの右の端から、試験端子→継電器の順に、横へ続ける
 *   - つながる先（CT・VT）が無い継電器と、置き場所が決まっていない継電器は、OCR（なければOVGR）の真上に名前だけ書く
 *   - トリップコイルは、VCBとOCRの両方があるときだけ入れ、OCRとつなぐ
 */
function arrangeInstruments(items: PlacedItem[]): PlacedItem[] {
  // 主遮断装置のDGR用のZCTを、母線（主遮断装置の一次側・二次側）に付けるときは、その位置へ動かすため、CT・VTなどと一緒に並べ直す
  // （ZCTの横のDGRも、ZCTと一緒に動かす）
  const busZct = items.find((i) => i.role === 'main-zct' && (i.pos === 'bus-primary' || i.pos === 'bus-secondary'));
  const isInst = (i: PlacedItem) => INSTRUMENT_ROLES.has(i.role) || (busZct !== undefined && (i === busZct || i.role === 'main-ground-relay'));
  const firstInst = items.findIndex((i) => INSTRUMENT_ROLES.has(i.role));
  if (firstInst < 0 && !busZct) return items;
  const rest = items.filter((i) => !isInst(i));
  const inst = items.filter(isInst);
  // CT・VT・継電器のかたまりが入っていた位置（rest の中の何番目か）。CT・VTなどが無いときは、最後
  const blockAt = firstInst >= 0 ? items.slice(0, firstInst).filter((i) => !isInst(i)).length : rest.length;

  const unitOf = (i: PlacedItem) => i.unit ?? 0;
  const ctOf = new Map<number, PlacedItem>();
  const vtOf = new Map<number, PlacedItem>();
  for (const i of inst) {
    if (i.role === 'ct') ctOf.set(unitOf(i), i);
    else if (i.role === 'ds-vt' || i.role === 'site-vt') vtOf.set(unitOf(i), i);
  }
  const ctStage = (c: PlacedItem) => (c.pos === 'primary' ? 2 : c.pos === 'after-vt' ? 6 : 4);
  const vtStage = (v: PlacedItem) => (v.role === 'ds-vt' ? 1 : 5);

  /** 並べ替えの鍵：[段, 組, 組の中の順, 元の順] */
  const keyOf = new Map<PlacedItem, number[]>();
  const out: PlacedItem[] = [];
  const seq = new Map(inst.map((i, n) => [i, n]));
  const put = (i: PlacedItem, stage: number, set: number, sub: number) => {
    keyOf.set(i, [stage, set, sub, seq.get(i) ?? 0]);
    out.push(i);
  };

  for (const i of inst) {
    // 主遮断装置の一次側：VCB・LBSの手前（CT・VTのあと）。二次側：VCB・LBSのすぐ後ろ（CTの前）
    if (i === busZct || (busZct && i.role === 'main-ground-relay')) {
      put(i, busZct.pos === 'bus-primary' ? 3 : 4, busZct.pos === 'bus-primary' ? 99 : -1, i === busZct ? 0 : 1);
      continue;
    }
    if (i.role === 'ct') put(i, ctStage(i), unitOf(i), 0);
    else if (i.role === 'ds-vt-pf' || i.role === 'ds-vt' || i.role === 'site-vt-pf' || i.role === 'site-vt') {
      put(i, i.role.startsWith('ds') ? 1 : 5, unitOf(i), i.role.endsWith('-pf') ? 0 : 1);
    }
  }

  // 継電器（個ごとに、試験端子・本体・名前だけ、のどれがあるかを集める）
  const relays = new Map<number, { tt?: PlacedItem; relay?: PlacedItem; note?: PlacedItem }>();
  for (const i of inst) {
    if (i.role !== 'relay-tt' && i.role !== 'relay' && i.role !== 'relay-note') continue;
    const r = relays.get(unitOf(i)) ?? {};
    if (i.role === 'relay-tt') r.tt = i;
    else if (i.role === 'relay') r.relay = i;
    else r.note = i;
    relays.set(unitOf(i), r);
  }
  // VTにつく継電器の試験端子は、VTごとに1つ（そのVTにつく継電器のうち、最初に試験端子ありとされたもの）
  const vtTest = new Map<number, PlacedItem>();
  const vtFirst = new Map<number, number>();
  const vtTestPut = new Set<number>();
  for (const [u, r] of [...relays.entries()].sort((a, b) => a[0] - b[0])) {
    const m = /^vt-(\d+)$/.exec((r.relay ?? r.note)?.ref ?? '');
    if (!m || !r.relay || !vtOf.get(Number(m[1]) - 1)) continue;
    const ou = Number(m[1]) - 1;
    if (!vtFirst.has(ou)) vtFirst.set(ou, u);
    if (r.tt && !vtTest.has(ou)) vtTest.set(ou, r.tt);
  }
  const noted: PlacedItem[] = [];
  for (const [u, r] of [...relays.entries()].sort((a, b) => a[0] - b[0])) {
    const head = r.relay ?? r.note;
    if (!head) continue;
    const m = /^(ct|vt)-(\d+)$/.exec(head.ref ?? '');
    const ownerUnit = m ? Number(m[2]) - 1 : -1;
    const owner = m ? (m[1] === 'ct' ? ctOf.get(ownerUnit) : vtOf.get(ownerUnit)) : undefined;
    if (!m || !owner || !r.relay) {
      // 置き場所が決まっていない（または、つながる先のCT・VTが無い）継電器は、名前だけを書く
      const note = r.note ?? (r.relay ? { ...r.relay, role: 'relay-note', id: r.relay.id.replace(/^relay/, 'relay-note'), kind: 'note-above' as const, connectFrom: undefined, separate: undefined } : undefined);
      if (note) {
        noted.push(note);
        keyOf.set(note, [8, u, 0, seq.get(head) ?? 0]);
      }
      continue;
    }
    const stage = m[1] === 'ct' ? ctStage(owner) : vtStage(owner);
    if (m[1] === 'ct') {
      // CTにつく継電器：主回路から右へ。試験端子があれば、試験端子→継電器
      if (r.tt) {
        r.tt.separate = true;
        r.relay.connectFrom = [r.tt.id];
        r.relay.separate = false;
        put(r.tt, stage, ownerUnit, 2 + u * 2);
      } else {
        r.relay.separate = true;
      }
      put(r.relay, stage, ownerUnit, 3 + u * 2);
    } else {
      // VTにつく継電器：VT → 試験端子 → 継電器。試験端子は、VTごとに1つだけ（継電器ごとには付けない）。
      // 継電器が複数あるときは、試験端子（なければVT）の二次側から、並列につなぐ（上下に並ぶ）
      const shared = vtTest.get(ownerUnit);
      if (shared && !vtTestPut.has(ownerUnit)) {
        vtTestPut.add(ownerUnit);
        shared.connectFrom = [owner.id];
        shared.sourceLabel = 'below';
        shared.separate = false;
        put(shared, stage, ownerUnit, 2 + (vtFirst.get(ownerUnit) ?? u) * 2);
      }
      r.relay.connectFrom = [shared?.id ?? owner.id];
      r.relay.sourceLabel = 'below';
      r.relay.separate = false;
      put(r.relay, stage, ownerUnit, 3 + u * 2);
    }
  }

  // 名前だけの継電器を書く先：OCR（なければOVGR）。どちらも無ければ、図面の下に置く
  const ocr = out.find((i) => i.role === 'relay' && i.symbolId === 'relay-ocr');
  const target = ocr ?? rest.find((i) => i.role === 'ovgr');
  for (const n of noted) {
    out.push(target ? { ...n, attachTo: target.id } : { ...n, kind: 'free', attachTo: undefined });
  }

  // トリップコイル：主遮断装置（VCB・LBS）ごとに1つ。OCR・主遮断装置のDGR・GRのうち、付いているものを、すべて、このコイルにつなぐ
  const coil = inst.find((i) => i.role === 'trip-coil');
  const mainBreaker = rest.find((i) => i.role === 'main-breaker');
  const grounds = [...rest, ...inst].filter((i) => i.role === 'main-ground-relay').map((i) => i.id);
  const ocrTrips = ocr && (mainBreaker?.symbolId === 'vcb' || mainBreaker?.symbolId === 'lbs-pf' || mainBreaker?.symbolId === 'lbs') ? [ocr.id] : [];
  if (coil && mainBreaker && (mainBreaker.symbolId === 'vcb' || mainBreaker.symbolId === 'lbs-pf' || mainBreaker.symbolId === 'lbs') && (ocrTrips.length > 0 || grounds.length > 0)) {
    keyOf.set(coil, [9, 0, 0, 0]);
    out.push({ ...coil, connectFrom: [...ocrTrips, ...grounds] });
  }

  const cmp = (a: PlacedItem, b: PlacedItem) => {
    const ka = keyOf.get(a) ?? [9, 0, 0, 0];
    const kb = keyOf.get(b) ?? [9, 0, 0, 0];
    for (let n = 0; n < 4; n++) if (ka[n] !== kb[n]) return ka[n]! - kb[n]!;
    return 0;
  };
  // 名前だけの継電器を作り直したときの鍵（上の out.push は鍵を引き継ぐ）
  for (const o of out) if (!keyOf.has(o)) keyOf.set(o, keyOf.get(noted.find((n) => n.id === o.id)!) ?? [8, 0, 0, 0]);
  const sorted = out.sort(cmp);
  const primary = sorted.filter((i) => (keyOf.get(i)?.[0] ?? 9) <= 3);
  const after = sorted.filter((i) => (keyOf.get(i)?.[0] ?? 9) > 3);

  // 一次側のものは、主遮断装置の手前。主遮断装置が無いときは、そのままの位置に置く
  const main = rest.findIndex((i) => i.role === 'main-breaker');
  const result =
    main < 0 || main >= blockAt
      ? [...rest.slice(0, blockAt), ...primary, ...after, ...rest.slice(blockAt)]
      : [...rest.slice(0, main), ...primary, ...rest.slice(main, blockAt), ...after, ...rest.slice(blockAt)];
  return moveVtLeftWhenCrowded(result);
}

/**
 * 主回路から右へ出る継電器（OCR・試験端子・DGRなど）のすぐあとに、VTが続き、番号（組・個の番号）が同じだと、
 * 図面を作るとき、VTが継電器の右に横並びでつながって、重なる。 * そのときは、VT（と、VTにつく試験端子・UVR・OVR）を、主回路から見て左へ出す。OCRなどは、右のまま。
 */
function moveVtLeftWhenCrowded(list: PlacedItem[]): PlacedItem[] {
  const leftUnits = new Set<number>();
  let prev: PlacedItem | undefined;
  for (const i of list) {
    const isVt = i.role === 'site-vt-pf' || i.role === 'site-vt' || i.role === 'ds-vt-pf' || i.role === 'ds-vt';
    if (isVt) {
      const u = i.unit ?? 0;
      // VT（PFがあればPF）が、右へ出る機器のすぐあとに続くとき（横につながってしまうとき）だけ、左へ出す
      if (!leftUnits.has(u) && i.kind === 'branch-right' && !i.separate && (i.role.endsWith('-pf') || !list.some((o) => o.role === `${i.role}-pf` && (o.unit ?? 0) === u)) && prev?.kind === 'branch-right' && prev.unit === i.unit) {
        leftUnits.add(u);
      }
      if (leftUnits.has(u)) i.kind = 'branch-left';
    } else if (i.role === 'relay' || i.role === 'relay-tt') {
      const m = /^vt-(\d+)$/.exec(i.ref ?? '');
      if (m && leftUnits.has(Number(m[1]) - 1)) i.kind = 'branch-left';
    }
    prev = i;
  }
  return list;
}

/**
 * ZPD・LA・GCを、答えた位置に動かす。
 * - zct-source（ZCTの電源側）：ZCTの直前（GCだけ。ZCTが無いときは、ds-vcb と同じ）
 * - ds-source（DSの一次側）：DSの直前（LAだけ。第13弾 項目20）。DSが無いときは、動かさない
 * - ds-vcb（DSとVCBの間）：主遮断装置（VCB）の直前
 * - vcb-ct・lbs-ct（主遮断装置とCTの間）：主遮断装置の直後
 * - ct-bus（変圧器の手前）：いまの位置（CTや試験端子・OCRのあと、高圧母線の上）
 * 主遮断装置が無いときは、動かさない。
 */
function placeByTap(items: PlacedItem[]): PlacedItem[] {
  // GCの「ZCTの電源側」：ZCT（DGR・GR用）のすぐ上。ZCTが無いときは、DSとVCBの間（主遮断装置の直前）に寄せる（第13弾 項目21）
  if (items.some((i) => i.tap === 'zct-source')) {
    const z = items.findIndex((i) => i.role === 'main-zct');
    if (z >= 0) {
      const gcs = items.filter((i) => i.tap === 'zct-source');
      const rest0 = items.filter((i) => !gcs.includes(i));
      const at0 = rest0.findIndex((i) => i.role === 'main-zct');
      items = [...rest0.slice(0, at0), ...gcs, ...rest0.slice(at0)];
    } else {
      items = items.map((i) => (i.tap === 'zct-source' ? { ...i, tap: 'ds-vcb' } : i));
    }
  }
  const dsSide = items.filter((i) => i.tap === 'ds-source');
  if (dsSide.length > 0) {
    const ds = items.findIndex((i) => i.role === 'ds');
    if (ds >= 0) {
      const rest0 = items.filter((i) => !dsSide.includes(i));
      const at0 = rest0.findIndex((i) => i.role === 'ds');
      items = [...rest0.slice(0, at0), ...dsSide, ...rest0.slice(at0)];
    }
  }
  const tapped = items.filter((i) => i.tap && ['ds-vcb', 'vcb-ct', 'lbs-ct'].includes(i.tap));
  if (tapped.length === 0) return items;
  const main = items.findIndex((i) => i.role === 'main-breaker');
  if (main < 0) return items;
  const rest = items.filter((i) => !tapped.includes(i));
  const at = rest.findIndex((i) => i.role === 'main-breaker');
  const before = tapped.filter((i) => i.tap === 'ds-vcb');
  const after = tapped.filter((i) => i.tap !== 'ds-vcb');
  return [...rest.slice(0, at), ...before, rest[at]!, ...after, ...rest.slice(at + 1)];
}


/**
 * 入力画面に出す、注意の文（図面は、そのまま描く。直すかどうかは、人が決める）。
 * group：どの入力のまとまり（グループ）に出すか。view：そのエリアの答え（初期値を足したもの）
 *
 * - 接地コンデンサ（GC）があるのに、地絡継電器（GR・DGR）が無いとき：GCは、ZCTの電源側につなぐ機器なので、確認を促す
 * - CTが0組（または、CTが入らない構成）なのに、CTにつなぐ継電器（OCRなど）があるとき：
 *   継電器の箱は、つなぐ先が無いので、主回路につながらないまま、図面の下に置かれる。CTの組数を1以上にするか、継電器を0個にするよう知らせる
 */
/**
 * 高圧変圧器の合計容量（kVA）。受電設備エリアが2か所以上のときは、すべてのエリアの合計。
 * 電灯および動力のV結線は、電灯の容量と動力の容量の合計。三相の三巻線変圧器は、一次巻線の容量。
 * 2か所目以降で、容量がまだ入っていないものは、0として数える（合計は「少なくともこれだけ」になる）。
 * allKnown：すべてのエリアの容量が入っているか。1か所目が未入力のときの total は NaN。
 */
export function totalTransformerKva(raw: Answers): { total: number; allKnown: boolean } {
  const a = normalizeAnswers(raw);
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const areaKva = (v: Record<string, unknown>) => {
    const mixed = v.trConnection === 'tr-vv' && v.trUsage === '電灯・動力';
    const threeWinding = v.trConnection === 'tr-3w-yyd' || v.trConnection === 'tr-3w-ddy';
    const unit = mixed ? num(v.trCapacityLight) + num(v.trCapacityPower) : num(threeWinding ? v.trCapacityW1 : v.trCapacity);
    return unit * Math.max(1, num(v.transformerCount) || 1);
  };
  const parts = [areaKva(a)];
  for (let n = 1; n < areaCountOf(a); n++) parts.push(areaKva(normalizeAnswers(areaView(a, n))));
  const allKnown = parts.every((p) => Number.isFinite(p));
  const total = parts.reduce((sum, p, i) => sum + (Number.isFinite(p) ? p : i === 0 ? NaN : 0), 0);
  return { total, allKnown };
}

export interface InputNotice {
  group: string;
  text: string;
}
/** 交流の低圧は、600V以下（法令）。600Vを超えるものが高圧。電圧が分からない（NaN）ときは、低圧とは見なさない */
export const LOW_VOLTAGE_MAX = 600;
export const isLowVoltage = (volts: number): boolean => Number.isFinite(volts) && volts <= LOW_VOLTAGE_MAX;

/** t+1台目の変圧器の、二次側の電圧（V）。「6600/210-105V」なら210。読み取れなければ NaN */
function secondaryVolts(view: Answers, t: number): number {
  const text = String(viewAt(view, t).trVoltage ?? '');
  const after = text.split('/')[1] ?? '';
  const m = after.match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

export function inputNotices(view: Answers, all?: Answers): InputNotice[] {
  const out: InputNotice[] = [];
  const ctSets = countOf(view.ctSetCount, 0, maxCountOf('ctSetCount'));
  const hasCt = evaluate(CT_SHOWN, view) && ctSets > 0;
  const relays = countOf(view.relayCount, 0, maxCountOf('relayCount'));
  if (!hasCt && relays > 0) {
    let onCt = false;
    for (let i = 0; i < relays; i++) {
      if (/^ct-\d+$/.test(String(viewAt(view, i).relayAt ?? ''))) onCt = true;
    }
    if (onCt) {
      const text = 'CTが0組（または、CTが無い構成）ですが、CTにつなぐ継電器があります。CTの組数を1以上にするか、継電器の個数を0にしてください（このままだと、継電器は、主回路につながらないまま、図面の下に置かれます）。';
      out.push({ group: 'ctset', text }, { group: 'relay', text });
    }
  }
  // 接地コンデンサ（GC）があるのに、主遮断装置の地絡継電器（GR・DGR）が無いとき：GCは、ZCTの電源側につなぐ機器なので、確認を促す（第13弾 項目21）
  const dv = withDerived(view);
  // VCTの置き場所が、主遮断装置より下になっているのに、区分開閉器なし＋電力会社のケーブルのとき（古い案件）：その位置には置けないので、「ケーブルの次」として描いている
  if (evaluate({ key: 'vctLocation', eq: 'indoor' }, dv) && evaluate(PROPERTY_AT_DS, dv) && (VCT_BELOW_BREAKER as readonly string[]).includes(String(view.vctTap ?? ''))) {
    out.push({
      group: 'vct',
      text: 'VCTの置き場所が「主遮断装置（VCB・LBS）より下」になっていますが、区分開閉器が「なし」で、引込ケーブルが電力会社のものなので、その位置には置けません（財産分界点が、責任分界点より下流になるため）。「ケーブルの次」として描いています。置き場所を選び直してください。',
    });
  }
  if (dv.hasGc === 'yes' && (evaluate({ key: 'intakeVcb', eq: 'yes' }, dv) || evaluate({ key: 'intakeLbs', eq: 'yes' }, dv)) && !evaluate(MAIN_GROUND_ON, dv)) {
    out.push({
      group: 'receiving',
      text: '接地コンデンサ（GC）がありますが、主遮断装置の地絡継電器（GR・DGR）が「なし」です（DGRは、ZPDが「あり」のときだけ描きます）。GCは、ZCTの電源側につなぐ機器なので、地絡継電器とZCTの有無を確かめてください（図面は、このまま描きます）。',
    });
  }
  // 太陽光発電設備があるのに、ZPD・OVGR が無いとき（ZPDとOVGRはセットで必要。第13弾 項目55 修正9／B-9）。読み取りのときの確認と同じ内容を、手入力でも出す
  if (dv.hasPv === 'yes' && dv.hasZpd !== 'yes') {
    out.push({
      group: 'receiving',
      text: '太陽光発電設備がありますが、ZPD（零相電圧検出装置）が「なし」です（OVGRも描かれません）。太陽光発電設備があるときは、ZPDとOVGR（地絡過電圧継電器）が、セットで必要です。「ZPDはありますか？」と「OVGRはありますか？」を、確かめてください（図面は、このまま描きます）。',
    });
  } else if (dv.hasPv === 'yes' && dv.hasOvgr !== 'yes') {
    out.push({
      group: 'receiving',
      text: '太陽光発電設備がありますが、OVGR（地絡過電圧継電器）が「なし」です。太陽光発電設備があるときは、ZPDとOVGRが、セットで必要です。「OVGRはありますか？」を、確かめてください（図面は、このまま描きます）。',
    });
  }
  // 変圧器の二次側から送り出す（第13弾 項目55 修正19）：選んだ変圧器の二次側が低圧（600V以下）、または三巻線変圧器のときの注意
  if (all && dv.linkTap === 'tr-secondary' && Number(dv.areaNo) > 1) {
    const from = linkFromOf(dv, Number(dv.areaNo) - 1);
    const sender = areaView(all, from);
    const t = Math.max(0, Math.min(Math.max(1, countOf(sender.transformerCount, 1, maxCountOf('transformerCount'))), Math.round(Number(dv.linkSourceTr ?? 1)) || 1) - 1);
    const conn = String(viewAt(sender, t).trConnection ?? '');
    if (conn === 'tr-3w-yyd' || conn === 'tr-3w-ddy') {
      out.push({
        group: 'link',
        text: '選んだ変圧器は三巻線変圧器です。二次側の出口が決まっていない記号なので、「変圧器の二次側」からではなく、高圧母線から送り出す形で描きます（図面は、そのまま描きます）。',
      });
    } else if (isLowVoltage(secondaryVolts(sender, t))) {
      out.push({
        group: 'link',
        text: '選んだ変圧器の二次側は、低圧（600V以下）です。送り出し先は、高圧の設備です。二次側が高圧（600Vを超える）の変圧器から送り出していませんか（図面は、このまま描きます）。',
      });
    }
  }
  // 送り出しの途中の機器（VT・CT・ZPD・GC）：位置が、いまの構成（開閉器・線）に無いときは、描かない。知らせる（段階3-1）
  if (Number(dv.areaNo) > 1 && dv.linkTap === 'tr-secondary') {
    const n = countOf(view.linkPartCount, 0, LINK_PART_MAX);
    const bad: number[] = [];
    for (let i = 1; i <= n; i++) if (!evaluate(linkPartOpen(i), dv)) bad.push(i);
    if (bad.length > 0) {
      out.push({
        group: 'link',
        text: '途中に付ける機器のうち、付ける位置が、いまの構成にないものがあります（その段の開閉器が「なし」、または線が「電線」、または段が足りません）。位置を選び直してください（その機器は、図面に描きません）。',
      });
    }
  }
  // 送り出しの途中の継電器（段階3-2）：OCRはVCB・LBSと組み合わせる／2E・3EはVCB・LBS・VCSのとき／つなぐ先のCT・VTが無いとき
  if (Number(dv.areaNo) > 1 && dv.linkTap === 'tr-secondary') {
    const on = (code: string) => dv[linkRelayKey(code)] === 'yes';
    const n = linkStageCountOf(dv);
    const sw = Array.from({ length: n }, (_, i) => String(dv[linkSwitchKey(i + 1)] ?? 'none'));
    if (on('OCR') && Number(dv.linkGroundStage ?? 0) === 0) {
      out.push({ group: 'link', text: 'OCRは、VCB・LBSと組み合わせて使います。送り出しの開閉器に、VCB・LBSが無いので、トリップコイル（TC）は描きません。開閉器を確かめてください（図面は、このまま描きます）。' });
    }
    if ((on('2E') || on('3E')) && !sw.some((v) => /vcb|lbs|vcs/.test(v))) {
      out.push({ group: 'link', text: '2E・3Eは、VCB・LBS・VCSと組み合わせて使うことがあります。送り出しの開閉器に、どれも無いので、確かめてください（図面は、このまま描きます）。' });
    }
    const noTarget = LINK_RELAYS.some((r) => on(r.code) && Number(dv[r.on === 'ct' ? LINK_PART_CT_COUNT : LINK_PART_VT_COUNT] ?? 0) === 0);
    if (noTarget) {
      out.push({ group: 'link', text: 'つなぐ先の機器（CT・VT）が無い継電器があります。「途中に付ける機器」で、CT・VTを付けてください。付けないときは、継電器の名前だけを、縦の並びの下に書きます。' });
    }
  }
  // 低圧の電動機：図面に描くのは、高圧（600Vを超えるもの）だけ。定格電圧（無ければ、つなぎ先の変圧器の二次側の電圧）が低圧のとき、知らせる（第13弾 項目55 修正15）。
  // 発電機は、高圧も低圧も描くので、知らせない（第20弾・図面再現の診断から。220Vの発電機がある図面に合わせた）
  if (dv.hasMotor === 'yes') {
    const units = countOf(view.motorCount, 1, maxCountOf('motorCount'));
    let low = false;
    for (let i = 0; i < units; i++) {
      const u = withDerived(viewAt(view, i));
      const rated = Number(u.motorRatedVoltage);
      let volts = Number.isFinite(rated) && rated > 0 ? rated : NaN;
      if (!Number.isFinite(volts)) {
        // 定格電圧を入れていないとき：二次側につないでいれば、その変圧器の二次側の電圧で見る（母線につないでいれば、高圧）
        if (u.motorSource === 'secondary') volts = secondaryVolts(view, Math.max(1, Number(u.motorSourceTr ?? '1')) - 1);
      }
      if (isLowVoltage(volts)) low = true;
    }
    if (low) {
      out.push({
        group: 'motor',
        text: '低圧（600V以下）の電動機があります。この図面に描くのは、高圧（3300V・6600Vなど）の電動機だけです。低圧の電動機は、描かないでください（図面は、このまま描きます）。',
      });
    }
  }
  // 主遮断装置がPFS形（LBS）なのに、高圧変圧器の合計が300kVAを超えるとき（1か所目の「主遮断装置の形式」のところに出す）
  if (all && dv.mainBreakerForm === 'pfs' && !(Number(dv.areaNo) > 1)) {
    const { total } = totalTransformerKva(all);
    if (Number.isFinite(total) && total > 300) {
      out.push({
        group: 'receiving',
        text: '高圧変圧器の合計容量が300kVAを超えています（受電設備が2か所以上のときは、すべての合計です）。300kVAを超えるときは、主遮断装置はCB形（VCB）にします。「主遮断装置の形式は？」を、確かめてください（図面は、このまま描きます）。',
      });
    }
  }
  return out;
}

/**
 * VCT（電気設備内）を置く位置（vctTap）に合わせて、VCTを、主回路の並びの途中へ動かす（第13弾 項目18）。
 * 位置は、上（電源側）から見て、次のとおり。VCTは、同じ位置にあるVT・CTより、電源側（上）に置く。
 * - cable（初期値）：引込ケーブルの次（ケーブルとDS／LBSの間）。動かさない
 * - ds-vcb：DSの次（DSとVCBの間）。DSが無いときは、動かさない
 * - vcb-ct：VCBの次（VCBとCTの間）。VCBが無いときは、動かさない
 * - lbs-ct：LBSの次（LBSとCTの間）。LBSが無いときは、動かさない
 * - ct-bus：変圧器の手前（CT・VT・継電器のあと、高圧母線の上）
 * VCBに並列に付く励磁突入電流抑制開閉器や、責任分界点の印は、VCBについているので、その次に入れる。
 * VCTが2台のときは、2台とも、同じ位置にまとめて動かす（上下の並びは、そのまま）。
 * 区分開閉器なし＋電力会社のケーブルのときの分界線（boundary-ds）は、動かしたVCTの真下に移す。
 */
function placeVct(items: PlacedItem[], pos: string): PlacedItem[] {
  if (pos === 'cable') return items;
  const vcts = items.filter((i) => i.role === 'vct-indoor');
  if (vcts.length === 0) return items;
  const rest = items.filter((i) => i.role !== 'vct-indoor');
  let at = -1;
  if (pos === 'ds-vcb') at = rest.findIndex((i) => i.role === 'ds');
  else if (pos === 'vcb-ct' || pos === 'lbs-ct') {
    const m = rest.findIndex((i) => i.role === 'main-breaker' && (pos === 'vcb-ct' ? i.symbolId === 'vcb' : i.symbolId.startsWith('lbs')));
    if (m >= 0) {
      at = m;
      // VCBについている（並列・重ねて描く）ものは、その次に入れる
      while (rest[at + 1] && (rest[at + 1]!.attachTo === rest[m]!.role || rest[at + 1]!.attachTo === rest[m]!.id)) at++;
    }
  } else if (pos === 'ct-bus') {
    const bus = rest.findIndex((i) => ['parallel', 'feeder', 'free', 'sendout'].includes(i.kind));
    at = (bus < 0 ? rest.length : bus) - 1;
  }
  if (at < 0) return items;
  const moved = [...rest.slice(0, at + 1), ...vcts, ...rest.slice(at + 1)];
  // 区分開閉器なし＋電力会社のケーブルのときの「財産・責任分界点」の線（boundary-ds）は、VCT（電力会社の持ち物）の下にある。
  // VCTを初期位置以外へ動かしたら、線も、VCTの真下へ移す（そうしないと、電力会社の持ち物が、線の需要家側に入ってしまう）（第13弾 項目55 修正12／A-9）
  const bd = moved.findIndex((i) => i.role === 'boundary-ds');
  if (bd < 0) return moved;
  const line = moved[bd]!;
  const without = moved.filter((_, k) => k !== bd);
  const lastVct = without.reduce((m, i, k) => (i.role === 'vct-indoor' ? k : m), -1);
  return [...without.slice(0, lastVct + 1), line, ...without.slice(lastVct + 1)];
}

/**
 * 図面を複製して新しい案件を作るときの回答。
 * 「複製のとき空にする」印の付いた質問（事業場名称・電柱名称・図面名称・特記事項など）の答えを外し、設備の内容は、そのまま残す。
 * 2か所目以降（a2:〜）・2件目以降（__2）の答えも対象。外した質問は、既定値（電柱名称なら「中電柱：」）に戻る。
 */
export function clearForDuplicate(answers: Answers): Answers {
  const clear = new Set(QUESTIONS.filter((q) => q.clearOnDuplicate).map((q) => q.id));
  const out: Answers = {};
  // 白紙で始めた案件の複製は、すべての項目を開いた形にする（初期値を使わないのは、複製元と同じ図面にするため、そのまま）
  if (answers[START_MODE_KEY] === 'blank') answers = openStartMode(answers);
  for (const [key, value] of Object.entries(answers)) {
    const id = /^(?:a\d+:)?([A-Za-z0-9]+)(?:__\d+)?$/.exec(key)?.[1];
    if (id && clear.has(id)) continue;
    out[key] = value;
  }
  return out;
}
