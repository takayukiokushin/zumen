import { useRef } from 'react';
import { useT } from '../i18n/useT.ts';

/**
 * 図面の画面の右にある「記号を追加・差し替え」の枠の幅を、ドラッグで変えるための取っ手（第13弾 項目9）。
 * 図面と枠のあいだに置く細い縦の帯。左へドラッグすると枠が広がり、右へドラッグすると狭まる。
 *   ・ダブルクリックで、元の幅（280px）に戻る
 *   ・キーボード：取っ手を選んで、← → で 20px ずつ（Shift を押しながらで 60px ずつ）、Home で元の幅
 *   ・広げすぎて、図面が見えなくならないよう、最小 240px・最大 560px。さらに、図面の幅が 360px を下回るほどは広げない（CSS側でも抑える）
 * 広げた幅は、このブラウザに覚えさせる（次に開いたときも、同じ幅。ほかの表示の設定と同じ。案件のデータには入らない）。
 * 枠の中の記号のボタンは、幅に合わせて大きさが変わる（幅が2倍なら、ボタンも絵も2倍。文字は、その半分の割合で大きくなる）。
 */
export const SIDE_W_DEFAULT = 280;
export const SIDE_W_MIN = 240;
export const SIDE_W_MAX = 560;
/** 図面の幅の下限（px）。枠を広げても、図面がこれより狭くならないようにする */
export const CANVAS_MIN = 360;
export const HANDLE_W = 8;

const KEY = 'zumen.sideWidth';

/** このブラウザに覚えている幅（無い・読めないときは、元の幅） */
function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? Math.round(Math.max(SIDE_W_MIN, Math.min(SIDE_W_MAX, v))) : SIDE_W_DEFAULT;
  } catch {
    return SIDE_W_DEFAULT;
  }
}

/** 広げた幅の記憶 */
let remembered = load();
export const rememberedSideWidth = (): number => remembered;

function save(w: number): void {
  remembered = w;
  try {
    localStorage.setItem(KEY, String(w));
  } catch {
    // 保存できなくても、画面は使える（プライベートモードなど）
  }
}

const clamp = (v: number, max = SIDE_W_MAX): number => Math.round(Math.max(SIDE_W_MIN, Math.min(max, v)));

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
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number; last: number; ratio: number; max: number } | null>(null);

  const set = (w: number) => {
    save(w);
    onChange(w);
  };

  /**
   * 画面全体の倍率（設定の「画面全体の大きさ」）があると、マウスの動き（画面の長さ）と、CSS の長さが、同じ割合ではない。
   * 枠の見えている幅 ÷ いま決めている幅 で、その割合を測って、換算する。
   */
  const measure = () => {
    const aside = ref.current?.nextElementSibling as HTMLElement | null;
    const body = ref.current?.parentElement;
    const r = aside && width > 0 ? aside.getBoundingClientRect().width / width : 1;
    const ratio = Number.isFinite(r) && r > 0 ? r : 1;
    const bodyW = body ? body.getBoundingClientRect().width / ratio : 1200;
    return { ratio, max: Math.max(SIDE_W_MIN, Math.min(SIDE_W_MAX, bodyW - HANDLE_W - CANVAS_MIN)) };
  };

  return (
    <div
      ref={ref}
      className="side-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('editor.sideResize')}
      title={t('editor.sideResize')}
      aria-valuemin={SIDE_W_MIN}
      aria-valuemax={SIDE_W_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width, last: width, ...measure() };
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const body = ref.current?.parentElement;
        if (!d || !body) return;
        // ドラッグの途中は、図面全体を描き直さず、枠の幅だけを直接動かす（手を離したときに確定する）
        d.last = clamp(d.w - (e.clientX - d.x) / d.ratio, d.max);
        for (const [k, v] of Object.entries(sideVars(d.last))) body.style.setProperty(k, v);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        e.currentTarget.classList.remove('dragging');
        if (d && d.last !== d.w) set(d.last);
      }}
      onPointerCancel={(e) => {
        const d = drag.current;
        drag.current = null;
        e.currentTarget.classList.remove('dragging');
        if (d && d.last !== d.w) set(d.last);
      }}
      onDoubleClick={() => set(SIDE_W_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 60 : 20;
        if (e.key === 'ArrowLeft') set(clamp(width + step, measure().max));
        else if (e.key === 'ArrowRight') set(clamp(width - step, measure().max));
        else if (e.key === 'Home') set(SIDE_W_DEFAULT);
        else return;
        e.preventDefault();
      }}
    />
  );
}
