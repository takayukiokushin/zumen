import { useMemo, useRef, useState } from 'react';
import type { Answers } from '@zumen/knowledge';
import { VOICE_VERSION, buildReview, buildVoiceInstruction, parseVoiceResult } from '@zumen/ai';
import type { ReviewItem, VoiceParse } from '@zumen/ai';
import { AnalysisReview } from '../analyze/AnalysisReview.tsx';
import { useT } from '../i18n/useT.ts';
import { Rich } from '../i18n/Rich.tsx';
import { translateByTemplate } from '../session/serverMessages.ts';
import { getCurrentLang } from '../i18n/index.ts';

/**
 * 音声入力から図面を作る画面。
 *
 * 技術者が、Claude のアプリ（会社のプロジェクト）に声で設備を話すと、Claude が「決まった形の文章」を出す。
 * それをここに貼り付けると、アプリが読み取って、確認画面に出す。アプリは AI を呼ばない（APIキーも要らない）。
 * お客様名称・事業場名称・図面名称は、情報漏えいを避けるため、声では話さず、アプリで手入力する。
 */

interface Props {
  answers: Answers;
  onApply: (patch: Answers) => void;
  onGoToHearing: () => void;
}

/** 文字をコピーする。https でない画面（社内のアドレス）では、新しい方法が使えないので、古い方法も試す */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 次の方法へ
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  document.body.removeChild(ta);
  return done;
}

/** 取り込みの結果の文（packages/ai が日本語で作る）を、選んでいる言葉にする。型に合わなければ、そのまま */
const vp = (m: string): string => (getCurrentLang() === 'ja' ? m : (translateByTemplate('vp.', m) ?? m));

export function Voice({ answers, onApply, onGoToHearing }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ id: number; parse: VoiceParse; review: ReviewItem[] } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const seq = useRef(0);

  const full = useMemo(() => buildVoiceInstruction(), []);

  const copy = async (what: string, value: string) => {
    const ok = await copyText(value);
    setCopied(ok ? t('voice.copied', { what }) : t('voice.copyFailed', { what }));
  };

  const read = () => {
    const parse = parseVoiceResult(text);
    setParsed({ id: ++seq.current, parse, review: parse.result ? buildReview(parse.result, answers) : [] });
  };

  return (
    <div className="analyze voice">
      <section className="panel">
        <h2>{t('voice.title')}</h2>
        <ol className="hint voice-steps">
          <li>
            <Rich text={t('voice.s1')} />
          </li>
          <li>
            <Rich text={t('voice.s2')} />
          </li>
          <li>{t('voice.s3')}</li>
        </ol>
        <p className="notice">
          <Rich text={t('voice.notice')} />
        </p>
      </section>

      <section className="panel">
        <h2>{t('voice.pasteTitle')}</h2>
        <textarea
          className="voice-paste"
          rows={9}
          value={text}
          placeholder={t('voice.placeholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="primary" disabled={text.trim() === ''} onClick={read}>
          {t('voice.read')}
        </button>

        {parsed?.parse.error && <p className="err">{vp(parsed.parse.error)}</p>}
        {parsed?.parse.warnings.map((w, i) => (
          <p className="warn-note" key={i}>
            {vp(w)}
          </p>
        ))}
        {parsed && parsed.parse.rejected.length > 0 && (
          <div className="rejected">
            <Rich text={t('voice.rejected', { n: parsed.parse.rejected.length })} />
            <ul>
              {parsed.parse.rejected.map((r) => (
                <li key={r.key}>
                  <code>{r.key}</code>　{vp(r.reason)}
                </li>
              ))}
            </ul>
            <p className="hint">{t('voice.rejectedHint')}</p>
          </div>
        )}
      </section>

      {parsed?.parse.result && (
        <AnalysisReview
          key={parsed.id}
          result={parsed.parse.result}
          review={parsed.review}
          evidenceLabel={t('voice.evidence')}
          notesLabel={t('voice.notes')}
          onApply={(patch) => {
            onApply(patch);
            onGoToHearing();
          }}
        />
      )}

      <section className="panel">
        <h2>{t('voice.setupTitle')}</h2>
        <ol className="hint voice-steps">
          <li>{t('voice.p1')}</li>
          <li>
            <Rich text={t('voice.p2')} />
          </li>
          <li>{t('voice.p3')}</li>
        </ol>
        <p className="hint">
          <Rich text={t('voice.explain', { version: VOICE_VERSION })} />
        </p>
        <div className="voice-actions">
          <button type="button" className="primary" onClick={() => void copy(t('voice.what'), full)}>
            {t('voice.copyBtn')}
          </button>
        </div>
        {copied && <p className="ok-note-inline">{copied}</p>}
        <details>
          <summary>{t('voice.seeInstruction', { n: full.length.toLocaleString() })}</summary>
          <textarea className="voice-paste" readOnly rows={14} value={full} onFocus={(e) => e.currentTarget.select()} />
        </details>
      </section>
    </div>
  );
}
