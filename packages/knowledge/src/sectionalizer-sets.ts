import type { Answers } from './condition.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers } from './engine.ts';
import type { PlacedItem } from './engine.ts';

/**
 * 「記号を追加・差し替え」の「区分開閉器」リストに並べる、完成形のセット（第20弾 項目6）。
 *
 * 区分開閉器（PAS・PGS・UGS）の枠・内蔵機器（ZCT・VT・LA・ZPD）・継電器（GR または DGR）・制御線を、
 * ひとまとめで図面に足す。形は、自動作図と同じ仕組みで作る（同じ構成ルールの、区分開閉器の部分だけを取り出す）ので、
 * 自動作図の区分開閉器と同じ見た目になる。画面やロジックには書かず、ここにデータとして持つ。
 *
 *   種類 3（PAS・PGS・UGS）× 制御 2（GR・DGR）× 内蔵 4（なし・VTのみ・LAのみ・VT＋LA）＝ 24
 *   ZCT は、どちらにも付く。ZPD は、DGR のときだけ入る（GR・内蔵なしのときは入らない）。
 */
export type SetSectionalizer = 'pas' | 'pgs' | 'ugs';
export type SetControl = 'gr' | 'dgr';

export interface SectionalizerSet {
  id: string;
  sectionalizer: SetSectionalizer;
  control: SetControl;
  /** VT 内蔵 */
  vt: boolean;
  /** LA 内蔵 */
  la: boolean;
}

/** 種類（リストでの並び順） */
export const SET_SECTIONALIZERS: readonly { id: SetSectionalizer; abbr: string }[] = [
  { id: 'pas', abbr: 'PAS' },
  { id: 'pgs', abbr: 'PGS' },
  { id: 'ugs', abbr: 'UGS' },
];

/** 制御（リストの、上半分＝GR・下半分＝DGR） */
export const SET_CONTROLS: readonly { id: SetControl; label: string }[] = [
  { id: 'gr', label: 'GR方式' },
  { id: 'dgr', label: 'DGR方式' },
];

/** 内蔵機器のパターン（並び順。名前は、画面に出る言葉） */
export const SET_PATTERNS: readonly { vt: boolean; la: boolean; label: string }[] = [
  { vt: false, la: false, label: '内蔵なし' },
  { vt: true, la: false, label: 'VTのみ' },
  { vt: false, la: true, label: 'LAのみ' },
  { vt: true, la: true, label: 'VT＋LA' },
];

export const SECTIONALIZER_SETS: readonly SectionalizerSet[] = SET_CONTROLS.flatMap((c) =>
  SET_SECTIONALIZERS.flatMap((s) =>
    SET_PATTERNS.map((p) => ({
      id: `${s.id}-${c.id}-${p.vt ? 'vt' : 'novt'}-${p.la ? 'la' : 'nola'}`,
      sectionalizer: s.id,
      control: c.id,
      vt: p.vt,
      la: p.la,
    })),
  ),
);

/** セットの名前（例：「PAS・VTのみ」）。GR方式・DGR方式は、リストの見出しで分かるので、ここには入れない */
export const setPatternLabel = (set: SectionalizerSet): string =>
  SET_PATTERNS.find((p) => p.vt === set.vt && p.la === set.la)!.label;

/** 区分開閉器の部分の構成ルール（役割）。これ以外の部分（ケーブル・客柱・外づけLAなど）は、足さない */
const SET_ROLE = /^pas(-zct|-vt|-la|-zpd|-relay)?$/;

/** セットを作る回答（区分開閉器の種類・制御・内蔵だけ。定格電圧の初期値は7200V） */
export function setAnswers(set: SectionalizerSet): Answers {
  return effectiveAnswers(
    dropHiddenChoices({
      sectionalizer: set.sectionalizer,
      pasControl: set.control,
      pasBuiltinVt: set.vt ? 'yes' : 'no',
      pasBuiltinLa: set.la ? 'yes' : 'no',
      pasRatedVoltage: '7200',
    } as Answers),
  );
}

/** セットの構成（区分開閉器・内蔵機器・継電器だけ）。自動作図と同じ構成ルールから取り出す */
export function setComposition(set: SectionalizerSet): { items: PlacedItem[]; answers: Answers } {
  const answers = setAnswers(set);
  return { items: buildComposition(answers).filter((i) => SET_ROLE.test(i.role)), answers };
}

/** 「記号を追加・差し替え」の分類の名前（責任分界点と、開閉器・遮断器のあいだに出る） */
export const SET_LIST_LABEL = '区分開閉器';

/** セットの名前（例：「PAS・GR・VTのみ」）。tr は、画面の言語へ訳す関数 */
export const setDisplayName = (set: SectionalizerSet, tr: (s: string) => string = (s) => s): string =>
  `${set.sectionalizer.toUpperCase()}・${set.control.toUpperCase()}・${tr(setPatternLabel(set))}`;

/** リストの中で、見出し（GR方式・DGR方式）の下に出す短い名前（例：「PAS・VTのみ」） */
export const setShortName = (set: SectionalizerSet, tr: (s: string) => string = (s) => s): string =>
  `${set.sectionalizer.toUpperCase()}・${tr(setPatternLabel(set))}`;

/** 区分開閉器の文字のうち、内蔵機器を表す行（例：「VT,LA内蔵型」）か。内蔵を入れ替えるときに、この行だけ作り直す */
export const isBuiltinTextLine = (line: string): boolean => /内蔵型$/.test(line);
