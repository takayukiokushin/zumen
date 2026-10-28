import type { Condition } from './condition.ts';

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
  /** 2か所目以降のエリアを、前のエリアにつなぐケーブル（記号ではなく、つなぎ方を表す） */
  | 'link'
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
  | 'overlay';

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
  /** kind==='overlay' のとき、重ねる先の記号のロール */
  attachTo?: string;
  /** つなぐ位置を答える質問のID（ZPD・LA）。答えに応じて、並びの位置を動かす */
  tapFrom?: string;
  /** 分岐するとき、横に回さず、縦のまま置く（LA：真横に出た線が、真下に折れて、記号が縦に並ぶ） */
  upright?: boolean;
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
    role: 'boundary',
    labelSide: 'left',
    symbolId: 'boundary-both',
    kind: 'series',
    when: { key: 'boundaryPattern', eq: 'coincident' },
    labelTemplate: ['財産・責任分界点'],
    note: '3点一致（約99%）。引込点の図記号とPASの間に横線を引く',
  },
  {
    role: 'boundary-property',
    labelSide: 'left',
    symbolId: 'boundary-property',
    kind: 'series',
    when: { key: 'boundaryPattern', eq: 'split' },
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
    connectFrom: ['pas-zct', 'pas-vt'],
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

/** 主遮断装置がLBSの構成 */
export const PFS_CHAIN: Placement[] = [
  {
    role: 'main-breaker',
    symbolId: 'lbs-pf',
    kind: 'series',
    labelTemplate: ['LBS', '{lbsRatedVoltage}V', '{lbsRatedCurrent}A', 'PF×{lbsFuseCount}', '{lbsFuseSpec}'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent', fuseCount: 'lbsFuseCount', fuseSpec: 'lbsFuseSpec' },
  },
];

/** 主遮断装置がVCBの構成 */
export const CB_CHAIN: Placement[] = [
  { role: 'ds', symbolId: 'ds', kind: 'series', labelTemplate: ['DS', '{dsRating}'] },
  {
    role: 'ds-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    labelTemplate: ['{vtPfHead}', '{vtRatio}'],
    note: 'DSの次にVTを並列接続する（直列ではない）。VTの手前にPFが入る',
  },
  { role: 'ds-vt', symbolId: 'vt', kind: 'branch-right', props: { ratio: 'vtRatio' } },
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

/** 主遮断装置の下流（PFS形・CB形で共通） */
export const DOWNSTREAM: Placement[] = [
  {
    // 3点不一致のとき、保安上の責任分界点は主遮断装置の図記号の位置に置く。
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
    labelTemplate: ['保安上の責任分界点'],
    note: '3点不一致（約1%）。主遮断装置の図記号の中央に横線を引き、「保安上の責任分界点」と記載する',
  },
  {
    role: 'ct',
    symbolId: 'ct',
    kind: 'series',
    when: { any: [{ key: 'mainBreakerForm', eq: 'cb' }, { key: 'hasSiteCt', eq: 'yes' }] },
    labelTemplate: ['{ctHead}', '{ctRatioText}'],
    props: { ratio: 'ctRatioText' },
  },
  {
    role: 'ct-test-terminal',
    symbolId: 'test-terminal',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'cb' },
  },
  {
    role: 'ocr',
    symbolId: 'relay-ocr',
    kind: 'branch-right',
    when: { key: 'mainBreakerForm', eq: 'cb' },
    connectFrom: ['ct-test-terminal'],
    note: 'CB形では CT の次に OCR が入る',
  },
  {
    role: 'site-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    when: { all: [{ key: 'mainBreakerForm', eq: 'pfs' }, { key: 'hasSiteVt', eq: 'yes' }] },
    labelTemplate: ['{vtPfHead}', '{vtRatio}'],
  },
  {
    role: 'site-vt',
    symbolId: 'vt',
    kind: 'branch-right',
    when: { all: [{ key: 'mainBreakerForm', eq: 'pfs' }, { key: 'hasSiteVt', eq: 'yes' }] },
    props: { ratio: 'vtRatio' },
  },
  {
    role: 'zpd',
    symbolId: 'zpd',
    kind: 'branch-left',
    tapFrom: 'zpdTap',
    when: { key: 'hasZpd', eq: 'yes' },
    labelTemplate: ['ZPD'],
  },
  {
    role: 'ovgr',
    symbolId: 'relay-ovgr',
    kind: 'branch-left',
    tapFrom: 'zpdTap',
    when: { key: 'hasZpd', eq: 'yes' },
    connectFrom: ['zpd'],
  },
  {
    role: 'site-la',
    symbolId: 'la',
    kind: 'branch-left',
    tapFrom: 'laTap',
    upright: true,
    when: { key: 'hasLa', eq: 'yes' },
    labelTemplate: ['LA'],
  },
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
    when: { key: 'linkCable', ne: 'no' },
    labelTemplate: ['{linkCableInstallationLabel}', '{linkCableStructure}', '{linkCableSpecLine}'],
    note: '前のエリアから分岐してくるケーブル。つなぎ方（どこから・どこへ）は、図面の配置で使う',
  },
  {
    role: 'area-frame',
    symbolId: 'enclosure-cubicle',
    kind: 'frame',
    when: { not: { key: 'areaForm', eq: 'apartment-pole' } },
    labelTemplate: ['{areaLabel}'],
  },
  {
    // ケーブルを受ける側の端末（1か所目の「受電側の端末」と同じ。180°回して使う）
    role: 'cable-head-site',
    symbolId: 'cable-head',
    kind: 'series',
    when: { all: [{ key: 'linkCable', ne: 'no' }, { not: { key: 'areaForm', eq: 'apartment-pole' } }] },
    note: 'エリアの枠の中の、ケーブルを受ける端末',
  },
  { role: 'ds', symbolId: 'ds', kind: 'series', when: { key: 'intakeDs', eq: 'yes' }, labelTemplate: ['DS', '{dsRating}'] },
  {
    role: 'ds-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    when: { key: 'intakeStandard', eq: 'yes' },
    labelTemplate: ['{vtPfHead}', '{vtRatio}'],
    note: 'DS＋VCBの標準構成のときは、DSの次にVTを並列接続する',
  },
  { role: 'ds-vt', symbolId: 'vt', kind: 'branch-right', when: { key: 'intakeStandard', eq: 'yes' }, props: { ratio: 'vtRatio' } },
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
    labelTemplate: ['LBS', '{lbsRatedVoltage}V', '{lbsRatedCurrent}A', 'PF×{lbsFuseCount}', '{lbsFuseSpec}'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent', fuseCount: 'lbsFuseCount', fuseSpec: 'lbsFuseSpec' },
  },
  {
    role: 'main-breaker',
    symbolId: 'lbs',
    kind: 'series',
    when: { all: [{ key: 'intakeLbs', eq: 'yes' }, { key: 'intakeLbsPf', ne: 'yes' }] },
    labelTemplate: ['LBS', '{lbsRatedVoltage}V', '{lbsRatedCurrent}A'],
    props: { ratedVoltage: 'lbsRatedVoltage', ratedCurrent: 'lbsRatedCurrent' },
  },
  {
    role: 'ct',
    symbolId: 'ct',
    kind: 'series',
    when: { any: [{ key: 'intakeStandard', eq: 'yes' }, { key: 'hasSiteCt', eq: 'yes' }] },
    labelTemplate: ['{ctHead}', '{ctRatioText}'],
    props: { ratio: 'ctRatioText' },
  },
  {
    // VCBがあって、CTもあるとき、試験端子とOCRを付ける（1か所目のCB形と同じ）
    role: 'ct-test-terminal',
    symbolId: 'test-terminal',
    kind: 'branch-right',
    when: { all: [{ key: 'intakeVcb', eq: 'yes' }, { any: [{ key: 'intakeStandard', eq: 'yes' }, { key: 'hasSiteCt', eq: 'yes' }] }] },
  },
  {
    role: 'ocr',
    symbolId: 'relay-ocr',
    kind: 'branch-right',
    when: { all: [{ key: 'intakeVcb', eq: 'yes' }, { any: [{ key: 'intakeStandard', eq: 'yes' }, { key: 'hasSiteCt', eq: 'yes' }] }] },
    connectFrom: ['ct-test-terminal'],
  },
  {
    role: 'site-vt-pf',
    symbolId: 'pf',
    kind: 'branch-right',
    when: { all: [{ key: 'intakeOptional', eq: 'yes' }, { key: 'hasSiteVt', eq: 'yes' }] },
    labelTemplate: ['{vtPfHead}', '{vtRatio}'],
  },
  {
    role: 'site-vt',
    symbolId: 'vt',
    kind: 'branch-right',
    when: { all: [{ key: 'intakeOptional', eq: 'yes' }, { key: 'hasSiteVt', eq: 'yes' }] },
    props: { ratio: 'vtRatio' },
  },
  { role: 'zpd', symbolId: 'zpd', kind: 'branch-left', tapFrom: 'zpdTap', when: { key: 'hasZpd', eq: 'yes' }, labelTemplate: ['ZPD'] },
  { role: 'ovgr', symbolId: 'relay-ovgr', kind: 'branch-left', tapFrom: 'zpdTap', when: { key: 'hasZpd', eq: 'yes' }, connectFrom: ['zpd'] },
  { role: 'site-la', symbolId: 'la', kind: 'branch-left', tapFrom: 'laTap', upright: true, when: { key: 'hasLa', eq: 'yes' }, labelTemplate: ['LA'] },
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
  },
  {
    role: 'tr-lbs',
    symbolId: 'lbs-pf',
    kind: 'parallel',
    row: ROW.lbs,
    when: { key: 'trHasLbs', eq: 'yes' },
    labelTemplate: ['{trLbsHead}', '{trPfLine}'],
    repeatCountKey: 'transformerCount',
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
export const FEEDERS: Placement[] = Array.from({ length: 8 }, (_, t) => ({
  role: `pcs-tr${t + 1}`,
  symbolId: 'pcs',
  kind: 'feeder' as const,
  when: { all: [{ key: 'hasPv', eq: 'yes' }, { key: `pcsAtTr${t + 1}`, ne: '' }] },
  labelTemplate: [`{pcsAtTr${t + 1}}`],
  props: { transformer: `pcsTrNo${t + 1}` },
  laneBase: 200 + t,
}));

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
    labelTemplate: ['{capLbsHead}', '{capPfLine}'],
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
];

export const CHAIN_BY_FORM: Record<string, Placement[]> = {
  pfs: PFS_CHAIN,
  cb: CB_CHAIN,
  /** 高圧マンションの電柱上構成は主遮断装置なし */
  'pole-top': [],
};
