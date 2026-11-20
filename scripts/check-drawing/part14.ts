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

  // 7. 台数：最後の台を消す → 台数を1つ減らす。最初の台を消したときも、台数を減らし、残りの台の答えを前へつめる（以前は、書き戻さなかった）
  {
    const d0 = fresh();
    const r = writeBack(raw, edited(removeItem(d0, sym(d0, 'transformer-2')!.id)), toEff);
    ok(Number(r?.answers.transformerCount) === 1, `最後の台を消しても、台数が減っていません（${r?.answers.transformerCount}／${JSON.stringify(r?.rejected)}）`);
    ok(r !== null && sym(r.doc, 'transformer-2') === undefined && sym(r.doc, 'transformer') !== undefined, '書き戻したあとの図面の、変圧器の数が違います');
    const first = writeBack(raw, edited(removeItem(d0, sym(d0, 'transformer')!.id)), toEff);
    ok(first !== null && Number(first.answers.transformerCount) === 1, `最初の台を消しても、台数が減っていません（${first?.answers.transformerCount}）`);
    ok(first !== null && !first.leftovers.some((l) => l.kind === 'removed'), '書き戻したのに、「消した記号」が図面にだけ残っています');
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

/* 入力の質問ではない、答えから自動で決まる目印（hasPas など）には、書き戻さない（第17弾 項目7の調査5）：
   図面で区分開閉器（PAS）を消しても、入力の「区分開閉器」は、PASのまま変わらず、書き戻した、という知らせだけが出ていた */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const raw: Answers = { ...answersSpread, areaCount: '1', sectionalizer: 'pas' };
  const d0 = buildGenerated(toEff(raw));
  const pas = d0.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === 'pas');
  if (!pas) fail('区分開閉器（PAS）が、自動の図面にありません');
  else {
    const r = writeBack(raw, { ...removeItem(d0, pas.id), edited: true }, toEff);
    const names = (d: Doc) => new Set(d.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => sameName(i.id)));
    if (!r || r.answers.sectionalizer !== 'none') fail(`図面で区分開閉器（PAS）を消したのに、入力が「区分開閉器：なし」になっていません（${r?.answers.sectionalizer}／${JSON.stringify(r?.rejected)}）`);
    else if (!r.applied.some((a) => a.to === 'なし' || /なし/.test(a.to))) fail('書き戻した内容の知らせに、区分開閉器が出ていません');
    else {
      // 「なし」にすると自動で増える部品（地上キャビネット・DS・分界点の安全装置）は、図面に出さない（消したまま。必要なら、手で足す）
      const auto = names(buildGenerated(toEff(r.answers)));
      const grew = [...auto].filter((n) => !names(d0).has(n));
      const shown = grew.filter((n) => names(r.doc).has(n));
      if (grew.length === 0) fail('区分開閉器を「なし」にしても、自動で増える部品がありません（検査の前提が変わりました）');
      else if (shown.length > 0) fail(`区分開閉器を消したら、描いていない部品が図面に出ました（${shown.join('・')}）`);
      else if (names(r.doc).has('pas')) fail('書き戻したあとの図面に、区分開閉器が残っています');
      else if (!names(r.doc).has('transformer')) fail('区分開閉器を消したら、ほかの記号まで消えました');
      else console.log(`  図面で区分開閉器（PAS）を消す → 入力が「区分開閉器：なし」になる。自動で増える部品（${grew.join('・')}）は、図面に出さず、消したままにする`);
    }
  }
}

/* 2か所目以降のエリアの部品を消しても、入力（そのエリアの答え）に書き戻す（第18弾 追加）：
   これまでは、部品の名前に「a2:」が付くため、書き戻しの対象にならなかった */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const raw: Answers = {
    ...answersSpread,
    areaCount: '2',
    transformerCount: 1,
    hasCapacitor: 'no',
    hasPv: 'no',
    hasGenerator: 'no',
    'a2:transformerCount': 2,
    'a2:trConnection': 'tr-3p-dy',
    'a2:trConnection__2': 'tr-3p-dy',
    'a2:hasCapacitor': 'yes',
    'a2:capacitorCount': 1,
    'a2:hasLa': 'yes',
  };
  const d0 = buildGenerated(toEff(raw));
  const find = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const namesOf = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol').map((i) => sameName(i.id)).sort().join(',');
  // 2か所目の、最後の変圧器を消す → 2か所目の台数が減る（1か所目は変わらない）
  const t2 = find(d0, 'a2:transformer-2');
  if (!t2) fail('2か所目の2台目の変圧器が、自動の図面にありません');
  else {
    const r = writeBack(raw, { ...removeItem(d0, t2.id), edited: true }, toEff);
    if (!r || Number(r.answers['a2:transformerCount']) !== 1) fail(`2か所目の最後の変圧器を消しても、2か所目の台数が減っていません（${r?.answers['a2:transformerCount']}）`);
    else if (Number(r.answers.transformerCount) !== 1) fail('2か所目の変圧器を消したら、1か所目の台数が変わりました');
    else if (!r.applied.some((a) => a.area === 1)) fail('書き戻した内容の知らせに、2か所目であることが出ていません');
    else if (find(r.doc, 'a2:transformer-2')) fail('書き戻したあとの図面に、消した変圧器が残っています');
    else console.log('  2か所目の変圧器を消す → 2か所目の台数が減る（1か所目は変わらない）');
  }
  // 2か所目のコンデンサを消す → 2か所目のコンデンサが「なし」になる（1か所目は変わらない）
  const cap = find(d0, 'a2:capacitor');
  if (!cap) fail('2か所目のコンデンサが、自動の図面にありません');
  else {
    const r = writeBack(raw, { ...removeItem(d0, cap.id), edited: true }, toEff);
    if (!r || r.answers['a2:hasCapacitor'] !== 'no') fail(`2か所目のコンデンサを消しても、入力が「なし」になっていません（${r?.answers['a2:hasCapacitor']}）`);
    else if (r.answers.hasCapacitor !== 'no') fail('2か所目のコンデンサを消したら、1か所目の入力が変わりました');
    else if (namesOf(buildGenerated(toEff(r.answers))).split(',').filter((n) => !/capacitor/.test(n)).join(',') !== namesOf(d0).split(',').filter((n) => !/capacitor/.test(n)).join(',')) fail('2か所目のコンデンサを消したら、ほかの記号まで変わりました');
    else console.log('  2か所目のコンデンサを消す → 2か所目の「コンデンサ」が「なし」になる（ほかは変わらない）');
  }
}

/* 途中の台を消したとき：後ろの台の答えが、1つずつ前へつまる（第18弾 追加）。手で動かした位置・接続元の参照も、つめた番号についていく */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const raw: Answers = {
    ...answersSpread,
    areaCount: '1',
    transformerCount: 3,
    trUsage: '動力',
    trUsage__2: '電灯',
    trUsage__3: '空調',
    trConnection: 'tr-3p-dy',
    trConnection__2: 'tr-3p-dy',
    trConnection__3: 'tr-3p-dy',
    trCapacity: 300,
    trCapacity__2: 500,
    trCapacity__3: 750,
    trVoltage: '6600/210V',
    trVoltage__2: '6600/210V',
    trVoltage__3: '6600/210V',
    hasCapacitor: 'no',
    hasPv: 'no',
    hasGenerator: 'no',
  };
  const d0 = buildGenerated(toEff(raw));
  const find = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const t2 = find(d0, 'transformer-2');
  const t3 = find(d0, 'transformer-3');
  if (!t2 || !t3) fail('変圧器が3台の図面に、2台目・3台目がありません');
  else {
    // 3台目を、手で動かしてから、2台目を消す
    const moved = moveItem(d0, t3.id, 12, 8);
    const r = writeBack(raw, { ...removeItem(moved, t2.id), edited: true }, toEff);
    if (!r) fail('途中の変圧器（2台目）を消しても、書き戻しが動いていません');
    else {
      const a = r.answers;
      if (Number(a.transformerCount) !== 2) fail(`2台目を消したのに、台数が2台になっていません（${a.transformerCount}）`);
      else if (a.trCapacity !== 300 || a.trCapacity__2 !== 750) fail(`2台目を消したら、3台目の容量が2台目へつまるはずが、違います（${a.trCapacity}・${a.trCapacity__2}）`);
      else if (a.trUsage !== '動力' || a.trUsage__2 !== '空調') fail(`2台目を消したら、3台目の用途が2台目へつまるはずが、違います（${a.trUsage}・${a.trUsage__2}）`);
      else {
        const after = r.doc;
        const n2 = find(after, 'transformer-2');
        const n3 = find(after, 'transformer-3');
        const g = buildGenerated(toEff(a));
        const g2 = find(g, 'transformer-2');
        if (n3) fail('書き戻したあとの図面に、3台目が残っています');
        else if (!n2 || !g2) fail('書き戻したあとの図面に、2台目（つめた台）がありません');
        else if (Math.abs(n2.x - (g2.x + 12)) > 2 || Math.abs(n2.y - (g2.y + 8)) > 2) fail(`手で動かした3台目の位置が、つめた2台目に引き継がれていません（ずれ ${Math.round(n2.x - g2.x)}・${Math.round(n2.y - g2.y)}。動かしたのは 12・8）`);
        else if (r.leftovers.some((l) => l.kind === 'removed')) fail('書き戻したのに、「消した記号」が図面にだけ残っています');
        else console.log('  途中の変圧器（2台目）を消す → 台数が減り、3台目の答え（容量・用途）が2台目へつまる。手で動かした位置も、ついていく');
      }
    }
  }
  // 1台目を消す（先頭）：2台目・3台目が、1台目・2台目になる
  const t1 = find(d0, 'transformer');
  if (t1) {
    const r = writeBack(raw, { ...removeItem(d0, t1.id), edited: true }, toEff);
    if (!r || Number(r.answers.transformerCount) !== 2 || r.answers.trCapacity !== 500 || r.answers.trCapacity__2 !== 750) fail(`1台目を消したら、2台目・3台目の答えが前へつまるはずが、違います（${r?.answers.transformerCount}・${r?.answers.trCapacity}・${r?.answers.trCapacity__2}）`);
    else console.log('  先頭の変圧器（1台目）を消す → 2台目・3台目の答えが、1台目・2台目へつまる');
  }
}

/* 台のまわりの部品（PC・LBS・ケーブルの端末・ケーブル前後の開閉器）を消したとき、その台の答えに書き戻す（第18弾 追加） */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const unit = (u: number): Answers => {
    const k = (id: string) => (u === 0 ? id : `${id}__${u + 1}`);
    return {
      [k('trConnection')]: 'tr-3p-dy',
      [k('trCapacity')]: 300,
      [k('trVoltage')]: '6600/210V',
      [k('trHasPc')]: 'yes',
      [k('trHasLbs')]: 'yes',
      [k('trHasCable')]: 'yes',
      [k('trCableUp1')]: 'ds',
      [k('trCableUp2')]: 'vcb',
      [k('trCableUp3')]: 'lbs',
      [k('trCableDn1')]: 'lbs',
      [k('trCableInstallation')]: 'buried',
      [k('trCableStructure')]: 'CVT',
    };
  };
  const raw: Answers = { ...answersSpread, areaCount: '1', transformerCount: 2, hasCapacitor: 'no', hasPv: 'no', hasGenerator: 'no', ...unit(0), ...unit(1) };
  const d0 = buildGenerated(toEff(raw));
  const find = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const del = (d: Doc, ...names: string[]) => {
    let cur = d;
    for (const n of names) {
      const s = find(cur, n);
      if (!s) {
        fail(`図面に ${n} がありません（検査の前提が崩れています）`);
        return null;
      }
      cur = removeItem(cur, s.id);
    }
    return { ...cur, edited: true };
  };
  const count = (d: Doc) => d.items.filter((i) => i.kind === 'symbol').length;

  // 2台目のPCを消す → 2台目の「PC」だけ「なし」
  {
    const d = del(d0, 'tr-pc-2');
    const r = d && writeBack(raw, d, toEff);
    if (!r || r.answers.trHasPc__2 !== 'no') fail(`2台目のPCを消しても、2台目の「PC」が「なし」になっていません（${r?.answers.trHasPc__2}／${JSON.stringify(r?.rejected)}）`);
    else if (r.answers.trHasPc !== 'yes') fail('2台目のPCを消したら、1台目のPCまで変わりました');
    else if (count(buildGenerated(toEff(r.answers))) !== count(d0) - 1) fail('2台目のPCを消したら、PC以外の記号まで変わりました');
    else console.log('  2台目のPCを消す → 2台目の「PC」だけが「なし」になる');
  }
  // ケーブルの手前の開閉器（2つ目）を消す → 3つ目が2つ目へつまる
  {
    const d = del(d0, 'tr-cable-up2');
    const r = d && writeBack(raw, d, toEff);
    if (!r || r.answers.trCableUp1 !== 'ds' || r.answers.trCableUp2 !== 'lbs' || (r.answers.trCableUp3 ?? 'none') !== 'none') {
      fail(`ケーブルの手前の開閉器（2つ目）を消したら、3つ目が2つ目へつまるはずが、違います（${r?.answers.trCableUp1}・${r?.answers.trCableUp2}・${r?.answers.trCableUp3}／${JSON.stringify(r?.rejected)}）`);
    } else if (r.answers.trCableUp2__2 !== 'vcb') fail('1台目の開閉器を消したら、2台目の開閉器まで変わりました');
    else if (find(r.doc, 'tr-cable-up3')) fail('書き戻したあとの図面に、つめる前の3つ目が残っています');
    else console.log('  ケーブルの手前の開閉器（2つ目）を消す → 3つ目が2つ目へつまる（2台目は変わらない）');
  }
  // ケーブルの前後の部品を、すべて消す → その台の「ケーブル：なし」
  {
    const d = del(d0, 'tr-cable-source', 'tr-cable-site', 'tr-cable-up1', 'tr-cable-up2', 'tr-cable-up3', 'tr-cable-dn1');
    const r = d && writeBack(raw, d, toEff);
    if (!r || r.answers.trHasCable !== 'no') fail(`ケーブルと前後の開閉器をすべて消しても、「ケーブル：なし」になっていません（${r?.answers.trHasCable}／${JSON.stringify(r?.rejected)}）`);
    else if (r.answers.trHasCable__2 !== 'yes') fail('1台目のケーブルを消したら、2台目のケーブルまで変わりました');
    else console.log('  ケーブルと、前後の開閉器を、すべて消す → その台の「ケーブル：なし」（2台目は変わらない）');
  }
  // ケーブルの端末だけを消す（前後の開閉器は残す）→ ケーブルだけ「なし」にはできないので、書き戻さない
  {
    const d = del(d0, 'tr-cable-source');
    const r = d && writeBack(raw, d, toEff);
    if (r && (r.applied.length > 0 || r.answers.trHasCable !== 'yes')) fail('ケーブルの端末だけを消したのに、書き戻しています（前後の開閉器が残るので、書き戻せない）');
    else console.log('  ケーブルの端末だけを消す（開閉器は残す）→ 書き戻さない（図面にだけ残る）');
  }
  // 変圧器の本体を消す（ケーブル・開閉器は残っていても）→ その台ごと消える
  {
    const d = del(d0, 'transformer-2');
    const r = d && writeBack(raw, d, toEff);
    if (!r || Number(r.answers.transformerCount) !== 1) fail(`変圧器の本体を消しても、台数が減っていません（${r?.answers.transformerCount}／${JSON.stringify(r?.rejected)}）`);
    else console.log('  変圧器の本体を消す（その台のケーブル・開閉器が残っていても）→ 台数が減る');
  }
}

/* CT・VTの組を消したとき（第18弾 追加）：組数が減る。1組だけのときは「0（なし）」。継電器の「CT n組目」は、つめた番号についていく */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const find = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const raw3: Answers = { ...answersSpread, areaCount: '1', ctSetCount: '3', relayCount: '2', relayAt: 'ct-1', relayAt__2: 'ct-3', relayType: 'ocr', relayType__2: 'ocr' };
  const d3 = buildGenerated(toEff(raw3));
  const c2 = find(d3, 'ct-2');
  if (!c2) fail('CTが3組の図面に、2組目がありません');
  else {
    const r = writeBack(raw3, { ...removeItem(d3, c2.id), edited: true }, toEff);
    if (!r || Number(r.answers.ctSetCount) !== 2) fail(`CTの2組目を消しても、組数が2組になっていません（${r?.answers.ctSetCount}／${JSON.stringify(r?.rejected)}）`);
    else if (r.answers.relayAt__2 !== 'ct-2') fail(`CTの2組目を消したら、「CT 3組目」についていた継電器が「CT 2組目」へつまるはずが、違います（${r.answers.relayAt__2}）`);
    else if (r.answers.relayAt !== 'ct-1') fail('CTの2組目を消したら、1組目の継電器まで変わりました');
    else console.log('  CTの2組目を消す → 組数が2組になり、「CT 3組目」の継電器は「CT 2組目」へつまる');
  }
  const raw1: Answers = { ...answersSpread, areaCount: '1', ctSetCount: '1', relayCount: '1', relayAt: 'none' };
  const d1 = buildGenerated(toEff(raw1));
  const c1 = find(d1, 'ct');
  if (!c1) fail('CTが1組の図面に、CTがありません');
  else {
    const r = writeBack(raw1, { ...removeItem(d1, c1.id), edited: true }, toEff);
    if (!r || String(r.answers.ctSetCount) !== '0') fail(`1組だけのCTを消しても、組数が「0（なし）」になっていません（${r?.answers.ctSetCount}／${JSON.stringify(r?.rejected)}）`);
    else console.log('  1組だけのCTを消す → 組数が「0（なし）」になる');
  }
}

/* 電動機の開閉器、引込ケーブルの端末を消したとき（第18弾 追加） */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const find = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const rawM: Answers = { ...answersSpread, areaCount: '1', hasMotor: 'yes', motorCount: '1', motorSource: 'bus', motorSwitch: 'ds-vcb', motorSwitch2: 'none', motorCable: 'no' };
  const dM = buildGenerated(toEff(rawM));
  const ds = find(dM, 'motor-ds');
  const vcb = find(dM, 'motor-vcb');
  if (!ds || !vcb) fail('電動機の開閉器（DS＋VCB）が、自動の図面にありません');
  else {
    const r1 = writeBack(rawM, { ...removeItem(dM, ds.id), edited: true }, toEff);
    const r2 = writeBack(rawM, { ...removeItem(dM, vcb.id), edited: true }, toEff);
    if (r1?.answers.motorSwitch !== 'vcb') fail(`電動機のDSを消したのに、開閉器が「VCBだけ」になっていません（${r1?.answers.motorSwitch}／${JSON.stringify(r1?.rejected)}）`);
    else if (r2?.answers.motorSwitch !== 'ds') fail(`電動機のVCBを消したのに、開閉器が「DSだけ」になっていません（${r2?.answers.motorSwitch}／${JSON.stringify(r2?.rejected)}）`);
    else console.log('  電動機の「DS＋VCB」から、DSを消す → VCBだけ／VCBを消す → DSだけ');
  }
  const rawC: Answers = { ...answersSpread, areaCount: '1', sectionalizer: 'pas', cableInstallation: 'overhead' };
  const dC = buildGenerated(toEff(rawC));
  const h = find(dC, 'cable-head-source');
  if (!h) fail('引込ケーブルの端末が、自動の図面にありません');
  else {
    const r = writeBack(rawC, { ...removeItem(dC, h.id), edited: true }, toEff);
    if (r?.answers.cableInstallation !== 'none') fail(`引込ケーブルの端末を消したのに、「引込ケーブル：なし」になっていません（${r?.answers.cableInstallation}／${JSON.stringify(r?.rejected)}）`);
    else if (find(r.doc, 'cable-head-site')) fail('書き戻したあとの図面に、反対側の端末が残っています');
    else console.log('  引込ケーブルの端末を1つ消す → 「引込ケーブル：なし」（反対側の端末もいっしょに消える）');
  }
}

/* エリア間の接続の、送り出しの開閉器・ケーブルの端末を消したとき（第18弾 追加） */
{
  const DEFAULTS: Answers = Object.fromEntries(QUESTIONS.filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue as Value]));
  const toEff = (a: Answers): Answers => withAutoValues({ ...DEFAULTS, ...normalizeAnswers(a) });
  const find = (d: Doc, name: string) => d.items.find((i): i is DocSymbol => i.kind === 'symbol' && sameName(i.id) === name);
  const raw: Answers = {
    ...answersSpread,
    areaCount: '2',
    'a2:linkTap': 'bus',
    'a2:linkStageCount': '2',
    'a2:linkSwitch': 'ds-vcb',
    'a2:linkCable': 'yes',
    'a2:linkCableInstallation': 'buried',
    'a2:linkCableStructure': 'CVT',
    'a2:link2Switch': 'as',
    'a2:link2Cable': 'yes',
  };
  const d0 = buildGenerated(toEff(raw));
  const del = (name: string): Doc | null => {
    const s = find(d0, name);
    if (!s) {
      fail(`エリア間の接続の図面に ${name} がありません（検査の前提が崩れています）`);
      return null;
    }
    return { ...removeItem(d0, s.id), edited: true };
  };
  // 送り出しの開閉器「DS＋VCB」から、DSを消す
  {
    const d = del('a2:sendout-ds');
    const r = d && writeBack(raw, d, toEff);
    if (!r || r.answers['a2:linkSwitch'] !== 'vcb') fail(`送り出しの「DS＋VCB」からDSを消しても、「VCB」になっていません（${r?.answers['a2:linkSwitch']}／${JSON.stringify(r?.rejected)}）`);
    else console.log('  エリア間の接続の送り出し「DS＋VCB」から、DSを消す → 「VCB」になる');
  }
  // 1段目のケーブルの端末（途中の段）を消す → 1段目のケーブルが「なし」
  {
    const d = del('cable-head-send-s1');
    const r = d && writeBack(raw, d, toEff);
    if (!r || r.answers['a2:linkCable'] !== 'no') fail(`1段目のケーブルの端末を消しても、1段目のケーブルが「なし」になっていません（${r?.answers['a2:linkCable']}／${JSON.stringify(r?.rejected)}）`);
    else if (r.answers['a2:link2Cable'] !== 'yes') fail('1段目のケーブルを消したら、2段目のケーブルまで変わりました');
    else console.log('  エリア間の接続の1段目のケーブルの端末を消す → 1段目のケーブルが「なし」（2段目は変わらない）');
  }
  // 最後の段のケーブルの、受け側の端末を消す → 2段目のケーブルが「なし」
  {
    const d = del('a2:cable-head-site');
    const r = d && writeBack(raw, d, toEff);
    if (!r || r.answers['a2:link2Cable'] !== 'no') fail(`最後の段のケーブルの端末を消しても、2段目のケーブルが「なし」になっていません（${r?.answers['a2:link2Cable']}／${JSON.stringify(r?.rejected)}）`);
    else console.log('  エリア間の接続の最後の段のケーブルの、受け側の端末を消す → 2段目のケーブルが「なし」');
  }
}
