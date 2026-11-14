import type { SymbolDef } from '../types.ts';
import { EARTH_GREEN } from '../types.ts';
import { CONTACT_R, arrowDown, circle, earth, hline, rect, text, vline } from '../shape.ts';


/**
 * 保護継電器の種類マスタ。
 *
 * 図面には「長方形の中に継電器の種類を記載する」形で描く。
 * 手書き図面に書かれている記号をそのまま載せるのが原則で、この一覧にない記号が
 * 出てきた場合は「誤字か／新しい継電器か」をユーザーに確認したうえで、
 * このリストに1行追加する（＝新しい継電器はデータ追加のみで対応できる）。
 */
export interface RelayType {
  code: string;
  nameJa: string;
  /** 正式名称が未確定のものは要確認として扱う */
  needsConfirm?: boolean;
  note?: string;
}

export const RELAY_TYPES: RelayType[] = [
  { code: 'OCR', nameJa: '過電流継電器', note: 'CB形の基本構成で、CTの次に入る。' },
  { code: 'GR', nameJa: '地絡継電器（無方向性）', note: 'GR方式のPASに入る。ZCTが必要。' },
  { code: 'DGR', nameJa: '地絡方向継電器（方向性）', note: 'DGR方式のPASに入る。ZCTに加えZPDが必要。GRの上位互換。' },
  { code: 'OVGR', nameJa: '地絡過電圧継電器' },
  { code: 'UVR', nameJa: '不足電圧継電器' },
  { code: 'OVR', nameJa: '過電圧継電器' },
  { code: 'UFR', nameJa: '不足周波数継電器' },
  { code: 'OFR', nameJa: '過周波数継電器' },
  { code: 'RPR', nameJa: '逆電力継電器' },
  { code: 'UPR', nameJa: '不足電力継電器' },
  { code: 'DSR', nameJa: '短絡方向継電器', note: '使用頻度は極めて低い。' },
  { code: '2E', nameJa: '電動機保護継電器（2要素：過負荷・欠相）' },
  { code: '3E', nameJa: '電動機保護継電器（3要素：過負荷・欠相・反相）' },
];

/** 継電器の記号（長方形＋種類の文字）を1件生成する */
const relay = (t: RelayType): SymbolDef => ({
  id: `relay-${t.code.toLowerCase()}`,
  abbr: t.code,
  nameJa: t.nameJa,
  category: 'protection',
  tags: ['保護継電器', t.code],
  box: { w: 38, h: 24 },
  shapes: [
    rect(0, 0, 38, 24),
    text(19, 12, t.code, { size: t.code.length >= 4 ? 9 : 10.5, tracking: 1.6 }),
  ],
  ports: [
    { id: 'l', x: 0, y: 12, dir: 'left', role: 'secondary' },
    { id: 'r', x: 38, y: 12, dir: 'right', role: 'secondary' },
    // トリップコイルとつなぐ（OCRの出力）
    { id: 'top', x: 19, y: 0, dir: 'up', role: 'secondary' },
  ],
  fields: [
    { key: 'tap', label: '整定値・タップ', type: 'text' },
  ],
  status: t.needsConfirm ? 'open-question' : 'confirmed',
  statusNote: '長方形の中に継電器の種類を記載する。枠の外には何も書かない。引出線は結線側で引くため、記号は枠のみ。',
  note: t.note,
  review: t.needsConfirm ? `${t.code} の正式名称が未確定です。` : undefined,
});

export const protectionSymbols: SymbolDef[] = [
  ...RELAY_TYPES.map(relay),
  {
    id: 'trip-coil',
    abbr: 'TC',
    nameJa: 'トリップコイル（遮断器の引外しコイル）',
    category: 'protection',
    tags: ['VCB', 'OCR', '引外し'],
    box: { w: 30, h: 22 },
    shapes: [
      rect(0, 0, 30, 22),
      text(15, 11, 'TC', { size: 10, tracking: 1 }),
    ],
    ports: [
      { id: 'l', x: 0, y: 11, dir: 'left', role: 'secondary' },
      { id: 'b', x: 15, y: 22, dir: 'down', role: 'secondary' },
      // 上から入る線（DGR・GRの出力）
      { id: 't', x: 15, y: 0, dir: 'up', role: 'secondary' },
    ],
    status: 'confirmed',
    statusNote: 'VCBを引き外すコイル。どのOCRがどのVCBに対応しているかを、はっきりさせるために描く。長方形の中に「TC」と書く形（自前の図。表記は確認済み）。',
    note: 'VCBの横に置き、点線でVCBと連動させ、OCRの出力とつなぐ。',
  },
  {
    id: 'la',
    labelLines: ['LA', '{ratedVoltage}V'],
    abbr: 'LA',
    nameJa: '避雷器',
    category: 'protection',
    tags: ['PAS内蔵', '雷'],
    box: { w: 40, h: 48 },
    shapes: [
      vline(20, 0, 10),
      rect(13, 10, 14, 18),
      vline(20, 12, 23),
      arrowDown(20, 26.5),
      vline(20, 28, 36),
      ...earth(20, 36),
    ],
    ports: [{ id: 'in', x: 20, y: 0, dir: 'up', role: 'line' }],
    fields: [{ key: 'ratedVoltage', label: '定格電圧', type: 'text', unit: 'V' }],
    status: 'confirmed',
    statusNote: 'この形でOK。',
    note: 'PAS内蔵のパターンのほか、PAS内にLAが入っていない場合にPAS〜VCT間に単独で入るパターンがある（その上部にPCが入ることも）。PAS内蔵の場合、LAの接地はPAS本体の接地と同じ箇所で施工するため、接地記号はPASの枠の一番下にまとめて描く。',
  },
  {
    // 接地コンデンサ（第13弾 項目21）。静電容量の小さい高圧回路で、対地間にコンデンサをつなぎ、
    // 地絡電流を確保する機器。高圧コンデンサ（SC）と同じ四角の箱（30×30）・同じ線の太さで、
    // 上の線は箱を貫いて上の極板まで、下の線は下の極板から箱を貫いて下り、接地の記号につながる。三相の内訳は描かず、1つの記号で表す
    id: 'gc',
    labelLines: ['GC'],
    abbr: 'GC',
    nameJa: '接地コンデンサ',
    category: 'protection',
    tags: ['接地', '零相電流', '地絡', '3300V'],
    box: { w: 48, h: 60 },
    shapes: [
      vline(24, 0, 20.8),
      rect(9, 10, 30, 30),
      hline(20.8, 24 - 7.65, 24 + 7.65),
      hline(28, 24 - 7.65, 24 + 7.65),
      vline(24, 28, 50),
      ...earth(24, 50),
    ],
    ports: [{ id: 'in', x: 24, y: 0, dir: 'up', role: 'line' }],
    status: 'confirmed',
    statusNote: '高圧コンデンサ（SC）と同じ四角の箱・同じ線の太さで、上下に線をつなぎ、下に接地の記号を付ける形にしました（自前の図）。横に「GC」と書きます。',
    note: '静電容量が小さい高圧回路で、地絡電流を確保するために使う。ZCTの電源側につなぐのが初期値。三相の内訳（Y結線の3つのコンデンサ）は描かず、1つの記号で表す。',
  },
  {
    id: 'zpd',
    abbr: 'ZPD',
    nameJa: '零相電圧検出装置',
    nameFormal: 'ゼロポテンシャルデバイス（ユーザー呼称）',
    category: 'protection',
    tags: ['PAS', 'DGR', 'OVGR', '零相電圧'],
    // 大きさは、もとの図（幅100・高さ70）の半分。線の太さは変えない。接地記号は、LAと同じ大きさ（半分にしない）
    box: { w: 50, h: 38 },
    shapes: [
      vline(15, 0, 11),
      // 外枠の四角だけ、中心（26, 14）から1.1倍に広げた（以前は x＝7・y＝6・幅38・高さ16）。中の部品・接地は、大きさも位置も変えていない。
      // 上・下・左から枠を貫く線（縦線と、左から来る横線）は、そのまま枠をまたいで中までつながっている
      rect(5.1, 5.2, 41.8, 17.6),
      hline(11, 9, 21),
      hline(15, 9, 21),
      vline(15, 15, 29),
      ...earth(15, 29),
      hline(13, 0, 27.5),
      circle(32.5, 13, CONTACT_R),
      circle(37.5, 13, CONTACT_R),
    ],
    ports: [
      { id: 'in', x: 15, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 0, y: 13, dir: 'left', role: 'control', label: 'OVGR/DGRへ' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり、箱の中にコンデンサ（2枚の板）と変圧器（二重丸）、下に接地を描く形にしました。',
    note: 'DGR方式で零相電圧が必要なときに入る。見本図面ではOVGRへ接続されていた。',
  },
  {
    // PAS・PGSの枠の中に入れる、小さなZPD。母線につなぐ ZPD（zpd）を、枠に収まるように、左右を逆に・小さく描き直したもの。
    // 一次側（入口）は、枠の右寄りの上から入れ、二次側（出口）は右へ出す（DGRが枠の右にあるため）。
    // 接地記号は、LAと同じく、枠の外（下）に出す（枠の下の線を、接地へ向かう線がまたぐ）
    id: 'zpd-pas',
    abbr: 'ZPD',
    nameJa: '零相電圧検出装置（PAS・PGS内蔵用）',
    nameFormal: 'ゼロポテンシャルデバイス（ユーザー呼称）',
    category: 'protection',
    tags: ['PAS', 'PGS', 'DGR', '零相電圧', '内蔵'],
    altOf: 'zpd',
    optional: true,
    box: { w: 40, h: 40 },
    shapes: [
      vline(30, 0, 11),
      rect(1, 6, 36, 16),
      hline(11, 24, 36),
      hline(15, 24, 36),
      vline(30, 15, 32),
      ...earth(30, 32),
      hline(13, 18, 40),
      circle(9, 13, CONTACT_R),
      circle(14, 13, CONTACT_R),
    ],
    ports: [
      { id: 'in', x: 30, y: 0, dir: 'up', role: 'line' },
      { id: 'sec', x: 40, y: 13, dir: 'right', role: 'control', label: 'DGRへ' },
    ],
    status: 'confirmed',
    statusNote: 'PAS・PGSの大きさを変えずに収めるため、ZPDを小さくし、左右を逆にして描いた。',
    note: 'DGR方式のPAS・PGSに、ZCTやVTと同じく、枠の中に入れる。',
  },
  {
    // PAS・PGSの中に、LAも一緒に入っているときのZPD。接地の記号は描かず（接地は、LAの下のものを、共用する）、
    // ZPDの下の縦線を、そのまま、PAS・PGSの外箱（枠の下の線）まで伸ばして、外箱につなぐ。
    // 外箱の下の線は、スロットの位置（枠の下端の 28 上）にあるので、縦線の長さは 28 で、枠をはみ出さない
    id: 'zpd-pas-boxed',
    abbr: 'ZPD',
    nameJa: '零相電圧検出装置（PAS・PGS内蔵用・LAと接地を共用）',
    nameFormal: 'ゼロポテンシャルデバイス（ユーザー呼称）',
    category: 'protection',
    tags: ['PAS', 'PGS', 'DGR', '零相電圧', '内蔵', 'LA'],
    altOf: 'zpd',
    optional: true,
    box: { w: 40, h: 28 },
    shapes: [
      vline(30, 0, 11),
      rect(1, 6, 36, 16),
      hline(11, 24, 36),
      hline(15, 24, 36),
      vline(30, 15, 28),
      hline(13, 18, 40),
      circle(9, 13, CONTACT_R),
      circle(14, 13, CONTACT_R),
    ],
    ports: [
      { id: 'in', x: 30, y: 0, dir: 'up', role: 'line' },
      { id: 'sec', x: 40, y: 13, dir: 'right', role: 'control', label: 'DGRへ' },
    ],
    status: 'confirmed',
    statusNote: 'LAが一緒に入るときは、接地の記号を描かず、下の縦線を外箱へつないだ。',
    note: 'PAS・PGSの外箱に出す接地の記号は、最大1つ。LAとZPDが両方あるときは、LAのものだけを描く。',
  },
  {
    // 接地の種別の記号（第13弾 項目55 修正17／B-7）。線・記号・文字は、すべて緑。初期の図面には付かない（記号の一覧から、元の図面に直接足す）。
    // 位置は自由、大きさは、横の端をつかんで（幅だけで）変えられ、角度は、回して決める
    id: 'earth',
    labelLines: ['{earthType}'],
    abbr: 'E',
    nameJa: '接地（種別つき）',
    category: 'protection',
    tags: ['アース', '接地', 'EA', 'EB', 'EC', 'ED', 'A種', 'B種', 'C種', 'D種'],
    box: { w: 28, h: 20 },
    // 文字（EA〜ED）は、記号の右横に置く
    labelBody: { x0: 5, x1: 23, top: 0 },
    shapes: [vline(14, 0, 8), ...earth(14, 8)],
    ports: [{ id: 'in', x: 14, y: 0, dir: 'up', role: 'earth' }],
    resizable: { w: { min: 14, max: 112, step: 7 }, style: 'earth' },
    color: EARTH_GREEN,
    fields: [
      {
        key: 'earthType',
        label: '接地種別',
        type: 'select',
        options: [
          { value: 'EA', label: 'A種（EA）' },
          { value: 'EB', label: 'B種（EB）' },
          { value: 'EC', label: 'C種（EC）' },
          { value: 'ED', label: 'D種（ED）' },
        ],
        defaultValue: 'EA',
        help: '図面には、緑色で、EA・EB・EC・ED（大文字2文字）と書く',
      },
    ],
    status: 'confirmed',
    statusNote: '線・記号・文字は緑色。接地の種別（EA・EB・EC・ED）を、記号の右横に書きます。位置・大きさ・角度は自由に決められます。',
    note: '初期の図面には付かない。記号の一覧から、必要なところへ足す。接地抵抗値は書かない。',
  },
];
