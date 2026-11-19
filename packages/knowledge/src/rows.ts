import type { Answers } from './condition.ts';
import { evaluate } from './condition.ts';
import { countOf, maxCountOf } from './counts.ts';
import { areaCountOf, areaKey, areaView, effectiveAnswers, feedChoices, indexedKey, linkFromOf, viewAt, visibleQuestions } from './engine.ts';
import type { AskOptions } from './engine.ts';
import { QUESTIONS, QUESTION_GROUPS } from './questions.ts';
import type { Question, QuestionGroup } from './questions.ts';

/**
 * 「設備を入力して作成」に出る入力欄（行）の並びを、決める部分。
 *
 * 入力画面（HearingForm）と、「必須の項目が残っているか」の判断（スケッチ読み取りの「答えてください」・
 * 音声やスケッチの確認画面・図面の画面の「いまの構成」）が、**同じ並びを使う**ためのもの（第14弾 整合チェック 3）。
 * 以前は、入力画面の中にだけ、「何件目・何か所目の、どの質問を出すか」を決める処理があり、
 * 必須の判断のほうは、1件目しか見ていなかった（変圧器が3台で、2台目以降が空でも、「残っていない」と出た）。
 *
 * 行のキー：1件目は質問のID、2件目以降は後ろに __2 など、2か所目以降のエリアのグループは前に a2: などが付く。
 */

/** 入力欄1つ（行） */
export interface InputRow {
  /** 答えを入れる先のキー */
  key: string;
  question: Question;
  /** 繰り返しの何件目か（0始まり）。選択肢を絞る条件を、その件の答えで見るのに使う */
  unit: number;
  /** どのエリアの答えか（0始まり。1か所目と、エリア全体で1つの質問は0） */
  area: number;
}

/** 行を決めるのに使う、エリアごとの答えなど。effective は、実際に効いている回答（effectiveAnswers） */
export interface RowsContext {
  effective: Answers;
  /** 受電設備エリアの数 */
  areas: number;
  /** エリアごとの答え（1か所目はそのまま） */
  views: Answers[];
  /** エリアごとの、いま聞く質問 */
  visibleByArea: Question[][];
  resolvedByAi: ReadonlySet<string>;
}

export function rowsContext(effective: Answers, resolvedByAi: ReadonlySet<string> = new Set()): RowsContext {
  const areas = areaCountOf(effective);
  const views = Array.from({ length: areas }, (_, n) => areaView(effective, n));
  const visibleByArea = views.map((v) => visibleQuestions(v, { resolvedByAi }));
  return { effective, areas, views, visibleByArea, resolvedByAi };
}

/** まだ答えていないか（空・未入力） */
export const isUnanswered = (v: unknown): boolean => v === undefined || v === null || v === '';

/** グループ1つぶんの行：件数の質問など（lead）と、1台目・2台目…のまとまり（blocks） */
export interface SectionRows {
  group: QuestionGroup;
  lead: InputRow[];
  blocks: { index: number; rows: InputRow[] }[];
  /** 繰り返しの件数（繰り返さないグループは 1） */
  count: number;
}

/**
 * グループ1つぶんの行を作る。area：どのエリアの答えか（0＝1か所目）。
 * leadOnly：件数の質問など、繰り返しの外の行だけ（エリアごとに分けて出すとき、受電設備エリアのグループに使う）。
 */
export function sectionRows(ctx: RowsContext, group: QuestionGroup, area: number, leadOnly = false): SectionRows | null {
  const view = ctx.views[area]!;
  const groupQuestions = ctx.visibleByArea[area]!.filter((q) => q.group === group.id);
  if (groupQuestions.length === 0) return null;
  const keyOf = (id: string, unit: number) => (group.perArea ? areaKey(indexedKey(id, unit), area) : indexedKey(id, unit));

  const countKey = group.repeatCountKey;
  // 件数の一覧に「0」がある項目（VT・CTの組数など）は、0件のとき、入力欄を1つも出さない
  const zeroOk = countKey ? (QUESTIONS.find((q) => q.id === countKey)?.options ?? []).some((o) => o.value === '0') : false;
  const count = countKey ? countOf(view[countKey], zeroOk ? 0 : 1, maxCountOf(countKey)) : 1;
  // 件数そのものと、件数に関わらず1回だけ聞く質問は、繰り返しの外に出す
  const leading = groupQuestions.filter((q) => q.id === countKey || q.shared);
  const repeated = leadOnly ? [] : groupQuestions.filter((q) => q.id !== countKey && !q.shared);

  // 質問は畳まず、対象になったものは全部出す。隠れている項目に気づかないまま入力漏れになるほうが困るため
  const lead: InputRow[] = leading.map((q) => ({ key: keyOf(q.id, 0), question: q, unit: 0, area }));

  const blocks: SectionRows['blocks'] = [];
  for (let i = 0; i < count && !leadOnly; i++) {
    // 表示条件も件ごとに見る（他の件の答えは引き継がない）。
    // 1台目の答えで出ている質問の中から選ぶと、「1台目はPCなし・2台目だけPCあり」のとき、2台目のPCの定格が出なくなるので、
    // 2台目以降は、その件の答えで、出す質問を決め直す
    const unitQuestions =
      i === 0
        ? repeated
        : visibleQuestions(viewAt(view, i), { resolvedByAi: ctx.resolvedByAi }).filter((q) => q.group === group.id && q.id !== countKey && !q.shared);
    const rows: InputRow[] = unitQuestions.flatMap((q): InputRow[] => {
      // 接続元（ほかの機器の開閉器の二次側から分かれるか）：選べる開閉器があるときだけ出し、選択肢は、入力の内容から作る（第18弾 F-②）
      const fm = /^(tr|cap|gen|motor)From$/.exec(q.id);
      if (fm) {
        const choices = feedChoices(view, fm[1]!, i);
        if (choices.length === 0) return [];
        return [{ key: keyOf(q.id, i), question: { ...q, options: [...(q.options ?? []), ...choices] }, unit: i, area }];
      }
      return [{ key: keyOf(q.id, i), question: q, unit: i, area }];
    });
    if (rows.length === 0) continue;
    blocks.push({ index: i, rows });
  }
  return { group, lead, blocks, count };
}

/** 受電設備エリアそのものの質問（形態・設置場所…）の行。n：何か所目か（0始まり）。「か所目」ごとの答え */
export function areaRows(ctx: RowsContext, n: number): InputRow[] {
  const areaGroup = QUESTION_GROUPS.find((g) => g.id === 'area')!;
  // （2か所目以降だけに出す質問があるので、2か所目以降は、1か所目で出ている質問からではなく、全部の質問から選ぶ）
  return (n === 0 ? ctx.visibleByArea[0]! : QUESTIONS)
    .filter((q) => q.group === 'area' && q.id !== areaGroup.repeatCountKey)
    .filter((q) => n === 0 || evaluate(q.showIf, viewAt(ctx.effective, n)))
    .map((q) => ({ key: indexedKey(q.id, n), question: q, unit: n, area: 0 }));
}

/** 「エリア間の接続」（送り先 to へ向かう線）の行。送り先ごとの答えだが、入力画面では、送り出す側のエリアの欄に出す */
export function linkRows(ctx: RowsContext, to: number): InputRow[] {
  const linkGroup = QUESTION_GROUPS.find((g) => g.id === 'link')!;
  return (sectionRows(ctx, linkGroup, to)?.blocks.flatMap((b) => b.rows) ?? []).filter((r) => r.question.id !== 'linkFrom');
}

/** 入力画面に出る、すべての行（エリアが2か所以上のときは、エリアごとのブロックの中の行も含む） */
export function allInputRows(ctx: RowsContext): InputRow[] {
  const splitByArea = ctx.areas >= 2;
  const out: InputRow[] = [];
  const push = (sec: SectionRows | null) => {
    if (sec) out.push(...sec.lead, ...sec.blocks.flatMap((b) => b.rows));
  };
  // 通常のグループ。エリアが2か所以上のときは、エリアごとのグループは、下のエリアごとのブロックで出す
  for (const g of QUESTION_GROUPS.filter((x) => !(splitByArea && x.perArea))) push(sectionRows(ctx, g, 0, splitByArea && g.id === 'area'));
  if (splitByArea) {
    for (let n = 0; n < ctx.areas; n++) {
      out.push(...areaRows(ctx, n));
      for (const g of QUESTION_GROUPS.filter((x) => x.perArea && x.id !== 'link')) push(sectionRows(ctx, g, n));
    }
    // 送り先ごとの行。どの送り先も、送り出す側のエリアのどれか1つに属する（linkFromOf は、必ず、送り先より前のエリアを指す）
    for (let to = 1; to < ctx.areas; to++) out.push(...linkRows(ctx, to));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 未回答の必須項目                                                     */
/* ------------------------------------------------------------------ */

/** 未回答の必須項目を、入力欄を出せる形で返す（スケッチ読み取りの画面で、その場で答えてもらうため） */
export interface MissingField {
  /** 答えを入れる先のキー（2か所目以降は a2:〜、2件目以降は __2 の書き方） */
  key: string;
  question: Question;
  /** 画面に出す名前（2か所目以降は「2か所目：」、2件目以降は「2台目：」が付く） */
  label: string;
  /** 2か所目以降のエリアの項目のとき、何か所目か（2〜）。画面で、選んでいる言葉に合わせた「2か所目：」を付けるのに使う */
  areaNo?: number;
  /** 繰り返しの2件目以降の項目のとき、何件目か（2〜）と、その数え方（台・組・個…）。「2台目：」を付けるのに使う */
  unitNo?: number;
  unitName?: string;
  /** その項目の選択肢を絞る条件を見るための、その件・そのエリアの答え */
  context: Answers;
}

/**
 * 未回答の必須項目の一覧。入力画面と同じ行の並びから数える（2台目以降・2か所目以降も含む）。
 * 白紙で始めた案件は、初期値を足さない（実際に効いている回答 effectiveAnswers で見る）。
 */
export function missingRequiredFields(rawAnswers: Answers, opts: AskOptions = {}): MissingField[] {
  const effective = effectiveAnswers(rawAnswers);
  const ctx = rowsContext(effective, opts.resolvedByAi ?? new Set());
  const out: MissingField[] = [];
  for (const r of allInputRows(ctx)) {
    if (!r.question.required || !isUnanswered(effective[r.key])) continue;
    const group = QUESTION_GROUPS.find((g) => g.id === r.question.group);
    const repeating = group?.repeatCountKey !== undefined;
    // 2か所目以降のエリアの項目：エリアごとのグループは area、エリア自体の質問（形態・設置場所…）は unit が「何か所目か」
    const areaNo = r.question.group === 'area' ? (r.unit >= 1 ? r.unit + 1 : undefined) : r.area >= 1 ? r.area + 1 : undefined;
    const unitNo = r.question.group !== 'area' && repeating && r.unit >= 1 ? r.unit + 1 : undefined;
    const unitName = group?.repeatUnit ?? '件';
    const prefix = `${areaNo ? `${areaNo}か所目：` : ''}${unitNo ? `${unitNo}${unitName}目：` : ''}`;
    out.push({
      key: r.key,
      question: r.question,
      label: `${prefix}${r.question.label}`,
      ...(areaNo ? { areaNo } : {}),
      ...(unitNo ? { unitNo, unitName } : {}),
      context: viewAt(ctx.views[r.area]!, r.unit),
    });
  }
  return out;
}

/** 未回答の必須項目（名前つきの質問の形）。2か所目以降・2件目以降は、名前の前に「2か所目：」「2台目：」が付く */
export function missingRequired(rawAnswers: Answers, opts: AskOptions = {}): Question[] {
  return missingRequiredFields(rawAnswers, opts).map((f) => ({ ...f.question, label: f.label }));
}
