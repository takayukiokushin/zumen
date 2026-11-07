/**
 * 図面の検証（check-drawing）の4つ目：レイヤー（停電範囲図・絶縁耐力試験範囲図・追加したレイヤー）の入れ物。
 * 「レイヤーを使わない図面は、これまでと1文字も変わらない」「作り直しても、操作を戻しても、レイヤーは消えない」を確かめる。
 */
import { buildSheetSvg } from '../../apps/web/src/editor/exportSheet.ts';
import { fromLayout, tidyDoc } from '../../apps/web/src/editor/doc.ts';
import type { Doc } from '../../apps/web/src/editor/doc.ts';
import { chooseSheet } from '../../apps/web/src/editor/inspect.ts';
import { addLayer, carryLayers, customCount, layerInfos, layerNameProblem, layerOf, layerTitle, removeLayer, renameLayer, setLayerOrientation } from '../../apps/web/src/editor/layers.ts';
import { rebuildWithOverrides } from '../../apps/web/src/editor/overrides.ts';
import { buildComposition, FIXED_LAYERS, MAX_CUSTOM_LAYERS, MAX_TEXT_LENGTH } from '../../packages/knowledge/src/index.ts';
import { COMPANY_NAME, layout } from '../../packages/layout/src/index.ts';
import { fail, answersSpread } from './common.ts';

console.log('\n■ レイヤー（停電範囲図など）の入れ物');
{
  const base = (): Doc => fromLayout(layout(buildComposition(answersSpread), answersSpread));

  // 1. 固定の2つ
  const d0 = base();
  const infos = layerInfos(d0);
  if (infos.length !== 2 || infos[0]!.title !== '停電範囲図' || infos[1]!.title !== '絶縁耐力試験範囲図' || !infos.every((i) => i.fixed)) {
    fail(`レイヤーを使っていない図面に、固定の2つ（停電範囲図・絶縁耐力試験範囲図）が出ません：${JSON.stringify(infos)}`);
  } else console.log('  レイヤーを使っていない図面にも、固定の2つ（停電範囲図・絶縁耐力試験範囲図）がある');
  if (layerTitle(d0, 'outage') !== '停電範囲図' || layerTitle(d0, 'nai') !== null) fail('レイヤーの名前の引き方が違います');
  if (FIXED_LAYERS.length !== 2 || MAX_CUSTOM_LAYERS !== 3) fail(`固定は2つ・追加は3つまで、のはずが、${FIXED_LAYERS.length}・${MAX_CUSTOM_LAYERS}です`);

  // 2. 追加（3つまで）と、名前の決まり
  let d = d0;
  const names = ['夜間停電', '予備', '三つ目'];
  const ids: string[] = [];
  for (const n of names) {
    const r = addLayer(d, `  ${n}  `);
    if (!r) {
      fail(`「${n}」を追加できません`);
      break;
    }
    d = r.doc;
    ids.push(r.id);
  }
  if (new Set(ids).size !== 3 || customCount(d) !== 3) fail(`追加したレイヤーの id が重なっています：${ids.join(',')}`);
  if (layerOf(d, ids[0]!)?.name !== '夜間停電') fail('名前の前後の空白が、取り除かれていません');
  if (addLayer(d, '4つ目') !== null) fail('追加できるレイヤーは3つまでのはずが、4つ目が作れました');
  const problems: [string, string, string | null][] = [
    ['空', '', 'layer.err.empty'],
    ['空白だけ', '   ', 'layer.err.empty'],
    [`${MAX_TEXT_LENGTH + 1}文字`, 'あ'.repeat(MAX_TEXT_LENGTH + 1), 'layer.err.tooLong'],
    [`${MAX_TEXT_LENGTH}文字ちょうど`, 'あ'.repeat(MAX_TEXT_LENGTH), null],
    ['固定の名前と同じ', '停電範囲図', 'layer.err.taken'],
    ['追加済みの名前と同じ', '予備', 'layer.err.taken'],
    ['使える名前', '別の名前', null],
  ];
  for (const [label, name, want] of problems) {
    const got = layerNameProblem(d, name);
    if (got !== want) fail(`名前の確認（${label}）：${want} のはずが ${got} です`);
  }
  if (layerNameProblem(d, '予備', ids[1]) !== null) fail('自分自身の名前に変えるのは、「同じ名前」にしてはいけません');
  if (!problems.every(([, n, w]) => layerNameProblem(d, n) === w)) fail('名前の確認が合いません');
  else console.log(`  追加できるのは${MAX_CUSTOM_LAYERS}つまで。名前は、空・長すぎ・同じ名前を断り、前後の空白を取る`);

  // 3. 名前の変更・削除（固定は不可）
  const renamed = renameLayer(d, ids[1]!, '予備（改）');
  if (!renamed || layerTitle(renamed, ids[1]!) !== '予備（改）') fail('追加したレイヤーの名前を変えられません');
  if (renameLayer(d, 'outage', '別名') !== null) fail('固定のレイヤーの名前を変えられてしまいます');
  if (renameLayer(d, ids[1]!, '夜間停電') !== null) fail('ほかのレイヤーと同じ名前に変えられてしまいます');
  if (removeLayer(d, 'outage') !== null || removeLayer(d, 'withstand') !== null) fail('固定のレイヤーを消せてしまいます');
  const removed = removeLayer(d, ids[0]!);
  if (!removed || customCount(removed) !== 2 || layerOf(removed, ids[0]!)) fail('追加したレイヤーを消せません');
  const readd = removed ? addLayer(removed, '作り直し') : null;
  if (!readd || customCount(readd.doc) !== 3) fail('消したあとに、また追加できません（3つまで、の数え方が違います）');
  else console.log('  追加したレイヤーは、名前を変えられ、消せる。固定の2つは、名前も変えられず、消せない');

  // 4. 向き（レイヤーごと）。固定のレイヤーは、このとき初めて記録ができる
  const o1 = setLayerOrientation(d0, 'outage', 'landscape');
  const o2 = setLayerOrientation(o1, 'withstand', 'portrait');
  const o3 = setLayerOrientation(o2, ids[0] ?? 'x', 'landscape');
  if (layerOf(o1, 'outage')?.orientation !== 'landscape' || layerOf(o2, 'outage')?.orientation !== 'landscape' || layerOf(o2, 'withstand')?.orientation !== 'portrait') fail('レイヤーごとに、印刷の向きを持てません');
  if (setLayerOrientation(d0, 'nai', 'landscape') !== d0) fail('存在しないレイヤーに、向きが付いてしまいます');
  if (layerInfos(o3).length !== 2 || d0.orientation !== undefined || o3.orientation !== undefined) fail('レイヤーの向きが、元の図面の向きに影響しています');
  else console.log('  印刷の向きは、元の図面とレイヤーごとに別々に持つ');

  // 5. 作り直し・整える・戻す・保存を通しても、レイヤーは消えない
  const withLayers: Doc = { ...d, layers: [...d.layers!.map((l) => ({ ...l, items: [{ id: `${l.id}-x`, kind: 'mark' }] })), { id: 'outage', items: [], orientation: 'landscape' }] };
  const regen = rebuildWithOverrides(fromLayout(layout(buildComposition(answersSpread), answersSpread)), withLayers);
  if (JSON.stringify(regen.doc.layers) !== JSON.stringify(withLayers.layers)) fail('図面を作り直すと、レイヤーが消えたり、変わったりします');
  const edited: Doc = { ...withLayers, items: withLayers.items.filter((i) => i.kind !== 'text').slice(0, 5), edited: true };
  const regen2 = rebuildWithOverrides(fromLayout(layout(buildComposition(answersSpread), answersSpread)), edited);
  if (JSON.stringify(regen2.doc.layers) !== JSON.stringify(withLayers.layers)) fail('手で直した図面を作り直すと、レイヤーが消えます');
  const tidy = tidyDoc(withLayers);
  if (JSON.stringify(tidy.layers) !== JSON.stringify(withLayers.layers)) fail('「結線を整える」で、レイヤーが消えたり、変わったりします');
  const oldSnapshot: Doc = { ...base(), layers: [] };
  const carried = carryLayers(oldSnapshot, withLayers);
  if (JSON.stringify(carried.layers) !== JSON.stringify(withLayers.layers)) fail('「操作を戻す」で、レイヤーが昔の状態に戻ってしまいます');
  if ('layers' in carryLayers(withLayers, base())) fail('レイヤーが無い図面に、レイヤーの項目が付いてしまいます');
  const roundTrip = JSON.parse(JSON.stringify(withLayers)) as Doc;
  if (JSON.stringify(roundTrip.layers) !== JSON.stringify(withLayers.layers)) fail('保存・読み込みで、レイヤーが変わります');
  else console.log('  図面の作り直し（手直しの有無とも）・結線を整える・操作を戻す・保存と読み込み、のどれでも、レイヤーは消えない');

  // 6. 元の図面の印刷は、レイヤーがあっても、1文字も変わらない。タイトルだけ、レイヤーの名前になる
  const title = { site: '見本工場', name: 'キュービクル式高圧受電設備単線結線図', footer: COMPANY_NAME };
  const sheet = (doc: Doc, t = title) => {
    const { paper, orientation } = chooseSheet(doc, t);
    return buildSheetSvg(doc, t, paper, orientation);
  };
  if (sheet(withLayers) !== sheet(base())) fail('レイヤーがあるだけで、元の図面の印刷が変わります');
  const outageSvg = sheet(withLayers, { ...title, name: layerTitle(withLayers, 'outage')! });
  if (!outageSvg.includes('見本工場　停電範囲図') || outageSvg.includes('単線結線図')) fail('停電範囲図のタイトルが「見本工場　停電範囲図」になっていません');
  const withstandSvg = sheet(withLayers, { ...title, name: layerTitle(withLayers, 'withstand')! });
  if (!withstandSvg.includes('見本工場　絶縁耐力試験範囲図')) fail('絶縁耐力試験範囲図のタイトルになっていません');
  const customSvg = sheet(withLayers, { ...title, name: layerTitle(withLayers, ids[0]!)! });
  if (!customSvg.includes('見本工場　夜間停電')) fail('追加したレイヤーのタイトルが、「事業場名　付けた名前」になっていません');
  // タイトル以外（図面の中身）は、元の図面と同じ。図面の中身は、「<g transform="translate(」から後ろ
  const body = (svg: string) => svg.slice(svg.indexOf('<g transform="translate('));
  const baseBody = body(sheet(base()));
  for (const [name, svg] of [['停電範囲図', outageSvg], ['絶縁耐力試験範囲図', withstandSvg], ['追加したレイヤー', customSvg]] as const) {
    if (body(svg) !== baseBody) fail(`${name}の印刷で、図面の中身が、元の図面と変わっています（タイトルだけが変わるはずです）`);
  }
  console.log('  レイヤーがあるだけでは、元の図面の印刷は1文字も変わらない。タイトルは「事業場名　レイヤーの名前」になる');
}
