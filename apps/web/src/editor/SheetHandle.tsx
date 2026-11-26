import { useRef } from 'react';
import { loadPanelWidth, savePanelWidth } from '../ColResizer.tsx';
import type { PanelSpec } from '../ColResizer.tsx';
import { useT } from '../i18n/useT.ts';

/**
 * スマホの「記号・設定」の枠（画面の下から出る枠）の、上端のつまみ（第21弾 項目15）。
 *   ・つまみを上下にドラッグして、枠の高さを変える。手を離したときに確定して、覚える
 *   ・つまみを、下へ大きく引き下げる（または、下へ素早く払う）と、枠が閉じる。閉じたあとに開き直すと、引き下げる前の高さで開く
 *   ・ダブルタップ（ダブルクリック）で、元の高さに戻る。キーボード：つまみを選んで、↑ ↓ で5%ずつ、Home で元の高さ
 *   ・つまみの上でだけ高さが変わる。枠の中のスクロール・図面の操作では、動かない
 * 高さは、画面の高さに対する割合（%）で、利用者ごと・ブラウザごとに覚える（幅の調整と同じ仕組み。ColResizer の記憶を使う）。
 * 画面全体の倍率（設定）があっても、画面の高さに対する割合なので、ずれない。
 */
export const SHEET_SPEC: PanelSpec = { name: 'sheet', def: 55, min: 12, max: 85 };
/** 枠の高さの、最小（px）。これより小さくは、固定しない（つまみ・見出し・「閉じる」が見える高さ） */
export const SHEET_MIN_PX = 120;
/** 引き下げて、この高さ（px）より小さくなったら、手を離したときに閉じる */
const CLOSE_BELOW_PX = 70;
/** 下へ、この速さ（px/ms。1秒に1300px）より速く払ったら、閉じる（高さを合わせるドラッグでは、そこまで速くならない） */
const FLICK_SPEED = 1.3;

/** 覚えている高さ（画面の高さに対する%。Editor を開くたびに、いまの利用者の分を読む） */
export const rememberedSheetPct = (): number => loadPanelWidth(SHEET_SPEC);

const minPct = (vh: number): number => (SHEET_MIN_PX / Math.max(1, vh)) * 100;
const clampPct = (pct: number, vh: number): number => Math.round(Math.max(minPct(vh), Math.min(SHEET_SPEC.max, pct)) * 10) / 10;

export function SheetHandle({ pct, onChange, onClose, sheet }: { pct: number; onChange: (p: number) => void; onClose: () => void; sheet: (handle: HTMLElement) => HTMLElement | null }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number; t: number; last: number; lastT: number; speed: number; pct: number } | null>(null);
  const box = () => ref.current?.closest('.editor-body') as HTMLElement | null;

  const set = (p: number) => {
    const v = clampPct(p, window.innerHeight);
    savePanelWidth(SHEET_SPEC, v);
    onChange(v);
  };
  const finish = () => {
    const d = drag.current;
    drag.current = null;
    ref.current?.classList.remove('dragging');
    const b = box();
    if (!d) return;
    const vh = window.innerHeight;
    const px = (d.pct / 100) * vh;
    if (px < CLOSE_BELOW_PX || (d.speed > FLICK_SPEED && px < d.h - 30)) {
      // 閉じる。見た目の高さは、もとに戻しておく（次に開くときは、引き下げる前の高さ）
      b?.style.setProperty('--sheet-pct', String(pct));
      onClose();
      return;
    }
    const v = clampPct(d.pct, vh);
    b?.style.setProperty('--sheet-pct', String(v));
    if (v !== pct) set(v);
  };

  return (
    <div
      ref={ref}
      className="sheet-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('editor.sheetResize')}
      title={t('editor.sheetResize')}
      aria-valuemin={Math.round(minPct(window.innerHeight))}
      aria-valuemax={SHEET_SPEC.max}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const el = sheet(e.currentTarget);
        const h = el ? el.getBoundingClientRect().height : (pct / 100) * window.innerHeight;
        drag.current = { y: e.clientY, h, t: e.timeStamp, last: e.clientY, lastT: e.timeStamp, speed: 0, pct };
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const b = box();
        if (!d || !b) return;
        // 画面の長さ（px）で測る。画面の高さに対する割合に直す（画面全体の倍率があっても、ずれない）
        const px = Math.max(0, Math.min(window.innerHeight * 0.85, d.h - (e.clientY - d.y)));
        d.pct = (px / window.innerHeight) * 100;
        const dt = e.timeStamp - d.lastT;
        if (dt > 0) d.speed = (e.clientY - d.last) / dt;
        d.last = e.clientY;
        d.lastT = e.timeStamp;
        b.style.setProperty('--sheet-pct', String(d.pct));
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => set(SHEET_SPEC.def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 5;
        if (e.key === 'ArrowUp') set(pct + step);
        else if (e.key === 'ArrowDown') set(pct - step);
        else if (e.key === 'Home') set(SHEET_SPEC.def);
        else return;
        e.preventDefault();
      }}
    />
  );
}
