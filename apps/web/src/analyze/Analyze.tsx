import { useEffect, useState } from 'react';
import { QUESTIONS } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import type { AnalysisResult, ReviewItem } from '@zumen/ai';
import { api } from '../session/api.ts';

interface Props {
  answers: Answers;
  /** 読み取りに使った写真を案件に残すため */
  projectId: string;
  onApply: (patch: Answers) => void;
  /** 読み取りを実行して、結果が出たときに知らせる（ヒアリング画面の表示を切り替えるため） */
  onAnalyzed?: () => void;
  onGoToHearing: () => void;
}

interface Picked {
  file: File;
  url: string;
  mediaType: string;
  data: string;
}

const LEVEL_LABEL: Record<ReviewItem['level'], string> = {
  error: '矛盾',
  confirm: '確認',
  ask: '未記入',
};

const labelOf = (id: string) => QUESTIONS.find((q) => q.id === id)?.label ?? id;
const displayValue = (id: string, v: unknown): string => {
  const q = QUESTIONS.find((x) => x.id === id);
  const o = q?.options?.find((opt) => opt.value === String(v));
  return o ? o.label : String(v);
};

/** 画像をbase64にする（データURLの接頭辞は外す） */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('画像を読み込めませんでした'));
    r.readAsDataURL(file);
  });
}

/**
 * 現地の手書きメモを読み取って、ヒアリング項目を埋める画面。
 *
 * 読み取り結果はそのまま採用せず、必ずこの画面で人が選んでから反映する
 * （電気設備図面は保安上の重要書類のため、最終責任は人に残す）。
 */
export function Analyze({ answers, projectId, onApply, onAnalyzed, onGoToHearing }: Props) {
  const [images, setImages] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  /** 読み取りが使える状態か（サーバーに利用券が置いてあるか）。未確認のあいだは undefined */
  const [ready, setReady] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    api
      .health()
      .then((h) => setReady(h.hasApiKey))
      .catch(() => setReady(undefined));
  }, []);

  const pick = async (files: FileList | null) => {
    if (!files) return;
    const next: Picked[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (!file.type.startsWith('image/')) continue;
      next.push({ file, url: URL.createObjectURL(file), mediaType: file.type, data: await toBase64(file) });
    }
    setImages((prev) => [...prev, ...next].slice(0, 10));
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await api.analyze({
        images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })),
        answers,
      });
      setResult(json.result as AnalysisResult);
      setReview(json.review as ReviewItem[]);
      onAnalyzed?.();
      // 自信がある項目は最初からチェックを入れておく
      const uncertain = new Set((json.result as AnalysisResult).uncertain);
      setChosen(
        Object.fromEntries(Object.keys((json.result as AnalysisResult).answers).map((k) => [k, !uncertain.has(k)])),
      );
      // 読み取りに使った写真は案件に残しておく（後から見返せるように）
      for (const img of images) {
        await api
          .uploadFile(projectId, { fileName: img.file.name, mediaType: img.mediaType, data: img.data })
          .catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    const patch: Answers = {};
    for (const [k, v] of Object.entries(result.answers)) {
      if (chosen[k]) patch[k] = v as Value;
    }
    onApply(patch);
    onGoToHearing();
  };

  const chosenCount = Object.values(chosen).filter(Boolean).length;

  return (
    <div className="analyze">
      <section className="panel">
        <h2>現地の手書きメモを読み取る</h2>

        {ready === false && (
          <div className="notready">
            <b>この機能は、まだ使えるようになっていません。</b>
            <p>
              手書きメモの読み取りには、Claude の<b>利用券（APIキー）</b>が要ります。
              サーバーに利用券を置くと使えるようになります。
            </p>
            <p className="how">
              置き方：サーバーのフォルダにある <code>.env.example</code> を <code>.env</code> という名前で
              コピーし、<code>ANTHROPIC_API_KEY=</code> の後ろに利用券の文字列を書いて、サーバーを
              起動し直します。利用券は <code>https://platform.claude.com/</code> で発行します。
              <b>残高（クレジット）の購入も必要です</b>（カードの登録だけでは使えません）。
            </p>
            <p className="how">
              <b>利用券が無くても、ほかの機能はすべて使えます。</b>
              「事前ヒアリング」で質問に答えれば、図面のたたき台はできます。
            </p>
          </div>
        )}

        <p className="hint">
          写真やスキャンした画像を選んでください（10枚まで）。読み取った内容は<b>そのまま図面には入りません</b>。
          この画面で確認して、採用するものだけを反映します。
        </p>

        <label className="drop">
          <input type="file" accept="image/*" multiple onChange={(e) => void pick(e.target.files)} />
          <span>画像を選ぶ / ここにドラッグ</span>
        </label>

        {images.length > 0 && (
          <>
            <div className="thumbs">
              {images.map((img, i) => (
                <figure key={img.url}>
                  <img src={img.url} alt={img.file.name} />
                  <figcaption>{img.file.name}</figcaption>
                  <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))}>
                    外す
                  </button>
                </figure>
              ))}
            </div>
            <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
              {busy ? '読み取り中…' : `${images.length}枚を読み取る`}
            </button>
          </>
        )}

        {error && <p className="err">{error}</p>}
      </section>

      {result && (
        <>
          <section className="panel">
            <h2>確認してほしいこと（{review.length}件）</h2>
            {review.length === 0 ? (
              <p className="hint">特にありません。</p>
            ) : (
              <ul className="review">
                {review.map((r, i) => (
                  <li key={i} className={r.level}>
                    <span className="tag">{LEVEL_LABEL[r.level]}</span>
                    <div>
                      <b>{r.label}</b>
                      {r.value && <span className="val">読み取り: {r.value}</span>}
                      <p>{r.message}</p>
                      {r.evidence && <p className="ev">メモの記載: {r.evidence}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>読み取った内容（{Object.keys(result.answers).length}件）</h2>
            <p className="hint">反映するものにチェックを入れてください。チェックを外したものは今までの回答のままです。</p>
            <table className="picked">
              <thead>
                <tr>
                  <th>反映</th>
                  <th>項目</th>
                  <th>読み取った値</th>
                  <th>メモの記載</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.answers).map(([id, v]) => (
                  <tr key={id} className={result.uncertain.includes(id) ? 'uncertain' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(chosen[id])}
                        onChange={(e) => setChosen((p) => ({ ...p, [id]: e.target.checked }))}
                        aria-label={`${labelOf(id)}を反映する`}
                      />
                    </td>
                    <td>
                      {labelOf(id)}
                      {result.uncertain.includes(id) && <span className="warn-tag">自信なし</span>}
                    </td>
                    <td>{displayValue(id, v)}</td>
                    <td className="ev">{result.evidence[id] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" disabled={chosenCount === 0} onClick={apply}>
              選んだ{chosenCount}件を反映してヒアリングへ
            </button>
          </section>

          {result.notes.length > 0 && (
            <section className="panel">
              <h2>メモに書かれていた特記事項</h2>
              <ul className="notes">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
