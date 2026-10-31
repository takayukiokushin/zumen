import { checkKey, checkValue } from './voice.ts';

type JsonSchema = Record<string, unknown>;

/**
 * 解析結果のJSONスキーマ（AIに答えてもらう形）。
 *
 * AIの「決まった形で答える」機能には、複雑さの上限がある（省略できる項目は全体で24個まで、など）。
 * 質問は百数十あるので、質問ごとの欄を作ると上限を超えて、読み取りが必ず失敗する。
 * そこで、答えは「項目ID＋値」の組の並び（配列）で受け取る。省略できる項目は作らない。
 * 項目IDと値が、アプリの質問に合っているかは、受け取ったあと、parseAnalysisOutput が確かめる
 * （選べない値・一覧にない項目は、取り込まずに、理由を人に見せる）。
 */
export function buildAnalysisSchema(): JsonSchema {
  const pair = (keyName: string, valueName: string, keyDesc: string, valueDesc: string): JsonSchema => ({
    type: 'object',
    additionalProperties: false,
    required: [keyName, valueName],
    properties: {
      [keyName]: { type: 'string', description: keyDesc },
      [valueName]: { type: 'string', description: valueDesc },
    },
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answers', 'uncertain', 'evidence', 'notes', 'questions'],
    properties: {
      answers: {
        type: 'array',
        description: '読み取れた項目だけを入れる。読み取れないものは入れない（空の配列でもよい）',
        items: pair(
          'key',
          'value',
          '項目のID（例：transformerCount）。2か所目以降は「a2:」を、2件目以降は「__2」を付ける',
          '答え。数字も文字で書く（例：100）。選択式の項目は、指示文に書いてある値の文字そのまま',
        ),
      },
      uncertain: {
        type: 'array',
        description: '読み取ったが自信がない項目のID。ここに入れたものは人に確認してもらう',
        items: { type: 'string' },
      },
      evidence: {
        type: 'array',
        description: '項目ごとに、メモのどの記載から読み取ったかを短く書く',
        items: pair('key', 'text', '項目のID', 'メモ・図面・仕様書のどの記載から読み取ったか（短く）'),
      },
      notes: {
        type: 'array',
        description: 'メモに書かれていた特記事項・注意書き',
        items: { type: 'string' },
      },
      questions: {
        type: 'array',
        description: 'メモだけでは判断できず、作図前に人に聞きたいこと',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['questionId', 'ask', 'why'],
          properties: {
            questionId: { type: 'string', description: '対応する質問のID。該当が無ければ空文字' },
            ask: { type: 'string', description: '利用者に見せる質問文' },
            why: { type: 'string', description: 'なぜ判断できないのか' },
          },
        },
      },
    },
  };
}

export interface AnalysisResult {
  answers: Record<string, string | number | boolean>;
  uncertain: string[];
  evidence: Record<string, string>;
  notes: string[];
  questions: { questionId: string; ask: string; why: string }[];
}

/** AIが返した「項目ID＋値」の並びを、アプリの確認画面で使う形（AnalysisResult）に直す */
export function parseAnalysisOutput(raw: unknown): { result: AnalysisResult; rejected: { key: string; reason: string }[] } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rejected: { key: string; reason: string }[] = [];
  const pairs = (v: unknown, a: string, b: string): [string, string][] =>
    Array.isArray(v)
      ? v.flatMap((x): [string, string][] => {
          const r = (x ?? {}) as Record<string, unknown>;
          return typeof r[a] === 'string' && typeof r[b] === 'string' ? [[r[a] as string, r[b] as string]] : [];
        })
      : [];

  const answers: AnalysisResult['answers'] = {};
  for (const [key, value] of pairs(obj.answers, 'key', 'value')) {
    const k = checkKey(key);
    if (!k.q) {
      rejected.push({ key, reason: k.reason! });
      continue;
    }
    if (k.q.type === 'boolean') {
      const t = value.trim().toLowerCase();
      if (['true', 'yes', 'はい'].includes(t)) answers[key] = true;
      else if (['false', 'no', 'いいえ'].includes(t)) answers[key] = false;
      else rejected.push({ key, reason: `はい・いいえで答える項目です（「${value}」）` });
      continue;
    }
    const v = checkValue(k.q, value);
    if (v.value === undefined) rejected.push({ key, reason: v.reason! });
    else answers[key] = v.value;
  }
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const evidence: Record<string, string> = {};
  for (const [key, text] of pairs(obj.evidence, 'key', 'text')) if (key in answers) evidence[key] = text;
  const questions: AnalysisResult['questions'] = [];
  if (Array.isArray(obj.questions)) {
    for (const q of obj.questions) {
      const r = (q ?? {}) as Record<string, unknown>;
      if (typeof r.ask !== 'string' || r.ask.trim() === '') continue;
      questions.push({ questionId: typeof r.questionId === 'string' ? r.questionId : '', ask: r.ask, why: typeof r.why === 'string' ? r.why : '' });
    }
  }
  const notes = strings(obj.notes);
  if (rejected.length > 0) {
    notes.push(`AIが答えた次の項目は、アプリの質問に合わないため、取り込んでいません：${rejected.map((r) => `${r.key}（${r.reason}）`).join('、')}`);
  }
  return { result: { answers, uncertain: strings(obj.uncertain).filter((k) => k in answers), evidence, notes, questions }, rejected };
}
