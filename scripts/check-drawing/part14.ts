/**
 * 図面の検証（check-drawing）の14個目：図面で直した内容を、入力に書き戻す（第13弾 項目1）。
 * 「記号の差し替え→結線方式」「文字の書き換え→容量」「あり／なし」「最後の台の足し引き」を書き戻す。
 * 「位置を動かしただけ」「ほかの記号も変わってしまう変更」は、書き戻さず、図面にだけ残す。
 */
import { addSymbol, removeItem, replaceSymbol, setLabel, moveItem, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol } from '../../apps/web/src/editor/doc.ts';
import { buildGenerated, writeBack } from '../../apps/web/src/editor/writeback.ts';
import { normalizeAnswers, QUESTIONS, withAutoValues } from '../../packages/knowledge/src/index.ts';
import type { Answers, Value } from '../../packages/knowledge/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 図面で直した内容を、入力に書き戻す');
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const raw: Answers = {
    ...answersSpread,
    transformerCount: 2,
    trUsage: '動力',
    trConnection: 'tr-3p-dy',
    trConnection__2: 'tr-3p-dy',
    trCapacity: 300,
    trCapacity__2: 300,
    trVoltage: '6600/210V',
    trVoltage__2: '6600/210V',
    hasCapacitor: 'no',
    hasPv: 'no',
    hasGenerator: 'no',
    hasLa: 'yes',
  };
  const fresh = (): Doc => buildGenerated(toEff(raw));
  const edited = (d: Doc): Doc => ({ ...d, edited: true });
  const sym = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const ok = (cond: boolean, msg: string) => (cond ? undefined : fail(msg));

  // 0. 手で直していないときは、何もしない
  ok(writeBack(raw, fresh(), toEff) === null, '手で直していない図面で、書き戻しが動いています');

  // 1. 変圧器の記号を差し替える → 結線方式
  {
    const d0 = fresh();
    const t1 = sym(d0, 'transformer')!;
    const r = writeBack(raw, edited(replaceSymbol(d0, t1.id, 'tr-3p-yd')), toEff);
    ok(r !== null && r.answers.trConnection === 'tr-3p-yd', `1台目を差し替えても、結線方式が変わっていません（${r?.answers.trConnection}）`);
    ok(r?.answers.trConnection__2 === 'tr-3p-dy', '1台目の差し替えで、2台目の結線方式まで変わっています');
    ok(r?.applied.some((a) => a.question === '結線方式' && a.unit === 0) === true, '書き戻した内容の知らせに、結線方式が出ていません');
    ok(sym(r!.doc, 'transformer')?.symbolId === 'tr-3p-yd', '書き戻したあとの図面で、1台目が差し替えたままになっていません');
    ok(sym(r!.doc, 'transformer-2')?.symbolId === 'tr-3p-dy', '書き戻したあとの図面で、2台目が変わっています');
    ok(!(r!.leftovers.some((l) => l.kind === 'replaced')), '書き戻したのに、「差し替えたもの」が図面にだけ残っています');
    // 書き戻したあとにもう一度やっても、何も起きない（同じ答え・同じ図面）
    const again = writeBack(r!.answers, r!.doc, toEff);
    ok(again === null || again.applied.length === 0, '書き戻したあと、もう一度やると、また書き戻しています');
  }

  // 2. 2台目の差し替え → 2台目の結線方式
  {
    const d0 = fresh();
    const t2 = sym(d0, 'transformer-2')!;
    const r = writeBack(raw, edited(replaceSymbol(d0, t2.id, 'tr-3p-dd')), toEff);
    ok(r?.answers.trConnection__2 === 'tr-3p-dd' && r.answers.trConnection === 'tr-3p-dy', `2台目の差し替えが、2台目の結線方式に入っていません（${r?.answers.trConnection__2}）`);
    ok(r?.applied.some((a) => a.unit === 2) === true, '2台目と分かる知らせが出ていません');
  }

  // 3. 三巻線変圧器への差し替え
  {
    const d0 = fresh();
    const r = writeBack(raw, edited(replaceSymbol(d0, sym(d0, 'transformer')!.id, 'tr-3w-yyd')), toEff);
    ok(r?.answers.trConnection === 'tr-3w-yyd', '三巻線変圧器への差し替えが、結線方式に入っていません');
  }

  // 4. 文字の書き換え：容量
  {
    const d0 = fresh();
    const t1 = sym(d0, 'transformer')!;
    const lines = t1.label.map((l) => (/kVA$/.test(l) ? '3φ500kVA' : l));
    const r = writeBack(raw, edited(setLabel(d0, t1.id, lines)), toEff);
    ok(r?.answers.trCapacity === 500, `容量の書き換えが、入力に入っていません（${r?.answers.trCapacity}）`);
    ok(r?.answers.trCapacity__2 === 300, '1台目の容量の書き換えで、2台目の容量が変わっています');
    ok(sym(r!.doc, 'transformer')?.label.join('|') === lines.join('|'), '書き戻したあとの図面の文字が、書き換えたとおりになっていません');
    // 電圧・用途
    const l2 = t1.label.map((l) => (l.includes('/') ? '6600/105V' : l === '動力' ? '電灯・動力' : l));
    const r2 = writeBack(raw, edited(setLabel(d0, t1.id, l2)), toEff);
    ok(r2?.answers.trVoltage === '6600/105V' && r2.answers.trUsage === '電灯・動力', `電圧・用途の書き換えが、入力に入っていません（${r2?.answers.trVoltage}／${r2?.answers.trUsage}）`);
  }

  // 5. 書き方が決まりに合わない文字は、書き戻さない（図面にだけ残す）
  {
    const d0 = fresh();
    const t1 = sym(d0, 'transformer')!;
    const r = writeBack(raw, edited(setLabel(d0, t1.id, ['動力', 'Tr', '約300kVA（仮）'])), toEff);
    ok(r !== null && r.applied.length === 0 && r.answers.trCapacity === 300, '決まりに合わない文字を、入力に書き戻しています');
    ok(sym(r!.doc, 'transformer')?.label.join('|') === '動力|Tr|約300kVA（仮）', '書き戻さなかった文字が、図面から消えています');
    ok(r!.leftovers.some((l) => l.kind === 'relabel'), '書き戻さなかった文字が、「図面にだけ残るもの」に出ていません');
  }

  // 6. 「あり／なし」：LAを消す → なし、足す → あり
  {
    const d0 = fresh();
    const la = sym(d0, 'site-la')!;
    const r = writeBack(raw, edited(removeItem(d0, la.id)), toEff);
    ok(r?.answers.hasLa === 'no', `LAを消しても、「LAなし」になっていません（${r?.answers.hasLa}／${JSON.stringify(r?.rejected)}）`);
    ok(r !== null && sym(r.doc, 'site-la') === undefined, '書き戻したあとの図面に、消したLAが戻っています');
    // 足す：LAなしの図面に、LAを足す
    const raw2: Answers = { ...raw, hasLa: 'no' };
    const d1 = buildGenerated(toEff(raw2));
    const r2 = writeBack(raw2, edited(addSymbol(d1, 'la', 40, 40).doc), toEff);
    ok(r2?.answers.hasLa === 'yes', `LAを足しても、「LAあり」になっていません（${r2?.answers.hasLa}／${JSON.stringify(r2?.rejected)}）`);
    ok(r2 !== null && sym(r2.doc, 'site-la') !== undefined, '書き戻したあとの図面に、LAが出ていません');
    ok(r2 !== null && r2.doc.items.filter((i) => i.kind === 'symbol' && sameName(i.id) === 'site-la').length === 1 && r2.doc.items.filter((i) => i.kind === 'symbol' && i.symbolId === 'la').length === 2, 'LAが増えすぎています（PAS内蔵のLAと、手で足したものが重なっている）（手で足したものと、自動で出たものが重なっている）');
  }

  // 7. 台数：最後の台を消す → 台数を1つ減らす。最初の台を消しても、書き戻さない
  {
    const d0 = fresh();
    const r = writeBack(raw, edited(removeItem(d0, sym(d0, 'transformer-2')!.id)), toEff);
    ok(Number(r?.answers.transformerCount) === 1, `最後の台を消しても、台数が減っていません（${r?.answers.transformerCount}／${JSON.stringify(r?.rejected)}）`);
    ok(r !== null && sym(r.doc, 'transformer-2') === undefined && sym(r.doc, 'transformer') !== undefined, '書き戻したあとの図面の、変圧器の数が違います');
    const first = writeBack(raw, edited(removeItem(d0, sym(d0, 'transformer')!.id)), toEff);
    ok(first !== null && Number(first.answers.transformerCount) === 2, '最初の台を消したのに、台数を減らしています（どの台か決められない）');
    ok(first !== null && first.leftovers.some((l) => l.kind === 'removed'), '書き戻さなかった「消した記号」が、図面にだけ残るものに出ていません');
  }

  // 8. 台数：変圧器を1台足す → 台数を増やし、足した台の結線方式も入る
  {
    const d0 = fresh();
    const r = writeBack(raw, edited(addSymbol(d0, 'tr-3p-yd', 40, 40).doc), toEff);
    ok(Number(r?.answers.transformerCount) === 3, `変圧器を足しても、台数が増えていません（${r?.answers.transformerCount}／${JSON.stringify(r?.rejected)}）`);
    ok(r?.answers.trConnection__3 === 'tr-3p-yd', `足した変圧器の結線方式が入っていません（${r?.answers.trConnection__3}）`);
    ok(r !== null && r.doc.items.filter((i) => i.kind === 'symbol' && sameName(i.id).startsWith('transformer')).length === 3, '書き戻したあとの図面の、変圧器の数が違います');
  }

  // 9. 位置を動かしただけ：書き戻さず、図面にだけ残る
  {
    const d0 = fresh();
    const r = writeBack(raw, edited(moveItem(d0, sym(d0, 'transformer')!.id, 30, 20)), toEff);
    ok(r !== null && r.applied.length === 0 && JSON.stringify(r.answers) === JSON.stringify(raw), '位置を動かしただけで、入力が変わっています');
    ok(r !== null && r.leftovers.some((l) => l.kind === 'moved'), '位置の変更が、「図面にだけ残るもの」に出ていません');
  }

  // 10. 消すと、ほかの記号まで変わってしまうものは、書き戻さない（VT：ds-vt-pf と ds-vt はセットで出る）
  {
    const d0 = fresh();
    const names = d0.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => sameName(i.id));
    const vt = names.find((n) => /vt/.test(n));
    if (vt) {
      const r = writeBack(raw, edited(removeItem(d0, sym(d0, vt)!.id)), toEff);
      ok(r !== null, `${vt}を消した図面で、書き戻しの判断が返っていません`);
      if (r) {
        // 書き戻した場合は、それ以外の記号が、変わっていないこと
        const before = names.filter((n) => n !== vt).sort().join(',');
        const after = r.doc.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => sameName(i.id)).filter((n) => n !== vt).sort().join(',');
        ok(before === after, `${vt}を消したら、ほかの記号まで変わりました（書き戻しの確かめが効いていません）`);
      }
    }
  }
  console.log('  差し替え・文字・あり／なし・台数を書き戻す／位置だけ・決まりに合わない文字・ほかの記号も変わるものは書き戻さない');
}
