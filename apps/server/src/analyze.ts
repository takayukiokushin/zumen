import Anthropic from '@anthropic-ai/sdk';
import { buildAnalysisSchema, buildReview, buildSystemPrompt, buildUserPrompt } from '@zumen/ai';
import type { AnalysisResult, ReviewItem } from '@zumen/ai';
import type { Answers } from '@zumen/knowledge';

const client = new Anthropic();

/** 手書きメモの画像 */
export interface SketchImage {
  mediaType: string;
  /** base64（データURLの接頭辞は付けない） */
  data: string;
}

export interface AnalyzeResponse {
  result: AnalysisResult;
  review: ReviewItem[];
}

const SUPPORTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * 手書きメモを読み取って、ヒアリング項目を埋める。
 *
 * 出力はJSONスキーマで縛っているので、選択式の項目に勝手な値が入ることはない。
 * そのうえで構成ルールと突き合わせ、人が確認すべき点を一覧にして返す。
 */
export async function analyze(images: SketchImage[], answers: Answers): Promise<AnalyzeResponse> {
  const unsupported = images.find((i) => !SUPPORTED.includes(i.mediaType));
  if (unsupported) {
    throw new Error(`対応していない画像形式です: ${unsupported.mediaType}`);
  }

  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (img): Anthropic.ContentBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType as 'image/png', data: img.data },
      }),
    ),
    { type: 'text', text: buildUserPrompt(answers) },
  ];

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
    output_config: {
      format: { type: 'json_schema', schema: buildAnalysisSchema() },
    },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('解析を実行できませんでした。別の画像でお試しください。');
  }

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('解析結果を受け取れませんでした。');

  let result: AnalysisResult;
  try {
    result = JSON.parse(text.text) as AnalysisResult;
  } catch {
    throw new Error('解析結果を読み取れませんでした。');
  }

  // 念のため既定値で埋めておく（人が確認する画面が壊れないように）
  result.answers ??= {};
  result.uncertain ??= [];
  result.evidence ??= {};
  result.notes ??= [];
  result.questions ??= [];

  return { result, review: buildReview(result, answers) };
}
