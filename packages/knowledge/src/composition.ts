import type { Condition } from './condition.ts';
import { COUNT_LIMITS, MAX_COUNT } from './counts.ts';
import { PROPERTY_AT_DS } from './questions/common.ts';

/** 主遮断装置の地絡継電器が付くか。DGRはZPDが「ある」ときだけ、GR（ZCTのみ）はZPDに関わらず付く */
export const MAIN_GROUND_ON: Condition = {
  any: [{ all: [{ key: 'mainGroundRelay', eq: 'dgr' }, { key: 'hasZpd', eq: 'yes' }] }, { key: 'mainGroundRelay', eq: 'gr' }],
};
/** LAの上側に付く開閉器（DS・PC・LBS）。付くときは、LAを、この開閉器の真下に縦につなげて置く */
const LA_SWITCHES = ['ds', 'pc', 'lbs'];
const LA_ITEMS: Placement[] = [
  ...(['ds', 'pc', 'lbs'] as const).map((v): Placement => ({
    role: 'la-switch',
    symbolId: v,
    kind: 'branch-left',
    tapFrom: 'laTap',
    upright: true,
    when: { all: [{ key: 'hasLa', eq: 'yes' }, { key: 'laSwitch', eq: v }] },
    labelTemplate: [v.toUpperCase()],
    note: 'LAの上側（主回路の側）に付く開閉器。LAは、この開閉器の真下につなぐ',
  })),
  {
    role: 'site-la',
    symbolId: 'la',
    kind: 'branch-left',
    tapFrom: 'laTap',
    upright: true,
    hang: true,
    when: { all: [{ key: 'hasLa', eq: 'yes' }, { key: 'laSwitch', in: LA_SWITCHES }] },
    labelTemplate: ['LA'],
  },
  {
    role: 'site-la',
    symbolId: 'la',
    kind: 'branch-left',
    tapFrom: 'laTap',
    upright: true,
    when: { all: [{ key: 'hasLa', eq: 'yes' }, { not: { key: 'laSwitch', in: LA_SWITCHES } }] },
    labelTemplate: ['LA'],
  },
];

/** GCの上側に付く開閉器。LAと同じ作り（開閉器の真下にGCを縦につなげて置く） */
const GC_ITEMS: Placement[] = [
  ...(['ds', 'pc', 'lbs'] as const).map((v): Placement => ({
    role: 'gc-switch',
    symbolId: v,
    kind: 'branch-left',
    tapFrom: 'gcTap',
    tapDefault: 'zct-source',
    upright: true,
    when: { all: [{ key: 'hasGc', eq: 'yes' }, { key: 'gcSwitch', eq: v }] },
    labelTemplate: [v.toUpperCase()],
    note: 'GCの上側（主回路の側）に付く開閉器。GCは、この開閉器の真下につなぐ',
  })),
  {
    role: 'site-gc',
    symbolId: 'gc',
    kind: 'branch-left',
    tapFrom: 'gcTap',
    tapDefault: 'zct-source',
    upright: true,
    hang: true,
    when: { all: [{ key: 'hasGc', eq: 'yes' }, { key: 'gcSwitch', in: LA_SWITCHES }] },
    labelTemplate: ['GC'],
  },
  {
    role: 'site-gc',
    symbolId: 'gc',
    kind: 'branch-left',
    tapFrom: 'gcTap',
    tapDefault: 'zct-source',
    upright: true,
    when: { all: [{ key: 'hasGc', eq: 'yes' }, { not: { key: 'gcSwitch', in: LA_SWITCHES } }] },
    labelTemplate: ['GC'],
  },
];

/** 区分開閉器も地上キャビネットも無く、引込点から責任分界点までのあいだに、ケーブルがあるとき */
const PRE_CABLE: Condition = {
  all: [{ key: 'sectionalizer', eq: 'none' }, { key: 'groundCabinet', eq: 'no' }, { key: 'preCable', eq: 'yes' }],
};

/** 送り出しの開閉器の地絡継電器が付くか（DGR・GRの考え方は、主遮断装置と同じ） */
const SENDOUT_GROUND_ON: Condition = {
  // DGRの零相電圧は、送り出す側のエリアのZPDから得る（linkSenderZpd：送り出す側のエリアにZPDがあるか。エリアの答えを見るとき、engine が足す）
  any: [{ all: [{ key: 'linkGroundRelay', eq: 'dgr' }, { key: 'linkSenderZpd', eq: 'yes' }] }, { key: 'linkGroundRelay', eq: 'gr' }],
};

/**
 * 構成テンプレート。上流（引込側）から下流へ、どの記号がどの条件で入るかをデータで定義する。
 *
 * ナレッジベースの分岐（3点一致／PFS形・CB形／PASの制御装置／VCTの位置 等）は
 * すべて when の条件式として書いてあるので、新しい分岐は1件追加するだけで反映される。
 */

export type PlacementKind =
  /** 主回路に直列に入る */
  | 'series'
  /** 主回路から左へ分岐する */
  | 'branch-left'
  /** 主回路から右へ分岐する */
  | 'branch-right'
  /** 親の記号の中（slot）に入る */
  | 'inside'
  /** 主回路を囲む枠（キュービクルの範囲など） */
  | 'frame'
  /** ほかの機器（VCB）の横に、並列に入る（励磁突入電流抑制開閉器）。上と下を、主回路につなぐ */
  | 'bypass'
  /** 別の機器の真上に、隙間を空けて、名前だけ書く（置き場所が決まっていない継電器） */
  | 'note-above'
  /** ほかの機器（VCB）の横に置き、別の機器（OCR）と線でつなぐ（トリップコイル） */
  | 'coil'
  /** 2か所目以降のエリアを、前のエリアにつなぐケーブル（記号ではなく、つなぎ方を表す） */
  | 'link'
  /** 1か所目のエリアから、ほかのエリアへ送り出す線の途中に入る開閉器（DS・VCB・LBS）。線の上に置く */
  | 'sendout'
  /**
   * 高圧母線から下へ並列にぶら下がる（変圧器・高圧進相設備など）。
   * 1台だけのときは母線を描かず、主回路にそのまま直列で入る。
   */
  | 'parallel'
  /** 低圧母線から下へ出る回線（回線ごとに縦に並べる） */
  | 'feeder'
  /**
   * どこにも結線せず、図面の下に置くだけ。
   * 発電機・太陽光・蓄電池は、変圧器のどこにつながるかが現地のメモで初めて分かるため、
   * たたき台の段階では線をつながずに置いておき、あとから図面上で結線する。
   */
  | 'free'
  /**
   * 別の記号（attachTo）の上に重ねて描くだけの印。主回路の長さや並びは変えない。
   * 3点不一致のとき、主遮断装置（VCBまたはLBS）の中央に引く責任分界点の横線がこれ。
   */
  | 'overlay'
  /**
   * 別の記号（attachTo）の左側に、線をつながずに、隙間を空けて置く印。主回路の長さや並びは変えない。
   * 高さは、その記号の本体（枠）の真ん中にそろえる。PAS・PGSの左に置く客柱がこれ。
   */
  | 'beside-left';

export interface Placement {
  role: string;
  symbolId: string;
  kind: PlacementKind;
  when?: Condition;
  /** kind==='inside' のときの親のロールとスロット */
  parent?: string;
  slot?: string;
  /** 図面に添える文字。{質問ID} を回答で置き換え、値が無い行は落とす */
  labelTemplate?: string[];
  /** 記号の入力項目 ← 質問ID の対応 */
  props?: Record<string, string>;
  /** 同じ機器を繰り返す件数を持つ質問ID */
  repeatCountKey?: string;
  /** この機器の下に空ける間隔（既定より広げたいとき） */
  gapAfter?: number;
  /** この機器の下の線を点線にする条件（埋設ケーブルなど） */
  dashedAfter?: Condition;
  /** 二次側から結線してくる機器のロール（継電器など） */
  connectFrom?: string[];
  /** 文字を記号のどちら側に書くか（既定は右） */
  labelSide?: 'left' | 'right';
  /** kind==='overlay'・'beside-left' のとき、重ねる（横に置く）先の記号のロール */
  attachTo?: string;
  /** つなぐ位置を答える質問のID（ZPD・LA）。答えに応じて、並びの位置を動かす */
  tapFrom?: string;
  /** つなぐ位置を、まだ答えていないときの位置（無ければ ct-bus。GCは zct-source） */
  tapDefault?: string;
  /** 分岐するとき、横に回さず、縦のまま置く（LA：真横に出た線が、真下に折れて、記号が縦に並ぶ） */
  upright?: boolean;
  /** 直前の同じ向きの分岐と、横につなげず、別の分岐として出す */
  separate?: boolean;
  /** 直前の分岐（開閉器）の真下に、縦につなげて置く（LAの上に開閉器が付くとき：開閉器の下にLA） */
  hang?: boolean;
  /** 件数が0のときは、1件も出さない（継電器：0個もありうる）。ふつうは、最低1件出す */
  zeroOk?: boolean;
  /** 位置を答える質問のID（CT：主遮断装置の一次側・二次側など）。答えを PlacedItem.pos に入れ、並びに使う */
  posFrom?: string;
  /** つながる先を答える質問のID（継電器：ct-1・vt-2・none）。答えを PlacedItem.ref に入れ、並びとつなぎ方に使う */
  refFrom?: string;
  /**
   * kind==='feeder' のときの列番号の始まり。
   * 低圧の回線と、あとから結線する発電機などが同じ列に重ならないよう、
   * 種類ごとに離れた番号から始める。
   */
  laneBase?: number;
  /**
   * 高圧母線から並列にぶら下がるときの「段」。
   * 同じ段の機器は、どの列でも同じ高さに揃う。
   * PCやLBSが無い列は、その段を空けたまま母線からの線を長く引く。
   *   0 … PC（高圧カットアウト）
   *   1 … LBS
   *   2 … VCS（真空電磁接触器）
   *   3 … SR（直列リアクトル）
   *   4 … 本体（変圧器・コンデンサ）既定
   */
  row?: number;
  note?: string;
}

/** 並列の段。読みやすさのために名前を付けておく */
export const ROW = { pc: 0, lbs: 1, vcs: 2, reactor: 3, main: 4 } as const;
export const ROW_COUNT = 5;

/** 引込元から受電設備の入口まで（主遮断装置の形式によらず共通） */
export const UPSTREAM: Placement[] = [
  {
    role: 'source-pole',
    symbolId: 'pole-utility',
    kind: 'series',
    when: { key: 'sourceType', ne: 'cabinet' },
    // 引込元が電柱のとき：電力会社所有の電柱
    labelTemplate: ['{sourceLabel}'],
  },
  {
    // 引込元が地上キャビネットのとき：電柱の代わりに、DSの図記号に外枠をかぶせた記号
    role: 'source-cabinet',
    symbolId: 'cabinet',
    kind: 'series',
    when: { key: 'sourceType', eq: 'cabinet' },
    labelTemplate: ['{sourceLabel}'],
  },
  {
    role: 'as',
    symbolId: 'as',
    kind: 'series',
    // 引込元が地上キャビネットのときは、電柱が無いので AS も無い（前に「あり」と答えていても描かない）
    when: { all: [{ key: 'hasAs', eq: 'yes' }, { key: 'sourceType', ne: 'cabinet' }] },
    labelTemplate: ['AS'],
  },
  { role: 'incoming-point', symbolId: 'incoming-point', kind: 'series' },
  {
    // 区分開閉器も地上キャビネットも無く、引込点から責任分界点までのあいだにケーブルが入るとき（特別高圧受電設備に多い）。
    // ケーブルの描き方は、引込ケーブル・エリア間のケーブルと同じ（上に下向きの端末と文字、下に上向きの端末。埋設は点線）
    role: 'pre-cable-source',
    symbolId: 'cable-head',
    kind: 'series',
    when: PRE_CABLE,
    labelTemplate: ['{preCableInstallationLabel}', '{preCableStructure}', '{preCableSpecLine}'],
    gapAfter: 56,
    dashedAfter: { key: 'preCableInstallation', eq: 'buried' },
    note: '引込点と責任分界点のあいだのケーブル（送り出し側の端末）。埋設（埋ケ）のときは線を点線で描く',
  },
  {
    role: 'pre-cable-site',
    symbolId: 'cable-head',
    kind: 'series',
    when: PRE_CABLE,
    note: '引込点と責任分界点のあいだのケーブル（受ける側の端末。180°回して使う）',
  },
  {
    role: 'boundary',
    labelSide: 'left',
    symbolId: 'boundary-both',
    kind: 'series',
    when: { all: [{ key: 'boundaryPattern', eq: 'coincident' }, { not: PROPERTY_AT_DS }] },
    labelTemplate: ['財産・責任分界点'],
    note: '3点一致（約99%）。引込点の図記号とPASの間に横線を引く',
  },
  {
    role: 'boundary-property',
    labelSide: 'left',
    symbolId: 'boundary-property',
    kind: 'series',
    when: { all: [{ key: 'boundaryPattern', eq: 'split' }, { not: PROPERTY_AT_DS }] },
    labelTemplate: ['財産分界点'],
  },
  {
    // 区分開閉器が無いとき、電力会社の地上キャビネットで受電する。
    // 区分開閉器が描かれる場所に、断路器（DS）の図記号と「地上キャビネット／種類の名前」を書く
    role: 'ground-cabinet',
    symbolId: 'ds',
    kind: 'series',
    when: { all: [{ key: 'hasPas', eq: 'no' }, { key: 'groundCabinet', eq: 'yes' }] },
    labelTemplate: ['地上キャビネット', '{groundCabinetTypeName}'],
    note: '区分開閉器なし＋地上キャビネットあり。種類（モールドディスコン／T型シェルター／三極連動）は名前の文字だけで区別する',
  },
  {
    role: 'pas',
    // 内蔵機器（LA・VT）が入るときは、枠を少し広げたほうを使う（engine の pasSymbol）
    // PGS（キャビネット内の区分開閉器）も、同じ図記号で、名前だけ「PGS」と書く
    symbolId: '{pasSymbol}',
    kind: 'series',
    when: { key: 'hasPas', eq: 'yes' },
    // UGSのときは、キャビネットの名称を、定格の欄のすぐ上（先頭）に書く
    labelTemplate: ['{ugsCabinetLabel}', '{sectionalizerName}', '{pasRatingText}', '{pasBuiltinText}'],
    props: { ratedVoltage: 'pasRatedVoltage', ratedCurrent: 'pasRatedCurrent', control: 'pasControl' },
  },
  {
    // 客柱：PAS・PGSは電柱の上に付けるので、開閉器の左に、客柱の丸を添える（UGS・区分開閉器なしでは出さない）。
    // 線はつながない。高さは、開閉器の枠の真ん中
    role: 'customer-pole',
    symbolId: 'pole-customer',
    kind: 'beside-left',
    attachTo: 'pas',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'sectionalizer', ne: 'ugs' }] },
    note: 'PAS・PGSの左に、客柱（円の左半分を塗った丸）を、隙間を空けて置く。UGSのときは置かない',
  },
  {
    // SOG（GR/DGR）があれば、ZCTはPASに内蔵される。無ければ入らない
    role: 'pas-zct',
    symbolId: 'zct',
    kind: 'inside',
    parent: 'pas',
    slot: 'zct',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', in: ['gr', 'dgr'] }] },
  },
  {
    // VTもSOGがあるときだけ。SOGが無いPASにVTは入らない
    role: 'pas-vt',
    symbolId: 'vt',
    kind: 'inside',
    parent: 'pas',
    slot: 'vt',
    when: {
      all: [
        { key: 'hasPas', eq: 'yes' },
        { key: 'pasControl', in: ['gr', 'dgr'] },
        { key: 'pasBuiltinVt', eq: 'yes' },
      ],
    },
  },
  {
    role: 'pas-la',
    symbolId: 'la',
    kind: 'inside',
    parent: 'pas',
    slot: 'la',
    // LAはSOGの有無に関わらず内蔵されることがある
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasBuiltinLa', eq: 'yes' }] },
    note: 'LAの接地はPAS本体の接地と同じ箇所で施工する',
  },
  {
    // DGRのときは、零相電圧を得るZPDも、PAS・PGSの枠の中に入れる（枠の大きさは変えず、ZPDのほうを小さくして収める）
    role: 'pas-zpd',
    // LAも入るときは、接地記号の無いほう（engine の pasZpdSymbol）
    symbolId: '{pasZpdSymbol}',
    kind: 'inside',
    parent: 'pas',
    slot: 'zpd',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'dgr' }] },
    note: 'DGR方式の区分開閉器（PAS・PGS）の中に、ZCT・VTと並べて入れる。GR・SOGなしのときは入れない',
  },
  {
    role: 'pas-relay',
    symbolId: 'relay-gr',
    kind: 'branch-right',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'gr' }] },
    connectFrom: ['pas-zct'],
  },
  {
    role: 'pas-relay',
    symbolId: 'relay-dgr',
    kind: 'branch-right',
    when: { all: [{ key: 'hasPas', eq: 'yes' }, { key: 'pasControl', eq: 'dgr' }] },
    connectFrom: ['pas-zct', 'pas-vt', 'pas-zpd'],
  },
  {
    role: 'vct-pole',
    symbolId: 'vct',
    kind: 'series',
    when: { key: 'vctLocation', eq: 'pole' },
    // 図記号の中に「VCT」の文字は無いので、右横に書く
    labelTemplate: ['VCT'],
    repeatCountKey: 'vctCount',
    props: { location: 'vctLocation' },
  },
  {
    // 引込ケーブルが「なし」のとき（電柱の上に受電設備を構成する場合など）は、ケーブル端末も描かない
    role: 'cable-head-source',
    symbolId: 'cable-head',
    kind: 'series',
    when: { key: 'cableInstallation', ne: 'none' },
    labelTemplate: ['{cableInstallationLabel}', '{cableStructure}', '{cableSpecLine}'],
    gapAfter: 56,
    dashedAfter: { key: 'cableInstallation', eq: 'buried' },
    note: '埋設（埋ケ）のときはケーブルの線を点線で描く',
  },
  {
    role: 'area-frame',
    symbolId: 'enclosure-cubicle',
    kind: 'frame',
    // 高圧マンション（電柱上構成）は、箱やエリアで分かれているのではなく、区分開閉器と同じ場所
    // （電柱の上）に設備があるので、エリアの外枠は描かない
    when: {
      not: { any: [{ key: 'areaForm', eq: 'apartment-pole' }, { key: 'mainBreakerForm', eq: 'pole-top' }] },
    },
    labelTemplate: ['{areaLabel}'],
    note: 'この枠から下がキュービクル（電気室）の中。高圧マンション（電柱上構成）のときは描かない',
  },
  {
    // 主遮断装置に付くDGR：ZCTは、初期値では、引込の高圧ケーブルに付ける（ケーブルの受電側の端末の手前）。DGRは、ZCTの横。
    // 「母線」を選んだときは、主遮断装置の一次側・二次側（下のDOWNSTREAMの、同じ役割の記号）。
    // DGRは、ZPDが「ある」ときだけ（ZPDとDGRの間に、線は引かない）
    role: 'main-zct',
    symbolId: 'zct',
    kind: 'series',
    posFrom: 'mainZctPos',
    when: { all: [MAIN_GROUND_ON, { not: { key: 'mainZctPos', in: ['bus-primary', 'bus-secondary'] } }] },
    note: '主遮断装置のDGR用のZCT。引込の高圧ケーブルに付ける',
  },
  {
    role: 'main-ground-relay',
    symbolId: 'relay-dgr',
    kind: 'branch-right',
    when: { all: [{ key: 'mainGroundRelay', eq: 'dgr' }, { key: 'hasZpd', eq: 'yes' }] },
    connectFrom: ['main-zct'],
  },
  {
    role: 'main-ground-relay',
    symbolId: 'relay-gr',
    kind: 'branch-right',
    when: { key: 'mainGroundRelay', eq: 'gr' },
    connectFrom: ['main-zct'],
  },
  {
    role: 'cable-head-site',
    symbolId: 'cable-head',
    kind: 'series',
    when: { key: 'cableInstallation', ne: 'none' },
    note: '受電側の端末。同じ記号を180°回転して使う',
  },
  {
    role: 'vct-indoor',
    symbolId: 'vct',
    kind: 'series',
    when: { key: 'vctLocation', eq: 'indoor' },
    labelTemplate: ['VCT'],
    repeatCountKey: 'vctCount',
    props: { location: 'vctLocation' },
    note: 'PFS形ならケーブルとLBSの間、CB形ならケーブルとDSの間に入る',
  },
];

/**
 * 区分開閉器が「なし」で、引込ケーブルが電力会社のものなら、財産分界点は、ケーブルの負荷側にある。
 * VCT（電力会社の持ち物）がケーブルの負荷側にあるので、DSの一次側（DSが無ければ、LBSの一次側）。
 * 財産と責任の分界点を同じ位置とみなして、「財産・責任分界点」の横線を、DS（LBS）の真上に1本引く
 */
const BOUNDARY_AT_DS: Placement = {
  role: 'boundary-ds',
  labelSide: 'left',
  symbolId: 'boundary-both',
  kind: 'series',
  when: PROPERTY_AT_DS,
  labelTemplate: ['財産・責任分界点'],
  note: '区分開閉器なし＋電力会社のケーブル。財産分界点は、DS（無ければLBS）の一次側。VCTの下、DSの真上に横線を引く',
};

/** 主遮断装置がLBSの構成 */
export const PFS_CHAIN: Placement[] = [
  BOUNDARY_AT_DS,
  {
    role: 'main-breaker',
    symbolId: 'lbs-pf',
    kind: 'series',
    labelTemplate: ['LBS', '{lbsRatingLine}', 'PF×{lbsFuseCount}', '{lbsPfLine}'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent', fuseCount: 'lbsFuseCount', fuseSpec: 'lbsPfLine' },
  },
];

/** 主遮断装置がVCBの構成 */
export const CB_CHAIN: Placement[] = [
  BOUNDARY_AT_DS,
  { role: 'ds', symbolId: 'ds', kind: 'series', labelTemplate: ['DS', '{dsRating}'] },
  {
    role: 'main-breaker',
    symbolId: 'vcb',
    kind: 'series',
    labelTemplate: ['VCB', '{vcbRating}'],
  },
  {
    // 励磁突入電流抑制開閉器：VCBと並列に入るLBS（PF付）。VCBの左に並べ、上と下を主回路につなぐ
    role: 'inrush-lbs',
    symbolId: 'lbs-pf',
    kind: 'bypass',
    attachTo: 'main-breaker',
    labelSide: 'left',
    when: { all: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasInrush', eq: 'yes' }] },
    labelTemplate: ['励突抑制開閉器', 'LBS', '{inrushRatedVoltage}V', '{inrushRatedCurrent}A', 'PF×{inrushFuseCount}', '{inrushFuseSpec}'],
    props: { ratedVoltage: 'inrushRatedVoltage', ratedCurrent: 'inrushRatedCurrent', fuseCount: 'inrushFuseCount', fuseSpec: 'inrushFuseSpec' },
    note: 'VCBと並列。系統用蓄電所などで、励磁突入電流を抑えるために入る',
  },
];

/** VT・CTの組の番号（1〜6組目）。継電器の「どこについているか」の値（ct-1・vt-1 など）に使う */
const SET_NOS = [1, 2, 3, 4, 5, 6];
export const CT_AT_VALUES = SET_NOS.map((n) => `ct-${n}`);
export const VT_AT_VALUES = SET_NOS.map((n) => `vt-${n}`);
/** VT・CTが入る構成か（DS＋VCBの標準構成は必ず入る。それ以外は「ありますか？」の答え） */
export const VT_SHOWN: Condition = {
  any: [{ key: 'intakeStandard', eq: 'yes' }, { all: [{ key: 'intakeOptional', eq: 'yes' }, { key: 'hasSiteVt', eq: 'yes' }] }],
};
export const CT_SHOWN: Condition = { any: [{ key: 'intakeStandard', eq: 'yes' }, { key: 'hasSiteCt', eq: 'yes' }] };
const RELAY_ON_SET: Condition = { key: 'relayAt', in: [...CT_AT_VALUES, ...VT_AT_VALUES] };

/**
 * VT・CT（組ごと）と、保護継電器（1個ずつ）。1か所目も、2か所目以降のエリアも、同じものを使う。
 *
 * - VT・CTは「組」で数える。組ごとに、台数・変成比・位置（主遮断装置の一次側／二次側など）を答える。
 *   1組目は、これまでの答え（vtCount・ctCount など）をそのまま使う。
 * - 継電器は、1個ずつ「種類」「どこについているか」「試験端子の有無」を答える（relayAt／relayTest）。
 *   どこについているかが決まっていないものは、OCR（なければOVGR）の真上に、名前だけを書く。
 * - 並びは、並べたあとに、engine の arrangeInstruments が、主回路の上から順に整える。
 *   継電器は、つながる先（CT・VT）のすぐあとに続く。
 */
export const INSTRUMENTS: Placement[] = [
  // ---- VT（組ごと）。位置は、主遮断装置の一次側（DSの次）か二次側 ----
  {
    role: 'ds-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    repeatCountKey: 'vtSetCount',
    zeroOk: true,
    when: { all: [VT_SHOWN, { key: 'vtPosition', eq: 'primary' }] },
    labelTemplate: ['{vtPfHead}', '{vtConnectionText}', '{vtRatio}'],
    note: '主遮断装置の手前（DSの次）にVTを並列接続する（直列ではない）。VTの手前にPFが入る',
  },
  {
    role: 'ds-vt',
    symbolId: 'vt',
    kind: 'branch-right',
    repeatCountKey: 'vtSetCount',
    zeroOk: true,
    when: { all: [VT_SHOWN, { key: 'vtPosition', eq: 'primary' }] },
    props: { ratio: 'vtRatio' },
  },
  {
    role: 'site-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    repeatCountKey: 'vtSetCount',
    zeroOk: true,
    when: { all: [VT_SHOWN, { key: 'vtPosition', ne: 'primary' }] },
    labelTemplate: ['{vtPfHead}', '{vtConnectionText}', '{vtRatio}'],
  },
  {
    role: 'site-vt',
    symbolId: 'vt',
    kind: 'branch-right',
    repeatCountKey: 'vtSetCount',
    zeroOk: true,
    when: { all: [VT_SHOWN, { key: 'vtPosition', ne: 'primary' }] },
    props: { ratio: 'vtRatio' },
  },
  // ---- CT（組ごと）。位置は、主遮断装置の一次側・二次側・VTのあと ----
  {
    role: 'ct',
    symbolId: 'ct',
    kind: 'series',
    repeatCountKey: 'ctSetCount',
    zeroOk: true,
    when: CT_SHOWN,
    posFrom: 'ctPosition',
    labelTemplate: ['{ctHead}', '{ctRatioText}'],
    props: { ratio: 'ctRatioText' },
  },
  // ---- 保護継電器（OCR・UVR・OVRなど。1個ずつ） ----
  // 試験端子（あり）。CTにつくものは、主回路から右へ。VTにつくものは、VTの右の端からつなぐ（engine が決める）
  {
    role: 'relay-tt',
    symbolId: 'test-terminal',
    kind: 'branch-right',
    repeatCountKey: 'relayCount',
    zeroOk: true,
    refFrom: 'relayAt',
    when: { all: [RELAY_ON_SET, { key: 'relayTest', ne: 'no' }] },
    note: '継電器の手前の試験端子。「なし」にすると、継電器だけを置く',
  },
  {
    role: 'relay',
    symbolId: '{relaySymbol}',
    kind: 'branch-right',
    repeatCountKey: 'relayCount',
    zeroOk: true,
    refFrom: 'relayAt',
    when: { all: [RELAY_ON_SET, { key: 'relayType', answered: true }] },
  },
  // 置き場所が決まっていない継電器：OCR（なければOVGR）のすぐ上に、線をつながず、隙間を空けて、名前だけ書く
  {
    role: 'relay-note',
    symbolId: '{relaySymbol}',
    kind: 'note-above',
    repeatCountKey: 'relayCount',
    zeroOk: true,
    refFrom: 'relayAt',
    // 置き場所を「決まっていない」と答えたものだけ（まだ答えていないものは、推測で描かない）
    when: { all: [{ key: 'relayAt', eq: 'none' }, { key: 'relayType', answered: true }] },
    note: '置き場所が決まっていない継電器。OCRの真上に、隙間を空けて、名前だけ書く',
  },
  // トリップコイル：VCBの横に置き、OCRとつなぐ（どのOCRがどのVCBに対応しているかを、はっきりさせる）。
  // VCBとOCRの両方があるときだけ、engine が残す
  {
    role: 'trip-coil',
    symbolId: 'trip-coil',
    kind: 'coil',
    attachTo: 'main-breaker',
    // 記号の枠の中に「TC」と入っているので、横に名前の文字は付けない
    labelTemplate: [],
    note: 'VCBのトリップコイル。OCRの出力とつなぐ',
  },
];

/** 主遮断装置の下流（PFS形・CB形で共通） */
export const DOWNSTREAM: Placement[] = [
  {
    // 3点不一致のとき、責任分界点は主遮断装置の図記号の位置に置く。
    // 図記号の中央に横線を引き、その線に文言を書く（CB形ならVCB、PFS形ならLBS）
    role: 'boundary-safety',
    symbolId: 'boundary-safety',
    kind: 'overlay',
    attachTo: 'main-breaker',
    // どの機器の上かは、主遮断装置の形式から自動で決まる（CB形ならVCB、PFS形ならLBS）。
    // 形式が未入力のときだけ、「責任分界点はLBSですか、VCBですか？」の答えを見る
    // （未入力のときの主遮断装置はLBSとして描かれるので、LBSと答えたときだけ引ける）
    when: {
      all: [
        { key: 'boundaryPattern', eq: 'split' },
        { not: PROPERTY_AT_DS },
        {
          any: [
            { key: 'mainBreakerForm', eq: 'cb' },
            { key: 'mainBreakerForm', eq: 'pfs' },
            {
              all: [
                { not: { key: 'mainBreakerForm', answered: true } },
                { key: 'boundarySafetyDevice', eq: 'lbs' },
              ],
            },
          ],
        },
      ],
    },
    labelTemplate: ['責任分界点'],
    note: '3点不一致（約1%）。主遮断装置の図記号の中央に横線を引き、「責任分界点」と記載する',
  },
  {
    // 主遮断装置のDGR用のZCTを、母線に付けるとき（主遮断装置の一次側・二次側）。位置は、engine が、主遮断装置の前後に置く
    role: 'main-zct',
    symbolId: 'zct',
    kind: 'series',
    posFrom: 'mainZctPos',
    when: { all: [MAIN_GROUND_ON, { key: 'mainZctPos', in: ['bus-primary', 'bus-secondary'] }] },
    note: '主遮断装置のDGR用のZCT。母線（主遮断装置の一次側または二次側）に付ける',
  },
  ...INSTRUMENTS,
  {
    role: 'zpd',
    symbolId: 'zpd',
    kind: 'branch-left',
    tapFrom: 'zpdTap',
    when: { key: 'hasZpd', eq: 'yes' },
    labelTemplate: ['ZPD'],
  },
  {
    // OVGR：ZPDの左側。「OVGRはありますか？」に「ある」と答えたときだけ
    role: 'ovgr',
    symbolId: 'relay-ovgr',
    kind: 'branch-left',
    tapFrom: 'zpdTap',
    when: { all: [{ key: 'hasZpd', eq: 'yes' }, { key: 'hasOvgr', eq: 'yes' }] },
    connectFrom: ['zpd'],
  },
  ...LA_ITEMS,
  ...GC_ITEMS,
];

/**
 * 受電設備エリアが2か所以上のとき、2か所目以降のエリアの、受電側の機器の並び。
 * 1か所目と違い、主遮断装置の形式（CB形・PFS形）ではなく、「このエリアの受電側の開閉器」（areaIntake）で決まる。
 * 条件には、engine の intakeFlags（intakeDs・intakeVcb・intakeLbs・intakeLbsPf・intakeStandard・intakeOptional）を使う。
 */
export const AREA_CHAIN: Placement[] = [
  {
    role: 'link',
    symbolId: 'cable-head',
    kind: 'link',
    labelTemplate: ['{linkCableInstallationLabel}', '{linkCableStructure}', '{linkCableSpecLine}'],
    note: '前のエリアから分岐してくる線。つなぎ方（どこから・どこへ）は、図面の配置で使う。ケーブルのとき（linkCable が「いいえ」以外）は、ケーブルの図記号（端末・点線・文字）を描き、そうでないときは、ふつうの線',
  },
  {
    role: 'area-frame',
    symbolId: 'enclosure-cubicle',
    kind: 'frame',
    when: { not: { key: 'areaForm', eq: 'apartment-pole' } },
    labelTemplate: ['{areaLabel}'],
    // 枠から、その下の上向きの三角（ケーブルを受ける端末）までの線。ケーブルが埋設のときは点線（前のエリアからの線の続き）
    dashedAfter: { all: [{ key: 'linkCable', ne: 'no' }, { key: 'linkCableInstallation', eq: 'buried' }] },
  },
  {
    // 主遮断装置に付くDGR（1か所目と同じ）：ZCTは、初期値では、このエリアの引込の高圧ケーブルに付け、DGRは、ZCTの横。ZPDが「ある」ときだけ
    role: 'main-zct',
    symbolId: 'zct',
    kind: 'series',
    posFrom: 'mainZctPos',
    when: { all: [MAIN_GROUND_ON, { not: { key: 'mainZctPos', in: ['bus-primary', 'bus-secondary'] } }] },
  },
  {
    role: 'main-ground-relay',
    symbolId: 'relay-dgr',
    kind: 'branch-right',
    when: { all: [{ key: 'mainGroundRelay', eq: 'dgr' }, { key: 'hasZpd', eq: 'yes' }] },
    connectFrom: ['main-zct'],
  },
  {
    role: 'main-ground-relay',
    symbolId: 'relay-gr',
    kind: 'branch-right',
    when: { key: 'mainGroundRelay', eq: 'gr' },
    connectFrom: ['main-zct'],
  },
  {
    // ケーブルを受ける側の端末（1か所目の「受電側の端末」と同じ。180°回して使う）
    role: 'cable-head-site',
    symbolId: 'cable-head',
    kind: 'series',
    when: { all: [{ key: 'linkCable', ne: 'no' }, { not: { key: 'areaForm', eq: 'apartment-pole' } }] },
    note: 'エリアの枠の中の、ケーブルを受ける端末',
  },
  {
    // このエリアの受電側にも電柱があって、PAS（区分開閉器）が付いている場合（2か所目以降だけ）。ASとは別の機器
    role: 'area-pas',
    symbolId: 'pas',
    kind: 'series',
    when: { key: 'areaPas', eq: 'yes' },
    labelTemplate: ['PAS', '{areaPasRatingText}'],
  },
  {
    // 電気室などにAS（気中開閉器）が付いていて、そこから設備につながっている場合（2か所目以降だけ）
    role: 'area-as',
    symbolId: 'as',
    kind: 'series',
    when: { key: 'areaAs', eq: 'yes' },
    labelTemplate: ['AS', '{areaAsRatingText}'],
  },
  { role: 'ds', symbolId: 'ds', kind: 'series', when: { key: 'intakeDs', eq: 'yes' }, labelTemplate: ['DS', '{dsRating}'] },
  {
    role: 'main-breaker',
    symbolId: 'vcb',
    kind: 'series',
    when: { key: 'intakeVcb', eq: 'yes' },
    labelTemplate: ['VCB', '{vcbRating}'],
  },
  {
    // 励磁突入電流抑制開閉器：VCBと並列に入るLBS（PF付）。VCBの左に並べ、上と下を主回路につなぐ
    role: 'inrush-lbs',
    symbolId: 'lbs-pf',
    kind: 'bypass',
    attachTo: 'main-breaker',
    labelSide: 'left',
    when: { all: [{ key: 'intakeVcb', eq: 'yes' }, { key: 'hasInrush', eq: 'yes' }] },
    labelTemplate: ['励突抑制開閉器', 'LBS', '{inrushRatedVoltage}V', '{inrushRatedCurrent}A', 'PF×{inrushFuseCount}', '{inrushFuseSpec}'],
    props: { ratedVoltage: 'inrushRatedVoltage', ratedCurrent: 'inrushRatedCurrent', fuseCount: 'inrushFuseCount', fuseSpec: 'inrushFuseSpec' },
    note: 'VCBと並列。系統用蓄電所などで、励磁突入電流を抑えるために入る',
  },

  {
    role: 'main-breaker',
    symbolId: 'lbs-pf',
    kind: 'series',
    when: { key: 'intakeLbsPf', eq: 'yes' },
    labelTemplate: ['LBS', '{lbsRatingLine}', 'PF×{lbsFuseCount}', '{lbsPfLine}'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent', fuseCount: 'lbsFuseCount', fuseSpec: 'lbsPfLine' },
  },
  {
    role: 'main-breaker',
    symbolId: 'lbs',
    kind: 'series',
    when: { all: [{ key: 'intakeLbs', eq: 'yes' }, { key: 'intakeLbsPf', ne: 'yes' }] },
    labelTemplate: ['LBS', '{lbsRatingLine}'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent' },
  },
  {
    // 主遮断装置のDGR用のZCTを、母線に付けるとき（主遮断装置の一次側・二次側）。位置は、engine が、主遮断装置の前後に置く
    role: 'main-zct',
    symbolId: 'zct',
    kind: 'series',
    posFrom: 'mainZctPos',
    when: { all: [MAIN_GROUND_ON, { key: 'mainZctPos', in: ['bus-primary', 'bus-secondary'] }] },
    note: '主遮断装置のDGR用のZCT。母線（主遮断装置の一次側または二次側）に付ける',
  },
  ...INSTRUMENTS,
  { role: 'zpd', symbolId: 'zpd', kind: 'branch-left', tapFrom: 'zpdTap', when: { key: 'hasZpd', eq: 'yes' }, labelTemplate: ['ZPD'] },
  { role: 'ovgr', symbolId: 'relay-ovgr', kind: 'branch-left', tapFrom: 'zpdTap', when: { all: [{ key: 'hasZpd', eq: 'yes' }, { key: 'hasOvgr', eq: 'yes' }] }, connectFrom: ['zpd'] },
  ...LA_ITEMS,
  ...GC_ITEMS,
];

/**
 * 1か所目のエリアから、2か所目以降のエリアへ送り出す点の開閉器（送り出しの開閉器）。
 * 母線から直接ではなく、開閉器が付いている場合がある。エリアが2か所以上のときだけ入る。
 * 並び：DS → VCB（DS＋VCBのとき）。LBSは、パワーヒューズ付き（LBS＋PF）で描く。
 */
export const SENDOUT: Placement[] = [
  {
    role: 'sendout-ds',
    symbolId: 'ds',
    kind: 'sendout',
    when: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkSwitch', in: ['ds', 'ds-vcb'] }] },
    labelTemplate: ['DS'],
  },
  {
    role: 'sendout-vcb',
    symbolId: 'vcb',
    kind: 'sendout',
    when: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkSwitch', in: ['vcb', 'ds-vcb'] }] },
    labelTemplate: ['VCB'],
  },
  {
    role: 'sendout-lbs',
    symbolId: 'lbs-pf',
    kind: 'sendout',
    when: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkSwitch', eq: 'lbs' }] },
    labelTemplate: ['LBS', '{linkFuseText}'],
    note: '送り出しのLBS。パワーヒューズ（PF）の定格電流が分かっていれば、「PF 30A」のように書く',
  },
  // 送り出しの開閉器に付くDGR：ZCTは送り出しの高圧ケーブルに、DGRはその横（上）に、TCは開閉器の上に描く（layout が置く）
  {
    role: 'sendout-zct',
    symbolId: 'zct',
    kind: 'sendout',
    posFrom: 'linkZctPos',
    when: { all: [{ key: 'areaNo', gt: 1 }, SENDOUT_GROUND_ON, { key: 'linkSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }] },
  },
  {
    role: 'sendout-ground-relay',
    symbolId: 'relay-dgr',
    kind: 'sendout',
    when: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkGroundRelay', eq: 'dgr' }, { key: 'linkSenderZpd', eq: 'yes' }, { key: 'linkSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }] },
  },
  {
    role: 'sendout-ground-relay',
    symbolId: 'relay-gr',
    kind: 'sendout',
    when: { all: [{ key: 'areaNo', gt: 1 }, { key: 'linkGroundRelay', eq: 'gr' }, { key: 'linkSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }] },
  },
  {
    role: 'sendout-trip-coil',
    symbolId: 'trip-coil',
    kind: 'sendout',
    when: { all: [{ key: 'areaNo', gt: 1 }, SENDOUT_GROUND_ON, { key: 'linkSwitch', in: ['vcb', 'lbs', 'ds-vcb'] }] },
  },
];

/** 変圧器（台数分くり返す） */
export const TRANSFORMER: Placement[] = [
  // 変圧器は主回路から「分岐」して並列に入る（直列ではない）。
  // PCやLBSが手前に付く場合は、その変圧器と同じ列の上に入る。
  {
    role: 'tr-pc',
    symbolId: 'pc',
    kind: 'parallel',
    row: ROW.pc,
    when: { key: 'trHasPc', eq: 'yes' },
    labelTemplate: ['{trPcHead}', 'F:{trPcFuse}'],
    repeatCountKey: 'transformerCount',
    zeroOk: true,
  },
  {
    role: 'tr-lbs',
    symbolId: 'lbs-pf',
    kind: 'parallel',
    row: ROW.lbs,
    when: { key: 'trHasLbs', eq: 'yes' },
    labelTemplate: ['LBS', '{trLbsRatingLine}', '{trPfCountLine}', '{trPfLine}'],
    repeatCountKey: 'transformerCount',
    zeroOk: true,
  },
  {
    role: 'transformer',
    // 結線方式が未入力のときは、円の中が空の記号になる（engine の trSymbol）
    symbolId: '{trSymbol}',
    kind: 'parallel',
    row: ROW.main,
    labelTemplate: ['{trUsageLine}', 'Tr', '{trCapacityLine}', '{trVoltageText}', '{trComposition}'],
    props: { usage: 'trUsage', capacity: 'trCapacity', voltage: 'trVoltage', composition: 'trComposition' },
    repeatCountKey: 'transformerCount',
    zeroOk: true,
  },
];

/** 低圧母線から下へ出る回線（回線数ぶん横に並べる） */
/**
 * 変圧器の低圧側にぶら下がるもの。
 *
 * PCSは「容量の種類ごとに、何台目の変圧器に何台」を入れてもらい、
 * 変圧器ごとに1つの枠にまとめて（例「50kW×2台 / 5kW×1台」）ぶら下げる。
 * 低圧開閉器（MCCB）の記号は、いまのところ描かない。
 */
/**
 * t+1台目の変圧器に、PCSをつなぐか（PCSのぶんの内訳の文字があるか）。
 * 2台目以降は、変圧器がその台数あることも見る（無いときは、内訳の文字そのものが作られず、空と区別できないため）
 */
const onTransformer = (t: number): Condition => ({
  all: [...(t > 0 ? [{ key: 'transformerCount', gt: t }] : []), { key: 'hasPv', eq: 'yes' }, { key: `pcsAtTr${t + 1}`, ne: '' }],
});

export const FEEDERS: Placement[] = Array.from({ length: COUNT_LIMITS.transformerCount ?? MAX_COUNT }, (_, t): Placement[] => [
  {
    role: `pcs-tr${t + 1}`,
    symbolId: 'pcs',
    kind: 'feeder' as const,
    when: onTransformer(t),
    labelTemplate: [`{pcsAtTr${t + 1}}`],
    props: { transformer: `pcsTrNo${t + 1}` },
    laneBase: 200 + t,
  },
  {
    // PCSの枠の真下に、太陽電池パネル（PV）の図記号を1つだけ、線でつないで置く。PCSの台数に関わらず、枠ごとに1つ
    // （PCSの項目のすぐ後ろに並べるので、同じ列の2つ目として、PCSの下に入る）
    role: `pv-tr${t + 1}`,
    symbolId: 'pv',
    kind: 'feeder' as const,
    when: onTransformer(t),
    labelTemplate: ['PV', `{pvKwText${t + 1}}`],
    props: { transformer: `pcsTrNo${t + 1}` },
    laneBase: 200 + t,
  },
]).flat();

/**
 * 電動機（台ごと。第13弾 項目26）。台ごとの答え（接続元・途中のケーブル・開閉器）で、描き方が変わる。
 *   ・母線（高圧母線）から分岐：変圧器やコンデンサと同じ、高圧母線から下へぶら下がる列。上から、開閉器 → ケーブルの端末 → ケーブルの端末（向かい側）→ 電動機
 *   ・変圧器の二次側から：その変圧器の低圧側の下へぶら下がる列。上から、MCCB → ケーブルの端末 → ケーブルの端末（向かい側）→ 電動機
 * 文字：電動機の右横に、始動方式、その下に容量。台数は、記号の数で分かるので、書かない。ケーブルの注記は、向かい側の端末の右横
 */
const MOTOR_ON: Condition = { key: 'hasMotor', eq: 'yes' };
const MOTOR_BUS: Condition = { all: [MOTOR_ON, { key: 'motorSource', eq: 'bus' }] };
const MOTOR_SECONDARY: Condition = { all: [MOTOR_ON, { key: 'motorSource', eq: 'secondary' }] };
const MOTOR_CABLE: Condition = { key: 'motorCable', eq: 'yes' };
const MOTOR_LABEL = ['{motorStartMethod}', '{motorCapacityText}'];
const MOTOR_CABLE_LABEL = ['{motorCableInstallationLabel}', '{motorCableStructure}', '{motorCableSpecLine}'];
const MOTOR_LANE_BASE = 1000;
const MOTOR_ITEMS: Placement[] = [
  // ---- 母線から分岐する電動機（高圧母線から下へぶら下がる列） ----
  { role: 'motor-ds', symbolId: 'ds', kind: 'parallel', row: ROW.pc, when: { all: [MOTOR_BUS, { key: 'motorSwitch', in: ['ds', 'ds-vcb'] }] }, labelTemplate: ['DS'], repeatCountKey: 'motorCount', zeroOk: true },
  { role: 'motor-vcb', symbolId: 'vcb', kind: 'parallel', row: ROW.lbs, when: { all: [MOTOR_BUS, { key: 'motorSwitch', in: ['vcb', 'ds-vcb'] }] }, labelTemplate: ['VCB'], repeatCountKey: 'motorCount', zeroOk: true },
  { role: 'motor-lbs', symbolId: 'lbs-pf', kind: 'parallel', row: ROW.lbs, when: { all: [MOTOR_BUS, { key: 'motorSwitch', eq: 'lbs' }] }, labelTemplate: ['LBS', '{motorFuseText}'], repeatCountKey: 'motorCount', zeroOk: true },
  { role: 'motor-cable-source', symbolId: 'cable-head', kind: 'parallel', row: ROW.vcs, when: { all: [MOTOR_BUS, MOTOR_CABLE] }, dashedAfter: { key: 'motorCableInstallation', eq: 'buried' }, repeatCountKey: 'motorCount', zeroOk: true, note: '電動機へのケーブルの、電源側の端末' },
  { role: 'motor-cable-site', symbolId: 'cable-head', kind: 'parallel', row: ROW.reactor, when: { all: [MOTOR_BUS, MOTOR_CABLE] }, labelTemplate: MOTOR_CABLE_LABEL, repeatCountKey: 'motorCount', zeroOk: true, note: '電動機へのケーブルの、電動機側の端末（180°回して、頂点をケーブル側に向ける）' },
  { role: 'motor', symbolId: 'motor', kind: 'parallel', row: ROW.main, when: MOTOR_BUS, labelTemplate: MOTOR_LABEL, props: { startMethod: 'motorStartMethod', capacity: 'motorCapacity', place: 'motorPlace' }, repeatCountKey: 'motorCount', zeroOk: true },
  // ---- 変圧器の二次側から接続する電動機（その変圧器の低圧側の下へぶら下がる列） ----
  { role: 'motor-mccb', symbolId: 'mccb', kind: 'feeder', when: { all: [MOTOR_SECONDARY, { key: 'motorSwitch', eq: 'mccb' }] }, labelTemplate: ['MCCB'], props: { transformer: 'motorSourceTr' }, repeatCountKey: 'motorCount', laneBase: MOTOR_LANE_BASE, zeroOk: true },
  { role: 'motor-cable-source', symbolId: 'cable-head', kind: 'feeder', when: { all: [MOTOR_SECONDARY, MOTOR_CABLE] }, dashedAfter: { key: 'motorCableInstallation', eq: 'buried' }, props: { transformer: 'motorSourceTr' }, repeatCountKey: 'motorCount', laneBase: MOTOR_LANE_BASE, zeroOk: true },
  { role: 'motor-cable-site', symbolId: 'cable-head', kind: 'feeder', when: { all: [MOTOR_SECONDARY, MOTOR_CABLE] }, labelTemplate: MOTOR_CABLE_LABEL, props: { transformer: 'motorSourceTr' }, repeatCountKey: 'motorCount', laneBase: MOTOR_LANE_BASE, zeroOk: true },
  { role: 'motor', symbolId: 'motor', kind: 'feeder', when: MOTOR_SECONDARY, labelTemplate: MOTOR_LABEL, props: { startMethod: 'motorStartMethod', capacity: 'motorCapacity', place: 'motorPlace', transformer: 'motorSourceTr' }, repeatCountKey: 'motorCount', laneBase: MOTOR_LANE_BASE, zeroOk: true },
];

/** 高圧進相設備・特殊設備 */
export const EXTRAS: Placement[] = [
  // リアクトルの有無はコンデンサごとに決まるので、同じ件数で並べて書く。
  // 隣り合わせにしてあるため SR1→SC1→SR2→SC2 の順に出る
  // 高圧進相設備は変圧器と並列に入る。1台ごとに「リアクトル→コンデンサ」が1本の列になる
  // コンデンサの手前に入る開閉器。PCだけ・LBSだけ・LBS＋VCS など現場によって違う
  {
    role: 'cap-pc',
    symbolId: 'pc',
    kind: 'parallel',
    row: ROW.pc,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'capHasPc', eq: 'yes' }] },
    labelTemplate: ['{capPcHead}', 'F:{capPcFuse}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'cap-lbs',
    symbolId: 'lbs-pf',
    kind: 'parallel',
    row: ROW.lbs,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'capHasLbs', eq: 'yes' }] },
    labelTemplate: ['LBS', '{capLbsRatingLine}', '{capPfCountLine}', '{capPfLine}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'cap-vcs',
    symbolId: 'vcs',
    kind: 'parallel',
    row: ROW.vcs,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'capHasVcs', eq: 'yes' }] },
    labelTemplate: ['VCS'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'reactor',
    symbolId: 'sr',
    kind: 'parallel',
    row: ROW.reactor,
    when: { all: [{ key: 'hasCapacitor', eq: 'yes' }, { key: 'hasReactor', eq: 'yes' }] },
    labelTemplate: ['SR', '{reactorCapacity}'],
    repeatCountKey: 'capacitorCount',
  },
  {
    role: 'capacitor',
    symbolId: 'sc',
    kind: 'parallel',
    row: ROW.main,
    when: { key: 'hasCapacitor', eq: 'yes' },
    labelTemplate: ['SC', '{capacitorCapacity}'],
    repeatCountKey: 'capacitorCount',
  },
  /*
   * 発電機・太陽光・蓄電池。
   * 「どの変圧器につなぐか」を答えていれば、その変圧器の低圧側からぶら下げる。
   * 「つながない」なら、これまでどおり結線せずに図面の下に置く
   * （つなぎ先が現地のメモを見ないと分からない場合）。
   */
  ...MOTOR_ITEMS,
  {
    role: 'generator',
    symbolId: 'generator',
    kind: 'feeder',
    when: { all: [{ key: 'hasGenerator', eq: 'yes' }, { key: 'generatorTransformer', ne: 'none' }] },
    labelTemplate: ['G', '{generatorText}', '{generatorPlace}'],
    props: { usage: 'generatorUsage', place: 'generatorPlace', fuel: 'generatorFuel', transformer: 'generatorTransformer' },
    repeatCountKey: 'generatorCount',
    laneBase: 100,
  },
  {
    role: 'generator',
    symbolId: 'generator',
    kind: 'free',
    when: { all: [{ key: 'hasGenerator', eq: 'yes' }, { key: 'generatorTransformer', eq: 'none' }] },
    labelTemplate: ['G', '{generatorText}', '{generatorPlace}'],
    props: { usage: 'generatorUsage', place: 'generatorPlace', fuel: 'generatorFuel' },
    repeatCountKey: 'generatorCount',
  },
  {
    // PCSをどの変圧器にもつないでいないときだけ、太陽光を単独で置く
    role: 'pv',
    symbolId: 'pv',
    kind: 'free',
    when: { all: [{ key: 'hasPv', eq: 'yes' }, { key: 'pcsAssigned', eq: 'no' }] },
    labelTemplate: ['PV', '{pcsText}'],
  },
  {
    role: 'battery',
    symbolId: 'battery-unit',
    kind: 'feeder',
    when: { all: [{ key: 'hasBattery', eq: 'yes' }, { key: 'batteryTransformer', ne: 'none' }] },
    labelTemplate: ['蓄電池ユニット', '{batteryCapacity}'],
    props: { transformer: 'batteryTransformer' },
    laneBase: 300,
  },
  {
    role: 'battery',
    symbolId: 'battery-unit',
    kind: 'free',
    when: { all: [{ key: 'hasBattery', eq: 'yes' }, { key: 'batteryTransformer', eq: 'none' }] },
    labelTemplate: ['蓄電池ユニット', '{batteryCapacity}'],
  },
  /*
   * 補助変圧器（蓄電池の有無に関わらず、台数が1以上のとき）。選んだ変圧器の低圧側から、補助変圧器盤のMCCB → 補助変圧器の順にぶら下げる。
   * 台数ごとに1本の列になる。
   */
  {
    role: 'aux-mccb',
    symbolId: 'mccb',
    kind: 'feeder',
    labelTemplate: ['補助変圧器盤', 'MCCB{auxTrMccb}A'],
    props: { transformer: 'auxTrFrom' },
    repeatCountKey: 'auxTrCount',
    zeroOk: true,
    laneBase: 400,
  },
  {
    role: 'aux-tr',
    symbolId: '{auxTrSymbol}',
    kind: 'feeder',
    labelTemplate: ['{auxTrUsageLine}', '{auxTrCapacityLine}', '{auxTrVoltage}'],
    props: { transformer: 'auxTrFrom' },
    repeatCountKey: 'auxTrCount',
    zeroOk: true,
    laneBase: 400,
  },
];

export const CHAIN_BY_FORM: Record<string, Placement[]> = {
  pfs: PFS_CHAIN,
  cb: CB_CHAIN,
  /** 高圧マンションの電柱上構成は主遮断装置なし */
  'pole-top': [],
};
