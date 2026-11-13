import { QUESTIONS } from '@zumen/knowledge';
import type { TrendEntry } from '@zumen/knowledge';
import { useT, useTx } from './i18n/useT.ts';

/**
 * 「過去の傾向」の小さな表示（第13弾 項目51）。
 * 「過去の傾向：CB形 78%　DS＋PC 22%（全案件 42件）」のように、多い順に、割合を出す。
 * onAdopt があれば、選択肢を押して、その答えにできる（押すかどうかは、人が決める。自動では入れない）。
 * 参考です。スケッチ・音声・入力した内容が優先され、特別な設備のときは、合わせなくてよい。
 */
export function TrendHint({ questionId, entry, onAdopt }: { questionId: string; entry: TrendEntry; onAdopt?: (value: string) => void }) {
  const t = useT();
  const tx = useTx();
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (!q) return null;
  const scope = entry.scope === 'context' ? t('trend.scopeContext', { n: entry.total }) : t('trend.scopeAll', { n: entry.total });
  return (
    <p className="trend" title={t('trend.refTitle')}>
      <span className="trend-title">{t('trend.title')}</span>
      {entry.top.map((e) => {
        const opt = q.options?.find((o) => o.value === e.value);
        const label = tx(opt?.label ?? e.value, opt?.i18nContext);
        const text = t('trend.chip', { label, pct: Math.round((e.count / entry.total) * 100) });
        return onAdopt ? (
          <button key={e.value} type="button" className="trend-chip" title={t('trend.adoptTitle')} onClick={() => onAdopt(e.value)}>
            {text}
          </button>
        ) : (
          <span key={e.value} className="trend-chip plain">
            {text}
          </span>
        );
      })}
      <span className="trend-scope">（{scope}）</span>
    </p>
  );
}
