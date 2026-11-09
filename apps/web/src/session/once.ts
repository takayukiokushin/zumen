/**
 * 「同じ操作を、同時に2つ走らせない」ための入口。
 *
 * ボタンを素早く2回押す（ダブルクリック・連打）と、窓が2つ開いたり、案件が2つできたり、
 * 「戻す」が2回走って2回目が失敗したり（実際は1回目で戻っている）する。
 * once で包んだ操作は、動いている間に呼ばれても、何もしない（窓が開いている間も「動いている」）。
 */
export interface Once {
  <T>(fn: () => Promise<T>): Promise<T | undefined>;
  /** いま動いている操作があるか（画面に「処理中」を出したいとき用） */
  readonly running: boolean;
}

export function makeOnce(): Once {
  let running = false;
  const once = (async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (running) return undefined;
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  }) as Once;
  Object.defineProperty(once, 'running', { get: () => running });
  return once;
}
