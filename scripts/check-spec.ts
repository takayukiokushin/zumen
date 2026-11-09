/**
 * 仕様書（docs/spec.md）の数値が、プログラムの値とずれていないかの検証。
 *
 * 仕様書の「レイヤー」の節と、付録A（数の上限）に書いてある数値・名前を、プログラムの値と照らし合わせる。
 * プログラムの上限などを変えたのに、仕様書を直し忘れるのを防ぐ。
 * また、付録B（動作を確かめた環境）と付録C（デバッグの計画）が、決めた項目をそろえているかを確かめる。
 *
 *   node --experimental-strip-types scripts/check-spec.ts
 */
import { readFileSync } from 'node:fs';
import { AREA_CHAIN, AREA_KINDS, ARROW_LABEL_DEFAULT, CB_CHAIN, DOWNSTREAM, EXTRAS, FEEDERS, PFS_CHAIN, QUESTIONS, TRANSFORMER, UPSTREAM, COUNT_LIMITS, FIXED_LAYERS, MAX_COUNT, MAX_CUSTOM_LAYERS, PCS_INPUT_MAX, MAX_LAYER_ITEMS_PER_KIND, MAX_TEXT_LENGTH } from '../packages/knowledge/src/index.ts';
import { SYMBOLS } from '../packages/symbols/src/index.ts';
import { ARROW_LEN_DEFAULT, ARROW_LEN_MAX, ARROW_LEN_MIN, ARROW_STROKE, AREA_STROKE, CROSS_SPECS, DOT_RADIUS, GROUND_STROKE, HATCH_GAP, HATCH_STROKE, LINK_SHAPES, LINK_STROKE, TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '../packages/layout/src/index.ts';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const spec = read('docs/spec.md');
const readme = read('README.md');

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

console.log('■ 仕様書の数値とプログラムの値');

/** 表の行（「| 名前 | 値 | …」）を探して、2番目以降のセルが、そろっているか */
function row(label: string, ...cells: (string | number)[]): void {
  const line = spec.split('\n').find((l) => l.startsWith(`| ${label} |`));
  if (!line) return fail(`仕様書に「${label}」の行がありません`);
  const got = line.split('|').slice(2, -1).map((c) => c.trim());
  const want = cells.map(String);
  want.forEach((w, i) => {
    if (got[i] !== w) fail(`仕様書の「${label}」の ${i + 1} つ目が ${got[i] ?? '（なし）'} です（プログラムの値は ${w}）`);
  });
}

/** ソースの文字から、数を取り出す（サーバーの部品は、読み込むと動き出すものがあるので、文字として読む） */
function numFrom(file: string, re: RegExp): number {
  const m = re.exec(read(file));
  if (!m) {
    fail(`${file} から値を読めません（${re}）`);
    return NaN;
  }
  return Number(m[1]);
}

// レイヤー
for (const f of FIXED_LAYERS) if (!spec.includes(f.title)) fail(`仕様書に固定のレイヤー「${f.title}」がありません`);
if (!spec.includes(`「${ARROW_LABEL_DEFAULT}」`)) fail(`仕様書に、矢印の最初の文字「${ARROW_LABEL_DEFAULT}」がありません`);
for (const [id, label] of [['S', '小'], ['M', '中'], ['L', '大']] as const) row(label, CROSS_SPECS[id].size, CROSS_SPECS[id].thickness);
for (const k of AREA_KINDS) row(k.label, k.hatch ? 'あり' : 'なし');
const shapeName = { straight: '直線', gentle: 'ゆるい弧', normal: '普通の弧', round: 'すごく丸い弧' } as const;
for (const s of LINK_SHAPES) row(shapeName[s.id], `${Math.round(s.bulge * 100)}%`);
row('文字の大きさ', `${TEXT_SIZE_MIN}〜${TEXT_SIZE_MAX}倍`);
if (new Set([AREA_STROKE, GROUND_STROKE, LINK_STROKE, ARROW_STROKE]).size !== 1) fail('枠・接地・渡り線・矢印の線の太さが、そろっていません');
row('線の太さ（枠・接地・渡り線・矢印）', AREA_STROKE);
row('斜線の太さ', HATCH_STROKE);
row('斜線の間隔', HATCH_GAP);
row('丸い点の半径', DOT_RADIUS);
row('矢印の長さ', `${ARROW_LEN_MIN}〜${ARROW_LEN_MAX}（最初は${ARROW_LEN_DEFAULT}）`);

// 付録A 数の上限
row('受電設備のエリア数', COUNT_LIMITS.areaCount!);
row('変圧器の台数', COUNT_LIMITS.transformerCount!);
row('高圧コンデンサの台数', COUNT_LIMITS.capacitorCount!);
row('PCSの台数', COUNT_LIMITS.pcsCount!);
row('PCSのつなぎ先を入れる欄の数（PCSごとに選ぶ欄・変圧器ごとの台数の欄とも）', PCS_INPUT_MAX);
row('ほかの台数・組数', MAX_COUNT);
row('文字を入れる欄の文字数', MAX_TEXT_LENGTH);
row('パスワードの文字数', numFrom('apps/server/src/password-policy.ts', /MAX_PASSWORD = (\d+)/));
row('追加できるレイヤー', MAX_CUSTOM_LAYERS);
row('レイヤーに置けるもの（種類ごと）', MAX_LAYER_ITEMS_PER_KIND);
row('パスワードをまちがえて止まる回数', numFrom('apps/server/src/auth.ts', /MAX_FAILS = (\d+)/));
row('画像1枚の大きさ（MB）', numFrom('apps/server/src/projects.ts', /MAX_FILE_BYTES = (\d+) \* 1024 \* 1024/));
row('PDFの大きさ（MB）', numFrom('apps/server/src/projects.ts', /MAX_PDF_BYTES = (\d+) \* 1024 \* 1024/));
row('PDFのページ数', numFrom('apps/server/src/analyze.ts', /MAX_PDF_PAGES = (\d+)/));
row('記録ファイル（error.log・server.log）を入れ替える大きさ（MB）', numFrom('apps/server/src/errors.ts', /LOG_MAX_BYTES = (\d+) \* 1024 \* 1024/));
console.log('  レイヤーの寸法・形・上限と、付録Aの数の上限が、プログラムの値と一致');

// README・仕様書に書いてある、記号・質問・構成ルールの件数（増やしたのに、書き直し忘れるのを防ぐ）
{
  const roles = new Set(
    [...UPSTREAM, ...DOWNSTREAM, ...EXTRAS, ...FEEDERS, ...TRANSFORMER, ...AREA_CHAIN, ...PFS_CHAIN, ...CB_CHAIN].map((p) => p.role.replace(/^(pcs|pv)-tr\d+$/, '$1-tr')),
  );
  const want = { 記号: SYMBOLS.length, 質問: QUESTIONS.filter((q) => !q.noAi).length, 構成ルール: roles.size };
  const num = (text: string, re: RegExp) => Number(re.exec(text)?.[1] ?? NaN);
  const checks: [string, string, RegExp, number][] = [
    ['README', readme, /独自SVG (\d+)種/, want.記号],
    ['README', readme, /質問(\d+)件/, want.質問],
    ['README', readme, /構成ルール(\d+)件/, want.構成ルール],
    ['仕様書', spec, /独自SVG (\d+)種/, want.記号],
  ];
  for (const [where, text, re, expected] of checks) {
    const got = num(text, re);
    if (got !== expected) fail(`${where}に書いてある件数（${re.source.replace('(\\d+)', '○')}＝${got}）が、プログラムの値（${expected}）と違います`);
  }
  console.log(`  記号${want.記号}種・質問${want.質問}件・構成ルール${want.構成ルール}件：README・仕様書の数字と一致`);
}

// 付録B 動作を確かめた環境：決めた環境が、すべて載っていること
for (const env of ['パソコンの Chrome（Chromium）', '画面の幅（390〜1440px の6通り）', 'Safari（Mac）', 'Firefox', 'iPhone・iPad の実機', 'Android の実機', 'Windows のパソコン', 'Electron 版（apps/desktop）', 'AI 読み取りの結果の人による確認']) {
  if (!spec.split('\n').some((l) => l.startsWith(`| ${env} |`))) fail(`付録B に「${env}」の行がありません`);
}
// 付録C デバッグの計画：番号が1から13まで、順にそろっていること
const debugNums = spec
  .slice(spec.indexOf('## 付録C'))
  .split('\n')
  .map((l) => /^\| (\d+) \|/.exec(l)?.[1])
  .filter((x): x is string => x !== undefined)
  .map(Number);
if (debugNums.join(',') !== Array.from({ length: 13 }, (_, i) => i + 1).join(',')) fail(`付録C のデバッグ項目が、1〜13 の順になっていません（${debugNums.join(',')}）`);
else console.log('  付録B（確かめた環境）と付録C（デバッグ計画 1〜13）の項目が、そろっている');

console.log(failed === 0 ? '\n✓ 仕様書の数値を確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
