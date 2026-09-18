import type { Answers, Value } from './condition.ts';
import { evaluate, fillTemplate, referencedKeys } from './condition.ts';
import { QUESTIONS, QUESTION_GROUPS } from './questions.ts';
import type { Question, QuestionGroup } from './questions.ts';
import { CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, TRANSFORMER, UPSTREAM } from './composition.ts';
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
  for (const p of [...UPSTREAM, ...Object.values(CHAIN_BY_FORM).flat(), ...DOWNSTREAM, ...TRANSFORMER, ...EXTRAS]) {
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

/** 回答そのものに加えて、図面の文字に使う導出値を足した集まりを作る */
export function withDerived(answers: Answers): Answers {
  const d: Answers = { ...answers };

  // PASの内蔵表記（例: VT,LA内蔵型）
  const builtin: string[] = [];
  if (answers.pasBuiltinVt === 'yes') builtin.push('VT');
  if (answers.pasBuiltinLa === 'yes') builtin.push('LA');
  d.pasBuiltinText = builtin.length ? `${builtin.join(',')}内蔵型` : '';

  // PASの定格（例: 7200V300A）。片方しか分からないときは分かる方だけ書く
  d.pasRatingText = [
    answers.pasRatedVoltage ? `${answers.pasRatedVoltage}V` : '',
    answers.pasRatedCurrent ? `${answers.pasRatedCurrent}A` : '',
  ].join('');

  // ケーブルの注記（3行目：定格電圧 断面積 長さ。長さ不明は「- m」）
  d.cableInstallationLabel = CABLE_INSTALLATION_LABEL[String(answers.cableInstallation)] ?? '';
  const third = [
    answers.cableVoltage ? `${answers.cableVoltage}V` : '',
    answers.cableCrossSection ? `${answers.cableCrossSection}mm2` : '',
    answers.cableLength === undefined || answers.cableLength === null || answers.cableLength === ''
      ? '- m'
      : `${answers.cableLength}m`,
  ].filter(Boolean);
  d.cableSpecLine = third.join(' ');

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
  ];

  const out: PlacedItem[] = [];
  for (const p of chain) {
    if (!evaluate(p.when, answers)) continue;
    const count = p.repeatCountKey ? Math.max(1, Number(answers[p.repeatCountKey] ?? 1)) : 1;
    for (let i = 0; i < count; i++) {
      // 2件目以降は、そのぶんの回答で文字と入力値を組み立てる
      const a = p.repeatCountKey && i > 0 ? withDerived(viewAt(rawAnswers, i)) : answers;
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
        note: p.note,
      });
    }
  }
  return out;
}
