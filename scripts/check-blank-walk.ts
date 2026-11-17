/**
 * 「白紙で始めた案件を、最後まで入力できるか」の検証（第14弾 整合チェック 7）。
 *
 * 白紙（startMode: 'blank'）の案件で、画面と同じやり方で、でたらめに答えていく：
 *   必須の項目（missingRequiredFields。入力画面が出す行と同じ並びから数える）を1つずつ答え、必須がなくなるまで続ける。
 * 次の「行き止まり」が起きないことを確かめる。
 *   ・選ぶ項目なのに、選べる選択肢が1つもない（答えられない）
 *   ・答え終わらない（いつまでも、必須が残る・増え続ける）
 *   ・**見た目は答え済みなのに、実際は未入力**（画面には選ばれた状態で出ているのに、アプリの中では空のまま。
 *     答えたつもりでも次の入力が開かず、先へ進めなくなる。蓄電池を「あり」にすると補助変圧器が「あり」に見えた不具合が、これ）
 *   ・必須として数えた項目が、入力画面に出る行の中にない
 *   ・**途中の状態でも、図面が作れる**（入力の途中＝答えた分だけ描く図面を、毎回、組み立てて・配置して・用紙に書き出す。
 *     落ちない、付ける先（親・付け先）が描かれていない部品が無い。第16弾 項目2・整合チェック）
 * 質問を足したり、出す条件を変えたときに、行き止まりを作っていないかを、パソコンの中で、数秒で確かめる。
 *
 * 乱数は決まった種から作るので、毎回同じ試行になる。回数は、環境変数 FUZZ_COUNT で増やせる（`pnpm fuzz` は 10倍）。
 *
 *   node --experimental-strip-types scripts/check-blank-walk.ts
 */
import {
  QUESTION_GROUPS,
  allInputRows,
  buildComposition,
  dropHiddenChoices,
  effectiveAnswers,
  evaluate,
  missingRequiredFields,
  rowsContext,
  viewAt,
} from '../packages/knowledge/src/index.ts';
import type { Answers, MissingField } from '../packages/knowledge/src/index.ts';
import { layout, renderSvg } from '../packages/layout/src/index.ts';

const SCALE = Math.max(1, Number(process.env.FUZZ_COUNT ?? 1));
const WALKS = 30 * SCALE;
const MAX_STEPS = 600;

let failed = 0;
const reported = new Set<string>();
const fail = (msg: string) => {
  if (reported.has(msg)) return;
  reported.add(msg);
  console.error(`  NG: ${msg}`);
  failed++;
};

/** 決まった種から作る乱数 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 画面で入れられる、でたらめな答え。入れられない（選択肢が無い）ときは undefined */
function randomAnswer(f: MissingField, rnd: () => number): string | number | undefined {
  const q = f.question;
  if (q.type === 'number') return 1 + Math.floor(rnd() * 300);
  if (q.type === 'boolean') return 'yes';
  if (q.type === 'select') {
    // 入力画面と同じに、そのエリア・その件の答えで、出る選択肢だけから選ぶ
    const opts = (q.options ?? []).filter((o) => evaluate(o.showIf, f.context));
    if (opts.length === 0) return q.allowFreeInput ? '1' : undefined;
    const values = opts.map((o) => o.value);
    // 台数のような数の選択肢は、小さい数から選ぶ（組み立てに時間がかかりすぎないように）
    if (values.every((v) => /^\d+$/.test(v))) {
      const small = values.filter((v) => Number(v) >= 1 && Number(v) <= 3);
      const pool = small.length > 0 ? small : values;
      return pool[Math.floor(rnd() * pool.length)];
    }
    return values[Math.floor(rnd() * values.length)];
  }
  return 'テスト';
}

console.log('■ 白紙で始めた案件を、最後まで入力できるか');
let steps = 0;
let finished = 0;
let drawn = 0;
let emptyDrawn = 0;
for (let n = 0; n < WALKS; n++) {
  const rnd = rng(n * 7919 + 17);
  let answers: Answers = { startMode: 'blank' };
  // 特殊設備の5つのあり／なしは、必須ではない（何も選ばない＝なし）。ときどき「あり」を先に押して、中身の必須も、行き止まり無く入力できることを確かめる
  for (const id of ['hasGenerator', 'hasPv', 'hasBattery', 'hasAuxTr', 'hasMotor']) if (rnd() < 0.4) answers = { ...answers, [id]: 'yes' };
  let done = false;
  for (let step = 0; step < MAX_STEPS; step++) {
    // 途中の状態でも、図面が作れる（答えた分だけ描く）
    try {
      const items = buildComposition(answers);
      renderSvg(layout(items, answers), { site: '', name: 'テスト' });
      const roles = new Set(items.map((i) => i.role));
      for (const it of items) {
        if (it.parent && !roles.has(it.parent)) fail(`付ける先が描かれていない部品があります：${it.role}（親 ${it.parent}）`);
        if (it.attachTo && !roles.has(it.attachTo)) fail(`付ける先が描かれていない部品があります：${it.role}（付け先 ${it.attachTo}）`);
      }
      drawn++;
      if (items.length === 0) emptyDrawn++;
    } catch (e) {
      fail(`途中の状態で、図面が作れません：${e instanceof Error ? e.message.slice(0, 80) : String(e)}（答え ${Object.keys(answers).length}個）`);
    }
    const missing = missingRequiredFields(answers);
    if (missing.length === 0) {
      done = true;
      break;
    }
    const eff = effectiveAnswers(answers);
    const ctx = rowsContext(eff);
    const rowKeys = new Set(allInputRows(ctx).map((r) => r.key));

    // 見た目は答え済みなのに、実際は未入力のもの（画面は、答えが入っている項目として出す）
    for (const f of missing) {
      const shown = (f.context as Answers)[f.question.id];
      if (shown !== undefined && shown !== '') {
        fail(`見た目は答え済みなのに未入力のまま：${f.question.id}（画面には「${String(shown)}」と出るのに、答えとして数えられていません）`);
      }
      if (!rowKeys.has(f.key)) fail(`必須として数えた項目が、入力画面に出る行の中にありません：${f.key}`);
    }

    // 入力画面の上から順（先頭）の必須を答える
    const f = missing[0]!;
    const value = randomAnswer(f, rnd);
    if (value === undefined) {
      fail(`答えられない必須項目（選べる選択肢が1つもない）：${f.question.id}（${f.label}）`);
      break;
    }
    answers = dropHiddenChoices({ ...answers, [f.key]: value });
    steps++;
  }
  if (!done) {
    fail(`最後まで入力できません（${MAX_STEPS}回答えても、必須が残る）。残り：${missingRequiredFields(answers).slice(0, 4).map((m) => m.key).join('、')}`);
    continue;
  }
  finished++;
  // 全部答えたあとの案件で、図面の構成が作れる・必須の判断と同じ結果（残り0件）である
  const items = buildComposition(answers);
  if (!Array.isArray(items) || items.length === 0) fail('最後まで入力した案件から、図面の構成が作れません');
  if (missingRequiredFields(answers).length !== 0) fail('最後まで入力したのに、必須が残っていると数えられます');
  // 同じ答えで、全部の項目を開く形（blank-open）にしても、必須の数え方は同じ
  if (missingRequiredFields({ ...answers, startMode: 'blank-open' }).length !== 0) fail('全部の項目を開く形にすると、必須が残っていると数えられます');
}
console.log(`  ${WALKS}通りのでたらめな入力のうち、${finished}通りが最後まで入力できた（平均 ${Math.round(steps / Math.max(1, finished))}回の入力）。グループ ${QUESTION_GROUPS.length}個`);
console.log(`  途中の状態 ${drawn}通り（うち、何も描かない状態 ${emptyDrawn}通り）で、図面を組み立てて、用紙に書き出せた`);
if (emptyDrawn === 0) fail('何も答えていない状態（空の図面）を、確かめていません');

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
