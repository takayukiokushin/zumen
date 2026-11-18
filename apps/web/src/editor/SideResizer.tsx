import { CANVAS_MIN, ColResizer, HANDLE_W, SIDE_SPEC, loadPanelWidth } from '../ColResizer.tsx';

/**
 * 図面の画面の右にある「記号を追加・差し替え」の枠の幅を、ドラッグで変えるための取っ手（第13弾 項目9）。
 * 仕組みは、左の目次・右の「今の構成」と共通（ColResizer。第17弾 項目5）。
 * 図面と枠のあいだに置く細い縦の帯。左へドラッグすると枠が広がり、右へドラッグすると狭まる。
 *   ・ダブルクリックで、元の幅（280px）に戻る。最小 240px・最大 560px。図面の幅が 360px を下回るほどは広げない（CSS側でも抑える）
 *   ・広げた幅は、利用者ごと・ブラウザごとに覚える（案件のデータには入らない）
 * 枠の中の記号のボタンは、幅に合わせて大きさが変わる（幅が2倍なら、ボタンも絵も2倍。文字は、その半分の割合で大きくなる）。
 */
export const SIDE_W_DEFAULT = SIDE_SPEC.def;

/** 覚えている幅（Editor を開くたびに、いまの利用者の分を読む） */
export const rememberedSideWidth = (): number => loadPanelWidth(SIDE_SPEC);

/**
 * 枠の幅から決まる、CSS の変数。
 *   --side-w   枠の幅
 *   --pal-scale  記号のボタン・絵の大きさの倍率（元の幅のときが 1）
 *   --pal-font   記号の下の略称の文字の倍率（ボタンの倍率の、半分の割合で変える）
 */
export function sideVars(w: number): Record<string, string> {
  const scale = Math.round((w / SIDE_W_DEFAULT) * 1000) / 1000;
  return { '--side-w': `${w}px`, '--pal-scale': String(scale), '--pal-font': String(Math.round((1 + (scale - 1) * 0.5) * 1000) / 1000) };
}

export function SideResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  return (
    <ColResizer
      spec={SIDE_SPEC}
      width={width}
      grow="left"
      className="side-resizer"
      limit={(boxW) => boxW - HANDLE_W - CANVAS_MIN}
      panel={(h) => h.nextElementSibling as HTMLElement | null}
      live={(w, box) => {
        for (const [k, v] of Object.entries(sideVars(w))) box.style.setProperty(k, v);
      }}
      onChange={onChange}
    />
  );
}
