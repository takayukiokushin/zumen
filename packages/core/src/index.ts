/**
 * 単線結線図アプリのドメインモデル。
 *
 * 仕様書（docs/spec.md）6章のデータモデルに対し、ナレッジベース（docs/knowledge-base.md）の
 * 「1プロジェクト内に複数の受電設備エリアが存在しうる」という必須要件を反映して
 * substationAreas を追加している。
 */

export type Id = string;
export type ISODate = string;

/* ------------------------------------------------------------------ */
/* ヒアリング（共通項目）                                                */
/* ------------------------------------------------------------------ */

/** 受電方式 */
export type ReceivingType = 'high-voltage' | 'extra-high-voltage';

/** 主遮断装置の形式。以降の受電設備構成すべてに影響する最重要分岐 */
export type MainBreakerForm =
  | 'pfs'       // PFS形（PF・S形）主遮断装置はLBS。設備容量300kVA以下で採用可能
  | 'cb'        // CB形。主遮断装置はVCB。設備容量301kVA以上では必須
  | 'pole-top'; // 主遮断装置なし（高圧マンションで受電設備を電柱上に構成する例外パターン）

/** 引込元のパターン */
export type ServiceSourceType = 'pole' | 'cabinet';

/** キャビネットの中身 */
export type CabinetContent = 'mold-discon' | 'tee-shelter';

/** 責任分界点のパターン */
export type BoundaryPattern =
  | 'coincident'  // 3点一致（引込点・財産分界点・保安上の責任分界点が同一地点。約99%）
  | 'split';      // 3点不一致（約1%）

export interface HearingAnswers {
  /** 1. お客様名称 */
  customerName?: string;
  /** 表題欄への記載方法（略称を使う等の指定） */
  customerNameForTitleBlock?: string;
  /** 2. 事業場名称・現場住所 */
  siteName?: string;
  siteAddress?: string;
  /** 3. 受電方式・契約電力・受電電圧 */
  receivingType?: ReceivingType;
  contractPower?: number;      // kW
  receivingVoltage?: number;   // V
  /** 引込元 */
  sourceType?: ServiceSourceType;
  cabinetContent?: CabinetContent;
  /** 責任分界点 */
  boundaryPattern?: BoundaryPattern;
  /** 8. 接地方式・接地抵抗値等の特記事項 */
  earthingNotes?: string;
  /** 10. その他現場固有の特記事項 */
  notes?: string;
  /** 質問リストはカスタマイズ可能なため、追加項目は自由キーで保持する */
  extra?: Record<string, string | number | boolean | null>;
}

/* ------------------------------------------------------------------ */
/* 引込ケーブル                                                         */
/* ------------------------------------------------------------------ */

/** 付設方法。図面表記は略称（埋ケ／架ケ） */
export type CableInstallation = 'buried' | 'overhead';

export const CABLE_INSTALLATION_LABEL: Record<CableInstallation, string> = {
  buried: '埋ケ',
  overhead: '架ケ',
};

/** ケーブルの構造。全体の約99.9%がこの2択 */
export type CableStructure = 'CV' | 'CVT';

/** 断面積の候補。一覧にない値の手入力も許す（allowFreeInput） */
export const CABLE_CROSS_SECTIONS = [14, 22, 38, 60, 100, 150, 200, 250] as const;

export interface CableSpec {
  installation?: CableInstallation;
  structure?: CableStructure;
  /** 定格電圧。99.99%が6600V */
  ratedVoltage?: number;
  /** 断面積 mm²。CABLE_CROSS_SECTIONS 以外の値も入りうる */
  crossSection?: number;
  /** 長さ m。不明な場合は未設定とし、図面には「- m」と記載する */
  lengthM?: number;
}

/**
 * 図面に記載するケーブル諸元を組み立てる。見本図面にならい3行で書く。
 *   1行目: 付設方法（埋ケ／架ケ）
 *   2行目: 構造（CV／CVT）
 *   3行目: 定格電圧 断面積 長さ（例: 6600V 100mm2 20m。長さ不明なら「- m」）
 */
export function formatCableSpec(spec: CableSpec): string[] {
  const lines: string[] = [];
  if (spec.installation) lines.push(CABLE_INSTALLATION_LABEL[spec.installation]);
  if (spec.structure) lines.push(spec.structure);
  const third = [
    spec.ratedVoltage ? `${spec.ratedVoltage}V` : undefined,
    spec.crossSection ? `${spec.crossSection}mm2` : undefined,
    spec.lengthM == null ? '- m' : `${spec.lengthM}m`,
  ].filter(Boolean);
  lines.push(third.join(' '));
  return lines;
}

/**
 * ケーブルの線種。埋設（埋ケ）のみ点線で描き、架空（架ケ）は実線で描く。
 */
export function cableLineStyle(spec: CableSpec): 'dashed' | 'solid' {
  return spec.installation === 'buried' ? 'dashed' : 'solid';
}

/* ------------------------------------------------------------------ */
/* 受電設備エリア                                                       */
/* ------------------------------------------------------------------ */

/** 受電設備の形態。「開放型」等の表記は使わず「オープンフレーム式」に統一する */
export type AreaForm = 'cubicle' | 'room-cubicle' | 'room-open';

export type AreaPlacement = 'indoor' | 'rooftop' | 'outdoor' | 'semi-outdoor';

export interface SubstationArea {
  id: Id;
  /** 表示順 */
  order: number;
  form?: AreaForm;
  placement?: AreaPlacement;
  /** 階層（例: 1階 / 中2階） */
  floor?: string;
  /** 場所の補足（例: 駐車場横） */
  detail?: string;
  /** 主遮断装置の形式はエリアごとに異なりうる */
  mainBreakerForm?: MainBreakerForm;
  /** 図面に印字するラベル。未設定なら form/placement から自動生成する */
  label?: string;
  /** 図面上のエリア枠の位置と大きさ */
  frame?: { x: number; y: number; w: number; h: number };
}

/* ------------------------------------------------------------------ */
/* 機器・結線                                                           */
/* ------------------------------------------------------------------ */

export interface Equipment {
  id: Id;
  /** @zumen/symbols の記号ID */
  symbolId: string;
  /** どの受電設備エリアに属するか（電柱上の機器など、エリア外なら未設定） */
  areaId?: Id;
  /** 図面上に表示する名称。未設定なら記号の既定値 */
  name?: string;
  /** 記号定義の fields に対応する入力値 */
  properties?: Record<string, string | number | boolean | null>;
  quantity?: number;
  position: { x: number; y: number };
  /** 記号の向き（度）。0 は定義どおり */
  rotation?: number;
  notes?: string;
  /** AI解析が生成した項目で、まだ人間が確認していないもの */
  unconfirmed?: boolean;
}

export type LineType = 'high-voltage' | 'low-voltage' | 'control' | 'earth';

export interface Connection {
  id: Id;
  from: { equipmentId: Id; portId: string };
  to: { equipmentId: Id; portId: string };
  lineType: LineType;
  /** 線の脇に記載する文字（ケーブル諸元など） */
  label?: string;
  cable?: CableSpec;
  /** 手動で経路を指定した場合の折れ点 */
  waypoints?: { x: number; y: number }[];
  unconfirmed?: boolean;
}

/** 分界点の横線など、機器ではない作図要素 */
export interface Annotation {
  id: Id;
  kind: 'boundary' | 'text' | 'area-label';
  /** kind === 'boundary' のとき、@zumen/symbols の boundary-* 記号ID */
  symbolId?: string;
  text: string;
  position: { x: number; y: number };
  width?: number;
}

/* ------------------------------------------------------------------ */
/* 図面・プロジェクト                                                    */
/* ------------------------------------------------------------------ */

export interface TitleBlock {
  drawingName?: string;
  customerName?: string;
  drawingNumber?: string;
  revision?: string;
  author?: string;
  createdAt?: ISODate;
  /** 作図支援ツールである旨の注記を出力に含めるか */
  draftNotice?: boolean;
}

export interface Drawing {
  sheet: { width: number; height: number };
  titleBlock: TitleBlock;
  annotations: Annotation[];
}

export interface SourceFile {
  id: Id;
  fileName: string;
  mimeType: string;
  /** サーバー保管のためのキー */
  storageKey: string;
  pageCount?: number;
  uploadedAt: ISODate;
}

export interface Project {
  id: Id;
  name: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  hearingAnswers: HearingAnswers;
  sourceFiles: SourceFile[];
  substationAreas: SubstationArea[];
  equipment: Equipment[];
  connections: Connection[];
  incomingCable?: CableSpec;
  drawing: Drawing;
}

/** 受電設備エリアの図面ラベルを組み立てる（例:「電気室（1階、屋内）」） */
export function formatAreaLabel(area: SubstationArea): string {
  if (area.label) return area.label;
  const formLabel: Record<AreaForm, string> = {
    cubicle: 'キュービクル',
    'room-cubicle': '電気室',
    'room-open': 'オープンフレーム式',
  };
  const placeLabel: Record<AreaPlacement, string> = {
    indoor: '屋内',
    rooftop: '屋上',
    outdoor: '屋外',
    'semi-outdoor': '半屋外',
  };
  const head = area.form ? formLabel[area.form] : '受電設備';
  const inner = [area.floor, area.placement ? placeLabel[area.placement] : undefined, area.detail]
    .filter(Boolean)
    .join('、');
  return inner ? `${head}（${inner}）` : head;
}

/**
 * 受電設備エリアの外枠（一点鎖線の四角）を描くかどうか。
 * 2箇所以上あるときだけ囲う。1箇所しかない場合に全体を囲うと、かえって分かりにくくなる。
 */
export function shouldDrawAreaFrames(areas: readonly SubstationArea[]): boolean {
  return areas.length >= 2;
}

/**
 * 設備容量から主遮断装置の形式を判定する。
 * 300kVA以下ならPFS形を採用可能、301kVA以上はCB形でなければならない。
 * 例外（高圧マンションの電柱上構成）は容量からは判定できないため、質問で確認する。
 */
export function suggestMainBreakerForm(totalTransformerKva: number): MainBreakerForm | null {
  if (totalTransformerKva <= 0) return null;
  return totalTransformerKva <= 300 ? 'pfs' : 'cb';
}
