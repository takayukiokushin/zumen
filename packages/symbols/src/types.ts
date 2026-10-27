import type { Shape } from './shape.ts';

/** 記号の分類（カタログのグルーピングとパレットのタブに使う） */
export type SymbolCategory =
  | 'incoming'      // 引込元・引込点
  | 'boundary'      // 責任分界点まわりの作図要素
  | 'switchgear'    // 開閉器・遮断器・断路器・ヒューズ
  | 'instrument'    // 計器用変成器・計器
  | 'protection'    // 保護継電器・避雷器・接地
  | 'transformer'   // 変圧器
  | 'compensation'  // 高圧進相設備（コンデンサ・リアクトル）
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
  compensation: '高圧進相設備',
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
  options?: { value: string; label: string; /** 図面に書く文字（無ければ value をそのまま書く） */ text?: string }[];
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
  /**
   * 編集画面で記号を足したときに、最初から記号の脇へ出す文字の雛形（1行ずつ）。
   * {キー} は fields の入力値に置き換わる。値が空のところは単位などの文字だけが残る
   * （例：「{ratedCurrent}A」→「A」。あとから数字を入れると「100A」になる）。
   * 置き換えたあとに空になった行は書かない。
   */
  labelLines?: string[];
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
  /** 別の記号の上に重ねて描くだけの印（結線しないので、ポートを持たない） */
  overlay?: boolean;
}

/** 記号定義のバリデーション（ポートが枠内にあるか等の単純な整合性確認） */
export function validateSymbol(def: SymbolDef): string[] {
  const errors: string[] = [];
  if (def.ports.length === 0 && def.category !== 'enclosure' && !def.overlay) {
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

/** 雛形（labelLines）に入っている {キー} を取り出す */
const placeholdersOf = (lines: string[]): string[] => [...new Set(lines.flatMap((l) => [...l.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))];

/** 編集画面で数字などを入れる欄（雛形に使われている項目だけ） */
export function labelFields(def: SymbolDef): FieldDef[] {
  const keys = new Set(placeholdersOf(def.labelLines ?? []));
  return (def.fields ?? []).filter((f) => keys.has(f.key));
}

/** 記号を足した直後の入力値（既定値のある項目だけ） */
export function initialLabelValues(def: SymbolDef): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of labelFields(def)) if (f.defaultValue !== undefined) values[f.key] = String(f.defaultValue);
  return values;
}

/** 入力値を雛形に当てはめて、図面に書く行を作る。雛形が無ければ空 */
export function fillLabelLines(def: SymbolDef, values: Record<string, string>): string[] {
  const fields = new Map((def.fields ?? []).map((f) => [f.key, f]));
  const text = (key: string): string => {
    const v = (values[key] ?? '').trim();
    if (v === '') return '';
    return fields.get(key)?.options?.find((o) => o.value === v)?.text ?? v;
  };
  return (def.labelLines ?? [])
    .map((line) => line.replace(/\{(\w+)\}/g, (_, key: string) => text(key)))
    .filter((line) => line.trim() !== '');
}
