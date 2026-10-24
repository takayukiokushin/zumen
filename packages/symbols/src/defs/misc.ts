import type { SymbolDef } from '../types.ts';
import { CELL, CELL_PORTS } from './switchgear.ts';
import { circle, hline, line, path, poly, rect, text, vline } from '../shape.ts';

/** 一点鎖線（受電設備エリアの外枠に使う） */
export const DASH_DOT = '9 3 2 3';

/**
 * 進相設備（SC・SR）の絵の大きさ。
 * 見本の図記号どおり、コンデンサの正方形とリアクトルの円は同じ大きさにする。
 * 枠（48×72）の中で上下中央に置く。
 */
const COMP_SIDE = 30;
const COMP_CX = CELL.w / 2;
const COMP_CY = CELL.h / 2;
const COMP_TOP = COMP_CY - COMP_SIDE / 2;
const COMP_LEFT = COMP_CX - COMP_SIDE / 2;

/** 進相設備・電源設備・外枠・結線要素 */
export const miscSymbols: SymbolDef[] = [
  {
    id: 'sr',
    abbr: 'SR',
    nameJa: '直列リアクトル',
    category: 'compensation',
    tags: ['リアクトル', '進相設備'],
    box: { ...CELL },
    // 見本の図記号どおり。円は左下の4分の1が欠けた「4分の3の円」で、
    // 左のはしから上・右をまわって下のはしまで、きれいな円弧でつなぐ。
    // 上からの線は円の中心まで下り、そこから左へ曲がって円弧のはしで止まる
    shapes: [
      path(
        `M ${COMP_LEFT} ${COMP_CY} A ${COMP_SIDE / 2} ${COMP_SIDE / 2} 0 1 1 ${COMP_CX} ${COMP_CY + COMP_SIDE / 2}`,
      ),
      vline(COMP_CX, 0, COMP_CY),
      hline(COMP_CY, COMP_LEFT, COMP_CX),
      vline(COMP_CX, COMP_CY + COMP_SIDE / 2, CELL.h),
    ],
    ports: CELL_PORTS,
    fields: [
      { key: 'phase', label: '相', type: 'text', defaultValue: '3φ' },
      { key: 'capacity', label: '容量', type: 'number', unit: 'kvar' },
      { key: 'ratedVoltage', label: '定格電圧', type: 'text', unit: 'V' },
    ],
    status: 'confirmed',
    statusNote: 'いただいた図記号のとおり、左下の4分の1が欠けた円の中に「⌐」を描く形にしました。円の大きさはSCの正方形と同じです。',
    note: 'コンデンサ「あり」の場合に、直列接続されるパターンとされないパターンがある。記載例「SR 3φ6.38kvar 243V」。',
  },
  {
    id: 'sc',
    abbr: 'SC',
    nameJa: '進相コンデンサ',
    category: 'compensation',
    tags: ['コンデンサ', '進相設備', '力率改善'],
    box: { ...CELL },
    // 見本の図記号どおり。寸法は見本の絵から比率で割り出している。
    //   上の縦線は外枠を貫いて上の極板まで届く（外枠につながっている）
    //   下の縦線は下の極板から下りるが、外枠には届かせない
    shapes: [
      rect(COMP_LEFT, COMP_TOP, COMP_SIDE, COMP_SIDE),
      vline(COMP_CX, 0, COMP_TOP + COMP_SIDE * 0.36),
      hline(COMP_TOP + COMP_SIDE * 0.36, COMP_CX - COMP_SIDE * 0.255, COMP_CX + COMP_SIDE * 0.255),
      hline(COMP_TOP + COMP_SIDE * 0.6, COMP_CX - COMP_SIDE * 0.255, COMP_CX + COMP_SIDE * 0.255),
      vline(COMP_CX, COMP_TOP + COMP_SIDE * 0.6, COMP_TOP + COMP_SIDE * 0.82),
    ],
    ports: [{ id: 'in', x: 24, y: 0, dir: 'up', role: 'line' }],
    fields: [
      { key: 'phase', label: '相', type: 'text', defaultValue: '3φ' },
      { key: 'capacity', label: '容量', type: 'number', unit: 'kvar' },
      { key: 'ratedVoltage', label: '定格電圧', type: 'text', unit: 'V' },
    ],
    status: 'confirmed',
    statusNote: 'いただいた図記号のとおり、正方形の中に2枚の極板を描く形にしました。下の縦線は外枠に接しません。',
    note: '変圧器と並列に入るパターンがある。台数は1台〜複数台。記載例「SC 3φ106kvar 7020V」。',
  },
  {
    id: 'generator',
    abbr: 'G',
    nameJa: '発電機',
    category: 'source',
    tags: ['発電機', '非常用', '常用'],
    box: { w: 40, h: 44 },
    shapes: [vline(20, 0, 10), circle(20, 24, 14), text(20, 24, 'G', { size: 13 })],
    ports: [{ id: 'out', x: 20, y: 0, dir: 'up', role: 'line' }],
    fields: [
      {
        key: 'voltageClass',
        label: '電圧区分',
        type: 'select',
        options: [
          { value: 'high', label: '高圧発電機' },
          { value: 'low', label: '低圧発電機' },
        ],
      },
      {
        key: 'usage',
        label: '用途区分',
        type: 'select',
        options: [
          { value: 'normal', label: '常用型（常に稼働）' },
          { value: 'emergency', label: '非常用型（非常時のみ稼働）' },
        ],
      },
      { key: 'capacity', label: '容量', type: 'number', unit: 'kVA' },
      { key: 'place', label: '設置場所', type: 'text', help: '非常用発電機の場合は図面に明記する' },
    ],
    status: 'confirmed',
    statusNote: 'このマークでOK。',
  },
  {
    id: 'pv',
    abbr: 'PV',
    nameJa: '太陽電池パネル',
    category: 'source',
    tags: ['太陽光', '発電所', '再エネ', 'PV'],
    box: { w: 52, h: 40 },
    shapes: [
      vline(28, 0, 12),
      poly([10, 34, 22, 12, 48, 12, 36, 34], { close: true, fill: 'none' }),
      line(16, 34, 28, 12),
      line(22, 34, 34, 12),
      line(28, 34, 40, 12),
    ],
    ports: [{ id: 'out', x: 28, y: 0, dir: 'up', role: 'line' }],
    fields: [{ key: 'capacity', label: '設備規模', type: 'number', unit: 'kW' }],
    status: 'confirmed',
    statusNote: '実図面のとおり、ハッチングを入れた平行四辺形にしました。',
    note: 'PCSの下に描き、記号の下に「PV」と記載する。',
  },
  {
    id: 'pcs',
    abbr: 'PCS',
    nameJa: 'パワーコンディショナ',
    category: 'source',
    tags: ['太陽光', '蓄電', 'PCS'],
    box: { w: 56, h: 48 },
    // 下側の引き出し線は描かない。下に何もつながっていないのに線だけ伸びていると、
    // 行き先のない線に見えるため（変圧器と同じ扱い）。
    // 下につなぐものがあるときは、作図のほうが出口から線を引く
    shapes: [
      vline(28, 0, 10),
      rect(6, 10, 44, 28),
      text(28, 18, 'PCS', { size: 9 }),
    ],
    ports: [
      { id: 'in', x: 28, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 28, y: 38, dir: 'down', role: 'line' },
    ],
    fields: [{ key: 'capacity', label: '容量', type: 'text', help: '図面の記載例: 100kW×5' }],
    status: 'confirmed',
    statusNote: '実図面のとおり、長方形の中に「PCS」と容量を記載する形にしました。',
    note: '容量は枠の中の2行目に記載する（例: 100kW×5）。',
  },
  {
    id: 'battery-unit',
    abbr: 'BATT',
    nameJa: '蓄電池ユニット',
    category: 'source',
    tags: ['蓄電', '系統用蓄電所'],
    box: { w: 96, h: 44 },
    shapes: [vline(30, 0, 10), rect(4, 10, 88, 30), text(48, 25, '蓄電池ユニット', { size: 9 })],
    ports: [{ id: 'out', x: 30, y: 0, dir: 'up', role: 'line' }],
    fields: [
      { key: 'unitNo', label: 'ユニット番号', type: 'text', help: '図面の記載例: No.1' },
      { key: 'capacity', label: '蓄電ユニット規模', type: 'number', unit: 'kWh' },
    ],
    status: 'confirmed',
    statusNote: '実図面のとおり、長方形の中に「蓄電池ユニットNo.n」と記載する形にしました。',
    note: 'PCSの下に接続する。',
  },
  {
    id: 'bus',
    abbr: '母線',
    nameJa: '母線',
    category: 'wiring',
    tags: ['母線', '分岐'],
    box: { w: 80, h: 12 },
    shapes: [hline(6, 0, 80, { sw: 3 })],
    ports: [
      { id: 'l', x: 0, y: 6, dir: 'left', role: 'line' },
      { id: 'r', x: 80, y: 6, dir: 'right', role: 'line' },
      { id: 'in', x: 40, y: 0, dir: 'up', role: 'line' },
    ],
    status: 'confirmed',
    statusNote: 'このままでOK。',
    note: '線と線の交点に点（接続点マーク）は置かない。',
  },
  {
    id: 'ground-line',
    abbr: '地表面',
    nameJa: '地表面・建物境界の線',
    category: 'wiring',
    tags: ['埋設', '地表面', 'ケーブル'],
    box: { w: 120, h: 10 },
    shapes: [hline(5, 0, 120, { sw: 2.2 })],
    ports: [
      { id: 'l', x: 0, y: 5, dir: 'left' },
      { id: 'r', x: 120, y: 5, dir: 'right' },
    ],
    status: 'confirmed',
    statusNote: '見本図面（埋ケのケーブル）にあった太い横線を記号にしました。',
    note: '埋設ケーブルが地表面を横切る箇所に引く。',
  },
  {
    id: 'enclosure-cubicle',
    abbr: '外箱',
    nameJa: 'キュービクル・電気室の範囲を示す枠',
    category: 'enclosure',
    tags: ['キュービクル', '電気室', 'オープンフレーム式'],
    box: { w: 160, h: 30 },
    shapes: [hline(6, 0, 160), vline(0, 6, 30), vline(160, 6, 30)],
    ports: [],
    fields: [
      {
        key: 'form',
        label: '形態',
        type: 'select',
        options: [
          { value: 'cubicle', label: 'キュービクル式' },
          { value: 'room-cubicle', label: '電気室（内にキュービクル）' },
          { value: 'room-open', label: 'オープンフレーム式' },
        ],
        help: '「開放型」等の表記は使わず「オープンフレーム式」に統一する。',
      },
      {
        key: 'placement',
        label: '設置場所',
        type: 'select',
        options: [
          { value: 'indoor', label: '屋内' },
          { value: 'rooftop', label: '屋上' },
          { value: 'outdoor', label: '屋外（地上）' },
          { value: 'semi-outdoor', label: '半屋外' },
        ],
        allowFreeInput: true,
      },
      { key: 'floor', label: '階層', type: 'text', help: '例: 2階 / 中2階' },
      { key: 'detail', label: '場所の補足', type: 'text', help: '例: 駐車場横' },
    ],
    defaultLabel: 'キュービクル式（地上）',
    status: 'confirmed',
    statusNote: '実図面のとおり、閉じた四角ではなく「コ」の字（上辺＋両端の短い縦線）にしました。ラベルは上辺の左上（外側）に置きます。',
    note: 'この枠から下がキュービクル（電気室）の中であることを示す。受電設備が1箇所だけの場合はこの枠だけを描き、エリア全体を囲う枠は描かない。',
  },
  {
    id: 'substation-area',
    abbr: 'AREA',
    nameJa: '受電設備エリアの区分枠',
    category: 'enclosure',
    tags: ['受電設備エリア', '複数箇所'],
    box: { w: 150, h: 96 },
    shapes: [rect(0, 0, 150, 96, { dash: DASH_DOT })],
    ports: [],
    status: 'confirmed',
    statusNote: '一点鎖線で確定。',
    note: '受電設備が2箇所以上ある場合のみ、各エリアをこの枠で囲う。1箇所の場合は描かない。',
  },
];
