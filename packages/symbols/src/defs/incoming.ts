import type { Shape } from '../shape.ts';
import type { SymbolDef } from '../types.ts';
import { contact, hline, line, poly, rect, vline } from '../shape.ts';

/** 円の左半分を縦線でハッチングする（電柱の記号） */
const hatchLeftHalf = (cx: number, cy: number, r: number, step = 1.7): Shape[] => {
  const out: Shape[] = [];
  for (let x = cx - r + step; x < cx; x += step) {
    const dy = Math.sqrt(Math.max(r * r - (x - cx) * (x - cx), 0));
    out.push(vline(x, cy - dy, cy + dy, { sw: 0.7 }));
  }
  return out;
};

/** 電柱（円＋左半分のハッチング＋引下線） */
const pole = (id: string, abbr: string, nameJa: string, note: string): SymbolDef => ({
  id,
  abbr,
  nameJa,
  category: 'incoming',
  tags: ['引込元', '電柱'],
  box: { w: 36, h: 48 },
  shapes: [
    { k: 'circle', cx: 16, cy: 16, r: 14 },
    ...hatchLeftHalf(16, 16, 14),
    vline(16, 30, 48),
  ],
  ports: [{ id: 'out', x: 16, y: 48, dir: 'down', role: 'line' }],
  fields: [
    {
      key: 'poleName',
      label: '電柱名称',
      type: 'text',
      defaultValue: '中電柱：',
      help: '「中電柱：」が最初から入っている（中国電力の電柱）。その後ろに電柱の名称を入力する（例: 猪子山（分）81）。（分）（幹）（支）（連絡）などの区分は、電柱に記載されている内容をそのまま反映する',
    },
  ],
  status: 'confirmed',
  statusNote: '見本図面のとおり、円の左半分を縦線でハッチングする形にしました。',
  note,
});

export const incomingSymbols: SymbolDef[] = [
  pole('pole-utility', '電柱', '電柱（電力会社所有）', '引込元パターンA。名称は「中電柱：猪子山（分）81」の形式。「中電柱：」は共通で、それ以降が現場ごとに異なる。'),
  pole('pole-customer', '客柱', 'お客様電柱', 'PASは電柱上に設置するため、図面上「お客様電柱」として描かれる場合がある。'),
  {
    /*
     * 引込元が地上キャビネットのときの記号（電柱の代わり）。
     * 断路器（DS）の図記号に、ASやPASと同じ実線の長方形の外枠をかぶせた形。
     * 引込元なので、上からつなぐ線は無い（接続点は下の1つだけ）。
     * 開閉部の寸法はDS（固定接点の横バー・右上がりの可動刃）と同じで、左へ 4 ずらしてある。
     * 上の縦線は、枠の上端から6だけ突き出させてある。
     */
    id: 'cabinet',
    abbr: 'CAB',
    nameJa: '地上キャビネット（引込元）',
    nameFormal: '地上設置金属製ボックス',
    category: 'incoming',
    tags: ['引込元', '地上', 'キャビネット'],
    box: { w: 56, h: 88 },
    shapes: [
      // 枠の上端は y=8。縦線は、その上（y=0）から始めて、枠の上へ少し突き出させる
      rect(4, 8, 48, 70),
      // 中身：DSと同じ開閉部
      vline(28, 0, 19),
      hline(19, 17, 39),
      line(28, 55, 48, 24),
      vline(28, 55, 88),
    ],
    ports: [{ id: 'out', x: 28, y: 88, dir: 'down', role: 'line' }],
    fields: [
      { key: 'cabinetName', label: 'キャビネット名称', type: 'text', defaultValue: 'キャビネット番号：', help: '「キャビネット番号：」が最初から入っている。その後ろに名称を入力する' },
    ],
    labelLines: ['{cabinetName}'],
    status: 'confirmed',
    statusNote: '断路器（DS）の図記号に、AS・PASと同じ実線の外枠をかぶせる形にしました。',
    note: '引込元が地上キャビネットのとき、電柱の代わりに一番上に描く。記号の脇に「キャビネット番号：」＋名称を書く。電柱も AS も無い。',
  },
  {
    id: 'incoming-point',
    abbr: '引込点',
    nameJa: '引込点',
    category: 'incoming',
    tags: ['引込', '受電点', 'ジグザグ'],
    // ジグザグ部分は、横幅を以前の1.5倍（中心から左右へ20→30）、縦の長さを以前の0.8倍（32→25.6）にしてある
    box: { w: 60, h: 44 },
    shapes: [
      vline(30, 0, 9),
      line(30, 9, 0, 17),
      line(0, 17, 60, 26.6),
      line(60, 26.6, 30, 34.6),
      vline(30, 34.6, 44),
    ],
    ports: [
      { id: 'in', x: 30, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 30, y: 44, dir: 'down', role: 'line' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のジグザグ記号が引込点であることを確認しました。',
    note: '電柱と責任分界点の間に入る。3点一致（約99%）の場合、この直下とPASの間に分界点の横線を引く。',
  },
  {
    id: 'cable-head',
    abbr: 'CH',
    nameJa: '高圧ケーブル端末',
    nameFormal: 'ケーブル終端接続部',
    category: 'incoming',
    tags: ['受電点', 'ケーブルヘッド', '端末処理'],
    // 大きさは、もとの 40×40 の 60%（24×24）。線の太さは変えない
    box: { w: 24, h: 24 },
    shapes: [
      vline(12, 0, 3.6),
      poly([3.6, 3.6, 20.4, 3.6, 12, 18], { close: true, fill: 'none' }),
      vline(12, 18, 24),
    ],
    ports: [
      { id: 'in', x: 12, y: 0, dir: 'up', role: 'line' },
      { id: 'out', x: 12, y: 24, dir: 'down', role: 'line' },
    ],
    status: 'confirmed',
    statusNote: '見本図面のとおり三角形にしました。頂点がケーブル側を向きます。大きさは、もとの60%にしました。',
    note: '受電側の端末は同じ記号を180°回転して使う（頂点が常にケーブル側を向く）。電気設備側の引込点は、図面上まずこの高圧ケーブル端末が該当する。',
  },
];

/** 分界点の横線。主回路の右寄りを通し、横線を左へ長く伸ばして左上に文言を書く */
const boundary = (id: string, nameJa: string, label: string, note: string): SymbolDef => ({
  id,
  abbr: label,
  nameJa,
  category: 'boundary',
  tags: ['分界点'],
  box: { w: 120, h: 24 },
  shapes: [vline(96, 0, 24), hline(12, 0, 120)],
  ports: [
    { id: 'in', x: 96, y: 0, dir: 'up', role: 'line' },
    { id: 'out', x: 96, y: 24, dir: 'down', role: 'line' },
  ],
  defaultLabel: label,
  status: 'confirmed',
  statusNote: '見本図面のとおり、横線を左へ長く伸ばし、その左上に文言を太字で記載します。',
  note,
});

/**
 * 保安上の責任分界点（3点不一致のとき）。
 * 主遮断装置（VCBまたはLBS）の図記号の**中央に重ねる横線**で、縦線は持たない（縦線は主遮断装置自身のもの）。
 * 横線は主回路の左へ長く伸ばし（文言の幅ぶん）、右へは図記号の外まで少しだけ出す。文言はその線の左上に書く。
 * 箱の高さを2にしてあるのは、線の太さを持たせるため。置き場所は layout が決める（主遮断装置の中央）。
 */
export const BOUNDARY_SAFETY_LEFT = 130;
export const BOUNDARY_SAFETY_RIGHT = 24;

incomingSymbols.push(
  {
    id: 'boundary-safety',
    abbr: '責任分界点',
    nameJa: '責任分界点（3点不一致のとき）',
    category: 'boundary',
    tags: ['分界点', '責任分界点'],
    box: { w: BOUNDARY_SAFETY_LEFT + BOUNDARY_SAFETY_RIGHT, h: 2 },
    shapes: [hline(1, 0, BOUNDARY_SAFETY_LEFT + BOUNDARY_SAFETY_RIGHT)],
    ports: [],
    overlay: true,
    defaultLabel: '責任分界点',
    status: 'confirmed',
    statusNote: '主遮断装置（VCBまたはLBS）の図記号の中央に重ねる横線。その左上に「責任分界点」と記載します。',
    note: '3点不一致のとき、保安上の責任分界点は主遮断装置の図記号の位置に置く。CB形ならVCB、PFS形ならLBS。',
  },
  boundary(
    'boundary-both',
    '財産・責任分界点（3点一致）',
    '財産・責任分界点',
    '3点一致（全体の約99%）。引込点の図記号とPASの間に横線を引く。',
  ),
  boundary(
    'boundary-property',
    '財産分界点（3点不一致のとき）',
    '財産分界点',
    '3点不一致（全体の約1%）。引込点と同一地点に記載する。',
  ),
);
