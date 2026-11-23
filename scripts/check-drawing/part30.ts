/**
 * 図面の検証（check-drawing）の30個目：電源切替開閉器（DT）3種類と、スコット変圧器の大小（第20弾・図面再現の診断から）。
 * 「記号を追加」から手で足す記号。DTは、外箱・左右の接点・下の線に、左右の接続点と下の接続点。スコット変圧器は、通常の大きさと、小さい版（約0.77倍）。
 */
import { getSymbol, SYMBOLS } from '../../packages/symbols/src/index.ts';
import { addSymbol } from '../../apps/web/src/editor/doc.ts';
import type { Doc } from '../../apps/web/src/editor/doc.ts';
import { fail } from './common.ts';

console.log('\n■ 電源切替開閉器（DT）・スコット変圧器の大小');
{
  const bad: string[] = [];
  const ids = ['dt', 'dt-r', 'dt-l', 'tr-scott', 'tr-scott-s'];
  for (const id of ids) {
    const d = SYMBOLS.find((x) => x.id === id);
    if (!d) { bad.push(`${id} が、記号の一覧にありません`); continue; }
    if (!d.optional) bad.push(`${id}：入力の画面では使わない記号（optional）になっていません`);
    const added = (addSymbol({ items: [] } as unknown as Doc, id, 0, 0).doc.items.find((i) => i.kind === 'symbol')) as { label: string[] } | undefined;
    if (!added || added.label.every((l) => l.trim() === '')) bad.push(`${id}：足した直後に、文字が何も書かれません`);
  }
  // DT：接続点は、左・右・下の3つ。矢印の数が、3種類で違う（左右の矢印は、あるほうだけ）
  const arrows = (id: string) => getSymbol(id).shapes.filter((s) => s.k === 'poly').length;
  for (const id of ['dt', 'dt-r', 'dt-l']) {
    const d = getSymbol(id);
    const ports = d.ports.map((p) => `${p.id}:${p.dir}`).sort().join(',');
    if (ports !== 'l:left,out:down,r:right') bad.push(`${id}：接続点が、左・右・下になっていません（${ports}）`);
    if (d.shapes.filter((s) => s.k === 'rect').length !== 1) bad.push(`${id}：外箱（四角）が1つではありません`);
    if (!d.labelLines?.includes('電源切替開閉器')) bad.push(`${id}：文字が「電源切替開閉器」ではありません`);
  }
  if (arrows('dt') !== 1 || arrows('dt-r') !== 2 || arrows('dt-l') !== 2) bad.push(`矢印の数が違います（dt ${arrows('dt')}・dt-r ${arrows('dt-r')}・dt-l ${arrows('dt-l')}。下の矢印を含めて 1・2・2 のはず）`);
  // 右・左の矢印は、それぞれ、右の端・左の端にある
  const tipX = (id: string) => getSymbol(id).shapes.filter((s) => s.k === 'poly').map((s) => (s.k === 'poly' ? s.pts[2]! : NaN));
  const w = getSymbol('dt').box.w;
  if (!tipX('dt-r').includes(w) || tipX('dt-r').includes(0)) bad.push('dt-r：右の端に矢印の先がありません');
  if (!tipX('dt-l').includes(0) || tipX('dt-l').includes(w)) bad.push('dt-l：左の端に矢印の先がありません');
  // スコット変圧器：通常と、小さい版。形は同じで、大きさだけ約0.77倍
  const a = getSymbol('tr-scott');
  const b = getSymbol('tr-scott-s');
  const ratio = b.box.w / a.box.w;
  if (Math.abs(ratio - 0.77) > 0.02) bad.push(`スコット変圧器（小）の大きさが、約0.77倍ではありません（${ratio.toFixed(2)}倍）`);
  if (a.shapes.length !== b.shapes.length) bad.push('スコット変圧器の大小で、形（線・円の数）が違います');
  if (a.nameJa !== 'スコット変圧器' || b.nameJa !== 'スコット変圧器（小）') bad.push(`スコット変圧器の名前が違います（${a.nameJa}・${b.nameJa}）`);
  if (bad.length > 0) fail(`DT・スコット変圧器に問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  DT 3種類（左右とも横棒／右に矢印／左に矢印。下は下向きの矢印）、スコット変圧器（通常・小）が、「記号を追加」から足せる');
}
