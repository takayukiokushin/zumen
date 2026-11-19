import { useRef } from 'react';
import { useT } from './i18n/useT.ts';

/**
 * 枠の幅を、ドラッグで変えるための取っ手（共通の部品）。
 * 「設備を入力して作成」の左の目次・右の「今の構成」（第17弾 項目5）と、図面の画面の右の「記号を追加・差し替え」（第13弾 項目9）で使う。
 *   ・ドラッグで幅を変える。手を離したときに確定して、覚える
 *   ・ダブルクリックで、元の幅に戻る
 *   ・キーボード：取っ手を選んで、← → で 20px ずつ（Shift を押しながらで 60px ずつ）、Home で元の幅
 *   ・最小と最大の幅がある。さらに、真ん中の入力欄・図面が狭くなりすぎるほどは、広げない（limit）
 * 幅は、「利用者ごと・ブラウザごと」に覚える（ほかの表示の設定と同じく、案件のデータには入らない。別のブラウザ・別の端末では、元の幅から始まる）。
 */
export const HANDLE_W = 8;

/** いま使っている利用者のID。幅の記憶は、利用者ごとに分ける（ログインのたびに、App が知らせる） */
let account = '';
export const setPanelAccount = (id: string | null | undefined): void => {
  account = id ?? '';
};
const keyOf = (name: string): string => `zumen.panel.${account}.${name}`;

export interface PanelSpec {
  name: string;
  def: number;
  min: number;
  max: number;
  /** 前の版で、利用者に分けずに覚えていた場所（あれば、はじめの値として引き継ぐ） */
  legacyKey?: string;
}
/** 設備を入力する画面：左の目次・右の「今の構成」 */
export const NAV_SPEC: PanelSpec = { name: 'nav', def: 220, min: 160, max: 420 };
export const PREVIEW_SPEC: PanelSpec = { name: 'preview', def: 300, min: 220, max: 560 };
/** 図面の画面：右の「記号を追加・差し替え」 */
export const SIDE_SPEC: PanelSpec = { name: 'side', def: 280, min: 240, max: 560, legacyKey: 'zumen.sideWidth' };
/** 真ん中の入力欄の、これより狭くしない幅（px） */
export const FORM_MIN = 480;
/** 図面の幅の下限（px）。枠を広げても、図面がこれより狭くならないようにする */
export const CANVAS_MIN = 360;

const clampTo = (spec: PanelSpec, v: number, max = spec.max): number => Math.round(Math.max(spec.min, Math.min(Math.max(spec.min, max), v)));

/** このブラウザに、この利用者として覚えている幅（無い・読めないときは、元の幅） */
export function loadPanelWidth(spec: PanelSpec): number {
  try {
    const raw = localStorage.getItem(keyOf(spec.name)) ?? (spec.legacyKey ? localStorage.getItem(spec.legacyKey) : null);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) && v > 0 ? clampTo(spec, v) : spec.def;
  } catch {
    return spec.def;
  }
}

export function savePanelWidth(spec: PanelSpec, w: number): void {
  try {
    localStorage.setItem(keyOf(spec.name), String(w));
  } catch {
    // 保存できなくても、画面は使える（プライベートモードなど）
  }
}

export interface ColResizerProps {
  spec: PanelSpec;
  /** いまの幅（確定している値） */
  width: number;
  /** 広げられる幅の上限を、取っ手を置いている入れ物の幅（CSSの長さ）から決める。spec.max より大きくはならない */
  limit: (containerWidth: number) => number;
  /** 幅を変える枠そのもの（見えている幅を測って、画面全体の倍率との換算に使う） */
  panel: (handle: HTMLElement) => HTMLElement | null;
  /** どちらへドラッグすると広がるか。left＝左へ（右の枠）、right＝右へ（左の枠） */
  grow: 'left' | 'right';
  /** ドラッグの途中：描き直さず、入れ物の CSS の変数だけを動かす */
  live: (w: number, container: HTMLElement) => void;
  onChange: (w: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ColResizer({ spec, width, limit, panel, grow, live, onChange, className, style }: ColResizerProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number; last: number; ratio: number; max: number } | null>(null);

  const set = (w: number) => {
    savePanelWidth(spec, w);
    onChange(w);
  };

  /**
   * 画面全体の倍率（設定の「画面全体の大きさ」）があると、マウスの動き（画面の長さ）と、CSS の長さが、同じ割合ではない。
   * 枠の見えている幅 ÷ いま決めている幅 で、その割合を測って、換算する。
   */
  const measure = () => {
    const el = ref.current ? panel(ref.current) : null;
    const box = ref.current?.parentElement;
    const r = el && width > 0 ? el.getBoundingClientRect().width / width : 1;
    const ratio = Number.isFinite(r) && r > 0 ? r : 1;
    const boxW = box ? box.getBoundingClientRect().width / ratio : 1200;
    return { ratio, max: Math.max(spec.min, Math.min(spec.max, limit(boxW))) };
  };
  const finish = () => {
    const d = drag.current;
    drag.current = null;
    ref.current?.classList.remove('dragging');
    if (d && d.last !== d.w) set(d.last);
  };
  // 左へ広がる枠は、取っ手を左へ動かすほど広がる。右へ広がる枠は、右へ動かすほど広がる
  const sign = grow === 'left' ? -1 : 1;

  return (
    <div
      ref={ref}
      className={`col-resizer${className ? ` ${className}` : ''}`}
      style={style}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('editor.sideResize')}
      title={t('editor.sideResize')}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
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
        const box = ref.current?.parentElement;
        if (!d || !box) return;
        // ドラッグの途中は、画面全体を描き直さず、枠の幅だけを直接動かす（手を離したときに確定する）
        d.last = clampTo(spec, d.w + (sign * (e.clientX - d.x)) / d.ratio, d.max);
        live(d.last, box);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => set(spec.def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 60 : 20;
        if (e.key === 'ArrowLeft') set(clampTo(spec, width - sign * step, measure().max));
        else if (e.key === 'ArrowRight') set(clampTo(spec, width + sign * step, measure().max));
        else if (e.key === 'Home') set(spec.def);
        else return;
        e.preventDefault();
      }}
    />
  );
}
