import { useEffect, useState } from 'react';
import type { TrendEntry } from '@zumen/knowledge';
import { api } from './session/api.ts';

/**
 * 過去の案件の傾向（第13弾 項目51）を、サーバーから受け取る。
 * 参考表示のためだけのもの。受け取れなかったとき（つながらない・ログインが切れた・練習用のアカウント）は、何も出さない
 * （入力の邪魔にならないよう、エラーの知らせも出さない）。
 */
export type TrendMap = Record<string, TrendEntry>;

const EMPTY: TrendMap = {};
/** 前に受け取ったものを使い回す時間 */
const KEEP_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: Promise<TrendMap> }>();

function load(context: string): Promise<TrendMap> {
  const hit = cache.get(context);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.data;
  const data = api
    .trends(context || undefined)
    .then((r) => r.trends)
    .catch(() => {
      // 失敗は覚えない（次に開いたとき、もう一度試す）
      cache.delete(context);
      return EMPTY;
    });
  cache.set(context, { at: Date.now(), data });
  return data;
}

/** context：いま答えている案件の「受電の形」（sourceType）。同じ受電の形の案件で数えるのに使う */
export function useTrends(context: string | undefined): TrendMap {
  const [map, setMap] = useState<TrendMap>(EMPTY);
  const key = context ?? '';
  useEffect(() => {
    let live = true;
    void load(key).then((m) => {
      if (live) setMap(m);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return map;
}
