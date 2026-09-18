import type { Shape } from './shape.ts';

/** 記号の分類（カタログのグルーピングとパレットのタブに使う） */
export type SymbolCategory =
  | 'incoming'      // 引込元・引込点
  | 'boundary'      // 責任分界点まわりの作図要素
  | 'switchgear'    // 開閉器・遮断器・断路器・ヒューズ
  | 'instrument'    // 計器用変成器・計器
  | 'protection'    // 保護継電器・避雷器・接地
  | 'transformer'   // 変圧器
  | 'compensation'  // 進相設備（コンデンサ・リアクトル）
  | 'source'        // 発電機・太陽光・蓄電池
  | 'enclosure'     // キュービクル・電気室などの外枠
  | 'wiring';       // 母線・接続点など結線要素

export const CATEGORY_LABEL: Record<SymbolCategory, string> = {
  incoming: '引込元・引込点',
  boundary: '責任分界点',
  switchgear: '開閉器・遮断器',
  instrument: '計器用変成器・計器',
  protection: '保護継電器・避雷器・接地',
  transformer: '変圧器',
  compensation: '進相設備',
  source: '発電機・太陽光・蓄電池',
  enclosure: '外枠（キュービクル・電気室）',
  wiring: '結線要素',
};

/**
 * 記号の確認状態。レビューの進捗をカタログ上で追えるようにする。
 *  confirmed        … 現場の確認で「これでOK」となったもの
 *  awaiting-sample  … 代表図面（見本）の到着待ちで、これから修正するもの
 *  open-question    … テキストでも図面でも指示がなく、こちらから確認が必要なもの
 */
export type SymbolStatus = 'confirmed' | 'awaiting-sample' | 'open-question';

export const STATUS_LABEL: Record<SymbolStatus, string> = {
  confirmed: '確定',
  'awaiting-sample': '見本待ち',
  'open-question': '要確認',
};

/** 接続点（ポート）の役割 */
export type PortRole =
  | 'line'       // 主回路
  | 'secondary'  // 二次側（計器・継電器へ）
  | 'earth'      // 接地側
  | 'control';   // 制御線

export interface Port {
  id: string;
  x: number;
  y: number;
  /** 線が記号から出ていく向き */
  dir: 'up' | 'down' | 'left' | 'right';
  role?: PortRole;
  label?: string;
}

/** 機器プロパティの入力欄定義。ヒアリング質問の自動生成にも使う */
export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  options?: { value: string; label: string }[];
  /** selectのとき、一覧にない値の手入力を許すか */
  allowFreeInput?: boolean;
  unit?: string;
  defaultValue?: string | number | boolean;
  /** 入力時の補足説明 */
  help?: string;
}

/**
 * 記号の中に他の記号を収める位置（PASの内蔵VT/LA、キュービクル内の機器など）。
 * 「PASにVT内蔵」のようなバリエーションを新しい記号として増やさず、
 * 既存記号の組み合わせ（ルール側のデータ）で表現するための仕組み。
 */
export interface Slot {
  id: string;
  x: number;
  y: number;
  label: string;
  /** ここに入りうる記号ID */
  accepts: string[];
}

export interface SymbolDef {
  /** 一意なID（ケバブケース） */
  id: string;
  /** 図面上の略称。表記はアルファベット略称に統一（SOGは使わない） */
  abbr: string;
  /** 現場での呼称 */
  nameJa: string;
  /** 正式名称（現場呼称と異なる場合のみ） */
  nameFormal?: string;
  category: SymbolCategory;
  /** 記号パレットの検索用キーワード */
  tags?: string[];
  /** 記号のローカル座標系の大きさ */
  box: { w: number; h: number };
  shapes: Shape[];
  ports: Port[];
  fields?: FieldDef[];
  slots?: Slot[];
  /** 記号の脇に既定で表示する文字 */
  defaultLabel?: string;
  /** 作図上の注意・ナレッジベース由来の補足 */
  note?: string;
  /** 別表記（同じ機器の描き方違い）のとき、基準となる記号ID */
  altOf?: string;
  /** 現場レビューの確認状態 */
  status: SymbolStatus;
  /** 確認状態の補足（何を待っているか、何がOKになったか） */
  statusNote?: string;
  /** レビュー時に確認したい点（カタログに表示される） */
  review?: string;
  /** 既定で図面に描かない記号（指示があったときだけ配置する） */
  optional?: boolean;
}

/** 記号定義のバリデーション（ポートが枠内にあるか等の単純な整合性確認） */
export function validateSymbol(def: SymbolDef): string[] {
  const errors: string[] = [];
  if (def.ports.length === 0 && def.category !== 'enclosure') {
    errors.push(`${def.id}: ポートが1つもありません`);
  }
  const ids = new Set<string>();
  for (const p of def.ports) {
    if (ids.has(p.id)) errors.push(`${def.id}: ポートID重複 "${p.id}"`);
    ids.add(p.id);
    if (p.x < -0.01 || p.x > def.box.w + 0.01 || p.y < -0.01 || p.y > def.box.h + 0.01) {
      errors.push(`${def.id}: ポート "${p.id}" が枠外 (${p.x}, ${p.y})`);
    }
  }
  if (def.box.w <= 0 || def.box.h <= 0) errors.push(`${def.id}: boxの大きさが不正`);
  return errors;
}
