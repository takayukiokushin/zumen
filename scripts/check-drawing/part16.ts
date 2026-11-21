/**
 * 図面の検証（check-drawing）の16個目：構内柱の外づけの避雷器（LA）（第20弾 項目1）。
 * PAS・PGSの二次側から、左へ線を出して、真下に折れ、上から、PC（あれば）、LA、接地の順に縦に並ぶ。
 * PAS内蔵のLAとは、別々に選べる（4通り）。UGSには出さない。
 */
import { fromLayout } from '../../apps/web/src/editor/doc.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { buildComposition, dropHiddenChoices } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { findLabelCollisions, layout } from '../../packages/layout/src/index.ts';
import { PAS_SCALE, getSymbol } from '../../packages/symbols/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 構内柱の外づけの避雷器（LA）：PASの左に縦に並び、PAS内蔵のLAとは別に選べる');
{
  let checked = 0;
  const bad: string[] = [];
  for (const sec of ['pas', 'pgs']) {
    for (const form of ['pfs', 'cb']) {
      for (const builtin of ['yes', 'no']) {
        for (const pc of ['yes', 'no']) {
          const a = dropHiddenChoices({ ...answersSpread, areaCount: '1', mainBreakerForm: form, sectionalizer: sec, pasBuiltinLa: builtin, pasExtLa: 'yes', pasExtLaPc: pc } as Answers);
          const d = layout(buildComposition(a), a);
          const name = `${sec}・${form}・内蔵LA${builtin}・PC${pc}`;
          checked++;
          const pas = d.symbols.find((s) => s.id === 'pas');
          const la = d.symbols.filter((s) => s.id === 'pas-ext-la');
          const pcs = d.symbols.filter((s) => s.id === 'pas-ext-pc');
          if (!pas) {
            bad.push(`${name}：PASがありません`);
            continue;
          }
          const inner = d.symbols.find((x) => x.id === 'pas-la');
          // 内蔵LAは、PASと一緒に60%に縮めた専用の図記号（la-pas。第20弾 項目7）。外づけLAは、ふつうの大きさのLA（la）のまま
          if (inner && la[0]) {
            const bi = getSymbol(inner.symbolId).box;
            const be = getSymbol(la[0].symbolId).box;
            if (inner.symbolId !== 'la-pas' || la[0].symbolId !== 'la' || Math.abs(bi.w - be.w * PAS_SCALE) > 0.01 || Math.abs(bi.h - be.h * PAS_SCALE) > 0.01) bad.push(`${name}：内蔵LA（60%の la-pas）と外づけLA（la）の、図記号・大きさが想定と違います`);
          }
          if (la.length !== 1) bad.push(`${name}：外づけのLAが${la.length}個です`);
          else if (la[0]!.x + 5 >= pas.x) bad.push(`${name}：外づけのLAが、PASの左にありません`);
          else if (la[0]!.y <= pas.y) bad.push(`${name}：外づけのLAが、PASより下にありません`);
          if (pcs.length !== (pc === 'yes' ? 1 : 0)) bad.push(`${name}：PCの数が違います（${pcs.length}個）`);
          else if (pcs[0] && la[0] && !(pcs[0].y < la[0].y)) bad.push(`${name}：PCが、LAの上にありません`);
          // 外づけLA専用のPCは、ふつうのPCを70%に縮めた専用の図記号（pc-pas-la）。変圧器などの手前のPC（pc）は、変えない
          if (pcs[0] && pcs[0].symbolId !== 'pc-pas-la') bad.push(`${name}：外づけLAのPCが、専用の小さいPC（pc-pas-la）ではありません（${pcs[0].symbolId}）`);
          // PASのまわりは狭いので、PCとLAの縦の間隔（つなぐ線の長さ）は、短くしてある（4以下）
          if (pcs[0] && la[0]) {
            const pcd = getSymbol(pcs[0].symbolId);
            const lad = getSymbol(la[0].symbolId);
            const pcOut = pcd.ports.find((p) => p.dir === 'down') ?? pcd.ports[pcd.ports.length - 1]!;
            const gap = la[0].y + lad.ports[0]!.y - (pcs[0].y + pcOut.y);
            if (gap > 4) bad.push(`${name}：PCとLAのあいだが、広すぎます（${Math.round(gap)}）`);
          }
          // 内蔵のLAは、外づけとは別（PASの文字に、「LA内蔵」が、内蔵のときだけ出る）
          const hasText = (pas.label ?? []).some((l: string) => /LA/.test(l));
          if (hasText !== (builtin === 'yes')) bad.push(`${name}：PASの「LA内蔵」の文字が、内蔵LAの答えと合っていません`);
          const doc = fromLayout(d);
          const iss = inspectDrawing(doc, 'A3', 'portrait').filter((i) => ['floating', 'skew', 'through', 'overlap', 'stray'].includes(i.kind));
          if (iss.length > 0) bad.push(`${name}：図面の点検で問題（${iss[0]!.message}）`);
          if (findLabelCollisions(d).length > 0) bad.push(`${name}：文字が重なりました`);
        }
      }
    }
  }
  // 変圧器の手前のPCは、ふつうのPC（pc）のまま（外づけLA専用のPCとは別）
  {
    const t = dropHiddenChoices({ ...answersSpread, areaCount: '1', sectionalizer: 'pas', pasExtLa: 'yes', pasExtLaPc: 'yes', transformerCount: '1', trHasPc: 'yes' } as Answers);
    const dd = layout(buildComposition(t), t);
    const trPc = dd.symbols.find((x) => x.id === 'tr-pc');
    if (!trPc || trPc.symbolId !== 'pc') bad.push(`変圧器の手前のPCが、ふつうのPC（pc）ではありません（${trPc?.symbolId ?? 'なし'}）`);
  }
  // 外づけのLAが無いとき、UGSのとき：何も出ない
  const none = dropHiddenChoices({ ...answersSpread, areaCount: '1', sectionalizer: 'pas', pasExtLa: 'no' } as Answers);
  if (layout(buildComposition(none), none).symbols.some((s) => /^pas-ext/.test(s.id))) bad.push('外づけのLAが「なし」なのに、描かれています');
  const ugs = dropHiddenChoices({ ...answersSpread, areaCount: '1', sectionalizer: 'ugs', pasExtLa: 'yes', pasExtLaPc: 'yes' } as Answers);
  if (layout(buildComposition(ugs), ugs).symbols.some((s) => /^pas-ext/.test(s.id))) bad.push('UGSなのに、外づけのLAが描かれています');
  if (bad.length > 0) fail(`構内柱の外づけのLAに問題が ${bad.length}件あります（例：${bad.slice(0, 3).join(' ／ ')}）`);
  console.log(`  PAS・PGS × 主遮断装置の形式2 × 内蔵LA × PC（${checked}通り）：左に縦に並び、点検の問題・文字の重なりは ${bad.length}件。UGS・「なし」のときは出ない`);
}
