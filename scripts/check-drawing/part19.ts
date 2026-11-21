/**
 * 図面の検証（check-drawing）の19個目：線の上に乗せる記号（VCT・CT・ZCT。第20弾 項目2）。
 *  1. 自動作図：記号の中に縦線・入口・出口が無く、上下の線は、記号の中を通る1本の線。ZCTは、ケーブルの線の上に乗る
 *  2. 保存してある古い図面（縦線・入口・出口のある形）を、新しい形に直せる。見た目・手で直した内容が変わらない
 *  3. 手で足す・動かす・差し替える・消す
 */
import { addSymbol, assistMove, baselineOf, dropRedundantStub, fromLayout, moveItem, removeItem, replaceSymbol, sameName } from '../../apps/web/src/editor/doc.ts';
import type { Doc, DocSymbol, DocWire } from '../../apps/web/src/editor/doc.ts';
import { cableViolations } from '../../apps/web/src/editor/hvCable.ts';
import { inspectDrawing } from '../../apps/web/src/editor/inspect.ts';
import { convertDocOnWire, migrateOnWire, needsOnWireMigration } from '../../apps/web/src/editor/onwireMigrate.ts';
import { buildComposition, dropHiddenChoices } from '../../packages/knowledge/src/index.ts';
import type { Answers } from '../../packages/knowledge/src/index.ts';
import { layout, layoutChain } from '../../packages/layout/src/index.ts';
import { CHAIN_SYMBOLS, ON_WIRE_ORIGIN, getSymbol, isOnWireId } from '../../packages/symbols/src/index.ts';
import { answersSpread, fail } from './common.ts';

console.log('\n■ 線の上に乗せる記号（VCT・CT・ZCT）：自動作図・古い図面の変換・手で足す／動かす／差し替える／消す');
{
  const bad: string[] = [];
  const syms = (d: Doc) => d.items.filter((i): i is DocSymbol => i.kind === 'symbol');
  const wiresOf = (d: Doc) => d.items.filter((i): i is DocWire => i.kind === 'wire');
  const problems = (d: Doc) => inspectDrawing(d, 'A3', 'landscape').filter((i) => ['overlap', 'through', 'floating', 'skew'].includes(i.kind)).length;
  const onIds = Object.keys(ON_WIRE_ORIGIN);
  const cases: [string, Answers][] = [
    ['複雑な1か所', { ...answersSpread, areaCount: '1' } as Answers],
    ['複数エリア（送り出しのZCT・CT）', { ...answersSpread } as Answers],
    ['PFS形', dropHiddenChoices({ ...answersSpread, areaCount: '1', mainBreakerForm: 'pfs', lbsRatedVoltage: '7200', lbsRatedCurrent: 200, lbsFuseCount: 3 } as Answers)],
    ['PGS・DGR・内蔵', dropHiddenChoices({ ...answersSpread, areaCount: '1', sectionalizer: 'pgs', pasControl: 'dgr', pasBuiltinVt: 'yes', pasBuiltinLa: 'yes' } as Answers)],
  ];
  for (const [name, a] of cases) {
    const d = fromLayout(layout(buildComposition(a), a));
    const on = syms(d).filter((s) => onIds.includes(s.symbolId));
    if (on.length === 0) { bad.push(`${name}：線の上に乗せる記号が、図面にありません（試験の前提が違います）`); continue; }
    for (const s of on) {
      const def = getSymbol(s.symbolId);
      if (def.ports.some((p) => p.id === 'in' || p.id === 'out')) bad.push(`${name}：${s.id} に入口・出口の接続点があります`);
      if (def.shapes.some((sh) => sh.k === 'line' && Math.abs(sh.x1 - sh.x2) < 0.01 && Math.abs(sh.y2 - sh.y1) >= def.box.h * 0.9 && sh.x1 === def.onWire!.x)) bad.push(`${name}：${s.id} に縦線があります`);
      // 記号の中を、1本の線が、縦に通っている（PASの中のものは、PASの枠の線）
      if (!s.parent) {
        const x = s.x + def.onWire!.x;
        const through = wiresOf(d).some((w) => Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.x1 - x) <= 0.5 && Math.min(w.y1, w.y2) <= s.y + def.box.h / 2 && Math.max(w.y1, w.y2) >= s.y + def.box.h / 2);
        if (!through) bad.push(`${name}：${s.id} の中を、線が通っていません`);
        if (wiresOf(d).some((w) => [w.at1, w.at2].some((an) => an?.item === s.id))) {
          // 二次側の接続点（sec）につながる線は、あってよい。入口・出口につながる線は、無い
          if (wiresOf(d).some((w) => [w.at1, w.at2].some((an) => an?.item === s.id && (an.port === 'in' || an.port === 'out')))) bad.push(`${name}：${s.id} の入口・出口につながる線があります`);
        }
      }
    }
    // 見た目は、以前と同じ（位置は、以前の本体と同じ場所）
    const old = layoutChain(buildComposition(a), a);
    for (const s of on) {
      const o = old.symbols.find((x) => x.id === s.id)!;
      const c = ON_WIRE_ORIGIN[s.symbolId as keyof typeof ON_WIRE_ORIGIN];
      if (o.rotate === 0 && (Math.abs(o.x + c.x - s.x) > 0.01 || Math.abs(o.y + c.y - s.y) > 0.01)) bad.push(`${name}：${s.id} の本体の位置が、以前と違います`);
    }
    if (problems(d) > 0) bad.push(`${name}：図面の点検で問題が出ます（${problems(d)}件）`);
    if (cableViolations(d).length > 0) bad.push(`${name}：高圧ケーブルの途中に、ZCT以外が入っています`);
  }

  // 2. 古い図面（縦線・入口・出口のある形）を、新しい形に直す
  const oldDocOf = (a: Answers): Doc => {
    const lay = layoutChain(buildComposition(a), a);
    let doc = fromLayout(lay);
    // 古い形：入口・出口につながる線は、記号の接続点につなぐ。版は無い
    const onSet = new Set(syms(doc).filter((s) => isOnWireId(s.symbolId)).map((s) => s.id));
    const items = doc.items.map((it) => {
      if (it.kind !== 'wire') return it;
      // 新しい形の記号につながったつなぎ先は、いったん外し、以前の形の接続点（入口・出口・二次側）につなぎ直す
      const w = { ...it, at1: it.at1 && onSet.has(it.at1.item) ? undefined : it.at1, at2: it.at2 && onSet.has(it.at2.item) ? undefined : it.at2 };
      for (const s of syms(doc)) {
        const o = CHAIN_SYMBOLS[s.symbolId];
        if (!o || !(isOnWireId(s.symbolId))) continue;
        // fromLayout は、新しい形の位置に直さない（layoutChain の位置のまま）ので、そのまま使う
        for (const p of o.ports) {
          if (Math.abs(w.x1 - (s.x + p.x)) < 0.01 && Math.abs(w.y1 - (s.y + p.y)) < 0.01) w.at1 = { item: s.id, port: p.id };
          if (Math.abs(w.x2 - (s.x + p.x)) < 0.01 && Math.abs(w.y2 - (s.y + p.y)) < 0.01) w.at2 = { item: s.id, port: p.id };
        }
      }
      return w;
    });
    doc = { ...doc, items };
    const { layoutV: _v, ...rest } = doc;
    return { ...rest, base: baselineOf(doc), edited: true };
  };
  for (const [name, a] of cases.slice(0, 3)) {
    const oldDoc = oldDocOf(a);
    if (!needsOnWireMigration(oldDoc)) { bad.push(`${name}：古い図面が、直す対象になっていません`); continue; }
    const gen = fromLayout(layout(buildComposition(a), a));
    // 手で直した内容：1台を動かす・1つの文字を動かす・VCBを消す
    const target = syms(oldDoc).find((s) => !s.parent && (s.symbolId === 'ds' || s.symbolId === 'lbs')) ?? syms(oldDoc).find((s) => !s.parent && !onIds.includes(s.symbolId) && s.label.length > 0)!;
    let edited: Doc = { ...oldDoc, items: oldDoc.items.map((i) => (i.id === target.id && i.kind === 'symbol' ? { ...i, x: i.x + 24, labelDx: i.labelDx + 6 } : i)) };
    edited = { ...edited, edited: true };
    const m = migrateOnWire(edited, gen);
    const mm = syms(m);
    for (const s of syms(gen)) {
      const k = mm.find((x) => x.id === s.id);
      if (!k) { bad.push(`${name}：変換のあと、${s.id} がありません`); continue; }
      const dx = s.id === target.id || s.parent === target.id ? 24 : 0;
      if (Math.abs(k.x - s.x - dx) > 0.01 || Math.abs(k.y - s.y) > 0.01) bad.push(`${name}：変換のあと、${s.id} の位置が違います（${k.x - s.x}, ${k.y - s.y}）`);
    }
    if (mm.some((k) => k.id === target.id && k.labelDx !== syms(gen).find((x) => x.id === k.id)!.labelDx + 6)) bad.push(`${name}：手で動かした文字の位置が、変換のあとに残っていません`);
    if ((m.layoutV ?? 1) < 2 || needsOnWireMigration(m)) bad.push(`${name}：変換のあと、版が新しくなっていません`);
    // 線：ほとんど同じ数（動かした記号につながる線の位置は変わる）。余計な重なり・つなぎ先の無い線は、増えない
    if (problems(m) > problems(gen) + 2) bad.push(`${name}：変換のあと、図面の点検で問題が増えました（${problems(gen)}→${problems(m)}）`);
    const ids = new Set(m.items.map((i) => i.id));
    for (const w of wiresOf(m)) for (const an of [w.at1, w.at2]) if (an && !ids.has(an.item)) bad.push(`${name}：変換のあと、線のつなぎ先が図面にありません`);
    // 基準の控えが無い図面は、そのまま直す（位置を動かし、中を通る線を足す）
    const { base: _b, ...nobase } = oldDoc;
    const c = convertDocOnWire(nobase as Doc);
    if (needsOnWireMigration(c)) bad.push(`${name}：（控えの無い図面）直したあとも、直す対象のままです`);
    for (const s of syms(gen)) {
      const k = syms(c).find((x) => x.id === s.id);
      if (!k || Math.abs(k.x - s.x) > 0.01 || Math.abs(k.y - s.y) > 0.01) bad.push(`${name}：（控えの無い図面）${s.id} の位置が、自動作図と違います`);
    }
    if (problems(c) > problems(gen)) bad.push(`${name}：（控えの無い図面）直したあと、図面の点検で問題が増えました（${problems(gen)}→${problems(c)}）`);
  }

  // 3. 手で足す・動かす・差し替える・消す
  {
    const d = fromLayout(layout(buildComposition({ ...answersSpread, areaCount: '1' } as Answers), { ...answersSpread, areaCount: '1' } as Answers));
    for (const id of ['ct', 'zct', 'vct']) {
      const r = addSymbol(d, id, 600, 900);
      const s = syms(r.doc).find((x) => x.id === r.id)!;
      const ow = getSymbol(id).onWire!;
      const stub = wiresOf(r.doc).filter((w) => !wiresOf(d).some((o) => o.id === w.id));
      if (stub.length !== 1 || Math.abs(stub[0]!.x1 - (s.x + ow.x)) > 0.01) bad.push(`${id}：足したとき、軸の位置に短い線が足されていません`);
      // 近くの縦の線に、軸がぴったり合う（動かす手助け）
      const wire = wiresOf(d).find((w) => Math.abs(w.x1 - w.x2) < 0.01 && Math.abs(w.y2 - w.y1) > 30)!;
      const raw = wire.x1 - (s.x + ow.x) + 3;
      const a = assistMove(r.doc, r.id, raw, 0, 10);
      if (Math.abs(s.x + a.dx + ow.x - wire.x1) > 0.01 && Math.abs(a.guideX ?? 1e9) > 1e8) bad.push(`${id}：縦の線の近くで、軸が線にぴったり合いません`);
      // 消すと、足した線だけが残る（記号の入口・出口が無いので、つなぎ直しは起きない）
      const gone = removeItem(r.doc, r.id);
      if (syms(gone).some((x) => x.id === r.id) || wiresOf(gone).length !== wiresOf(r.doc).length) bad.push(`${id}：消したとき、線が増減しました`);
    }
    // 差し替え：VCT・CT・ZCTどうしは、軸を合わせて入れ替わる／ほかの記号とは、入れ替えられない（Editor が断る）
    const ct = syms(d).find((s) => s.symbolId === 'ct')!;
    const sw = replaceSymbol(d, ct.id, 'zct');
    const z = syms(sw).find((s) => s.id === ct.id)!;
    if (z.symbolId !== 'zct' || Math.abs(z.x + getSymbol('zct').onWire!.x - (ct.x + getSymbol('ct').onWire!.x)) > 0.01) bad.push('CTをZCTに差し替えたとき、軸の位置が動きました');
    // ZCT以外を、高圧ケーブルの線の上に置くと、断る対象になる
    const cable = wiresOf(d).find((w) => syms(d).some((s) => s.symbolId === 'cable-head' && w.at1?.item === s.id) && w.at2 && Math.abs(w.x1 - w.x2) < 0.01);
    if (cable) {
      const ow = getSymbol('ct').onWire!;
      const r = addSymbol(d, 'ct', cable.x1 + (getSymbol('ct').box.w / 2 - ow.x), (cable.y1 + cable.y2) / 2);
      const k = syms(r.doc).find((x) => x.id === r.id)!;
      const placed = moveItem(r.doc, r.id, cable.x1 - (k.x + ow.x), 0);
      if (cableViolations(placed).length === cableViolations(d).length) bad.push('CTを高圧ケーブルの線の上に置いても、断る対象になりません');
      const zr = addSymbol(d, 'zct', cable.x1 + 10, (cable.y1 + cable.y2) / 2);
      const kz = syms(zr.doc).find((x) => x.id === zr.id)!;
      const zp = dropRedundantStub(moveItem(zr.doc, zr.id, cable.x1 - (kz.x + getSymbol('zct').onWire!.x), 0), [zr.id]);
      if (wiresOf(zp).some((w) => w.stub === zr.id)) bad.push('ZCTを、線の上に置いたのに、一緒に足した短い線が残っています');
      if (problems(zp) > problems(d)) bad.push('ZCTを、線の上に置いたら、図面の点検で問題が増えました');
      if (cableViolations(zp).length !== cableViolations(d).length) bad.push('ZCTを高圧ケーブルの線の上に置いたら、断る対象になっています（ZCTは付けてよい）');
    } else bad.push('高圧ケーブルの線が見つかりません（試験の前提が違います）');
  }
  void sameName;
  if (bad.length > 0) fail(`線の上に乗せる記号に問題が ${bad.length}件あります（例：${bad.slice(0, 4).join(' ／ ')}）`);
  else console.log('  自動作図・古い図面の変換（手で直した内容を残す）・手で足す／動かす／差し替える／消す・高圧ケーブルの決まりが、決まりどおり');
}
