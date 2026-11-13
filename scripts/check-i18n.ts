/**
 * 画面の言葉（4つの言語への翻訳）の検証。
 *
 * - 辞書（ボタン・案内・メッセージ）の鍵が、5つの言語にそろっている。{名前} の部分も、そろっている。
 * - 質問・選択肢・説明文・記号の名前（data-xx.ts）が、4つの言語に、すべて訳されている。
 * - 訳に、その言語に無い文字（英語・フランス語に日本語、韓国語に日本語・漢字、中国語に仮名）が残っていない。
 *   ただし、図面に印刷される日本語の例（「」の中）は、そのまま残してよい。
 * - サーバーが返す日本語の文が、辞書の型に合う（訳せる）。
 * - 画面の部品に、訳せない日本語が直接書かれていない。
 *
 * 図面に印刷される文字（図面のプレビューと、印刷・PDF）は、日本語のまま。ここでは調べない。
 *
 *   node --experimental-strip-types scripts/check-i18n.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LANGS, dictionaryOf, dataOf, setCurrentLang } from '../apps/web/src/i18n/index.ts';
import { matchTemplate, translateReviewText, translateServerMessage } from '../apps/web/src/session/serverMessages.ts';
import { QUESTIONS, QUESTION_GROUPS } from '../packages/knowledge/src/index.ts';
import { SYMBOLS, CATEGORY_LABEL } from '../packages/symbols/src/index.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

const KANA = /[぀-ヿ]/;
/** 「」の中（図面に印刷される日本語の例）を除く */
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(',');

/**
 * 訳に、その言語に無い文字（日本語）が、日本語の元の文に無い形で残っていないか。
 * 元の文からそのまま写した日本語（図面に印刷される例の「中電柱：」「猪子山（分）81」など）は、残してよい。
 */
/** 図面に印刷される日本語の例そのもの（入力欄の例）。訳さず、そのまま出す */
const SAME_OK = new Set(['第2変電所 / 第2電気室 / 第3キュービクル', '第2変電所 / ○○出先']);

function wrongScript(lang: string, text: string, source: string): string | null {
  if (text === source && SAME_OK.has(source)) return null;
  if (text === source && KANA.test(source)) return '日本語のままです（訳されていません）';
  const runs = text.match(/[\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]+/g) ?? [];
  const bad = runs.filter((r) => !source.includes(r) && !(lang === 'zh' && !KANA.test(r)));
  if (bad.length > 0) return `元の文にない日本語（${bad[0]}）が残っています`;
  if (lang === 'ko' || lang === 'en' || lang === 'fr') {
    // 漢字・仮名が、元の文の写しだけでなく、訳の中心になっていないか（日本語の文字が、訳の半分以上を占めない）
    const jpCount = runs.join('').length;
    if (text.length > 0 && jpCount / text.length > 0.5 && KANA.test(source)) return '日本語の文字が半分以上を占めています';
  }
  return null;
}

console.log('■ 辞書（ボタン・案内・メッセージ）');
const ja = dictionaryOf('ja');
const keys = Object.keys(ja);
console.log(`  日本語の言葉：${keys.length}件`);
for (const lang of LANGS) {
  if (lang === 'ja') continue;
  const d = dictionaryOf(lang);
  let missing = 0;
  let wrong = 0;
  let vmis = 0;
  let same = 0;
  for (const k of keys) {
    const v = d[k] ?? '';
    const absent = d[k] === undefined;
    if ((absent || v === '') && k !== 'project.count') {
      missing++;
      if (missing <= 5) fail(`${lang}：「${k}」に訳がありません`);
      continue;
    }
    const w = wrongScript(lang, v, ja[k]!);
    if (w) {
      wrong++;
      if (wrong <= 5) fail(`${lang}：「${k}」${w}：${v.slice(0, 50)}`);
    }
    if (vars(v) !== vars(ja[k]!)) {
      vmis++;
      if (vmis <= 5) fail(`${lang}：「${k}」の {名前} が日本語と合いません（${vars(ja[k]!)} ／ ${vars(v)}）`);
    }
    if (v === ja[k] && KANA.test(ja[k]!)) same++;
  }
  if (missing > 5) fail(`${lang}：ほか ${missing - 5}件、訳がありません`);
  if (wrong > 5) fail(`${lang}：ほか ${wrong - 5}件、日本語が残っています`);
  console.log(`  ${lang}：訳なし ${missing} / 文字の誤り ${wrong} / {名前}の不一致 ${vmis} / 日本語のまま ${same}`);
}

console.log('\n■ 質問・選択肢・説明文・記号の名前');
const jp = /[぀-ヿ一-鿿]/;
const need = new Set<string>();
const add = (s?: string) => {
  if (s && jp.test(s)) need.add(s);
};
for (const g of QUESTION_GROUPS) {
  add(g.label);
  add(g.description);
  add(g.repeatUnit);
}
for (const q of QUESTIONS) {
  add(q.label);
  add(q.help);
  add(q.placeholder);
  add(q.section);
  add(q.unit);
  for (const o of q.options ?? []) {
    add(o.label);
    add(o.share);
  }
}
for (const v of Object.values(CATEGORY_LABEL)) add(v);
for (const d of SYMBOLS) add(d.abbr);
for (const d of SYMBOLS) {
  add(d.nameJa);
  for (const f of d.fields ?? []) {
    add(f.label);
    add(f.help);
    add(f.unit);
    for (const o of f.options ?? []) add(o.label);
  }
}
console.log(`  訳が要る日本語の文：${need.size}件`);
for (const lang of LANGS) {
  if (lang === 'ja') continue;
  const d = dataOf(lang);
  const missing = [...need].filter((s) => !d[s]);
  const wrong = [...need].filter((s) => d[s] && wrongScript(lang, d[s]!, s));
  // 「なし@yesno」のような、場面で使い分ける訳（質問の選択肢の i18nContext）は、使われているものとして数える
  const stale = Object.keys(d).filter((s) => !need.has(s) && !s.includes('@'));
  if (missing.length > 0) fail(`${lang}：訳が無い文が ${missing.length}件あります（例：${missing.slice(0, 3).join(' / ')}）`);
  if (wrong.length > 0) fail(`${lang}：文字の誤りが ${wrong.length}件あります（例：${wrong[0]} → ${d[wrong[0]!]}）`);
  console.log(`  ${lang}：訳なし ${missing.length} / 文字の誤り ${wrong.length} / 使われていない訳 ${stale.length}`);
}

/* 英語の「Yes／No／None」の使い分け（第13弾 項目52）：
 *   ・「はい／いいえ」「ある／ない」「あり／なし」の2択（「〜はありますか？」への答え）→ Yes／No
 *   ・複数の選択肢の中の1つとしての「なし」→ None */
console.log('\n■ 英語の「Yes／No／None」の使い分け');
{
  const en = dataOf('en');
  const label = (o: { label: string; i18nContext?: string }) => (o.i18nContext ? en[`${o.label}@${o.i18nContext}`] : undefined) ?? en[o.label];
  let n2 = 0;
  let nm = 0;
  for (const q of QUESTIONS) {
    const opts = q.options ?? [];
    if (opts.length === 0) continue;
    const en2 = opts.map(label);
    const isYesNo = opts.length === 2 && opts.every((o) => /^(あり|なし|ある|ない|はい|いいえ)([（(].*)?$/.test(o.label));
    if (isYesNo) {
      n2++;
      // 2択の答えは、「Yes」「No」（「（3点一致）」のような補足が付いてもよい）
      if (!/^Yes\b/.test(en2[0] ?? '') || !/^No\b/.test(en2[1] ?? '')) fail(`英語：2択の「${q.id}」が、Yes／No になっていません（${en2.join(' / ')}）`);
    } else {
      nm++;
      // 複数の選択肢の中の「なし」は、「None」（「なし（母線から直接）」のような補足が付いてもよい）
      for (const o of opts) {
        if (/^なし([（(].*)?$/.test(o.label) && !/^None\b/.test(label(o) ?? '')) fail(`英語：「${q.id}」の「${o.label}」が、None になっていません（${label(o)}）`);
      }
    }
    // 小文字の yes／no／none が、そのまま出ていない
    for (const t of en2) if (/^(yes|no|none)$/.test(t ?? '')) fail(`英語：「${q.id}」の選択肢が小文字のままです（${t}）`);
  }
  console.log(`  Yes／No の2択：${n2}問／複数の選択肢（なし → None）：${nm}問`);
}

console.log('\n■ サーバーが返す日本語の文が、訳せるか');
{
  // 文字列（'…' か `…`）が + でつながっているものは、1つの文として調べる
  const LIT = "(?:'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)";
  const chain = new RegExp(`${LIT}(?:\\s*\\+\\s*${LIT})*`, 'g');
  const unquote = (lit: string) => lit.slice(1, -1);
  const files = ['admin', 'auth', 'projects', 'password-policy', 'security', 'index', 'analyze', 'analyze-errors'];
  let n = 0;
  let miss = 0;
  for (const f of files) {
    const src = readFileSync(`apps/server/src/${f}.ts`, 'utf8');
    for (const m of src.matchAll(chain)) {
      const lits = m[0].match(new RegExp(LIT, 'g')) ?? [];
      let raw = lits.map(unquote).join('');
      if (!jp.test(raw)) continue;
      const before = src.slice(Math.max(0, src.lastIndexOf('\n', m.index)), m.index);
      if (/console\./.test(before)) continue;
      if (!/(error:|Error\(|return\s*$|\(\s*$|^\s*$)/.test(before)) continue;
      if (!/(。|ください)/.test(raw)) continue;
      // 定数（ASK_ADMIN）と ${…} は、文の型に合う形にする
      raw = raw.replace(/\$\{ASK_ADMIN\}/g, '続くときは、管理者に伝えてください。').replace(/\$\{[^}]*\}/g, 'X');
      n++;
      if (!matchTemplate('srv.', raw)) {
        miss++;
        fail(`サーバーの文が、辞書の型（srv.）に合いません：${f}.ts「${raw.slice(0, 40)}…」`);
      }
    }
  }
  console.log(`  調べた文：${n}件 / 合わないもの：${miss}件`);
}

console.log('\n■ 言葉を切り替えたときの動き');
{
  const sample = 'そのIDはすでに使われています: abc-1。別のIDにしてください。';
  const lock = '山田さんが編集中のため保存できません。山田さんの編集が終わるのを待つか、山田さんに連絡してください。';
  setCurrentLang('ja');
  if (translateServerMessage(sample) !== sample) fail('日本語のときに、サーバーの文が変わっています');
  for (const lang of ['en', 'fr', 'zh', 'ko'] as const) {
    setCurrentLang(lang);
    const a = translateServerMessage(sample);
    const b = translateServerMessage(lock);
    const r = translateReviewText('高圧変圧器の合計容量が450kVA（301kVA以上）なので、CB形でなければなりません。');
    const q = translateReviewText('主遮断装置の形式は？');
    if (a === sample || !a.includes('abc-1')) fail(`${lang}：サーバーの文（ID入り）が、訳されて、IDが入っていません：${a}`);
    if (b === lock || !b.includes('山田') || b.includes('さん')) fail(`${lang}：サーバーの文（名前入り）が、訳されていません：${b}`);
    if (!r.includes('450')) fail(`${lang}：確認事項の文が、訳されていません：${r}`);
    if (q === '主遮断装置の形式は？') fail(`${lang}：質問の名前が、訳されていません`);
  }
  setCurrentLang('ja');
  console.log('  日本語のときは、そのまま／4言語では、訳されて、名前・数字が入る');
}

console.log('\n■ 構成の一覧の「種類」の名前');
{
  // 配置の種類（packages/knowledge/src/composition.ts の PlacementKind）が、すべて、辞書にある
  const src = readFileSync('packages/knowledge/src/composition.ts', 'utf8');
  const block = src.slice(src.indexOf('export type PlacementKind ='), src.indexOf('export interface Placement {'));
  const kinds = [...block.matchAll(/\|\s*'([a-z-]+)'/g)].map((m) => m[1]!);
  const lacking = kinds.filter((k) => !(`comp.kind.${k}` in ja));
  if (kinds.length < 10) fail(`配置の種類を読み取れませんでした（${kinds.length}個）`);
  if (lacking.length > 0) fail(`構成の一覧の「種類」の名前が、辞書にありません：${lacking.join('、')}`);
  console.log(`  配置の種類 ${kinds.length}個：辞書に無いもの ${lacking.length}個`);
}

console.log('\n■ 画面の部品に、訳せない日本語が直接書かれていないか');
{
  // 許す：コメント／エラーの投げ込み（開発者向け）／図面に書く文字（注記）／辞書を使わない備え（'件'）
  const ALLOW = [/(addText|addLayerText)\(.*'注記'/, /\?\? '件'/, /throw new Error\(/, /join\('・'\)/, /ROLE_LABEL|admin: '管理用'|member: '標準'|sandbox: '練習用'/];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === 'i18n' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  let n = 0;
  for (const f of walk('apps/web/src')) {
    // 複数行のコメント（/* … */）は、行数を保ったまま空にする
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (!jp.test(code)) return;
      if (ALLOW.some((a) => a.test(code))) return;
      n++;
      fail(`${f}:${i + 1} 日本語が直接書かれています：${line.trim().slice(0, 80)}`);
    });
  }
  console.log(`  直接書かれた日本語：${n}件`);
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
