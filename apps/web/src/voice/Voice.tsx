import { useMemo, useRef, useState } from 'react';
import type { Answers } from '@zumen/knowledge';
import { VOICE_VERSION, buildReview, buildVoiceInstruction, parseVoiceResult } from '@zumen/ai';
import type { ReviewItem, VoiceParse } from '@zumen/ai';
import { AnalysisReview } from '../analyze/AnalysisReview.tsx';

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

export function Voice({ answers, onApply, onGoToHearing }: Props) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ id: number; parse: VoiceParse; review: ReviewItem[] } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const seq = useRef(0);

  const full = useMemo(() => buildVoiceInstruction(), []);

  const copy = async (what: string, value: string) => {
    const ok = await copyText(value);
    setCopied(ok ? `${what}をコピーしました` : `コピーできませんでした。下の枠の文字を、すべて選んで、コピーしてください（${what}）`);
  };

  const read = () => {
    const parse = parseVoiceResult(text);
    setParsed({ id: ++seq.current, parse, review: parse.result ? buildReview(parse.result, answers) : [] });
  };

  return (
    <div className="analyze voice">
      <section className="panel">
        <h2>音声入力から図面を作る</h2>
        <ol className="hint voice-steps">
          <li>
            <b>Claude のアプリ</b>で、会社の「単線結線図」プロジェクトを開き、<b>音声入力</b>で、設備の内容を話します。
            Claude が、足りないところを聞き返します。
          </li>
          <li>話し終えたら、Claude に「アプリ用の文章を出してください」と言います。出てきた<b>コードブロック</b>を、コピーします。</li>
          <li>下の枠に貼り付けて、「読み取る」を押します。確認画面が出るので、確かめて、反映します。</li>
        </ol>
        <p className="notice">
          <b>お客様名称・事業場名称・図面名称は、声では話しません。</b>
          アプリの「設備を入力して作成」で、手で入力してください（情報漏えいを防ぐためです。Claude には伝えません）。
        </p>
      </section>

      <section className="panel">
        <h2>Claude が出した文章を貼り付ける</h2>
        <textarea
          className="voice-paste"
          rows={9}
          value={text}
          placeholder="Claude が出したコードブロック（{ で始まる文章）を、ここに貼り付けます"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="primary" disabled={text.trim() === ''} onClick={read}>
          読み取る
        </button>

        {parsed?.parse.error && <p className="err">{parsed.parse.error}</p>}
        {parsed?.parse.warnings.map((w, i) => (
          <p className="warn-note" key={i}>
            {w}
          </p>
        ))}
        {parsed && parsed.parse.rejected.length > 0 && (
          <div className="rejected">
            <b>次の{parsed.parse.rejected.length}件は、取り込みませんでした：</b>
            <ul>
              {parsed.parse.rejected.map((r) => (
                <li key={r.key}>
                  <code>{r.key}</code>　{r.reason}
                </li>
              ))}
            </ul>
            <p className="hint">Claude に「次の項目は取り込めませんでした」と伝えて、直した文章を出してもらってください。</p>
          </div>
        )}
      </section>

      {parsed?.parse.result && (
        <AnalysisReview
          key={parsed.id}
          result={parsed.parse.result}
          review={parsed.review}
          evidenceLabel="話された言葉"
          notesLabel="話された特記事項"
          onApply={(patch) => {
            onApply(patch);
            onGoToHearing();
          }}
        />
      )}

      <section className="panel">
        <h2>Claude のプロジェクトを用意する（最初の1回だけ・管理する人）</h2>
        <ol className="hint voice-steps">
          <li>Claude のアプリで、プロジェクトを1つ新しく作ります。</li>
          <li>
            下の<b>「Claude用の指示文をコピー」</b>を押し、コピーした文章を、プロジェクトの<b>「指示」</b>の欄に、<b>そのまま全部</b>貼り付けます。
          </li>
          <li>プロジェクトを会社の人と共有します（全員が同じように使えます）。</li>
        </ol>
        <p className="hint">
          この文章は、Claude に「どんな順番で聞き取り、どんな形の文章で答えるか」を教えるものです。
          質問を増やしたときは、新しくコピーして、指示の欄を入れ替えてください（いまの版：<b>{VOICE_VERSION}</b>）。
          古い指示文で作られた文章を貼り付けると、アプリが知らせます。
        </p>
        <div className="voice-actions">
          <button type="button" className="primary" onClick={() => void copy('指示文', full)}>
            Claude用の指示文をコピー
          </button>
        </div>
        {copied && <p className="ok-note-inline">{copied}</p>}
        <details>
          <summary>指示文を見る（{full.length.toLocaleString()}文字）</summary>
          <textarea className="voice-paste" readOnly rows={14} value={full} onFocus={(e) => e.currentTarget.select()} />
        </details>
      </section>
    </div>
  );
}
