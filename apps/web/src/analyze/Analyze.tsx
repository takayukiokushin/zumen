import { useEffect, useRef, useState } from 'react';
import type { Answers } from '@zumen/knowledge';
import type { AnalysisResult } from '@zumen/ai';
import { api } from '../session/api.ts';
import { SketchResult } from './SketchResult.tsx';
import { useT } from '../i18n/useT.ts';
import { tr } from '../i18n/index.ts';
import { Rich } from '../i18n/Rich.tsx';

interface Props {
  answers: Answers;
  /** 読み取りに使った写真を案件に残すため */
  onApply: (patch: Answers) => void;
  /** 読み取りを実行して、結果が出たときに知らせる（ヒアリング画面の表示を切り替えるため） */
  onAnalyzed?: () => void;
  /** 読み取りの状態を、外（タブの表示）に知らせる。別のタブを見ているあいだも、読み取りは続く */
  onStatus?: (s: 'idle' | 'busy' | 'done') => void;
  onGoToHearing: () => void;
}

interface Picked {
  file: File;
  url: string;
  mediaType: string;
  data: string;
}

/** 画像・PDFをbase64にする（データURLの接頭辞は外す） */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error(tr('an.err.read')));
    r.readAsDataURL(file);
  });
}

/**
 * 現地の手書きメモを読み取って、ヒアリング項目を埋める画面。
 *
 * 読み取り結果はそのまま採用せず、必ずこの画面で人が選んでから反映する
 * （電気設備図面は保安上の重要書類のため、最終責任は人に残す）。
 */
export function Analyze({ answers, onApply, onAnalyzed, onStatus, onGoToHearing }: Props) {
  const t = useT();
  const [images, setImages] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  /** 読み取りを実行するたびに変える（確認画面の、チェックの状態を作り直すため） */
  const [runId, setRunId] = useState(0);
  /** 読み取りが使える状態か（サーバーに利用券が置いてあるか）。未確認のあいだは undefined */
  const [ready, setReady] = useState<boolean | undefined>(undefined);
  /** ファイルを枠の上に持ってきているあいだ、枠を目立たせる */
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => setReady(h.hasApiKey))
      .catch(() => setReady(undefined));
  }, []);

  // ブラウザの初期の動き（ドロップしたファイルを、新しいタブで開く）を止める。枠から少し外れても、タブが開かないように
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const pick = async (files: FileList | null) => {
    if (!files) return;
    const next: Picked[] = [];
    for (const file of Array.from(files).slice(0, 10)) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') continue;
      next.push({ file, url: URL.createObjectURL(file), mediaType: file.type, data: await toBase64(file) });
    }
    setImages((prev) => [...prev, ...next].slice(0, 10));
  };

  /** 読み取りの返事を待つ、いちばん長い時間。サーバーが必ず打ち切る時間（約5分15秒）より、少し長く待つ */
  const CLIENT_WAIT_MS = 330_000;
  /** いまの読み取りを、画面から打ち切るためのもの（「やめる」・時間切れ） */
  const abortRef = useRef<{ ctl: AbortController; why: 'user' | 'timeout' | null } | null>(null);
  /** 読み取りを始めてから、何秒たったか */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  // この画面を閉じたら、待つのをやめる（サーバーへの問い合わせも、そこで止まる）
  useEffect(() => () => abortRef.current?.ctl.abort(), []);

  const run = async () => {
    setBusy(true);
    setError(null);
    onStatus?.('busy');
    let ok = false;
    const mine = { ctl: new AbortController(), why: null as 'user' | 'timeout' | null };
    abortRef.current = mine;
    const timer = window.setTimeout(() => {
      mine.why = 'timeout';
      mine.ctl.abort();
    }, CLIENT_WAIT_MS);
    try {
      const json = await api.analyze(
        {
          images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })),
          answers,
        },
        mine.ctl.signal,
      );
      setResult(json.result as AnalysisResult);
      ok = true;
      onAnalyzed?.();
      setRunId((n) => n + 1);
      // 読み取りに使った写真・PDFは、サーバーには預けない（この画面の中で確認に使うだけ。画面を閉じれば消える）
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') setError(mine.why === 'timeout' ? t('an.err.clientTimeout') : t('an.cancelled'));
      else setError(e instanceof Error ? e.message : t('an.err.fail'));
    } finally {
      window.clearTimeout(timer);
      if (abortRef.current === mine) abortRef.current = null;
      setBusy(false);
      onStatus?.(ok ? 'done' : 'idle');
    }
  };

  /** 読み取りを、途中でやめる（サーバーへの問い合わせも止まる） */
  const cancel = () => {
    const cur = abortRef.current;
    if (!cur) return;
    cur.why = 'user';
    cur.ctl.abort();
  };


  return (
    <div className="analyze">
      <section className="panel">
        <h2>{t('an.title')}</h2>

        {ready === false && (
          <div className="notready">
            <Rich text={t('an.notready.title')} />
            <p>
              <Rich text={t('an.notready.p1')} />
            </p>
            <p className="how">
              <Rich text={t('an.notready.how')} />
            </p>
            <p className="how">
              <Rich text={t('an.notready.other')} />
            </p>
          </div>
        )}

        <p className="hint">{t('an.hint')}</p>

        <p className="privacy-note">
          <Rich text={t('an.privacy')} />
        </p>

        <label
          className={`drop${dragOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void pick(e.dataTransfer.files);
          }}
        >
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => void pick(e.target.files)} />
          <span>{t('an.drop')}</span>
        </label>

        {images.length > 0 && (
          <>
            <div className="thumbs">
              {images.map((img, i) => (
                <figure key={img.url}>
                  {img.mediaType === 'application/pdf' ? (
                    <div className="pdf-thumb" role="img" aria-label={t('an.pdfLabel', { name: img.file.name })}>
                      PDF
                    </div>
                  ) : (
                    <img src={img.url} alt={img.file.name} />
                  )}
                  <figcaption>{img.file.name}</figcaption>
                  <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))}>
                    {t('an.remove')}
                  </button>
                </figure>
              ))}
            </div>
            <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
              {busy ? t('an.busy') : t('an.run', { n: images.length })}
            </button>
            {busy && (
              <>
                <button type="button" className="btn" onClick={cancel}>
                  {t('an.cancel')}
                </button>
                <p className="hint" role="status">
                  {t('an.busyElapsed', { n: elapsed })}
                </p>
              </>
            )}
          </>
        )}

        {error && <p className="err">{error}</p>}
      </section>

      {result && (
        <SketchResult
          key={runId}
          result={result}
          current={answers}
          onApply={(patch) => {
            onApply(patch);
            onGoToHearing();
          }}
        />
      )}
    </div>
  );
}
