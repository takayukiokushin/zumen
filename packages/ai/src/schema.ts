import { QUESTIONS } from '@zumen/knowledge';
import type { Question } from '@zumen/knowledge';

/**
 * 手書きメモの読み取り結果を受け取るためのJSONスキーマを、質問定義から組み立てる。
 *
 * 質問を足せばスキーマも自動で増えるので、AI側の受け口を別途書き足す必要がない。
 * 選択式の質問は選択肢に限定するので、AIが勝手な値を返すことがない。
 */

type JsonSchema = Record<string, unknown>;

function fieldSchema(q: Question): JsonSchema {
  const base: JsonSchema = { description: q.help ? `${q.label}（${q.help}）` : q.label };
  switch (q.type) {
    case 'number':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'select': {
      const values = (q.options ?? []).map((o) => o.value);
      // 一覧にない値の手入力を許す質問は、文字列も受け付ける
      return q.allowFreeInput
        ? { ...base, type: 'string', description: `${base.description}。候補: ${values.join(' / ')}` }
        : { ...base, type: 'string', enum: values };
    }
    default:
      return { ...base, type: 'string' };
  }
}

/** 解析結果のJSONスキーマ */
export function buildAnalysisSchema(): JsonSchema {
  const answers: JsonSchema = {};
  for (const q of QUESTIONS) answers[q.id] = fieldSchema(q);

  return {
    type: 'object',
    additionalProperties: false,
    required: ['answers', 'uncertain', 'evidence', 'notes', 'questions'],
    properties: {
      answers: {
        type: 'object',
        additionalProperties: false,
        description: '手書きメモから読み取れた項目だけを入れる。読み取れないものは入れない',
        properties: answers,
      },
      uncertain: {
        type: 'array',
        description: '読み取ったが自信がない項目のID。ここに入れたものは人に確認してもらう',
        items: { type: 'string', enum: QUESTIONS.map((q) => q.id) },
      },
      evidence: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: '項目IDごとに、メモのどの記載から読み取ったかを短く書く',
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
