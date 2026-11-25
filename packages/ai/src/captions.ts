/**
 * 大きな図面を、画面が、拡大して分けて AI に渡すときに、各画像の前に添える説明の文（AI への指示の一部。画面には出ない）。
 * 画面（apps/web）は、分け方だけを決めて、文はここから取る。
 */

/** 図（ファイル・ページ）の呼び名。ファイル名は、お客様の名前が入っていることがあるので、使わない */
export function sheetLabel(fileNo: number, onlyOneFile: boolean, page?: { no: number; of: number }): string {
  const name = onlyOneFile ? '図面' : `ファイル${fileNo}`;
  return page && page.of > 1 ? `${name} ${page.no}ページ目` : name;
}

/** 全体の縮小図の説明 */
export function overviewCaption(label: string): string {
  return `【${label}：全体（縮小した図）。全体のつながり・配置を見るための画像です。細かい文字（型番・容量・定格など）は、このあとの拡大図で読んでください】`;
}

/** 分けた1枚（拡大図）の説明 */
export function tileCaption(label: string, t: { row: number; col: number; rows: number; cols: number }): string {
  return `【${label}：拡大図 ${t.row}段目・${t.col}列目（${t.rows}段×${t.cols}列に分けたうちの1枚。左上が1段目・1列目。つなぎ目は、少し重なっています）】`;
}
