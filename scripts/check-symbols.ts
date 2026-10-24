/**
 * 記号の描き方の検査。
 *
 * 主回路の線（リード）が、丸や四角の中を突き抜けていないかを調べる。
 * 突き抜けていると、図面を見たときに「線が記号を貫通している」ように見えて汚い。
 *
 * 記号の意味として中に描いてある印（変圧器のΔ・Y、ZCTの斜線など）は
 * 突き抜けではないので、ALLOWED に挙げて除いてある。
 *
 *   node --experimental-strip-types scripts/check-symbols.ts
 */
import { SYMBOLS } from '../packages/symbols/src/index.ts';
import type { Shape } from '../packages/symbols/src/shape.ts';

let failed = 0;
const fail = (msg: string) => {
  console.error(`  NG: ${msg}`);
  failed++;
};

/**
 * 「中に線があってよい」丸。記号の意味としてそう描くもの。
 *   記号ID → その丸の中心（cx,cy）の一覧
 */
const ALLOWED: Record<string, string[]> = {
  // 変圧器は、丸の中に結線（Δ・Y・V・単相の巻線）を描くのが決まり
  ...Object.fromEntries(
    SYMBOLS.filter((d) => d.id.startsWith('tr-')).map((d) => [d.id, ['*']]),
  ),
  // 丸の中に貫通する一次導体や文字を描く記号
  zct: ['*'],
  ct: ['*'],
  vct: ['*'],
  'ct-test': ['*'],
  generator: ['*'],
  motor: ['*'],
  // 電柱は、丸の中に斜線を引いて塗りつぶしを表す
  'pole-utility': ['*'],
  'pole-customer': ['*'],
  'pole-shared': ['*'],
};

/** 線分と円の重なり。円の内部をはっきり通っていれば true */
function crossesCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, r: number,
): boolean {
  // 円のふちギリギリは「接している」だけなので、少し内側で判定する
  const inner = r - 0.6;
  if (inner <= 0) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  // 線分上で、円の中心にいちばん近い点
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const dist = Math.hypot(px - cx, py - cy);
  if (dist >= inner) return false;
  // 両端とも円の外なら「突き抜け」、片端が中なら「食い込み」。どちらも直したい
  return true;
}

/** 図形から、まっすぐな線分を取り出す */
function segmentsOf(s: Shape): [number, number, number, number][] {
  if (s.k === 'line') return [[s.x1, s.y1, s.x2, s.y2]];
  return [];
}

console.log('■ 記号の線が丸を突き抜けていないか');
let checked = 0;
for (const def of SYMBOLS) {
  const circles = def.shapes.filter((s): s is Extract<Shape, { k: 'circle' }> => s.k === 'circle');
  if (circles.length === 0) continue;
  const allow = ALLOWED[def.id];
  for (const c of circles) {
    if (allow && (allow.includes('*') || allow.includes(`${c.cx},${c.cy}`))) continue;
    for (const s of def.shapes) {
      for (const [x1, y1, x2, y2] of segmentsOf(s)) {
        checked++;
        if (crossesCircle(x1, y1, x2, y2, c.cx, c.cy, c.r)) {
          fail(
            `${def.id}（${def.nameJa}）：線 (${x1},${y1})-(${x2},${y2}) が ` +
              `丸 (${c.cx},${c.cy}) r=${c.r} の中を通っています`,
          );
        }
      }
    }
  }
}
console.log(`  記号 ${SYMBOLS.length}種類 / 線と丸の組み合わせ ${checked}通りを調べました`);

/* ---------- 丸の中の文字が、丸からはみ出していないか ---------- */
console.log('\n■ 丸の中の文字が、丸からはみ出していないか');
{
  // 文字の大きさの見積もり。1文字の幅は字の大きさの約0.58、高さは約0.72
  const CHAR_W = 0.58;
  const CHAR_H = 0.72;
  let seen = 0;
  for (const def of SYMBOLS) {
    const circles = def.shapes.filter((s): s is Extract<Shape, { k: 'circle' }> => s.k === 'circle');
    const texts = def.shapes.filter((s): s is Extract<Shape, { k: 'text' }> => s.k === 'text');
    for (const t of texts) {
      const size = t.size ?? 9;
      const hw = (t.s.length * size * CHAR_W) / 2;
      const hh = (size * CHAR_H) / 2;
      for (const c of circles) {
        // 丸の中に置いた文字だけを見る（外に添えた文字は対象外）
        if (Math.hypot(t.x - c.cx, t.y - c.cy) >= c.r) continue;
        seen++;
        let worst = 0;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            worst = Math.max(worst, Math.hypot(t.x + sx * hw - c.cx, t.y + sy * hh - c.cy));
          }
        }
        if (worst > c.r) {
          fail(
            `${def.id}（${def.nameJa}）：文字「${t.s}」が丸 (${c.cx},${c.cy}) r=${c.r} から ` +
              `${(worst - c.r).toFixed(1)} はみ出しています`,
          );
        }
      }
    }
  }
  console.log(`  丸の中の文字 ${seen}箇所を調べました`);
}

/* ---------- 丸の中に引いた飾りの線が、丸からはみ出していないか ---------- */
console.log('\n■ 丸の中の斜線などが、丸からはみ出していないか');
{
  let seen = 0;
  for (const def of SYMBOLS) {
    const circles = def.shapes.filter((s): s is Extract<Shape, { k: 'circle' }> => s.k === 'circle');
    if (circles.length === 0) continue;
    /** 接続点につながっている線は主回路なので、丸を突き抜けてよい */
    const atPort = (x: number, y: number) => def.ports.some((p) => Math.hypot(p.x - x, p.y - y) <= 1);
    for (const c of circles) {
      for (const sh of def.shapes) {
        if (sh.k !== 'line') continue;
        if (atPort(sh.x1, sh.y1) || atPort(sh.x2, sh.y2)) continue;
        // 丸の中心のそばを通る線だけを「中に描いた飾り」とみなす
        const dx = sh.x2 - sh.x1;
        const dy = sh.y2 - sh.y1;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((c.cx - sh.x1) * dx + (c.cy - sh.y1) * dy) / len2));
        if (Math.hypot(sh.x1 + t * dx - c.cx, sh.y1 + t * dy - c.cy) >= c.r / 2) continue;
        seen++;
        const out = Math.max(
          Math.hypot(sh.x1 - c.cx, sh.y1 - c.cy),
          Math.hypot(sh.x2 - c.cx, sh.y2 - c.cy),
        );
        // ふちにぴたりと届いているのは、塗りつぶしの斜線などで正しい
        if (out > c.r + 0.05) {
          fail(
            `${def.id}（${def.nameJa}）：線 (${sh.x1},${sh.y1})-(${sh.x2},${sh.y2}) が ` +
              `丸 (${c.cx},${c.cy}) r=${c.r} から ${(out - c.r).toFixed(1)} はみ出しています`,
          );
        }
      }
    }
  }
  console.log(`  丸の中に描いた線 ${seen}本を調べました`);
}

console.log(failed === 0 ? '\n✓ すべて確認できました' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
