import { useMemo, useState } from 'react';
import { missingRequiredFields } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult } from '@zumen/ai';
import { Field } from '../Field.tsx';
import { useT, useTx } from '../i18n/useT.ts';

/**
 * スケッチの読み取りが終わったあとの画面。
 *
 * 出すのは、次の3つだけ。
 * 1. 「読み込んだ内容を反映させる」ボタン（読み取った内容を、すべて反映する。すでに入っている答えとは比べない）
 * 2. 注意書き（AIは間違えることがある）
 * 3. 図面を作るのに必要で、スケッチから読み取れなかった項目（必須で未回答のもの）。ここで、答えられる
 * 読み取った内容は、反映したあと、「設備を入力して作成」の画面で、すべて見て、直せる。図面のプレビューでも確かめられる。
 */
export function SketchResult({
  result,
  current,
  onApply,
}: {
  result: AnalysisResult;
  /** いまの答え（初期設定・自動で入る値も含む） */
  current: Answers;
  onApply: (patch: Answers) => void;
}) {
  const t = useT();
  const tx = useTx();
  /** この画面で答えた分 */
  const [extra, setExtra] = useState<Answers>({});

  // 読み取った内容が優先。そのうえで、必須なのに答えが無いものだけを、確認事項にする
  const merged = useMemo<Answers>(() => ({ ...current, ...(result.answers as Answers) }), [current, result]);
  const firstMissing = useMemo(() => missingRequiredFields(merged), [merged]);
  const nowMissing = missingRequiredFields({ ...merged, ...extra });
  // 答えたものが、すぐに消えないよう、最初に出た項目は出したままにする。答えによって新しく必須になった項目は、あとから足す
  const rows = [...firstMissing, ...nowMissing.filter((m) => !firstMissing.some((f) => f.key === m.key))];

  const set = (key: string, value: Value) =>
    setExtra((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });

  const apply = () => onApply({ ...(result.answers as Answers), ...extra });

  return (
    <>
      <section className="panel">
        <button type="button" className="primary" onClick={apply}>
          {t('sketch.apply')}
        </button>
        <p className="ai-caution">{t('sketch.caution')}</p>
      </section>

      {rows.length > 0 && (
        <section className="panel">
          <h2>{t('sketch.answer')}</h2>
          <div className="fields">
            {rows.map((r) => (
              <Field
                key={r.key}
                question={{ ...r.question, label: r.areaNo ? `${t('hearing.areaPrefix', { n: r.areaNo })}${tx(r.question.label)}` : r.question.label }}
                fieldKey={r.key}
                value={extra[r.key]}
                onChange={set}
                context={{ ...r.context, ...extra }}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
