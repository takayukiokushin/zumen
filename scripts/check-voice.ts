/**
 * 音声入力から作成：Claude用の指示文と、貼り付けた文章の読み取りの検証。
 *
 *   node --experimental-strip-types scripts/check-voice.ts
 */
import { readFileSync } from 'node:fs';
import { QUESTIONS, buildComposition } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import {
  VOICE_FORMAT,
  VOICE_VERSION,
  buildReview,
  buildVoiceInstruction,
  buildVoiceItemList,
  parseVoiceResult,
} from '../packages/ai/src/index.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};
const ok = (cond: boolean, msg: string) => (cond ? undefined : fail(msg));

/** Claude が出す文章（コードブロックつき）を作る */
const claudeSays = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}, version = VOICE_VERSION): string =>
  `聞き取った内容をまとめました。アプリの「音声入力から作成」に貼り付けてください。\n\n\`\`\`json\n${JSON.stringify(
    { format: VOICE_FORMAT, version, answers, uncertain: [], evidence: {}, notes: [], questions: [], ...extra },
    null,
    2,
  )}\n\`\`\`\n`;

console.log('■ Claude用の指示文');
{
  const text = buildVoiceInstruction();
  const manual = QUESTIONS.filter((q) => q.manualOnly);
  ok(manual.map((q) => q.id).join() === 'siteName,customerNameForTitleBlock,drawingName', `手入力にする項目が違います（${manual.map((q) => q.id).join()}）`);
  // 手入力の項目は、項目の一覧に載せない（名前は、「聞かないで」という説明のために出てくる）
  for (const q of manual) ok(!text.includes(`- ${q.id}：`), `手入力の項目 ${q.id} が、項目の一覧に載っています`);
  ok(text.includes('お客様名称') || text.includes('事業場名称'), '「声に出さないでほしいもの」に、事業場名称などが書かれていません');
  ok(text.includes('聞かないでください') && text.includes('出力にも入れないでください'), '手入力の項目を、聞かない・出力に入れない、という指示がありません');
  // そのほかの項目は、すべて載っている
  const missing = QUESTIONS.filter((q) => !q.manualOnly && !text.includes(`- ${q.id}：`));
  ok(missing.length === 0, `項目の一覧に載っていない項目があります（${missing.map((q) => q.id).slice(0, 5).join('、')}）`);
  // 出力の形と、版
  ok(text.includes(`"format": "${VOICE_FORMAT}"`) && text.includes(`"version": "${VOICE_VERSION}"`), '指示文に、形の目印と版が書かれていません');
  // 繰り返し・エリアの書き方
  ok(text.includes('__2') && text.includes('a2:'), '繰り返し（__2）・エリア（a2:）の書き方が、指示文にありません');
  // 継電器・補助変圧器・VT/CTの組など、新しい項目も入っている
  for (const id of ['relayType', 'relayAt', 'relayTest', 'vtSetCount', 'ctSetCount', 'auxTrCapacity']) ok(text.includes(`- ${id}：`), `${id} が項目の一覧にありません`);
  // 分けて入れる場合
  const split = buildVoiceInstruction({ listInline: false });
  const list = buildVoiceItemList();
  ok(!split.includes('- relayType：') && list.includes('- relayType：') && list.includes(VOICE_VERSION), '指示文と項目の一覧を、分けて出せません');
  ok(split.length + list.length < text.length + 2000, '分けたときの文字数が、まとめたときと合いません');
  console.log(`  ${text.length}文字（版 ${VOICE_VERSION}）。手入力の項目は載せず、そのほか ${QUESTIONS.length - manual.length} 項目が載っている`);
}

// docs に置いてある指示文が、いまのアプリの項目と合っている（質問を増やしたのに、指示文を作り直し忘れていない）
{
  const read = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
  const stale = [
    ['claude-voice-instruction.txt', buildVoiceInstruction()],
    ['claude-voice-instruction-head.txt', buildVoiceInstruction({ listInline: false })],
    ['claude-voice-item-list.txt', buildVoiceItemList()],
  ].filter(([name, want]) => read(name!) !== want);
  ok(stale.length === 0, `docs の指示文が古いです（${stale.map(([n]) => n).join('、')}）。pnpm voice を実行してください`);
  if (stale.length === 0) console.log('  docs の指示文は、いまの項目と合っている');
}

console.log('\n■ 貼り付けた文章の読み取り');
{
  // いちばん普通の場合：Claude の出力をそのまま貼る（前後の文章・コードブロックつき）
  const good = parseVoiceResult(
    claudeSays(
      {
        sourceType: 'pole',
        poleName: '中電柱：猪子山（分）81',
        sectionalizer: 'pas',
        pasControl: 'dgr',
        mainBreakerForm: 'cb',
        areaCount: '2',
        transformerCount: '2',
        trCapacity: '300',
        trUsage: '動力',
        trCapacity__2: 100,
        'a2:areaIntake': 'ds-vcb',
        areaForm__2: 'room-open',
        'a2:trCapacity': 50,
        'a2:trCapacity__2': '75',
        relayCount: 2,
        relayType__2: 'UVR',
      },
      { uncertain: ['trCapacity__2'], evidence: { trCapacity: '「さんびゃくキロ」と話された' }, notes: ['蓄電所ではない'] },
    ),
  );
  ok(good.ok && good.rejected.length === 0 && good.warnings.length === 0, `正しい文章が、そのまま読み取れません（${good.error ?? ''}${good.rejected.map((r) => `${r.key}:${r.reason}`).join('、')}）`);
  const a = good.result?.answers ?? {};
  ok(a.trCapacity === 300 && a.trCapacity__2 === 100 && a['a2:trCapacity__2'] === 75, '数字の項目が、数字に直っていません');
  ok(a.transformerCount === '2' && a.relayCount === '2', '選ぶ項目が、文字に直っていません');
  ok(good.result?.uncertain.join() === 'trCapacity__2' && good.result.evidence.trCapacity !== undefined && good.result.notes.length === 1, '自信なし・根拠・特記事項が読み取れていません');
  // 取り込んだ答えで、構成が作れる（図面まで進める）
  const items = buildComposition({ ...(a as Answers), receivingVoltage: 6600, sectionalizer: 'pas' });
  ok(items.some((i) => i.role === 'transformer') && items.some((i) => i.role === 'a2:transformer'), '取り込んだ答えから、2か所ぶんの変圧器が作れません');
  ok(buildReview(good.result!, {}).length >= 0, '確認の一覧が作れません');
  console.log(`  正しい文章：${Object.keys(a).length}項目を読み取り、数字・選択の形に直した。2か所ぶんの構成も作れる`);

  // コードブロックが無くても、文章の前後にあっても、読み取れる
  const bare = parseVoiceResult(`はい、どうぞ。${JSON.stringify({ format: VOICE_FORMAT, version: VOICE_VERSION, answers: { sourceType: 'cabinet' } })} 以上です。`);
  ok(bare.ok && bare.result?.answers.sourceType === 'cabinet', 'コードブロックが無い文章が、読み取れません');
  // 会話の全部を貼ったとき：あとのコードブロック（最新のもの）を使う
  const twice = parseVoiceResult(claudeSays({ sourceType: 'pole' }) + '\n直しました。\n' + claudeSays({ sourceType: 'cabinet' }));
  ok(twice.result?.answers.sourceType === 'cabinet', '会話の全部を貼ったとき、最新のコードブロックを使っていません');

  // 間違い：項目ごとに、取り込まず、理由を出す（ほかの項目は取り込む）
  const bad = parseVoiceResult(
    claudeSays({
      sourceType: 'pole',
      mainBreakerForm: 'vcb-form', // 選べない値
      transformerCount__0: '1', // 件の番号が不正
      noSuchQuestion: 'x', // 一覧にない項目
      trCapacity: '三百', // 数字でない
      'a2:sourceType': 'pole', // エリアごとに答える項目ではない
      hasAs: '', // 空
      areaForm__2: 'cubicle',
    }),
  );
  const rej = Object.fromEntries(bad.rejected.map((r) => [r.key, r.reason]));
  ok(bad.ok && bad.result?.answers.sourceType === 'pole' && bad.result.answers.areaForm__2 === 'cubicle', '正しい項目まで取り込まれなくなっています');
  ok(Boolean(rej.mainBreakerForm?.includes('選べない値')), `選べない値が、弾かれていません（${rej.mainBreakerForm}）`);
  ok(Boolean(rej.transformerCount__0), '不正な件の番号が、弾かれていません');
  ok(Boolean(rej.noSuchQuestion?.includes('アプリにない項目')), '一覧にない項目が、弾かれていません');
  ok(Boolean(rej.trCapacity?.includes('数字ではありません')), '数字でない値が、弾かれていません');
  ok(Boolean(rej['a2:sourceType']), 'エリアごとに答えない項目への a2: が、弾かれていません');
  ok(Boolean(rej.hasAs?.includes('空')), '空の値が、弾かれていません');
  console.log(`  間違いのある文章：正しい項目は取り込み、間違い ${bad.rejected.length}件は、取り込まずに理由を出す`);

  // 手入力にする項目（お客様名称など）は、取り込まずに、知らせる
  const manual = parseVoiceResult(claudeSays({ siteName: '〇〇工場', customerNameForTitleBlock: '〇〇', drawingName: 'x', sourceType: 'pole' }));
  ok(manual.ok && !('siteName' in (manual.result?.answers ?? {})) && !('drawingName' in (manual.result?.answers ?? {})) && !('customerNameForTitleBlock' in (manual.result?.answers ?? {})), 'お客様名称などが、取り込まれています');
  ok(manual.warnings.some((w) => w.includes('事業場名称') && w.includes('手で入力')), '手で入力してください、という知らせが出ていません');
  ok(manual.rejected.length === 0 && manual.result?.answers.sourceType === 'pole', '手入力の項目のせいで、ほかの項目が取り込めなくなっています');
  console.log('  お客様名称・事業場名称・図面名称は、取り込まず、「手で入力してください」と知らせる');

  // 古い指示文（版が違う）：取り込むが、知らせる
  const old = parseVoiceResult(claudeSays({ sourceType: 'pole' }, {}, 'v-old'));
  ok(old.ok && old.warnings.some((w) => w.includes('古い')), '版が違うとき、知らせが出ていません');

  // 文章の形が違う：読み取らない
  for (const [name, text, want] of [
    ['空', '', 'JSON'],
    ['ふつうの文章', 'アプリ用の文章を出します。', 'JSON'],
    ['形の目印なし', '```json\n{"answers":{"sourceType":"pole"}}\n```', 'format'],
    ['答えなし', `{"format":"${VOICE_FORMAT}","version":"${VOICE_VERSION}"}`, 'answers'],
    ['壊れたJSON', `{"format":"${VOICE_FORMAT}",`, 'JSON'],
  ] as const) {
    const r = parseVoiceResult(text);
    ok(!r.ok && Boolean(r.error?.includes(want)), `${name}：読み取れない文章が、そう扱われていません（${r.error}）`);
  }
  console.log('  形の違う文章（空・ふつうの文章・目印なし・答えなし・壊れたJSON）は、理由を出して、読み取らない');
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
