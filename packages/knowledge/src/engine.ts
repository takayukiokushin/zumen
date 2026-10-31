import type { Answers, Value } from './condition.ts';
import { evaluate, fillTemplate, referencedKeys } from './condition.ts';
import { QUESTIONS, QUESTION_DEFAULTS, QUESTION_GROUPS } from './questions.ts';
import type { Question, QuestionGroup } from './questions.ts';
import { AREA_CHAIN, CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, FEEDERS, SENDOUT, TRANSFORMER, UPSTREAM } from './composition.ts';
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
export function normalizeAnswers(answers: Answers): Answers {
  let out = answers;
  if (out.sectionalizer === undefined && out.hasPas !== undefined) {
    out = { ...out, sectionalizer: out.hasPas === 'no' ? 'none' : 'pas' };
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
  out = { ...out, ...intakeFlags(out) };
  const cabinet = out.sourceType === 'cabinet';
  // 引込元が地上キャビネットのときは、PAS・PGS（電柱上）は無い。未回答（または古い回答）のときはUGSにする
  if (cabinet && (out.sectionalizer === undefined || out.sectionalizer === 'pas' || out.sectionalizer === 'pgs')) {
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
  for (const q of QUESTIONS) {
    if (!q.autoValue) continue;
    const group = QUESTION_GROUPS.find((g) => g.id === q.group);
    const units = group?.repeatCountKey && !q.shared ? Math.max(1, Math.floor(Number(answers[group.repeatCountKey] ?? 1)) || 1) : 1;
    for (let i = 0; i < units; i++) {
      const key = indexedKey(q.id, i);
      if (out[key] !== undefined) continue;
      const view = viewAt(out, i);
      const rule = q.autoValue.find((r) => evaluate(r.when, view));
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

/** 未回答の必須項目 */
export function missingRequired(rawAnswers: Answers, opts: AskOptions = {}): Question[] {
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  const answers = normalizeAnswers(rawAnswers);
  const out = visibleQuestions(answers, opts).filter((q) => q.required && empty(answers[q.id]));
  // 2か所目以降のエリアは、そのエリアの答えで見る（エリアごとの質問と、エリア自体の質問だけ）
  for (let n = 1; n < areaCountOf(rawAnswers); n++) {
    const view = normalizeAnswers(areaView(rawAnswers, n));
    for (const q of visibleQuestions(view, opts)) {
      const scoped = q.group === 'area' ? q.id !== 'areaCount' : PER_AREA_QUESTION_IDS.has(q.id);
      if (scoped && q.required && empty(view[q.id])) out.push({ ...q, label: `${n + 1}か所目：${q.label}` });
    }
  }
  return out;
}

/**
 * 設備容量から主遮断装置の形式を提案する。
 * 300kVA以下ならPFS形を採用可能、301kVA以上はCB形でなければならない。
 */
export function suggestMainBreakerForm(totalKva: number): 'pfs' | 'cb' | null {
  if (!Number.isFinite(totalKva) || totalKva <= 0) return null;
  return totalKva <= 300 ? 'pfs' : 'cb';
}

/**
 * 他の質問の表示条件や、構成の分岐・繰り返し件数が参照している質問。
 * これらは答えが変わると図面の中身が変わるため、画面で畳んではいけない。
 */
export const DRIVER_QUESTION_IDS: ReadonlySet<string> = (() => {
  const ids = new Set<string>();
  for (const q of QUESTIONS) for (const k of referencedKeys(q.showIf)) ids.add(k);
  for (const p of [...UPSTREAM, ...Object.values(CHAIN_BY_FORM).flat(), ...DOWNSTREAM, ...TRANSFORMER, ...EXTRAS, ...FEEDERS]) {
    for (const k of referencedKeys(p.when)) ids.add(k);
    if (p.repeatCountKey) ids.add(p.repeatCountKey);
  }
  for (const g of QUESTION_GROUPS) if (g.repeatCountKey) ids.add(g.repeatCountKey);
  return ids;
})();

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
  d.sourceLabel = /^(中電柱|キャビネット番号)\s*[：:]?$/.test(sourceText) ? '' : sourceText;

  // 区分開閉器（PAS／UGS／PGS／なし）。まだ答えていないときは、これまでどおりPAS（引込元がキャビネットならUGS）
  const sectionalizer = String(answers.sectionalizer ?? 'pas');
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

  // PASの定格（例: 7200V300A）。片方しか分からないときは分かる方だけ書く
  d.pasRatingText = [
    answers.pasRatedVoltage ? `${answers.pasRatedVoltage}V` : '',
    answers.pasRatedCurrent ? `${answers.pasRatedCurrent}A` : '',
  ].join('');

  // 送り出しのLBSのパワーヒューズ（例: PF 30A）。定格電流が分からないときは、書かない
  d.sendoutFuseText = answers.sendoutFuseCurrent ? `PF ${answers.sendoutFuseCurrent}A` : '';

  // 2か所目以降のPAS・ASの定格（例: 7200V300A）。片方しか分からないときは分かる方だけ書く
  const rating = (v: unknown, a: unknown) => `${v ? `${v}V` : ''}${a ? `${a}A` : ''}`;
  d.areaPasRatingText = rating(answers.areaPasRatedVoltage, answers.areaPasRatedCurrent);
  d.areaAsRatingText = rating(answers.areaAsRatedVoltage, answers.areaAsRatedCurrent);

  // 発電機の注記（例: 非常用 500kVA 軽油）。分かっているものだけ並べる
  d.generatorText = [
    GENERATOR_USAGE_LABEL[String(answers.generatorUsage)] ?? '',
    answers.generatorCapacity ? String(answers.generatorCapacity) : '',
    GENERATOR_FUEL_LABEL[String(answers.generatorFuel)] ?? (answers.generatorFuel ? String(answers.generatorFuel) : ''),
  ]
    .filter(Boolean)
    .join(' ');

  // PCSの注記（例: 100kW×15台、50kW×7台）。同じ容量はまとめて書く
  const groups = Math.max(1, Number(answers.pvGroupCount ?? 1));
  const pcs: string[] = [];
  for (let i = 0; i < groups; i++) {
    const kw = answers[indexedKey('pcsCapacity', i)];
    const n = answers[indexedKey('pcsCount', i)] ?? 1;
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
  const trCount = Math.max(1, Number(answers.transformerCount ?? 1));
  const perTransformer: string[][] = Array.from({ length: trCount }, () => []);
  for (let i = 0; i < groups; i++) {
    const kw = answers[indexedKey('pcsCapacity', i)];
    if (kw === undefined || kw === null || kw === '') continue;
    const total = Math.max(0, Number(answers[indexedKey('pcsCount', i)] ?? 1));
    const share: number[] = [];
    let assigned = 0;
    for (let t = 0; t < trCount; t++) {
      const n = Math.max(0, Number(answers[indexedKey(`pcsToTr${t + 1}`, i)] ?? 0) || 0);
      share[t] = n;
      assigned += n;
    }
    // どこにも入れていなければ、全部1台目へ。入れ残しがあれば1台目に足す
    if (assigned === 0) share[0] = total;
    else if (assigned < total) share[0] = (share[0] ?? 0) + (total - assigned);
    for (let t = 0; t < trCount; t++) {
      if ((share[t] ?? 0) > 0) perTransformer[t]!.push(`${kw}kW×${share[t]}台`);
    }
  }
  for (let t = 0; t < 8; t++) {
    d[`pcsAtTr${t + 1}`] = perTransformer[t]?.join('\n') ?? '';
    d[`pcsTrNo${t + 1}`] = String(t + 1);
  }
  /*
   * 変圧器の記号。結線方式がまだ入っていないときは、円の中が空のものを使う。
   * 決まっていないのに勝手にΔやYを描くと、間違った図面がそのまま使われてしまう。
   */
  d.trSymbol = answers.trConnection ? String(answers.trConnection) : 'tr-blank';

  /** PCSをどこかの変圧器につないだか（つないでいなければ太陽光は結線せずに置く） */
  d.pcsAssigned = answers.hasPv === 'yes' && perTransformer.some((v) => v.length > 0) ? 'yes' : 'no';

  // ケーブルの注記（3行目：定格電圧 断面積 長さ。長さ不明は「- m」）
  d.cableInstallationLabel = CABLE_INSTALLATION_LABEL[String(answers.cableInstallation)] ?? '';
  const third = [
    answers.cableVoltage ? `${answers.cableVoltage}V` : '',
    answers.cableCrossSection ? `${answers.cableCrossSection}mm2` : '',
    answers.cableLength === undefined || answers.cableLength === null || answers.cableLength === ''
      ? '- m'
      // 実測でないときは「約20m」と書く（現場で歩測しただけ、という場面が多い）
      : `${answers.cableLengthApprox === 'yes' ? '約' : ''}${answers.cableLength}m`,
  ].filter(Boolean);
  d.cableSpecLine = third.join(' ');

  // 2か所目以降のエリアの、前のエリアからのケーブルの注記（種類・構造・断面積・長さ）
  d.linkCableInstallationLabel = CABLE_INSTALLATION_LABEL[String(answers.linkCableInstallation)] ?? '';
  d.linkCableSpecLine = [
    answers.linkCableCrossSection ? `${answers.linkCableCrossSection}mm2` : '',
    answers.linkCableLength === undefined || answers.linkCableLength === null || answers.linkCableLength === ''
      ? ''
      : `${answers.linkCableLength}m`,
  ]
    .filter(Boolean)
    .join(' ');

  // CT・VTの台数。2台以上のときだけ「CT×2」「VT＋PF×2」のように書く
  const times = (v: unknown) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 2 ? `×${n}` : '';
  };
  d.ctHead = `CT${times(answers.ctCount)}`;
  d.vtPfHead = `VT＋PF${times(answers.vtCount)}`;
  // V結線は、VTが2台以上あるときだけ書く
  d.vtConnectionText = answers.vtConnection === 'v' && Math.floor(Number(answers.vtCount)) >= 2 ? 'V結線' : '';

  // 継電器の記号（OCR→relay-ocr）。種類がまだ無いときは、記号を決めない
  d.relaySymbol = answers.relayType ? `relay-${String(answers.relayType).toLowerCase()}` : '';

  // 補助変圧器（系統用蓄電所）。結線方式がまだ無いときは、円の中が空の記号を使う
  d.auxTrSymbol = answers.auxTrConnection ? String(answers.auxTrConnection) : 'tr-blank';
  d.auxTrUsageLine = answers.auxTrUsage ? `${answers.auxTrUsage}用 Tr` : '補助変圧器';
  const auxPhase = String(answers.auxTrConnection ?? '').startsWith('tr-1p') || answers.auxTrConnection === 'tr-vv' ? '1φ' : '3φ';
  d.auxTrCapacityLine = answers.auxTrCapacity ? `${auxPhase}${answers.auxTrCapacity}kVA` : '';

  // CTの変流比。数字（100）だけなら、2次側の「/5A」を足して「100/5A」にする。
  // 2次側は必ず5Aなので、「100/5A」「40A/5A」のように、すでに書いてあるものは、そのまま使う
  const ct = String(answers.ctRatio ?? '').trim();
  d.ctRatioText = /^\d+(\.\d+)?$/.test(ct) ? `${ct}/5A` : ct;

  // PC・LBSの定格の書き方
  //   PC  … 1行目「30A」／2行目「F:10A」
  //   LBS … 1行目「200A」／2行目「G50A T30A 40kA」（半角スペース区切り）
  const pfLine = (g: Value, kind: Value, amp: Value, ka: Value): string => {
    const parts: string[] = [];
    if (g) parts.push(`G${g}`);
    if (kind && amp) parts.push(`${kind}${amp}`);
    if (ka) parts.push(String(ka));
    return parts.join(' ');
  };
  for (const prefix of ['tr', 'cap'] as const) {
    // 定格を入れていないときは、せめて記号名を出す
    d[`${prefix}PcHead`] = answers[`${prefix}PcRating`] || 'PC';
    d[`${prefix}LbsHead`] = answers[`${prefix}LbsRating`] || 'LBS';
    d[`${prefix}PfLine`] = pfLine(
      answers[`${prefix}PfG`],
      answers[`${prefix}PfLoad`],
      answers[`${prefix}PfLoadAmp`],
      answers[`${prefix}PfKa`],
    );
  }

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
  const count = Math.max(1, Number(answers.areaCount ?? 1));
  const kinds = new Set<string>();
  for (let i = 0; i < count; i++) {
    const kind = FORM_KIND[String(answers[indexedKey('areaForm', i)])];
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
  const head = AREA_FORM_LABEL[String(answers.areaForm)] ?? '受電設備';
  // 高圧マンション（電柱上構成）の設置場所は、必ず電柱上
  const placement = answers.areaForm === 'apartment-pole' ? 'pole' : answers.areaPlacement;
  const inner = [
    answers.areaFloor,
    AREA_PLACEMENT_LABEL[String(placement)] ?? placement,
    answers.areaDetail,
  ]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .join('、');
  const body = inner ? `${head}（${inner}）` : head;
  // エリアの名前（2か所目以降）を、いちばん前に書く
  const name = Number(answers.areaNo) > 1 ? String(answers.areaName ?? '').trim() : '';
  return name ? `${name}　${body}` : body;
}

/**
 * 受電設備エリアの外枠（一点鎖線）を描くかどうか。
 * 2箇所以上あるときだけ囲う。1箇所しかない場合に全体を囲うと、かえって分かりにくい。
 */
export function shouldDrawAreaFrames(areaCount: number): boolean {
  return areaCount >= 2;
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
  /** kind==='link' のとき、前のエリアからのつなぎ方 */
  link?: {
    /** どのエリアから分岐するか（0始まり） */
    from: number;
    /** 分岐の位置：ds-source（DSの電源側）／ds-vcb（DSとVCBの間）／vcb-load（VCBの負荷側）／bus（高圧母線） */
    tap: string;
    /** ケーブルでつなぐか（false のときは、ケーブルの図記号を描かず、ふつうの線でつなぐ） */
    cable: boolean;
    /** ケーブルの線を点線（埋設）で描くか */
    dashed: boolean;
  };
  note?: string;
}

/**
 * 繰り返し入力するグループ（受電設備エリア・変圧器）の n 件目のキー。
 * 1件目は基本のキーのままにして、2件目以降だけ接尾辞を付ける。
 */
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
  if (index === 0) return { ...answers, unitNo: 1 };
  const out: Answers = { ...answers, unitNo: index + 1 };
  for (const id of PER_UNIT_QUESTION_IDS) {
    const v = answers[indexedKey(id, index)];
    if (v === undefined) delete out[id];
    else out[id] = v;
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
  return Math.max(1, Math.floor(Number(answers.areaCount ?? 1)) || 1);
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
    if (QUESTION_DEFAULTS[id] !== undefined) out[id] = QUESTION_DEFAULTS[id]!;
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
  return normalizeAnswers(out);
}

/** 質問ではないが、表示条件から参照してよい値（エリアの番号と、受電側の開閉器から決まる目印） */
export const VIEW_KEYS: ReadonlySet<string> = new Set([
  'areaNo',
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
export function buildComposition(givenAnswers: Answers): PlacedItem[] {
  // 状況に応じた初期値（継電器の個数など）を、画面と同じように足してから組み立てる。答えた値はそのまま優先される
  const rawAnswers = withAutoValues(normalizeAnswers(givenAnswers));
  const form = String(withDerived(rawAnswers).mainBreakerForm ?? 'pfs');
  const first = composeChain(rawAnswers, [
    ...UPSTREAM,
    ...(CHAIN_BY_FORM[form] ?? []),
    ...DOWNSTREAM,
    ...SENDOUT,
    ...TRANSFORMER,
    ...EXTRAS,
    ...FEEDERS,
  ]);
  const out = [...first];
  for (let n = 1; n < areaCountOf(rawAnswers); n++) {
    const view = areaView(rawAnswers, n);
    const prefix = `a${n + 1}:`;
    const items = composeChain(view, [...AREA_CHAIN, ...SENDOUT, ...TRANSFORMER, ...EXTRAS, ...FEEDERS]);
    const asPlaced = (r: string) => `${prefix}${r}`;
    for (const item of items) {
      out.push({
        ...item,
        id: asPlaced(item.id),
        role: asPlaced(item.role),
        parent: item.parent ? asPlaced(item.parent) : undefined,
        attachTo: item.attachTo ? asPlaced(item.attachTo) : undefined,
        connectFrom: item.connectFrom?.map(asPlaced),
        area: n,
        ...(item.kind === 'link'
          ? {
              // ケーブルでつなぐときも、ふつうの線でつなぐときも、つなぎ方（どこから・どこへ）は同じ。違いは、ケーブルの図記号を描くか
              label: view.linkCable === 'no' ? [] : item.label,
              link: {
                from: Math.max(0, Math.min(n - 1, (Number(view.linkFrom ?? 1) || 1) - 1)),
                tap: String(view.linkTap ?? 'bus'),
                cable: view.linkCable !== 'no',
                dashed: view.linkCable !== 'no' && view.linkCableInstallation === 'buried',
              },
            }
          : {}),
      });
    }
  }
  return out;
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
    const asked = countKey ? Math.floor(Number(answers[countKey] ?? 1)) : 1;
    const count = countKey ? Math.max(run.some((p) => p.zeroOk) ? 0 : 1, Number.isFinite(asked) ? asked : 1) : 1;
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
          row: p.row,
          unit: countKey ? i : undefined,
          ...(p.tapFrom ? { tap: String(a[p.tapFrom] ?? 'ct-bus'), separate: true } : {}),
          ...(p.upright ? { upright: true } : {}),
          ...(p.posFrom ? { pos: String(a[p.posFrom] ?? '') } : {}),
          ...(p.refFrom ? { ref: String(a[p.refFrom] ?? '') } : {}),
          note: p.note,
        });
      }
    }
  }
  return placeByTap(arrangeInstruments(out));
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
  const blockAt = items.findIndex((i) => INSTRUMENT_ROLES.has(i.role));
  if (blockAt < 0) return items;
  const rest = items.filter((i) => !INSTRUMENT_ROLES.has(i.role));
  const inst = items.filter((i) => INSTRUMENT_ROLES.has(i.role));

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

  // トリップコイル：VCBとOCRの両方があるときだけ
  const coil = inst.find((i) => i.role === 'trip-coil');
  if (coil && ocr && rest.some((i) => i.role === 'main-breaker' && i.symbolId === 'vcb')) {
    keyOf.set(coil, [9, 0, 0, 0]);
    out.push({ ...coil, connectFrom: [ocr.id] });
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
  if (main < 0 || main >= blockAt) return [...rest.slice(0, blockAt), ...primary, ...after, ...rest.slice(blockAt)];
  return [...rest.slice(0, main), ...primary, ...rest.slice(main, blockAt), ...after, ...rest.slice(blockAt)];
}

/**
 * ZPD・LAを、答えた位置に動かす。
 * - ds-vcb（DSとVCBの間）：主遮断装置（VCB）の直前
 * - vcb-ct・lbs-ct（主遮断装置とCTの間）：主遮断装置の直後
 * - ct-bus（変圧器の手前）：いまの位置（CTや試験端子・OCRのあと、高圧母線の上）
 * 主遮断装置が無いときは、動かさない。
 */
function placeByTap(items: PlacedItem[]): PlacedItem[] {
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

