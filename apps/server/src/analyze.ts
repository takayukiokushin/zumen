import Anthropic from '@anthropic-ai/sdk';
import { buildAnalysisSchema, buildSystemPrompt, buildUserPrompt, parseAnalysisOutput } from '@zumen/ai';
import type { AnalysisResult } from '@zumen/ai';
import type { Answers } from '@zumen/knowledge';

/**
 * AI の応答を待つ時間の決まり。
 * 何も決めないと、SDK の標準は「1回10分・失敗したら2回やり直し」で、AI が応答しないとき、最大30分、画面が待たされ続ける。
 *   ・1回の応答を待つのは、ANALYZE_TIMEOUT_MS（標準 150秒）まで
 *   ・失敗したときのやり直しは、1回だけ
 *   ・全体では、（待つ時間 × 2回）＋15秒 で、必ず打ち切る（標準で約5分）
 * 試験や調整のために、環境変数 ANALYZE_TIMEOUT_MS で変えられる。
 */
const parsed = Number(process.env.ANALYZE_TIMEOUT_MS);
export const ANALYZE_TIMEOUT_MS = Number.isFinite(parsed) && parsed >= 200 ? parsed : 150_000;
export const ANALYZE_RETRIES = 1;
export const ANALYZE_DEADLINE_MS = ANALYZE_TIMEOUT_MS * (ANALYZE_RETRIES + 1) + 15_000;

const client = new Anthropic({ timeout: ANALYZE_TIMEOUT_MS, maxRetries: ANALYZE_RETRIES });

/** 決めた時間のうちに、読み取りが終わらなかった（AI が応答しない・遅すぎる） */
export class AnalyzeTimeoutError extends Error {
  constructor() {
    super('読み取りに時間がかかりすぎたので、止めました。もう一度お試しください。何度も続くときは、ファイルの枚数やページ数を減らすか、小さくしてから試してください。続くときは、管理者に伝えてください。');
    this.name = 'AnalyzeTimeoutError';
  }
}

/** 手書きメモの画像 */
export interface SketchImage {
  mediaType: string;
  /** base64（データURLの接頭辞は付けない） */
  data: string;
}

/** 読み取りの返事。確認の一覧（「確認してほしいこと」）は、スケッチ読み取りの画面では使わないので、返さない（音声入力は、画面側で作る） */
export interface AnalyzeResponse {
  result: AnalysisResult;
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
 * 送る前の確認（形式・合計の大きさ・PDFのページ数）。問題があれば、利用者への案内の文で、失敗させる。
 * AI に送る前に、すぐ断るため（待たされない・料金がかからない）。読み取りを頼むときに、まず呼ぶ。
 */
export function validateImages(images: SketchImage[]): void {
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
}

/**
 * 手書きメモを読み取って、ヒアリング項目を埋める。
 *
 * 出力はJSONスキーマで縛っているので、選択式の項目に勝手な値が入ることはない。
 * 返した結果は、画面で、人が確認してから反映する（反映したあと、「設備を入力して作成」と「図面」で、見直して直せる）。
 */
export async function analyze(images: SketchImage[], answers: Answers, clientGone?: AbortSignal): Promise<AnalyzeResponse> {
  validateImages(images);

  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (img): Anthropic.ContentBlockParam =>
        img.mediaType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data } }
          : { type: 'image', source: { type: 'base64', media_type: img.mediaType as 'image/png', data: img.data } },
    ),
    { type: 'text', text: buildUserPrompt(answers) },
  ];

  // 全体の打ち切り（時間切れ）と、画面側がやめた（接続が切れた）ときの中断を、まとめて渡す
  const deadline = AbortSignal.timeout(ANALYZE_DEADLINE_MS);
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: 'claude-opus-5',
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
        output_config: {
          format: { type: 'json_schema', schema: buildAnalysisSchema() },
        },
        messages: [{ role: 'user', content }],
      },
      { signal: clientGone ? AbortSignal.any([deadline, clientGone]) : deadline },
    );
  } catch (e) {
    // 時間切れ（1回の待ち時間を超えた・全体の打ち切り）は、「つながらなかった」ではなく、「時間がかかりすぎた」と伝える
    if (e instanceof Anthropic.APIConnectionTimeoutError || (deadline.aborted && !clientGone?.aborted)) throw new AnalyzeTimeoutError();
    throw e;
  }

  logUsage(response.usage, images.length);

  if (response.stop_reason === 'refusal') {
    throw new Error('読み取りを実行できませんでした。別の画像でお試しください。');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('読み取る内容が多すぎて、結果が途中で止まりました。ファイルの枚数やページ数を減らして、何回かに分けてお試しください。');
  }

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('読み取りの結果を受け取れませんでした。もう一度お試しください。');

  let result: AnalysisResult;
  try {
    // AIは「項目ID＋値」の並びで答える。アプリの質問に合っているかを確かめて、確認画面の形に直す
    const parsed = parseAnalysisOutput(JSON.parse(text.text));
    result = parsed.result;
    if (parsed.rejected.length > 0) console.warn('解析：取り込まなかった項目', JSON.stringify(parsed.rejected));
  } catch {
    throw new Error('読み取りの結果を、うまく取り込めませんでした。もう一度お試しください。');
  }

  // 念のため既定値で埋めておく（人が確認する画面が壊れないように）
  result.answers ??= {};
  result.uncertain ??= [];
  result.evidence ??= {};
  result.notes ??= [];
  result.questions ??= [];

  return { result };
}
