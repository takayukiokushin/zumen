import type { Answers, Value } from './condition.ts';
import { evaluate, fillTemplate, referencedKeys } from './condition.ts';
import { QUESTIONS, QUESTION_GROUPS } from './questions.ts';
import type { Question, QuestionGroup } from './questions.ts';
import { CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, FEEDERS, TRANSFORMER, UPSTREAM } from './composition.ts';
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
export function visibleQuestions(answers: Answers, opts: AskOptions = {}): Question[] {
  const resolved = opts.resolvedByAi ?? new Set<string>();
  return QUESTIONS.filter((q) => {
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
export function missingRequired(answers: Answers, opts: AskOptions = {}): Question[] {
  return visibleQuestions(answers, opts).filter(
    (q) => q.required && (answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === ''),
  );
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
export function withDerived(answers: Answers): Answers {
  const d: Answers = { ...answers };

  // PASの内蔵表記（例: VT,LA内蔵型）。
  // VTはSOG（GR/DGR）があるときだけ入る。回答が残っていても、SOGが無ければ書かない
  const hasSog = answers.pasControl === 'gr' || answers.pasControl === 'dgr';
  const builtin: string[] = [];
  if (hasSog && answers.pasBuiltinVt === 'yes') builtin.push('VT');
  if (answers.pasBuiltinLa === 'yes') builtin.push('LA');
  d.pasBuiltinText = builtin.length ? `${builtin.join(',')}内蔵型` : '';

  // PASの定格（例: 7200V300A）。片方しか分からないときは分かる方だけ書く
  d.pasRatingText = [
    answers.pasRatedVoltage ? `${answers.pasRatedVoltage}V` : '',
    answers.pasRatedCurrent ? `${answers.pasRatedCurrent}A` : '',
  ].join('');

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
  if (answers.trConnection === 'tr-vv') {
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
};
const AREA_PLACEMENT_LABEL: Record<string, string> = {
  indoor: '屋内',
  rooftop: '屋上',
  outdoor: '地上',
  'semi-outdoor': '半屋外',
};

export function areaLabel(answers: Answers): string {
  const head = AREA_FORM_LABEL[String(answers.areaForm)] ?? '受電設備';
  const inner = [
    answers.areaFloor,
    AREA_PLACEMENT_LABEL[String(answers.areaPlacement)] ?? answers.areaPlacement,
    answers.areaDetail,
  ]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .join('、');
  return inner ? `${head}（${inner}）` : head;
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
  note?: string;
}

/**
 * 繰り返し入力するグループ（受電設備エリア・変圧器）の n 件目のキー。
 * 1件目は基本のキーのままにして、2件目以降だけ接尾辞を付ける。
 */
export function indexedKey(id: string, index: number): string {
  return index === 0 ? id : `${id}__${index + 1}`;
}

/** n 件目の回答として見た集まりを作る（2件目以降のキーで上書きする） */
export function viewAt(answers: Answers, index: number): Answers {
  if (index === 0) return answers;
  const suffix = `__${index + 1}`;
  const out: Answers = { ...answers };
  for (const [k, v] of Object.entries(answers)) {
    if (k.endsWith(suffix)) out[k.slice(0, -suffix.length)] = v;
  }
  return out;
}

/** 回答から、上流→下流の順に並んだ機器の一覧を作る */
export function buildComposition(rawAnswers: Answers): PlacedItem[] {
  const answers = withDerived(rawAnswers);
  const form = String(answers.mainBreakerForm ?? 'pfs');
  const chain: Placement[] = [
    ...UPSTREAM,
    ...(CHAIN_BY_FORM[form] ?? []),
    ...DOWNSTREAM,
    ...TRANSFORMER,
    ...EXTRAS,
    ...FEEDERS,
  ];

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
  // 変圧器→進相設備の順に、列を左から詰めていく
  let parallelLane = 0;

  for (const run of runs) {
    const countKey = run[0]!.repeatCountKey;
    const count = countKey ? Math.max(1, Number(answers[countKey] ?? 1)) : 1;
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
          lane: p.kind === 'feeder' ? i : p.kind === 'parallel' ? laneBase + i : undefined,
          row: p.row,
          unit: countKey ? i : undefined,
          note: p.note,
        });
      }
    }
  }
  return out;
}
