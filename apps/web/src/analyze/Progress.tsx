import { useT } from '../i18n/useT.ts';

/** 読み取りの段階の数（サーバーの ANALYZE_STAGE_TOTAL と同じ） */
export const ANALYZE_STEPS = 4;

interface Props {
  /** いま何段階目か（1〜4） */
  stage: number;
  /** 読み取りを始めてから、何秒たったか */
  elapsed: number;
}

/**
 * スケッチ読み取りの、進み具合の表示。
 *
 * 全部で4段階。小さな4つの四角を並べて、「いま4つのうち、どこか」が、ぱっと見て分かるようにする。
 * 済んだ段階は緑、いまの段階は金色（ゆっくり点滅）、まだの段階は灰色。色だけに頼らず、番号と文字でも示す。
 * 段階は、AI の答えの届き方（見ている→書いている）に合わせた、実際の様子（サーバーが知らせる）。割合（％）は出さない。
 */
export function AnalyzeProgress({ stage, elapsed }: Props) {
  const t = useT();
  const labels = [t('an.step1'), t('an.step2'), t('an.step3'), t('an.step4')];
  const now = Math.min(Math.max(Math.round(stage), 1), ANALYZE_STEPS);
  const nowLabel = labels[now - 1]!;
  return (
    <div className="an-progress">
      <p className="an-progress-now" role="status">
        <b>{t('an.stepOf', { n: now, total: ANALYZE_STEPS })}</b>
        <span>{nowLabel}</span>
      </p>
      <ol
        className="an-bar"
        role="progressbar"
        aria-label={t('an.stepBar')}
        aria-valuemin={1}
        aria-valuemax={ANALYZE_STEPS}
        aria-valuenow={now}
        aria-valuetext={`${t('an.stepOf', { n: now, total: ANALYZE_STEPS })} ${nowLabel}`}
      >
        {labels.map((label, i) => {
          const no = i + 1;
          const state = no < now ? 'done' : no === now ? 'now' : 'todo';
          return (
            <li key={no} className={`an-seg ${state}`} aria-hidden="true" title={label}>
              <span className="an-seg-no">{no < now ? '✓' : no}</span>
              <span className="an-seg-label">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="hint" role="status">
        {t('an.busyElapsed', { n: elapsed })}
      </p>
    </div>
  );
}
