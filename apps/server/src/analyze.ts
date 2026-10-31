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

const SUPPORTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];

/** PDFは、ページ数が多いと、料金と時間が、ページ数のぶんだけ増える。1つのPDFは、このページ数まで */
export const MAX_PDF_PAGES = 10;

/** PDFのページ数（目安）。PDFの中の「ページ」の印を数える。数えられなければ 0 */
export function pdfPageCount(base64: string): number {
  try {
    const text = Buffer.from(base64, 'base64').toString('latin1');
    return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  } catch {
    return 0;
  }
}

/** claude-opus-5 の単価（100万トークンあたりの米ドル）。改定されたら直す。 */
const PRICE_PER_MTOK = { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 };

/**
 * 1件あたりいくらかかったかをログに残す。
 * 実際の運用費を見積もるための材料で、料金の請求とは関係ない。
 */
function logUsage(usage: Anthropic.Usage, imageCount: number): void {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const usd =
    (usage.input_tokens * PRICE_PER_MTOK.input +
      cacheWrite * PRICE_PER_MTOK.cacheWrite +
      cacheRead * PRICE_PER_MTOK.cacheRead +
      usage.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000;
  console.log(
    `解析: 画像${imageCount}枚 / 入力${usage.input_tokens}（キャッシュ 書込${cacheWrite}・読込${cacheRead}）` +
      ` / 出力${usage.output_tokens} / 約$${usd.toFixed(3)}`,
  );
}

/**
 * 手書きメモを読み取って、ヒアリング項目を埋める。
 *
 * 出力はJSONスキーマで縛っているので、選択式の項目に勝手な値が入ることはない。
 * そのうえで構成ルールと突き合わせ、人が確認すべき点を一覧にして返す。
 */
export async function analyze(images: SketchImage[], answers: Answers): Promise<AnalyzeResponse> {
  const unsupported = images.find((i) => !SUPPORTED.includes(i.mediaType));
  if (unsupported) {
    throw new Error(`対応していない形式です（${unsupported.mediaType}）。JPEG・PNG・GIF・WebP の画像、または PDF にしてください。`);
  }
  // 1回に AI へ送れる大きさには上限がある（base64 の文字数で、おおよそ 30MB）
  if (images.reduce((n, i) => n + i.data.length, 0) > 30 * 1024 * 1024) {
    throw new Error('選んだファイルの合計が大きすぎます。枚数を減らすか、小さくしてから、もう一度お試しください。');
  }
  for (const img of images) {
    if (img.mediaType === 'application/pdf' && pdfPageCount(img.data) > MAX_PDF_PAGES) {
      throw new Error(`PDF のページ数が多すぎます（1つの PDF は ${MAX_PDF_PAGES} ページまで）。読み取りたいページだけの PDF にしてから、もう一度お試しください。`);
    }
  }

  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (img): Anthropic.ContentBlockParam =>
        img.mediaType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data } }
          : { type: 'image', source: { type: 'base64', media_type: img.mediaType as 'image/png', data: img.data } },
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

  logUsage(response.usage, images.length);

  if (response.stop_reason === 'refusal') {
    throw new Error('解析を実行できませんでした。別の画像でお試しください。');
  }

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('解析結果を受け取れませんでした。もう一度お試しください。');

  let result: AnalysisResult;
  try {
    result = JSON.parse(text.text) as AnalysisResult;
  } catch {
    throw new Error('解析結果を読み取れませんでした。もう一度お試しください。');
  }

  // 念のため既定値で埋めておく（人が確認する画面が壊れないように）
  result.answers ??= {};
  result.uncertain ??= [];
  result.evidence ??= {};
  result.notes ??= [];
  result.questions ??= [];

  return { result, review: buildReview(result, answers) };
}
