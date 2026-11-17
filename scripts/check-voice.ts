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
  VOICE_EXAMPLE_ANSWERS,
  parseVoiceResult,
  buildAnalysisSchema,
  parseAnalysisOutput,
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
  ok(manual.map((q) => q.id).join() === 'siteName,customerNo,customerNameForTitleBlock,drawingName', `手入力にする項目が違います（${manual.map((q) => q.id).join()}）`);
  // 手入力の項目は、項目の一覧に載せない（名前は、「聞かないで」という説明のために出てくる）
  for (const q of manual) ok(!text.includes(`- ${q.id}：`), `手入力の項目 ${q.id} が、項目の一覧に載っています`);
  ok(text.includes('お客様名称') || text.includes('事業場名称'), '「声に出さないでほしいもの」に、事業場名称などが書かれていません');
  ok(text.includes('聞かないでください') && text.includes('出力（answers・notes・evidence）にも') && text.includes('聞き流'), '手入力の項目を、聞かない・出力に入れない・聞き流す、という指示がありません');
  ok(!text.includes('アプリの中で入力してください」と'), '手入力の項目について、「アプリで入力してください」と案内する指示が残っています（案内は不要）');
  // 聞き返しは、必ず確認すること（6つ）だけ。1回だけ。最初の一言は無い
  ok(text.includes('必ず確認すること') && text.includes('まとめて1回だけ') && text.includes('もう聞き返さず'), '聞き返しを、1回だけ・必ず確認することだけにする指示がありません');
  for (const id of ['sourceType', 'sectionalizer', 'mainBreakerForm', 'transformerCount', 'areaCount']) {
    const sec = text.slice(text.indexOf('# 必ず確認すること'), text.indexOf('# 名称・番号など'));
    ok(sec.includes(`（${id}）`), `「必ず確認すること」に ${id} がありません`);
  }
  ok(!text.includes('現地の設備を教えてください'), '最初の一言の指示が残っています（やめる）');
  ok(text.includes('細かい項目') && text.includes('聞かない'), '細かい項目（定格など）は聞かない、という指示がありません');
  // 流れ：合図（ここまで）を待たず、聞き返しは1回だけ。答えがなくても、すぐ出す
  ok(!text.includes('「ここまで」「以上です」「お願いします」などと言われたら'), '「ここまで」と言われるまで出力しない、という古い流れが残っています');
  ok(text.includes('合図は、待たない') && text.includes('聞き返しは、全体を通して、1回だけ'), '「合図を待たない・聞き返しは1回だけ」の指示がありません');
  ok(text.includes('答えになっていない返事でも、聞き返さない') && text.includes('空のまま'), '答えが無くても、空のまま、すぐ出す、という指示がありません');
  // 出力は、ふつうの文字のコードブロック。図・アーティファクトは作らない
  ok(text.includes('コードブロック') && text.includes('図・表・アーティファクト') && text.includes('作らない'), '出力は、コードブロック（図やアーティファクトは作らない）という指示がありません');
  // 大事な決まり（流れ・出力の形）は、先頭に近いところにある（長くて途中までしか読まれなくても、抜け落ちない）
  ok(text.indexOf('# 出力の形') < 3000 && text.indexOf('# 会話の流れ') < 800, '流れ・出力の形が、指示文の先頭から離れています');
  // 長すぎない（以前は28万文字あり、決まった形で出なくなる原因だった）
  ok(text.length <= 60000, `指示文が長すぎます（${text.length}文字。6万文字以内にしてください）`);
  // 見本の文章を、アプリが、そのまま読み取れる
  {
    const ex = /```json\n([\s\S]*?)\n```/.exec(text);
    ok(Boolean(ex), '指示文に、出力の見本（コードブロック）がありません');
    const p = parseVoiceResult(ex ? ex[0] : '');
    ok(p.ok && p.rejected.length === 0 && p.warnings.length === 0, `指示文の見本を、アプリが読み取れません（${p.error ?? ''}${p.rejected.map((r) => r.key).join('、')}${p.warnings.join('')}）`);
    ok(Object.keys(VOICE_EXAMPLE_ANSWERS).every((k) => k in (p.result?.answers ?? {})), '見本の答えが、すべて読み取れていません');
  }
  // そのほかの項目は、すべて載っている
  const missing = QUESTIONS.filter((q) => !q.manualOnly && !q.noAi && !text.includes(`- ${q.id}：`));
  ok(missing.length === 0, `項目の一覧に載っていない項目があります（${missing.map((q) => q.id).slice(0, 5).join('、')}）`);
  // 出力の形と、版
  ok(text.includes(`"format": "${VOICE_FORMAT}"`) && text.includes(`"version": "${VOICE_VERSION}"`), '指示文に、形の目印と版が書かれていません');
  // 繰り返し・エリアの書き方
  ok(text.includes('__2') && text.includes('a2:'), '繰り返し（__2）・エリア（a2:）の書き方が、指示文にありません');
  // 継電器・補助変圧器・VT/CTの組など、新しい項目も入っている
  for (const id of ['relayType', 'relayAt', 'relayTest', 'vtSetCount', 'ctSetCount', 'auxTrCapacity']) ok(text.includes(`- ${id}：`), `${id} が項目の一覧にありません`);
  console.log(`  ${text.length}文字（版 ${VOICE_VERSION}）。手入力の項目は載せず、そのほか ${QUESTIONS.length - manual.length} 項目が載っている`);
}

// docs に置いてある指示文が、いまのアプリの項目と合っている（質問を増やしたのに、指示文を作り直し忘れていない）
{
  const read = (name: string) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
  const stale = [['claude-voice-instruction.txt', buildVoiceInstruction()]].filter(([name, want]) => read(name!) !== want);
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

  // 文章の形が違う：読み取らない（やさしい言葉で、Claudeに何と伝えるかを出す）
  for (const [name, text, want] of [
    ['空', '', 'アプリ用のデータが含まれていません'],
    ['聞き返しの文章だけ', 'はい、続けてください。', 'アプリ用のコードブロックで出してください'],
    ['答えなし', `{"format":"${VOICE_FORMAT}","version":"${VOICE_VERSION}"}`, '"answers"'],
    ['別のJSON', '```json\n{"name":"田中","age":30}\n```', '"answers"'],
    ['壊れたJSON', `{"format":"${VOICE_FORMAT}",`, 'アプリ用のデータが含まれていません'],
  ] as const) {
    const r = parseVoiceResult(text);
    ok(!r.ok && Boolean(r.error?.includes(want)), `${name}：読み取れない文章が、そう扱われていません（${r.error}）`);
    ok(!r.error?.includes('JSON') && !r.error?.includes('{'), `${name}：エラーの文に、専門用語（JSON）が入っています（${r.error}）`);
  }
  console.log('  形の違う文章（空・聞き返しだけ・答えなし・別のJSON・壊れたJSON）は、「Claudeにこう伝えて」と案内して、読み取らない');

  // 目印（format）が無くても、答えの一覧があれば、読み取る（知らせは出す）
  const noFormat = parseVoiceResult('```json\n{"answers":{"sourceType":"pole","sectionalizer":"pas"}}\n```');
  ok(noFormat.ok && noFormat.result?.answers.sourceType === 'pole' && noFormat.warnings.some((w) => w.includes('目印')), '目印（format）が無い文章が、読み取れない・知らせが出ていません');
  // 別の目印・版が無い
  const otherFormat = parseVoiceResult('{"format":"something","answers":{"sourceType":"cabinet"}}');
  ok(otherFormat.ok && otherFormat.result?.answers.sourceType === 'cabinet', '別の目印の文章が、読み取れません');
  // "answers" の枠が無く、項目IDが並んでいる
  const flat = parseVoiceResult('```json\n{"format":"zumen-voice","sourceType":"pole","mainBreakerForm":"pfs","trCapacity":150}\n```');
  ok(flat.ok && flat.result?.answers.mainBreakerForm === 'pfs' && flat.result.answers.trCapacity === 150 && flat.warnings.some((w) => w.includes('answers')), '項目IDが直接並んだ文章が、読み取れません');
  // [{key,value}] の並び
  const arr = parseVoiceResult(`${JSON.stringify({ format: VOICE_FORMAT, version: VOICE_VERSION, answers: [{ key: 'sourceType', value: 'pole' }, { id: 'trCapacity', value: 200 }] })}`);
  ok(arr.ok && arr.result?.answers.sourceType === 'pole' && arr.result.answers.trCapacity === 200, '{key,value} の並びが、読み取れません');
  // 前に、別のJSONがあっても、アプリ用のものを選ぶ
  const two = parseVoiceResult('{"memo":"これは別の文書"}\n' + claudeSays({ sourceType: 'cabinet' }) + '\n{"x":1}');
  ok(two.ok && two.result?.answers.sourceType === 'cabinet' && two.rejected.length === 0, '別のJSONが混ざると、アプリ用のものを選べません');
  // 少し崩れたJSON：最後の , ・曲がった引用符
  const loose = parseVoiceResult(`\`\`\`JSON\n{"format":"${VOICE_FORMAT}","version":"${VOICE_VERSION}","answers":{"sourceType":"pole",},"notes":[],}\n\`\`\``);
  ok(loose.ok && loose.result?.answers.sourceType === 'pole', '最後の , のあるJSONが、読み取れません');
  const curly = parseVoiceResult('{“format”:“zumen-voice”,“answers”:{“sourceType”:“pole”}}');
  ok(curly.ok && curly.result?.answers.sourceType === 'pole', '曲がった引用符のJSONが、読み取れません');
  console.log('  目印なし・別の目印・IDが直接並ぶ・{key,value}の並び・別のJSONが混ざる・崩れたJSON も、読み取れる（知らせは出す）');

  // 音声入力の、値の書き方のずれ：読み替えて取り込み、読み替えたことを知らせる
  const sloppy = parseVoiceResult(
    claudeSays({
      'sourceType（引込元）': 'POLE',
      ' sectionalizer ': 'ＰＡＳ',
      mainBreakerForm: 'CB形（主遮断装置＝VCB）',
      transformerCount: 2,
      trCapacity: '300kVA',
      trCapacity__2: '１５０',
      'a2：trCapacity': '7,200 V'.replace('7,200 V', '75 kVA'),
      hasZpd: 'あり',
      hasInrush: true,
      hasAs: 'なし',
    }),
  );
  const sa = sloppy.result?.answers ?? {};
  ok(sloppy.ok && sa.sourceType === 'pole' && sa.sectionalizer === 'pas' && sa.mainBreakerForm === 'cb', `選ぶ項目の書き方のずれが、読み取れません（${JSON.stringify(sa)}）`);
  ok(sa.trCapacity === 300 && sa.trCapacity__2 === 150 && sa['a2:trCapacity'] === 75, `数字の書き方のずれ（単位つき・全角）が、読み取れません（${JSON.stringify(sa)}）`);
  ok(sa.hasZpd === 'yes' && sa.hasInrush === 'yes' && sa.hasAs === 'no', `あり・なしの書き方のずれが、読み取れません（${JSON.stringify(sa)} ${JSON.stringify(sloppy.rejected)}）`);
  ok(sloppy.warnings.some((w) => w.includes('読み替えました')), '読み替えたことの知らせが出ていません');
  ok(!sloppy.warnings.some((w) => w.includes('古い')), 'ずれた値のせいで、「古い指示文」の知らせが出ています');
  console.log('  書き方のずれ（大文字・全角・単位つき・名前つきのID・あり／なし・true）は、読み替えて取り込み、知らせる');

  // 音声入力の、典型的な話し方（聞き間違いの直しは、Claude の役目）。Claude が出しそうな文章を、アプリが取り込める
  const speeches: { name: string; says: Record<string, unknown>; need: Record<string, string | number> }[] = [
    {
      name: 'PFS形・変圧器1台（「区分解兵器」の聞き間違いを、区分開閉器に直したもの）',
      says: { sourceType: 'pole', sectionalizer: 'pas', mainBreakerForm: 'pfs', transformerCount: '1', trCapacity: 100, trUsage: '動力' },
      need: { mainBreakerForm: 'pfs', transformerCount: '1', trCapacity: 100 },
    },
    {
      name: 'CB形・変圧器2台・電灯と動力',
      says: { sourceType: 'pole', sectionalizer: 'pgs', mainBreakerForm: 'cb', transformerCount: '2', trCapacity: 300, trCapacity__2: 200, trUsage: '電灯', trUsage__2: '動力' },
      need: { mainBreakerForm: 'cb', transformerCount: '2', trCapacity__2: 200 },
    },
    {
      name: 'キャビネット受電・UGS・変圧器3台',
      says: { sourceType: 'cabinet', sectionalizer: 'ugs', mainBreakerForm: 'cb', transformerCount: '3', trCapacity: 500, trCapacity__2: 300, trCapacity__3: 100 },
      need: { sourceType: 'cabinet', sectionalizer: 'ugs', transformerCount: '3', trCapacity__3: 100 },
    },
    {
      name: '聞き返しに答えなかった（ほとんど空）',
      says: { sourceType: 'pole' },
      need: { sourceType: 'pole' },
    },
  ];
  for (const sp of speeches) {
    const p = parseVoiceResult(`ご確認ください。\n\n${claudeSays(sp.says)}\nアプリに貼り付けてください。`);
    const a2 = p.result?.answers ?? {};
    ok(p.ok && p.rejected.length === 0 && p.warnings.length === 0, `${sp.name}：取り込めません（${p.error ?? ''}${p.rejected.map((r) => `${r.key}:${r.reason}`).join('、')}${p.warnings.join('')}）`);
    for (const [k, v] of Object.entries(sp.need)) ok(a2[k] === v, `${sp.name}：${k} が ${String(v)} になっていません（${String(a2[k])}）`);
    const items = buildComposition({ receivingVoltage: 6600, ...(a2 as Answers) });
    ok(items.length > 0, `${sp.name}：構成が作れません`);
  }
  console.log(`  典型的な話し方 ${speeches.length}通り（PFS／CB・変圧器の台数ちがい・聞き返しに答えなかった場合）を、そのまま取り込めた`);
}

console.log('\n■ Claude（指示文だけを読んだもの）が実際に出した文章の例');
{
  for (const n of [1, 2, 3]) {
    const text = readFileSync(new URL(`../docs/voice-samples/sample-${n}-claude-output.txt`, import.meta.url), 'utf8');
    const p = parseVoiceResult(text);
    ok(p.ok && p.rejected.length === 0, `例${n}：取り込めない項目があります（${p.error ?? ''}${p.rejected.map((r) => `${r.key}：${r.reason}`).join('、')}）。指示文を見直してください`);
    // お客様名称は、出力のどこにも入っていない（話された名前の言葉が、文章に出てこない）
    for (const name of ['マルマル製作所', 'ばつばつエナジー', 'てすと工業']) ok(!text.includes(name), `例${n}：お客様名称（${name}）が、出力に入っています`);
    for (const id of ['siteName', 'customerNo', 'customerNameForTitleBlock', 'drawingName']) ok(!(id in (p.result?.answers ?? {})), `例${n}：手入力の項目 ${id} が、答えに入っています`);
    // 取り込んだ答えから、構成が作れる
    // 聞き返しは、使わない（話されたことの根拠は、自信がない項目だけ）
    ok((p.result?.questions.length ?? 0) <= 3, `例${n}：questions が多すぎます`);
    ok(Object.keys(p.result?.evidence ?? {}).every((k) => (p.result?.uncertain ?? []).includes(k)), `例${n}：自信がある項目にも、根拠（evidence）が付いています`);
    const items = buildComposition({ receivingVoltage: 6600, ...(p.result?.answers as Answers) });
    ok(items.some((i) => i.role === 'transformer'), `例${n}：取り込んだ答えから、構成が作れません`);
    if (p.ok && p.rejected.length === 0) console.log(`  例${n}：${Object.keys(p.result!.answers).length}項目を、そのまま取り込めた。お客様名称は入っていない。構成は ${items.length}件`);
  }
}

/* ---------- スケッチ読み取り：AIに答えてもらう形（JSONスキーマ）の複雑さ ---------- */
console.log('\n■ スケッチ読み取りの、AIに答えてもらう形（スキーマ）');
{
  // AIの「決まった形で答える」機能の上限：省略できる項目は、全体で24個まで／「または」型は、16個まで／
  // すべての入れ物は additionalProperties: false。これを超えると、読み取りが必ず失敗する（400）
  let optional = 0;
  let unions = 0;
  const badObjects: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'object' || n.properties) {
      if (n.additionalProperties !== false) badObjects.push(path || '(最上位)');
      const props = Object.keys((n.properties as object) ?? {});
      const req = new Set((n.required as string[]) ?? []);
      optional += props.filter((k) => !req.has(k)).length;
    }
    if ('anyOf' in n || Array.isArray(n.type)) unions++;
    for (const [k, v] of Object.entries(n)) walk(v, `${path}/${k}`);
  };
  const schema = buildAnalysisSchema();
  walk(schema, '');
  ok(optional <= 24, `省略できる項目が ${optional}個あります（上限24個。超えると、読み取りが必ず失敗します）`);
  ok(unions <= 16, `「または」型が ${unions}個あります（上限16個）`);
  ok(badObjects.length === 0, `additionalProperties が false でない入れ物があります：${badObjects.join('、')}`);
  ok(JSON.stringify(schema).length < 6000, `スキーマが大きすぎます（${JSON.stringify(schema).length}文字）。質問ごとの欄を作っていないか確かめてください`);
  if (optional <= 24 && unions <= 16 && badObjects.length === 0) console.log(`  省略できる項目 ${optional}個（上限24）・「または」型 ${unions}個（上限16）・スキーマ ${JSON.stringify(schema).length}文字`);

  // AIの答え（項目ID＋値の並び）を、確認画面の形にできる。合わない項目は、取り込まずに、理由を出す
  const wire = {
    answers: [
      { key: 'transformerCount', value: '2' },
      { key: 'trCapacity', value: '100' },
      { key: 'vtCount__2', value: '2' },
      { key: 'a2:trCapacity', value: '50' },
      { key: 'mainBreakerForm', value: 'cb' },
      { key: 'siteName', value: '試験の現場' },
      { key: 'mainBreakerForm__x', value: 'cb' },
      { key: 'hasZpd', value: 'たぶん' },
      { key: 'noSuchQuestion', value: '1' },
    ],
    uncertain: ['trCapacity', 'noSuchQuestion'],
    evidence: [{ key: 'trCapacity', text: '「100kVA」と書いてある' }, { key: 'noSuchQuestion', text: 'x' }],
    notes: ['注意書き'],
    questions: [{ questionId: '', ask: '2か所目は？', why: 'メモに無い' }],
  };
  const r = parseAnalysisOutput(wire);
  ok(r.result.answers.transformerCount === '2' && r.result.answers.trCapacity === 100, '答えを、項目の形（数字は数）に直せていません');
  ok(r.result.answers.mainBreakerForm === 'cb' && r.result.answers['a2:trCapacity'] === 50 && r.result.answers.vtCount__2 !== undefined, '2か所目（a2:）・2件目（__2）の答えを取り込めていません');
  ok(r.result.answers.siteName === '試験の現場', 'スケッチ読み取りでは、事業場名称も取り込めるはずです');
  ok(r.rejected.length === 3 && r.rejected.some((x) => x.key === 'hasZpd') && r.rejected.some((x) => x.key === 'noSuchQuestion'), `合わない項目の扱いが違います（${JSON.stringify(r.rejected.map((x) => x.key))}）`);
  ok(r.result.notes.length === 2 && r.result.notes[1]!.includes('取り込んでいません'), '取り込まなかった項目の説明が、特記事項に入っていません');
  ok(r.result.uncertain.join() === 'trCapacity' && r.result.evidence.trCapacity !== undefined && !('noSuchQuestion' in r.result.evidence), '自信がない項目・根拠が、取り込んだ項目だけになっていません');
  ok(r.result.questions.length === 1, 'AIからの質問が取り込めていません');
  const empty = parseAnalysisOutput({});
  ok(Object.keys(empty.result.answers).length === 0 && empty.result.notes.length === 0, '空の答えを、空として扱えていません');
  console.log('  AIの答え（項目ID＋値）を確認画面の形に直せる。合わない項目は、取り込まずに理由を出す');
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
