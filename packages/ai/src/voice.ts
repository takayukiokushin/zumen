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
 * 流れ：技術者が Claude に声で設備を話す → Claude が指示文のとおりに、決まった形の文章を出す →
 * 技術者がアプリの「音声入力から作成」に貼り付ける → この関数が読み取って、確認画面に出す。
 * アプリは AI を呼ばない（APIキーも要らない）。読み取った結果は、必ず人が確認してから反映する。
 *
 * お客様名称・事業場名称などの manualOnly の項目は、指示文に載せず、貼り付けられても取り込まない
 * （アプリの中で、人が手で入力する）。
 */

/** 決まった形の文章の、目印 */
export const VOICE_FORMAT = 'zumen-voice';

/** Claude に聞いてよい項目（アプリで手入力する項目は除く） */
const voiceQuestions = (): Question[] => QUESTIONS.filter((q) => !q.manualOnly);

const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const GROUP_BY_ID = new Map(QUESTION_GROUPS.map((g) => [g.id, g]));

/** 質問ではないが、条件の中に出てくる、アプリが決める目印の説明 */
const DERIVED_KEY_TEXT: Record<string, string> = {
  areaNo: '受電設備エリアの番号',
  unitNo: '何件目（何台目・何個目）か',
  intakeDs: '受電側にDSがある',
  intakeVcb: '受電側にVCBがある',
  intakeLbs: '受電側にLBSがある',
  intakeLbsPf: '受電側のLBSがヒューズ付（PF付）',
  intakeStandard: '受電側がDS＋VCBの標準構成',
  intakeOptional: '受電側がDS＋VCB以外（VT・CTがあるかを答えてもらう構成）',
};

const valueText = (key: string, v: unknown): string => {
  const q = QUESTION_BY_ID.get(key);
  const opt = q?.options?.find((o) => o.value === String(v));
  return opt ? `${opt.value}（${opt.label}）` : String(v);
};

const keyText = (key: string): string => {
  const q = QUESTION_BY_ID.get(key);
  return q ? `${key}（${q.label}）` : (DERIVED_KEY_TEXT[key] ?? key);
};

/** 表示の条件を、日本語の短い文にする（Claude が、どの質問が必要かを判断する手がかり） */
function describeCondition(c: Condition): string {
  if ('all' in c) return c.all.map(describeCondition).join('、かつ、');
  if ('any' in c) return `（${c.any.map(describeCondition).join('、または、')}）`;
  if ('not' in c) return `次ではないとき：${describeCondition(c.not)}`;
  if ('eq' in c) return DERIVED_KEY_TEXT[c.key] ? `${DERIVED_KEY_TEXT[c.key]}とき` : `${keyText(c.key)}が ${valueText(c.key, c.eq)} のとき`;
  if ('ne' in c) return DERIVED_KEY_TEXT[c.key] ? `${DERIVED_KEY_TEXT[c.key]}のではないとき` : `${keyText(c.key)}が ${valueText(c.key, c.ne)} 以外のとき`;
  if ('in' in c) return `${keyText(c.key)}が ${c.in.map((v) => valueText(c.key, v)).join(' か ')} のとき`;
  if ('gt' in c) return `${keyText(c.key)}が ${c.gt} より大きいとき`;
  if ('lte' in c) return `${keyText(c.key)}が ${c.lte} 以下のとき`;
  return `${keyText(c.key)}に答えがあるとき`;
}

/** 質問1件ぶんの説明（1行） */
function describeQuestion(q: Question): string {
  const parts: string[] = [`- ${q.id}：${q.label}`];
  if (q.type === 'select' && q.options?.length) {
    const opts = q.options.map((o) => `${o.value}＝${o.label}`).join(' ／ ');
    parts.push(`選ぶ値は ${opts}${q.allowFreeInput ? '（一覧にない値も書いてよい）' : '（この中から、値の文字そのままで答える）'}`);
  } else if (q.type === 'number') {
    parts.push(`数字${q.unit ? `（単位：${q.unit}。単位は書かず、数字だけ）` : ''}`);
  } else {
    parts.push(`文字${q.unit ? `（単位：${q.unit}）` : ''}`);
  }
  if (q.showIf) parts.push(`聞くのは、${describeCondition(q.showIf)}`);
  if (q.required) parts.push('必ず答えてもらう');
  else if (q.defaultValue !== undefined || q.autoValue) parts.push('最初から入っている値があるので、話されなければ聞かなくてよい');
  if (q.help) parts.push(`※${q.help}`);
  return parts.join('。');
}

/** 項目の一覧（指示文の後半。グループごと）。この中身が変わると、指示文の「版」が変わる */
function buildQuestionList(): string {
  return QUESTION_GROUPS.map((g) => {
    const qs = voiceQuestions().filter((q) => q.group === g.id);
    if (qs.length === 0) return '';
    const notes: string[] = [];
    if (g.repeatCountKey) {
      notes.push(
        `${g.repeatUnit ?? '件'}ごとに繰り返す。件数は ${g.repeatCountKey} に答える。2${g.repeatUnit ?? '件'}目以降は、項目IDの後ろに __2、__3 …を付けて答える（例：${qs.find((q) => q.id !== g.repeatCountKey && !q.shared)?.id ?? g.repeatCountKey}__2）`,
      );
    }
    if (g.perArea) {
      notes.push('受電設備エリアが2か所以上のときは、2か所目以降の答えは、項目IDの前に a2:（3か所目は a3:）を付ける（例：a2:' + qs[0]!.id + '）');
    }
    if (g.showIf) notes.push(`このまとまり全体を聞くのは、${describeCondition(g.showIf)}`);
    return `【${g.label}】${g.description ? `${g.description}` : ''}\n${notes.map((n) => `（${n}）`).join('\n')}${notes.length ? '\n' : ''}${qs.map(describeQuestion).join('\n')}`;
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

/**
 * 指示文の「版」。項目の一覧が変わると変わる。
 * 古い指示文で作られた文章をアプリに貼り付けたとき、それに気づくために使う。
 */
export const VOICE_VERSION: string = `v${digest(buildQuestionList())}`;

/** 手入力にする項目の名前（指示文に書く） */
const manualLabels = (): string => QUESTIONS.filter((q) => q.manualOnly).map((q) => q.label).join('・');

/**
 * Claude のプロジェクトに入れる指示文。
 * 質問・構成ルールはデータから組み立てるので、質問が増えたら、この指示文も自動で変わる
 * （変わったときは、アプリの「音声入力から作成」で、新しい指示文をコピーして、プロジェクトに入れ直す）。
 */
export function buildVoiceInstruction(opts: { listInline?: boolean } = {}): string {
  const listInline = opts.listInline ?? true;
  return `# このプロジェクトの目的

あなたは、高圧受電設備の「単線結線図」を作る、現場の技術者の補助をします。
技術者は、現地で、**声（音声入力）**で、設備の内容を話します。
あなたは、その内容を聞き取って、単線結線図作成アプリに入れるための**「決まった形の文章（JSON）」**にまとめます。

技術者は、あなたが出した文章を、アプリの「音声入力から作成」の画面に貼り付けます。
アプリが読み取って、確認画面を出し、技術者が確認してから、図面が作られます。
あなたの役目は、**聞き取った内容を、正しく書き取ること**です。図面を作ること、正しいかどうかを最終的に決めることは、人がします。

# 会話の進め方

声で話す相手なので、**短く、やさしい言葉**で話してください。技術者は、設備のことを、**つらつらと、続けて話します**。

1. 話の途中では、質問したり、割り込んだりしないでください。返事は、「はい、続けてください。」だけにします。
2. 「ここまで」「以上です」「お願いします」などと言われたら、話が終わった合図です。聞き取った内容を、**やさしい文で3〜6行にして、短く読み返します。**
3. そのあと、下の「必ず確認すること」のうち、**話されていなかったものだけ**を、**まとめて1回だけ**、聞き返します（最大4個。短い文で、番号をつけて）。
   確認することが1つも無ければ、聞き返さずに、すぐ、アプリ用の文章を出します。
4. 技術者が答えたら、**もう聞き返さず**、すぐ、アプリ用の文章を出します（次の「出力の形」）。直したいところがあると言われたら、直して、もう一度出します。
5. **細かい項目は、聞かないでください。** 定格（電圧・電流・ヒューズなど）、ケーブルの太さ・長さ、変圧器の結線方式・電圧、設置場所の細かい内容などは、話されなければ、答えに入れず、空のままにします。
   「次の項目が分かっていません」と、一覧で伝えることも、しないでください。足りない項目は、技術者が、あとでアプリで入力します。
6. **話されていないことを、推測で埋めないでください。** 聞き取ったが自信がないものは、答えに入れたうえで、uncertain に入れます。

# 必ず確認すること（話されなかったときだけ、聞き返す）

図面の構成が決まらなくなる項目だけです。**話されていれば、聞き返しません。**

1. **引込元**は、電柱か、地上キャビネットか（sourceType）
2. **区分開閉器**は、PAS・PGS・UGS・なしのどれか（sectionalizer）
3. **主遮断装置の形式**は、CB形（VCB）か、PFS形（LBS）か（mainBreakerForm）。
   変圧器の容量が分かっているときは、容量から推定して（合計300kVA以下ならPFS形、301kVA以上ならCB形）、「CB形で合っていますか」のように、確認します。推定したものは、uncertain に入れます。
4. **変圧器の台数**（transformerCount）
5. **受電設備エリアの数**（areaCount）。「1か所目」「別の電気室」など、2か所以上の手がかりがあるのに、数がはっきりしないときだけ聞きます。手がかりが無ければ、1か所として、聞きません。
6. **聞き取りに自信が持てない、重要な数字**（変圧器の容量・台数）。聞き返して、確かめます。

# 声に出さないでほしいもの（アプリで、手で入力します）

**${manualLabels()}**は、情報漏えいを防ぐため、アプリの中で、人が手で入力します。
- これらは、**聞かないでください。**
- もし話されても、**記録せず、出力にも入れないでください。** 読み返しにも、特記事項（notes）にも、書かないでください。何も言わず、**聞き流してください。**
- 電力会社の**電柱番号・キャビネット番号**（poleName・cabinetName）は、話してよい項目です。

# 聞き間違いの直し方

音声入力は、専門用語を聞き間違えます。話の流れから、正しい用語に直してください。直したものは、読み返しの中で、正しい用語で言います。
例：「ブイシーティー」→ VCT／「ブイシービー」→ VCB／「ディーエス」→ DS／「パス」→ PAS／「ジーアール」→ GR／「ディージーアール」→ DGR／「ゼットピーディー」→ ZPD／
「オーシーアール」→ OCR／「ユーブイアール」→ UVR／「オーブイアール」→ OVR／「ななせんにひゃく」→ 7200／「ろくせんろっぴゃく」→ 6600

# 出力の形

アプリ用の文章は、**次の形のJSONを、コードブロック（\`\`\`json で始まるもの）1つだけ**で出します。
コードブロックの中は、JSONだけにしてください。コードブロックの前後に、「アプリの『音声入力から作成』に貼り付けてください」と、一言だけ添えます。

\`\`\`json
{
  "format": "${VOICE_FORMAT}",
  "version": "${VOICE_VERSION}",
  "answers": { "項目ID": 値, "項目ID": 値 },
  "uncertain": ["自信がない項目のID"],
  "evidence": { "自信がない項目のID": "話された言葉（短く）" },
  "notes": ["特記事項があれば"],
  "questions": []
}
\`\`\`

- "format" と "version" は、**この指示文に書いてあるとおり、一字も変えずに**書きます。
- "answers" には、**聞き取れた項目だけ**を入れます。値の書き方：
  - 選ぶ項目は、一覧の「値」の文字そのまま（例：mainBreakerForm なら cb か pfs）。
  - 数字の項目は、数字だけ（単位は書かない。例：容量 300）。
  - 文字の項目は、話された文字。
- 一覧にない項目ID、選べない値は、アプリが受け付けません。**一覧のIDと値だけ**を使ってください。
- "uncertain" に入れた項目（自信がないもの）だけ、"evidence" に、**話された言葉**を短く書きます（人が確認しやすくするため）。自信がある項目には、書きません。
- "notes" は、設備についての特記事項があるときだけ書きます（なければ空の []）。お客様名称などには、触れません。
- "questions" は、**空の [] にします。** どうしても人に確認してほしい、大事なことがあるときだけ、1〜3個まで入れてよい（"questionId"・"ask"・"why" を書く）。
- 繰り返す項目（変圧器など）と、2か所目以降のエリアの書き方は、下の「項目の一覧」に書いてあります。

# 設備について、気をつけること

（「メモ」「図」は、話された内容のことです。）

**注意：** 下の決まりのうち、「受電設備エリアが2か所以上のときは、1か所目のぶんだけ読み取る」は、手書きメモ用の決まりです。
音声入力では、2か所目以降のエリアも、聞き取って構いません（項目IDの前に a2: を付ける書き方で答えます）。
また、下の決まりに「questions で確認してください」「聞いてください」とある場合も、音声では、上の「必ず確認すること」に当てはまるものだけを聞き返します。
ほかは、質問せず、答えに入れずに（空のままで）構いません。

${DOMAIN_RULES}

# 項目の一覧

${
  listInline
    ? buildQuestionList()
    : 'この指示文とは別に、プロジェクトの知識（添付ファイル）に、「項目の一覧」を入れてあります。**必ず、そのファイルの項目ID・値・書き方に従ってください。**'
}
`;
}

/** 「項目の一覧」だけを、別のファイルにするとき用（プロジェクトの知識に入れる） */
export function buildVoiceItemList(): string {
  return `# 項目の一覧（版：${VOICE_VERSION}）

単線結線図作成アプリの、項目の一覧です。アプリ用の文章（JSON）の "answers" には、ここにある項目IDと値だけを使います。
手で入力する項目（${manualLabels()}）は、載せていません。

${buildQuestionList()}
`;
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

/** 貼り付けられた文章から、JSONの部分を取り出す。コードブロック・前後の文章があってもよい */
function extractJson(text: string): unknown | undefined {
  const candidates: string[] = [];
  // コードブロック（複数あれば、あとのものを優先）
  for (const m of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) candidates.push(m[1]!.trim());
  candidates.reverse();
  // コードブロックが無いとき：最初の { から、対応する } まで
  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        candidates.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  for (const c of candidates) {
    try {
      const v: unknown = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // 次の候補へ
    }
  }
  return undefined;
}

interface KeyParts {
  /** 何か所目のエリアか（2〜）。無ければ undefined */
  area?: number;
  id: string;
  /** 何件目か（2〜）。無ければ undefined */
  unit?: number;
}

/** 項目IDの書き方（a2:項目ID__2）を分ける */
function splitKey(key: string): KeyParts {
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

/** 項目IDの書き方が、アプリの決まりに合っているか。合っていなければ理由を返す */
function checkKey(key: string): { q?: Question; reason?: string } {
  const { area, id, unit } = splitKey(key);
  const q = QUESTION_BY_ID.get(id);
  if (!q) return { reason: 'アプリにない項目です（指示文が古い可能性があります）' };
  if (area !== undefined && (area < 2 || area > 20)) return { reason: 'エリアの番号（a2: など）が正しくありません' };
  if (area !== undefined && !PER_AREA_QUESTION_IDS.has(id)) return { reason: 'エリアごとに答える項目ではないので、a2: は付けられません' };
  if (unit !== undefined) {
    const group = GROUP_BY_ID.get(q.group);
    // 繰り返しの2件目以降（__2）。エリアそのものの質問（areaForm__2 など）も同じ書き方
    const repeatable = PER_UNIT_QUESTION_IDS.has(id) || (group?.repeatCountKey !== undefined && !q.shared && id !== group.repeatCountKey);
    if (unit < 2 || unit > 50 || !repeatable) return { reason: '繰り返す項目ではないので、__2 のような件の番号は付けられません' };
  }
  return { q };
}

/** 値が、項目の形に合っているか。合えば、アプリに入れる形に直して返す */
function checkValue(q: Question, v: unknown): { value?: string | number; reason?: string } {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { reason: '値が空です' };
  if (typeof v === 'object') return { reason: '値が文字や数字ではありません' };
  if (q.type === 'number') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,，]/g, '').trim());
    if (!Number.isFinite(n)) return { reason: `数字ではありません（「${String(v)}」）` };
    return { value: n };
  }
  const text = String(v).trim();
  if (q.type === 'select' && q.options?.length && !q.allowFreeInput) {
    if (!q.options.some((o) => o.value === text)) {
      return { reason: `選べない値「${text}」です（選べるのは：${q.options.map((o) => `${o.value}＝${o.label}`).join('、')}）` };
    }
  }
  return { value: text };
}

/**
 * Claude が出した文章（貼り付けられたもの）を、アプリの確認画面に出せる形にする。
 *
 * 文章の形が違うときは ok:false。項目ごとの間違い（一覧にない項目・選べない値など）は、
 * その項目だけを取り込まず、理由つきで rejected に入れる（ほかの項目は取り込む）。
 * 手入力にする項目（お客様名称など）は、取り込まずに、警告を出す。
 */
export function parseVoiceResult(text: string): VoiceParse {
  const rejected: VoiceRejected[] = [];
  const warnings: string[] = [];
  const raw = extractJson(text);
  if (raw === undefined) {
    return { ok: false, error: '文章の中に、アプリ用のJSON（{ で始まる部分）が見つかりませんでした。Claude が出したコードブロックを、そのまま貼り付けてください。', rejected, warnings };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== VOICE_FORMAT) {
    return { ok: false, error: `この文章は、「音声入力から作成」用の形ではありません（"format": "${VOICE_FORMAT}" がありません）。Claude のプロジェクトの指示文が、正しく入っているか確認してください。`, rejected, warnings };
  }
  if (!obj.answers || typeof obj.answers !== 'object' || Array.isArray(obj.answers)) {
    return { ok: false, error: '文章の中に、"answers"（答えの一覧）がありません。', rejected, warnings };
  }
  if (obj.version !== VOICE_VERSION) {
    warnings.push(
      `この文章は、古い（または別の）指示文で作られた可能性があります（文章の版：${String(obj.version ?? 'なし')}／いまのアプリの版：${VOICE_VERSION}）。` +
        '読み取れない項目が出たときは、アプリの「Claude用の指示文をコピー」で、新しい指示文を、Claude のプロジェクトに入れ直してください。',
    );
  }

  const answers: AnalysisResult['answers'] = {};
  const manualHit: string[] = [];
  for (const [key, value] of Object.entries(obj.answers as Record<string, unknown>)) {
    const { id } = splitKey(key);
    const asked = QUESTION_BY_ID.get(id);
    if (asked?.manualOnly) {
      manualHit.push(asked.label);
      continue;
    }
    const k = checkKey(key);
    if (!k.q) {
      rejected.push({ key, reason: k.reason! });
      continue;
    }
    const v = checkValue(k.q, value);
    if (v.value === undefined) {
      rejected.push({ key, reason: v.reason! });
      continue;
    }
    answers[key] = v.value;
  }
  if (manualHit.length > 0) {
    warnings.push(`${[...new Set(manualHit)].join('・')}は、情報漏えいを防ぐため、アプリでは取り込みません。アプリの「設備を入力して作成」で、手で入力してください。`);
  }

  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const evidenceIn = obj.evidence && typeof obj.evidence === 'object' && !Array.isArray(obj.evidence) ? (obj.evidence as Record<string, unknown>) : {};
  const evidence: Record<string, string> = {};
  for (const [k, v] of Object.entries(evidenceIn)) if (k in answers && typeof v === 'string') evidence[k] = v;

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
    uncertain: strings(obj.uncertain).filter((k) => k in answers),
    evidence,
    notes: strings(obj.notes),
    questions,
  };
  return { ok: true, result, rejected, warnings };
}
