/**
 * 図面の検証（check-drawing）の21個目：作り直しで斜めになった線を、下側の機器を横に動かして、まっすぐにそろえる（第20弾・案2）。
 * 横のずれが小さいとき（30以下）だけ。大きいずれ・もとから斜めだった線・動かして斜めが増えるときは、そのまま残す。
 */
import { groupRootOf, isHorizontal, isVertical, moveItem } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { ALIGN_MAX, alignSkewedColumns, skewKeys } from '../../apps/web/src/editor/alignSkew.ts';
import { build, fail } from './common.ts';

console.log('\n■ 作り直しで斜めになった線を、まっすぐにそろえる（小さいずれだけ）');
{
  const bad: string[] = [];
  const base = build();
  const skewCount = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire' && !!i.at1 && !!i.at2 && !isVertical(i) && !isHorizontal(i)).length;
  const pos = (d: Doc, id: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === id)!;
  const none = new Set<string>();
  if (skewCount(base) !== 0) bad.push('試験の図面に、もとから斜めの線があります');
  // 試験に使う機器：縦の線で、上の機器につながっていて、横に動かすと斜めになる（上側にぶら下がる葉のような機器）
  let tr: DocSymbol | undefined;
  for (const w of base.items.filter((i): i is DocWire => i.kind === 'wire' && !!i.at1 && !!i.at2 && isVertical(i))) {
    const lowId = groupRootOf(base, w.y1 > w.y2 ? w.at1!.item : w.at2!.item);
    const cand = pos(base, lowId);
    if (!cand || cand.parent) continue;
    const slanted = moveItem(base, cand.id, 12, 0);
    if (skewCount(slanted) === 0) continue;
    if (skewCount(alignSkewedColumns(slanted, none).doc) === 0) { tr = cand; break; }
  }
  if (!tr) {
    fail('斜めの線のそろえ：試験に使える機器が、試験の図面に見つかりません');
  } else {
  const t: DocSymbol = tr;
  // 小さいずれ（12）：まっすぐにそろう。動かすのは、下側の変圧器（上側は動かない）
  for (const dx of [3, 12, ALIGN_MAX, -12]) {
    const slanted = moveItem(base, t.id, dx, 0);
    if (skewCount(slanted) === 0) { bad.push(`横に ${dx} 動かしても、斜めの線ができません（試験が成り立ちません）`); continue; }
    const r = alignSkewedColumns(slanted, none);
    if (skewCount(r.doc) !== 0) bad.push(`横に ${dx} ずれたのに、まっすぐにそろいません`);
    if (Math.abs(pos(r.doc, t.id).x - t.x) > 0.01) bad.push(`横に ${dx} ずれたのに、変圧器が、元の位置（上側の真下）に戻りません`);
    if (!r.moved.includes(t.id)) bad.push(`横に ${dx} ずれたのに、動かした機器の名前に、変圧器が入っていません`);
    // 上側の機器は、動かない
    const upper = base.items.filter((i): i is DocSymbol => i.kind === 'symbol' && !i.parent && i.id !== t.id && i.y < t.y);
    for (const u of upper) if (Math.abs(pos(r.doc, u.id).x - u.x) > 0.01) bad.push(`横に ${dx} ずれたとき、上側の機器（${u.id}）まで動きました`);
  }
  // 大きいずれ（ALIGN_MAX を超える）：そのまま残す
  {
    const slanted = moveItem(base, t.id, ALIGN_MAX + 10, 0);
    const r = alignSkewedColumns(slanted, none);
    if (r.moved.length > 0 || skewCount(r.doc) === 0) bad.push('大きいずれ（30超）が、動かされました（手で大きく動かしたものとして、残すはず）');
  }
  // もとから斜めだった線（作り直す前の図面にあるもの）：そのまま
  {
    const slanted = moveItem(base, t.id, 12, 0);
    const r = alignSkewedColumns(slanted, skewKeys(slanted));
    if (r.moved.length > 0) bad.push('もとから斜めだった線が、動かされました');
  }
  // 何も斜めでなければ、何もしない
  {
    const r = alignSkewedColumns(base, none);
    if (r.doc !== base || r.moved.length > 0) bad.push('斜めの線が無いのに、図面が変わりました');
  }
  }
  if (bad.length > 0) fail(`斜めの線のそろえに問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  else console.log('  横のずれが30以下なら、下側の機器を動かして、まっすぐにそろう（上側は動かない）。30を超えるずれ・もとから斜めの線・斜めが無い図面は、そのまま');
}
