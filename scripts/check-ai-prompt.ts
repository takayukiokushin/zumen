/**
 * AIへの指示文と、返してもらう形の検査（第18弾 E）。AIには頼まない。
 *   ・質問に「どの部分か（where）」がある（返す形・取り込み）
 *   ・2か所目以降の確認を1件にまとめる指示がある
 *   ・利用者が選んでいる言葉（日本語以外）で、質問・注意書きを書いてもらう指示が、ユーザー側の指示文に入る（日本語・不明な言葉は、足さない）
 *   ・言葉の指示は、キャッシュされるシステム側の指示文に入れない（言葉ごとに、キャッシュが分かれてしまうため）
 */
import { buildAnalysisSchema, buildSystemPrompt, buildUserPrompt, parseAnalysisOutput } from '../packages/ai/src/index.ts';

let failed = 0;
const fail = (m: string) => {
  console.error(`  NG: ${m}`);
  failed++;
};
console.log('■ AIへの指示文と、返してもらう形（第18弾 E）');

const schema = JSON.stringify(buildAnalysisSchema());
const qs = (buildAnalysisSchema() as any).properties.questions.items;
if (!qs.required.includes('where') || !qs.properties.where) fail('質問の形に、where（どの部分か）がありません');
if (!schema.includes('where')) fail('返してもらう形に、where がありません');

const parsed = parseAnalysisOutput({ answers: [], uncertain: [], evidence: [], notes: [], questions: [{ questionId: 'sectionalizer', where: '図の最上部', ask: 'どれですか', why: '変わるため' }] });
if (parsed.result.questions[0]?.where !== '図の最上部') fail('受け取った質問の where が、取り込まれていません');
const noWhere = parseAnalysisOutput({ answers: [], uncertain: [], evidence: [], notes: [], questions: [{ questionId: '', ask: 'どれですか', why: '' }] });
if (noWhere.result.questions.length !== 1) fail('where が無い質問（古い返し方）が、取り込めません');

const sys = buildSystemPrompt();
if (!sys.includes('where：')) fail('指示文に、where の書き方がありません');
if (!sys.includes('入力画面で答えてください')) fail('指示文に、2か所目以降の確認を1件にまとめる決まりがありません');
for (const w of ['English', 'français', '简体中文', '한국어']) if (sys.includes(w)) fail(`システム側の指示文に、言葉の指示（${w}）が入っています（キャッシュが分かれます）`);

const base = buildUserPrompt({});
if (buildUserPrompt({}, 'ja') !== base) fail('日本語のとき、言葉の指示が足されています');
if (buildUserPrompt({}, 'xx') !== base) fail('知らない言葉のとき、言葉の指示が足されています');
for (const [lang, name] of [['en', 'English'], ['fr', 'français'], ['zh', '简体中文'], ['ko', '한국어']] as const) {
  const p = buildUserPrompt({}, lang);
  if (!p.includes(name) || !p.includes('where・ask・why')) fail(`${lang}：言葉の指示が、ユーザー側の指示文に入っていません`);
}

if (failed === 0) console.log('\n✓ 質問の where・2か所目以降のまとめ・言葉の指示は、そろっています');
else console.error(`\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
