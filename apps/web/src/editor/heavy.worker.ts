import { computeHeavy } from './heavy.ts';
import type { HeavyRequest, HeavyResult } from './heavy.ts';

/** 時間のかかる図面の処理を、画面とは別の流れで動かす（heavy.ts の runHeavy から呼ばれる） */
self.onmessage = (e: MessageEvent<HeavyRequest>) => {
  try {
    const res: HeavyResult = computeHeavy(e.data);
    (self as unknown as Worker).postMessage({ ok: true, res });
  } catch {
    (self as unknown as Worker).postMessage({ ok: false });
  }
};
