/**
 * 大きな図面を、AI が文字を読める大きさに分ける、割り付けの検査（項目1「解像度が低い」の対策）。AI には頼まない。
 *   ・小さい図面（A4 くらい）・普通の写真は、分けない（これまでどおり）
 *   ・A1・A3 の図面は、文字が読める大きさ（1pt を 2px くらい）に拡大して、縦横に分ける
 *   ・分けた1枚は、AI が縮めない大きさ（長い辺 1500px 以下）で、全体を、すき間なく覆い、つなぎ目は重なる
 *   ・分ける枚数の上限を守る（図が多いほど、1枚あたりを減らす）。1回に送る枚数の上限を超えない
 *   node --experimental-strip-types scripts/check-analyze-tiles.ts
 */
import { AI_EDGE, MAX_SEND_IMAGES, PX_PER_PT, TILE_EDGE, TILE_OVERLAP, planSheet, tilesPerSheet } from '../apps/web/src/analyze/tiles.ts';

let failed = 0;
const fail = (m: string) => {
  console.error(`  NG: ${m}`);
  failed++;
};
console.log('■ 大きな図面を、AI が読める大きさに分ける（割り付け）');

// 用紙の大きさ（pt。横向き）
const SHEETS: Record<string, [number, number]> = { A4: [842, 595], A3: [1191, 842], A2: [1684, 1191], A1: [2384, 1684], A0: [3370, 2384] };

/** 割り付けが、全体を、すき間なく覆っているか（各点が、どれかの1枚に入る）。1枚が大きすぎないか。つなぎ目が重なっているか */
function checkCover(name: string, plan: ReturnType<typeof planSheet>) {
  for (const t of plan.tiles) {
    if (t.w > TILE_EDGE || t.h > TILE_EDGE) fail(`${name}：分けた1枚が大きすぎます（${t.w}×${t.h}px。上限 ${TILE_EDGE}px）`);
    if (t.x < 0 || t.y < 0 || t.x + t.w > plan.width || t.y + t.h > plan.height) fail(`${name}：分けた1枚が、全体からはみ出しています`);
  }
  const step = 7;
  for (let y = 0; y < plan.height; y += step) {
    for (let x = 0; x < plan.width; x += step) {
      if (!plan.tiles.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)) {
        fail(`${name}：全体の ${x},${y} が、どの1枚にも入っていません（すき間）`);
        return;
      }
    }
  }
  // 隣どうしの重なり
  for (const a of plan.tiles) {
    const right = plan.tiles.find((b) => b.row === a.row && b.col === a.col + 1);
    if (right && a.x + a.w - right.x < TILE_OVERLAP - 2) fail(`${name}：横のつなぎ目の重なりが足りません（${a.x + a.w - right.x}px）`);
    const below = plan.tiles.find((b) => b.col === a.col && b.row === a.row + 1);
    if (below && a.y + a.h - below.y < TILE_OVERLAP - 2) fail(`${name}：縦のつなぎ目の重なりが足りません（${a.y + a.h - below.y}px）`);
  }
}

// A4（PDF）：分けない。AI が縮めない大きさに、1枚で
{
  const p = planSheet(...SHEETS.A4!, PX_PER_PT, 12);
  if (p.tiled) fail('A4 の PDF が、分けられています');
  if (Math.max(p.width, p.height) > AI_EDGE) fail(`A4 の PDF の大きさが、AI の見る大きさを超えています（${p.width}×${p.height}）`);
}
// A3・A2・A1・A0（PDF）：拡大して分ける。文字が読める大きさ（1pt に 1.4px 以上）を保つ
for (const k of ['A3', 'A2', 'A1', 'A0']) {
  const [w, h] = SHEETS[k]!;
  const p = planSheet(w, h, PX_PER_PT, 12);
  if (!p.tiled) fail(`${k} の PDF が、分けられていません`);
  if (p.tiles.length > 12) fail(`${k}：分けた枚数が上限を超えています（${p.tiles.length}枚）`);
  if (p.scale < 1.4) fail(`${k}：拡大が足りません（1pt あたり ${p.scale.toFixed(2)}px。文字が読めない）`);
  if (Math.abs(p.overviewScale - AI_EDGE / Math.max(w, h)) > 1e-9) fail(`${k}：全体の縮小図の倍率が、長い辺 ${AI_EDGE}px になっていません`);
  checkCover(k, p);
  console.log(`  ${k}：${p.tiles[0]?.cols}列×${p.tiles[0]?.rows}段＝${p.tiles.length}枚（1pt を ${p.scale.toFixed(2)}px で描く）`);
}
// A1：図が多いときは、1枚あたりの枚数を減らす
for (const sheets of [1, 2, 3, 5, 6, 10, 11]) {
  const per = tilesPerSheet(sheets);
  const p = planSheet(...SHEETS.A1!, PX_PER_PT, per);
  const total = sheets * (p.tiled ? p.tiles.length + 1 : 1);
  if (total > MAX_SEND_IMAGES) fail(`A1 が ${sheets} 枚：送る画像が ${total} 枚になり、上限 ${MAX_SEND_IMAGES} を超えます`);
  if (p.tiled) checkCover(`A1×${sheets}`, p);
  if (per === 1 && p.tiled) fail('分けてよい枚数が1のとき、分けられています');
}
// 写真・スキャン（画像）：そのままの大きさまで。小さいものは分けない
{
  const small = planSheet(1400, 989, 1, 12);
  if (small.tiled) fail('1400×989px の画像が、分けられています');
  const big = planSheet(6000, 4000, 1, 12);
  if (!big.tiled || big.tiles.length > 12) fail(`6000×4000px の画像の分け方が、おかしいです（${big.tiles.length}枚）`);
  checkCover('6000×4000px', big);
  const huge = planSheet(12000, 9000, 1, 12);
  if (huge.tiles.length > 12) fail('12000×9000px の画像が、上限の枚数を超えて分けられています');
  checkCover('12000×9000px', huge);
  // 分けない設定（枚数の上限が1）：全体を1枚に縮める
  const one = planSheet(6000, 4000, 1, 1);
  if (one.tiled || Math.max(one.width, one.height) > AI_EDGE) fail('枚数の上限が1のとき、全体が1枚に縮められていません');
}
// 極端な形（細長い図）
{
  const strip = planSheet(8000, 400, 1, 12);
  checkCover('8000×400px', strip);
  if (strip.tiles.length > 12) fail('細長い画像の枚数が、上限を超えています');
}

if (failed === 0) console.log('\n✓ 大きな図面は、文字が読める大きさに、すき間なく分かれます（小さい図面は、分けません）');
else console.error(`\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
