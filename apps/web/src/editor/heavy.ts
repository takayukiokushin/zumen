import type { Orientation, PaperSize } from '@zumen/layout';
import type { Doc } from './doc.ts';
import { tidyDrawing } from './inspect.ts';
import type { TidyResult } from './inspect.ts';
import { SHRINK, scaleLayout } from './layoutScale.ts';

/**
 * 時間のかかる図面の処理（結線を整える・レイアウトの縮小・拡大）。
 *
 * 大きな図面（エリアが多い、など）では、数秒〜十数秒かかる。画面の本体と同じ流れで動かすと、そのあいだ、
 * 画面全体が固まってしまう（ボタンも押せない）。そこで、**別の流れ（Web Worker）で動かす**。
 * 動かしている間も、画面は使える（別のタブに移ることもできる）。
 * Worker が使えない環境では、これまでどおり、画面の流れの中で動かす（固まるが、結果は同じ）。
 */
export type HeavyKind = 'tidy' | 'shrink' | 'expand';

export interface HeavyRequest {
  kind: HeavyKind;
  doc: Doc;
  paper: PaperSize;
  orientation: Orientation;
  titleH: number;
}

export type HeavyResult =
  | { kind: 'tidy'; result: TidyResult }
  | { kind: 'shrink' | 'expand'; result: { doc: Doc; changed: boolean } };

/** 実際の計算。Worker の中でも、Worker が使えないときの代わりでも、これを呼ぶ */
export function computeHeavy(req: HeavyRequest): HeavyResult {
  if (req.kind === 'tidy') return { kind: 'tidy', result: tidyDrawing(req.doc, req.paper, req.orientation, req.titleH) };
  return { kind: req.kind, result: scaleLayout(req.doc, req.kind === 'shrink' ? SHRINK : 1 / SHRINK) };
}

/** 画面の流れの中で動かす（Worker が使えないとき）。「実行中」の表示が先に出るよう、少し待ってから動かす */
function runHere(req: HeavyRequest): Promise<HeavyResult> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(computeHeavy(req));
      } catch (e) {
        reject(e);
      }
    }, 60);
  });
}

/** 別の流れで動かす。うまく始められない・途中で失敗したときは、画面の流れの中で、もう一度動かす */
export function runHeavy(req: HeavyRequest): Promise<HeavyResult> {
  if (typeof Worker === 'undefined') return runHere(req);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./heavy.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      runHere(req).then(resolve, reject);
      return;
    }
    const fallback = () => {
      worker.terminate();
      runHere(req).then(resolve, reject);
    };
    worker.onmessage = (e: MessageEvent<{ ok: true; res: HeavyResult } | { ok: false }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.res);
      else fallback();
    };
    worker.onerror = (e) => {
      e.preventDefault();
      fallback();
    };
    worker.postMessage(req);
  });
}
