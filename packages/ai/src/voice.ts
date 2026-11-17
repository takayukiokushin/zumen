import { QUESTIONS, QUESTION_GROUPS, PER_AREA_QUESTION_IDS, PER_UNIT_QUESTION_IDS } from '@zumen/knowledge';
import type { Condition, Question } from '@zumen/knowledge';
import type { AnalysisResult } from './schema.ts';
import { DOMAIN_RULES } from './prompt.ts';

/**
 * 音声入力から図面を作るための、2つの道具。
 *
 *   1. buildVoiceInstruction … Claude のプロジェクトに入れる「指示文」を、質問の定義から組み立てる
 *   2. parseVoiceResult      … Claude が出した「決まった形の文章（JSON）」を、アプリが読み取る
 *
 * 流れ：技術者が Claude に声で設備を話す → Claude が、足りないところを1回だけ聞き返す →
 * 技術者が答える → Claude が、決まった形の文章（コードブロック）を自動で出す →
 * 技術者がアプリの「音声入力から作成」に貼り付ける → この関数が読み取って、確認画面に出す。
 * アプリは AI を呼ばない（APIキーも要らない）。読み取った結果は、必ず人が確認してから反映する。
 *
 * お客様名称・事業場名称などの manualOnly の項目は、指示文に載せず、貼り付けられても取り込まない
 * （アプリの中で、人が手で入力する）。
 *
 * 【読み取りは、ゆるく】音声入力の出力は、形が少しずれることがある（目印が無い・値の書き方が違う・全角など）。
 * 意味が読み取れるものは取り込み、「読み替えたこと」を知らせて、人が確認画面で確かめる。
 * 読み取れないものだけ、取り込まず、理由を出す。
 */

/** 決まった形の文章の、目印 */
export const VOICE_FORMAT = 'zumen-voice';

/** Claude に聞いてよい項目（アプリで手入力する項目は除く） */
const voiceQuestions = (): Question[] => QUESTIONS.filter((q) => !q.manualOnly && !q.noAi);

const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const GROUP_BY_ID = new Map(QUESTION_GROUPS.map((g) => [g.id, g]));

/* ------------------------------------------------------------------ */
/* 項目の一覧（短い形）                                                  */
/* ------------------------------------------------------------------ */

/**
 * 項目の一覧は、短く書く。Claude のプロジェクトの「指示」の欄は、長すぎると、
 * 途中までしか読まれず、出力の形などの大事な決まりが抜け落ちる。
 * （以前は、長い説明つきで 28万文字あり、それが原因で、決まった形で出てこなかった）
 * 長い説明（aiHint）は載せない。設備についての大事な決まりは、DOMAIN_RULES に書いてある。
 */

/** 条件を、短い式にする。アプリが決める目印（受電設備エリアの番号など）が入るものは、省く */
function compactCondition(c: Condition): string | undefined {
  if ('all' in c) {
    const parts = c.all.map(compactCondition).filter((x): x is string => x !== undefined);
    return parts.length ? parts.join(' かつ ') : undefined;
  }
  if ('any' in c) {
    const parts = c.any.map(compactCondition);
    // 1つでも「アプリが決める目印」が入っていたら、全体を省く（正確に書けないため）
    return parts.every((x) => x !== undefined) ? `(${parts.join(' または ')})` : undefined;
  }
  if ('not' in c) return undefined;
  if (!QUESTION_BY_ID.has(c.key)) return undefined;
  if ('eq' in c) return `${c.key}=${String(c.eq)}`;
  if ('ne' in c) return `${c.key}≠${String(c.ne)}`;
  if ('in' in c) return `${c.key}=${c.in.map(String).join('/')}`;
  if ('gt' in c) return `${c.key}>${c.gt}`;
  if ('lte' in c) return `${c.key}≦${c.lte}`;
  return `${c.key}に答えあり`;
}

/** 数字だけの選択肢（台数・組数など）なら、「数（0〜50）」のようにまとめる */
function numericRange(q: Question): string | undefined {
  const o = q.options;
  if (!o || o.length < 6 || !o.every((x) => /^\d+$/.test(x.value))) return undefined;
  const nums = o.map((x) => Number(x.value));
  return `${Math.min(...nums)}〜${Math.max(...nums)}`;
}

/** 値の書き方（短く） */
function valueForm(q: Question): string {
  if (q.type === 'number') return q.unit ? `数字のみ（${q.unit}）` : '数字';
  if (q.type === 'boolean') return 'yes/no';
  if (q.type === 'select' && q.options?.length) {
    const range = numericRange(q);
    if (range) return `数（${range}）`;
    if (q.options.length === 2 && q.options.some((o) => o.value === 'yes') && q.options.some((o) => o.value === 'no')) return 'yes/no';
    const opts = q.options.map((o) => (o.label === o.value ? o.value : `${o.value}=${o.label.replace(/\s+/g, '')}`)).join(' ／ ');
    return q.allowFreeInput ? `${opts} ／ ほかの値も可` : opts;
  }
  return q.unit ? `文字（${q.unit}）` : '文字';
}

/** 質問1件ぶんの説明（1行） */
function describeQuestion(q: Question): string {
  const cond = q.showIf ? compactCondition(q.showIf) : undefined;
  return `- ${q.id}：${q.label.replace(/[？?]$/, '')}｜${valueForm(q)}${cond ? `｜条件：${cond}` : ''}`;
}

/** 項目の一覧（指示文の最後。グループごと） */
function buildQuestionList(): string {
  return QUESTION_GROUPS.map((g) => {
    const qs = voiceQuestions().filter((q) => q.group === g.id);
    if (qs.length === 0) return '';
    const notes: string[] = [];
    if (g.repeatCountKey) {
      const unit = g.repeatUnit ?? '件';
      const sample = qs.find((q) => q.id !== g.repeatCountKey && !q.shared)?.id ?? g.repeatCountKey;
      notes.push(`${unit}ごとに繰り返す。件数は ${g.repeatCountKey}。2${unit}目以降は、項目IDの後ろに __2、__3 …（例：${sample}__2）`);
    }
    if (g.perArea) notes.push(`エリアが2か所以上のとき、2か所目以降は、項目IDの前に a2:（3か所目は a3:）（例：a2:${qs[0]!.id}）`);
    if (g.showIf) {
      const c = compactCondition(g.showIf);
      if (c) notes.push(`このまとまりを聞くのは ${c}`);
    }
    return `【${g.label}】${notes.length ? `\n（${notes.join('）\n（')}）` : ''}\n${qs.map(describeQuestion).join('\n')}`;
  })
    .filter(Boolean)
    .join('\n\n');
}

/** 文字列を短い印にする（FNV-1a）。暗号用途ではない */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 手入力にする項目の名前（指示文に書く） */
const manualLabels = (): string => QUESTIONS.filter((q) => q.manualOnly && !q.noAi).map((q) => q.label).join('・');

/** 出力の見本（指示文に載せる）。実際の項目ID・値だけで作る（検査で、アプリが読み取れることを確かめる） */
export const VOICE_EXAMPLE_ANSWERS: Record<string, string | number> = {
  sourceType: 'pole',
  sectionalizer: 'pas',
  mainBreakerForm: 'cb',
  transformerCount: '2',
  trCapacity: 300,
  trCapacity__2: 200,
};

const exampleJson = (version: string): string =>
  JSON.stringify(
    {
      format: VOICE_FORMAT,
      version,
      answers: VOICE_EXAMPLE_ANSWERS,
      uncertain: ['trCapacity__2'],
      evidence: { trCapacity__2: '「にひゃくキロ」と話された' },
      notes: [],
      questions: [],
    },
    null,
    2,
  );

/** 指示文の本文。版（version）の入る場所だけ、引数で差し替える（版は、この本文から決める） */
function instructionBody(version: string): string {
  return `# 役目

あなたは、高圧受電設備の「単線結線図」を作る、現場の技術者の補助です。
技術者は、現地で、**声（音声入力）**で、設備の内容を話します。
あなたは、聞き取った内容を、単線結線図作成アプリに入れるための**「決まった形の文章（JSON）」**にまとめて、**コードブロックで出します**。
アプリが読み取って、確認画面を出し、技術者が確認してから、図面が作られます。
あなたの役目は、**聞き取った内容を、正しく書き取ること**です。図面を作ること、正しいかどうかを決めることは、人がします。

# 会話の流れ（この順番を必ず守る）

技術者は、設備のことを、**つらつらと、続けて**話します。話の途中では、割り込みません。
音声入力なので、句読点が無かったり、専門用語が聞き間違えられたりします（下の「聞き間違いの直し方」）。意味から判断して、聞き取ってください。

1. 技術者が設備の内容を話したら、**その返事の中で**、次の2つをします。
   - 聞き取った内容を、やさしい文で**2〜5行**にして、読み返す（聞き間違いは、正しい用語に直して言う）。
   - 下の「必ず確認すること」のうち、**話されていないものがあれば**、番号をつけて、**まとめて1回だけ**聞く（最大6個、短い文で）。
     **1つも無ければ、聞かずに、すぐ手順3に進む。**
2. 技術者が答えたら、**もう聞き返さず**、手順3に進む。
   「分かりません」「そのままでいい」「出して」など、答えになっていない返事でも、聞き返さない。答えが無かった項目は、**空のまま**（answers に入れない）にする。
   答えのかわりに、設備の話の続きが来たときも、それも合わせて、手順3に進む。
3. アプリ用の文章（次の「出力の形」）を、**すぐ出す**。「ここまで」「以上です」などの合図は、待たない。
4. 技術者が「直したい」と言ったら、直して、もう一度、同じ形で出す（これは聞き返しではない）。

**聞き返しは、全体を通して、1回だけです。** 細かい項目（定格・ケーブルの太さや長さ・変圧器の結線方式や電圧など）は、聞かない。
話されなかったものは、空のままにして、「分かっていない項目の一覧」も伝えない（足りない項目は、技術者が、あとでアプリで入力します）。
**話されていないことを、推測で埋めない。** 聞き取ったが自信がないものは、答えに入れたうえで、uncertain に入れる。

# 出力の形（いちばん大事）

アプリ用の文章は、**チャットの本文に、ふつうの文字のコードブロック（\`\`\`json で始まるもの）を1つだけ**出します。
- **図・表・アーティファクト（別画面の文書）・ファイル・画像は、作らない。** 結線図を描くことも、しない。
- コードブロックの中は、**JSONだけ**。コードブロックの前後には、「アプリの『音声入力から作成』に貼り付けてください」と、一言だけ添える。
- **話された内容が少なくても、必ず、この形で出す**（answers が少なくてもよい）。
- **"format" と "version" は、下の見本のとおり、一字も変えずに書く。**

見本（書き方の見本です。中身は、話された内容に置き換える）：

\`\`\`json
${exampleJson(version)}
\`\`\`

- "answers" には、**聞き取れた項目だけ**を入れます。値の書き方：
  - 選ぶ項目は、「項目の一覧」にある「値」の文字そのまま（例：mainBreakerForm なら cb か pfs）。
  - 数字の項目は、数字だけ（単位は書かない。例：容量 300）。
  - 文字の項目は、話された文字。
- **「項目の一覧」にあるID・値だけ**を使う。ないIDや、選べない値は、アプリが受け付けません。
- "uncertain" に、自信がない項目のIDを入れる。**その項目だけ**、"evidence" に、話された言葉を短く書く。自信がある項目には、書かない。
- "notes" は、設備についての特記事項があるときだけ（なければ空の []）。
- "questions" は、**空の [] にする。** どうしても人に確認してほしい大事なことがあるときだけ、1〜3個（"questionId"・"ask"・"why" を書く）。
- 繰り返す項目（変圧器など）と、2か所目以降のエリア（a2: …）の書き方は、「項目の一覧」に書いてあります。

# 必ず確認すること（話されなかったときだけ、1回だけ聞く）

図面の構成が決まらなくなる項目だけです。**話されていれば、聞きません。**

1. **引込元**は、電柱か、地上キャビネットか（sourceType）
2. **区分開閉器**は、PAS・PGS・UGS・なしのどれか（sectionalizer）
3. **主遮断装置の形式**は、CB形（VCB）か、PFS形（LBS）か（mainBreakerForm）。
   変圧器の容量が分かっているときは、容量から推定して（合計300kVA以下ならPFS形、301kVA以上ならCB形）、「CB形で合っていますか」のように、確認する。推定したものは、uncertain に入れる。
4. **変圧器の台数**（transformerCount）
5. **受電設備エリアの数**（areaCount）。「1か所目」「別の電気室」など、2か所以上の手がかりがあるのに、数がはっきりしないときだけ聞く。手がかりが無ければ、1か所として、聞かない。
6. **聞き取りに自信が持てない、重要な数字**（変圧器の容量・台数）。

# 名称・番号など（聞かない・記録しない）

**${manualLabels()}**は、情報漏えいを防ぐため、アプリの中で、人が手で入力します。
- **聞かないでください。**
- もし話されても、**記録せず、出力（answers・notes・evidence）にも、読み返しにも入れず、何も言わずに、聞き流してください。**
- 電力会社の**電柱番号・キャビネット番号**（poleName・cabinetName）は、話してよい項目です。

# 聞き間違いの直し方

音声入力は、専門用語を聞き間違えます。話の流れから、正しい用語に直してください。直したものは、読み返しの中で、正しい用語で言います。
例：「区分解兵器」「くぶんかいへいき」→ 区分開閉器／「パス」→ PAS／「ピージーエス」→ PGS／「ユージーエス」→ UGS／
「ブイシービー」「シービー」→ VCB／「エルビーエス」→ LBS／「ピーエフエス」→ PFS／「ディーエス」→ DS／
「ブイティー」→ VT／「シーティー」→ CT／「ブイシーティー」→ VCT／「ジーアール」→ GR／「ディージーアール」→ DGR／
「ゼットピーディー」→ ZPD／「ゼットシーティー」→ ZCT／「オーシーアール」→ OCR／「ユーブイアール」→ UVR／「オーブイアール」→ OVR／
「ピーシーエス」→ PCS／「ケーブイエー」→ kVA／「ななせんにひゃく」→ 7200／「ろくせんろっぴゃく」→ 6600

# 設備について、気をつけること

（「メモ」「図」は、話された内容のことです。）

**注意：** 下の決まりのうち、「受電設備エリアが2か所以上のときは、1か所目のぶんだけ読み取る」は、手書きメモ用の決まりです。
音声入力では、2か所目以降のエリアも、聞き取って構いません（項目IDの前に a2: を付ける書き方で答えます）。
また、下の決まりに「questions で確認してください」「聞いてください」とある場合も、音声では、上の「必ず確認すること」に当てはまるものだけを聞き返します。
ほかは、質問せず、答えに入れずに（空のままで）構いません。

${DOMAIN_RULES}

# 項目の一覧（版：${version}）

項目の書き方：\`- 項目ID：名前｜値の書き方｜条件：その項目を答えるとき\`。「条件」が無い項目は、いつでも答えてよい項目です。

${buildQuestionList()}
`;
}

/**
 * 指示文の「版」。指示文のどこかが変わると、変わる（項目が増えたとき、決まりを直したとき）。
 * 古い指示文で作られた文章をアプリに貼り付けたとき、それに気づくために使う。
 */
export const VOICE_VERSION: string = `v${digest(instructionBody(''))}`;

/**
 * Claude のプロジェクトに入れる指示文（1つの文章）。
 * 質問・構成ルールはデータから組み立てるので、質問が増えたら、この指示文も自動で変わる
 * （変わったときは、アプリの「音声入力から作成」で、新しい指示文をコピーして、プロジェクトに入れ直す）。
 */
export function buildVoiceInstruction(): string {
  return instructionBody(VOICE_VERSION);
}

/* ------------------------------------------------------------------ */
/* 貼り付けられた文章を読み取る                                          */
/* ------------------------------------------------------------------ */

export interface VoiceRejected {
  /** 書かれていた項目ID */
  key: string;
  /** なぜ取り込まなかったか（人に見せる） */
  reason: string;
}

export interface VoiceParse {
  /** 読み取れたか。false のときは、result が無い（文章の形が違う） */
  ok: boolean;
  /** 読み取れた結果（使える項目だけ）。確認画面に出す */
  result?: AnalysisResult;
  /** 文章の形が違うなどで、まったく読み取れなかった理由 */
  error?: string;
  /** 取り込まなかった項目と理由 */
  rejected: VoiceRejected[];
  /** 注意（取り込んだが、確認してほしいこと） */
  warnings: string[];
}

/** 文章の中から、JSONとして読める「{ … }」を、すべて取り出す（コードブロックの中・外のどちらも） */
function jsonCandidates(text: string): string[] {
  const out: string[] = [];
  // コードブロック（```json … ```）
  for (const m of text.matchAll(/```[A-Za-z]*\s*([\s\S]*?)```/g)) out.push(m[1]!.trim());
  // コードブロックの外：{ から、対応する } まで（複数あれば、すべて）
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    out.push(text.slice(start, end + 1));
    i = end + 1;
  }
  return out;
}

/** JSONを読む。少し崩れていても、直せるものは直す（最後の , ・曲がった引用符） */
function parseLoose(s: string): Record<string, unknown> | undefined {
  const tries = [s, s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')];
  for (const t of tries) {
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // 次へ
    }
  }
  return undefined;
}

/** 貼り付けられた文章から、アプリ用のJSONを取り出す。いくつかあれば、アプリ用らしいもの（あとのものを優先）を選ぶ */
function extractJson(text: string): Record<string, unknown> | undefined {
  const objs = jsonCandidates(text)
    .map(parseLoose)
    .filter((x): x is Record<string, unknown> => x !== undefined);
  if (objs.length === 0) return undefined;
  const score = (o: Record<string, unknown>): number =>
    (o.format === VOICE_FORMAT ? 4 : 0) + (o.answers && typeof o.answers === 'object' ? 2 : 0) + (Object.keys(o).some((k) => QUESTION_BY_ID.has(splitKey(normalizeKey(k)).id)) ? 1 : 0);
  // 点数が高いもの。同点なら、あとのもの（会話の全部を貼ったとき、最新のもの）
  let best = objs[objs.length - 1]!;
  let bestScore = score(best);
  for (let i = objs.length - 2; i >= 0; i--) {
    const sc = score(objs[i]!);
    if (sc > bestScore) {
      best = objs[i]!;
      bestScore = sc;
    }
  }
  return best;
}

interface KeyParts {
  /** 何か所目のエリアか（2〜）。無ければ undefined */
  area?: number;
  id: string;
  /** 何件目か（2〜）。無ければ undefined */
  unit?: number;
}

/** 項目IDの書き方（a2:項目ID__2）を分ける */
export function splitKey(key: string): KeyParts {
  let rest = key;
  let area: number | undefined;
  const am = /^a(\d+):/.exec(rest);
  if (am) {
    area = Number(am[1]);
    rest = rest.slice(am[0].length);
  }
  let unit: number | undefined;
  const um = /^(.*)__(\d+)$/.exec(rest);
  if (um) {
    unit = Number(um[2]);
    rest = um[1]!;
  }
  return { area, id: rest, unit };
}

/** 項目IDの、書きぶれを直す（全角・前後の空白・「項目ID（名前）」のような名前つき） */
function normalizeKey(key: string): string {
  const k = key.normalize('NFKC').trim();
  const m = /^[A-Za-z0-9_:]+/.exec(k);
  return m ? m[0] : k;
}

/** 項目IDの書き方が、アプリの決まりに合っているか。合っていなければ理由を返す */
export function checkKey(key: string): { q?: Question; reason?: string } {
  const { area, id, unit } = splitKey(key);
  const q = QUESTION_BY_ID.get(id);
  if (!q) return { reason: 'アプリにない項目です（指示文が古い可能性があります）' };
  if (q.noAi) return { reason: 'AIには渡さない項目です（アプリの画面で入力してください）' };
  if (area !== undefined && (area < 2 || area > 20)) return { reason: 'エリアの番号（a2: など）が正しくありません' };
  if (area !== undefined && !PER_AREA_QUESTION_IDS.has(id)) return { reason: 'エリアごとに答える項目ではないので、a2: は付けられません' };
  if (unit !== undefined) {
    const group = GROUP_BY_ID.get(q.group);
    // 繰り返しの2件目以降（__2）。エリアそのものの質問（areaForm__2 など）も同じ書き方
    const repeatable = PER_UNIT_QUESTION_IDS.has(id) || (group?.repeatCountKey !== undefined && !q.shared && id !== group.repeatCountKey);
    if (unit < 2 || unit > 50 || !repeatable) return { reason: '繰り返す項目ではないので、__2 のような番号（2件目以降を表す印）は付けられません' };
  }
  return { q };
}

const YES_WORDS = ['yes', 'y', 'true', 'はい', 'あり', '有', '有り', '○', '〇'];
const NO_WORDS = ['no', 'n', 'false', 'いいえ', 'なし', '無', '無し', '×'];

/** 値が、項目の形に合っているか。合えば、アプリに入れる形に直して返す。読み替えたときは、reread に、何を何として読んだかを入れる */
export function checkValue(q: Question, v: unknown): { value?: string | number; reason?: string; reread?: { from: string; to: string } } {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { reason: '値が空です' };
  if (typeof v === 'boolean') v = v ? 'yes' : 'no';
  if (typeof v === 'object') return { reason: '値が文字や数字ではありません' };
  if (q.type === 'number') {
    if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { reason: `数字ではありません（「${String(v)}」）` };
    // 全角の数字・カンマ・単位つき（「300kVA」「7,200 V」）も、数字だけにして読む
    const s = String(v).normalize('NFKC').replace(/[,，]/g, '').trim();
    const plain = Number(s);
    if (s !== '' && Number.isFinite(plain)) return { value: plain };
    const m = /^(-?\d+(?:\.\d+)?)\s*([^\d\s.][^\d]{0,5})$/.exec(s);
    if (m) return { value: Number(m[1]), reread: { from: String(v), to: m[1]! } };
    return { reason: `数字ではありません（「${String(v)}」）` };
  }
  const raw = String(v).trim();
  const text = raw.normalize('NFKC').trim();
  if (q.type === 'select' && q.options?.length && !q.allowFreeInput) {
    const opts = q.options;
    if (opts.some((o) => o.value === raw)) return { value: raw };
    // 大文字・小文字・全角のちがい（PAS と pas）。意味が同じなので、知らせない
    const ci = opts.find((o) => o.value.toLowerCase() === text.toLowerCase());
    if (ci) return { value: ci.value };
    // 画面に出ている名前（「CB形（主遮断装置＝VCB）」など）で書かれたとき
    const byLabel = opts.filter((o) => o.label.normalize('NFKC').replace(/\s+/g, '') === text.replace(/\s+/g, ''));
    if (byLabel.length === 1) return { value: byLabel[0]!.value, reread: { from: raw, to: byLabel[0]!.value } };
    // あり・なし（yes/no の項目）
    if (opts.some((o) => o.value === 'yes') && opts.some((o) => o.value === 'no')) {
      const t = text.toLowerCase();
      if (YES_WORDS.includes(t)) return { value: 'yes' };
      if (NO_WORDS.includes(t)) return { value: 'no' };
    }
    // 名前の一部（「VCB」→「CB形（主遮断装置＝VCB）」）。1つに決まるときだけ
    if (text.length >= 2) {
      const part = opts.filter((o) => o.label.normalize('NFKC').toLowerCase().includes(text.toLowerCase()));
      if (part.length === 1) return { value: part[0]!.value, reread: { from: raw, to: part[0]!.value } };
    }
    return { reason: `選べない値「${text}」です（選べるのは：${opts.map((o) => `${o.value}＝${o.label}`).join('、')}）` };
  }
  if (q.type === 'boolean') {
    const t = text.toLowerCase();
    if (YES_WORDS.includes(t)) return { value: 'yes' };
    if (NO_WORDS.includes(t)) return { value: 'no' };
    return { reason: `はい・いいえで答える項目です（「${text}」）` };
  }
  return { value: text };
}

/** "answers" の中身を、「項目ID → 値」の形にそろえる。{key,value} の並びで書かれていても読む */
function answersOf(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (Array.isArray(v)) {
    const out: Record<string, unknown> = {};
    for (const x of v) {
      if (!x || typeof x !== 'object') continue;
      const r = x as Record<string, unknown>;
      const k = r.key ?? r.id ?? r.questionId;
      if (typeof k === 'string' && 'value' in r) out[k] = r.value;
    }
    return out;
  }
  return undefined;
}

/**
 * Claude が出した文章（貼り付けられたもの）を、アプリの確認画面に出せる形にする。
 *
 * 文章の形が違うときは ok:false。項目ごとの間違い（一覧にない項目・選べない値など）は、
 * その項目だけを取り込まず、理由つきで rejected に入れる（ほかの項目は取り込む）。
 * 目印（format）が無い・値の書き方がずれている、などは、意味が読み取れるかぎり取り込み、warnings で知らせる。
 * 手入力にする項目（お客様名称など）は、取り込まずに、警告を出す。
 */
export function parseVoiceResult(text: string): VoiceParse {
  const rejected: VoiceRejected[] = [];
  const warnings: string[] = [];
  const obj = extractJson(text);
  if (obj === undefined) {
    return {
      ok: false,
      error: 'Claudeの出力に、アプリ用のデータが含まれていません。Claudeに「アプリ用のコードブロックで出してください」と伝えてください。',
      rejected,
      warnings,
    };
  }

  // 答えの一覧：answers があればそれ。無いときは、最上位に、項目IDがそのまま並んでいる場合も読む
  let answersIn = answersOf(obj.answers);
  let noAnswersKey = false;
  if (!answersIn) {
    const top: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (QUESTION_BY_ID.has(splitKey(normalizeKey(k)).id)) top[k] = v;
    if (Object.keys(top).length === 0) {
      return {
        ok: false,
        error: 'Claudeの出力に、アプリ用のデータの形（"answers"）が見つかりませんでした。Claudeに「アプリ用のコードブロックを、指示文の見本の形で出してください」と伝えてください。',
        rejected,
        warnings,
      };
    }
    answersIn = top;
    noAnswersKey = true;
  }

  if (obj.format !== VOICE_FORMAT) {
    warnings.push(
      'この文章には、アプリ用の目印（"format"）がありませんが、答えの一覧が読み取れたので、取り込みました。' +
        'Claude のプロジェクトの指示文が、古い、または、途中までしか入っていない可能性があります。' +
        '確認画面で内容をよく確かめ、続くようなら、「Claude用の指示文をコピー」で、新しい指示文を、プロジェクトの「指示」の欄に入れ直してください。',
    );
  } else if (obj.version !== VOICE_VERSION) {
    warnings.push(
      `この文章は、古い（または別の）指示文で作られた可能性があります（文章の版：${String(obj.version ?? 'なし')}／いまの指示文の版：${VOICE_VERSION}）。` +
        'Claude のプロジェクトの「指示」の欄を、アプリの「Claude用の指示文をコピー」で取った、新しい文章に入れ替えてください。',
    );
  }
  if (noAnswersKey) warnings.push('"answers" の枠が無く、項目IDが直接並んでいたので、それを答えとして読みました。確認画面で、内容を確かめてください。');

  const answers: AnalysisResult['answers'] = {};
  const manualHit: string[] = [];
  for (const [rawKey, value] of Object.entries(answersIn)) {
    const key = normalizeKey(rawKey);
    const { id } = splitKey(key);
    const asked = QUESTION_BY_ID.get(id);
    if (asked?.manualOnly) {
      manualHit.push(asked.label);
      continue;
    }
    const k = checkKey(key);
    if (!k.q) {
      rejected.push({ key: rawKey, reason: k.reason! });
      continue;
    }
    const v = checkValue(k.q, value);
    if (v.value === undefined) {
      rejected.push({ key: rawKey, reason: v.reason! });
      continue;
    }
    if (v.reread) warnings.push(`項目「${k.q.label.replace(/[？?]$/, '')}」の「${v.reread.from}」を、「${v.reread.to}」として読み替えました。確認画面で、確かめてください。`);
    answers[key] = v.value;
  }
  if (manualHit.length > 0) {
    warnings.push(`${[...new Set(manualHit)].join('・')}は、情報漏えいを防ぐため、アプリでは取り込みません。アプリの「設備を入力して作成」で、手で入力してください。`);
  }

  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const evidenceIn = obj.evidence && typeof obj.evidence === 'object' && !Array.isArray(obj.evidence) ? (obj.evidence as Record<string, unknown>) : {};
  const evidence: Record<string, string> = {};
  for (const [k, v] of Object.entries(evidenceIn)) {
    const nk = normalizeKey(k);
    if (nk in answers && typeof v === 'string') evidence[nk] = v;
  }

  const questions: AnalysisResult['questions'] = [];
  if (Array.isArray(obj.questions)) {
    for (const q of obj.questions) {
      if (!q || typeof q !== 'object') continue;
      const r = q as Record<string, unknown>;
      if (typeof r.ask !== 'string' || r.ask.trim() === '') continue;
      questions.push({
        questionId: typeof r.questionId === 'string' ? r.questionId : '',
        ask: r.ask,
        why: typeof r.why === 'string' ? r.why : '',
      });
    }
  }

  const result: AnalysisResult = {
    answers,
    uncertain: strings(obj.uncertain).map(normalizeKey).filter((k) => k in answers),
    evidence,
    notes: strings(obj.notes),
    questions,
  };
  return { ok: true, result, rejected, warnings };
}
