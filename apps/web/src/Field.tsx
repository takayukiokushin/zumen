import { useState } from 'react';
import type { Question } from '@zumen/knowledge';
import type { Answers, Value } from '@zumen/knowledge';
import { evaluate, limitCountText, MAX_TEXT_LENGTH } from '@zumen/knowledge';
import { useT, useTx } from './i18n/useT.ts';
import { useSettings } from './settings/settings.tsx';

interface Props {
  question: Question;
  /** 繰り返しグループの2件目以降は、実際の保存キーが変わる */
  fieldKey: string;
  value: Value;
  onChange: (key: string, value: Value) => void;
  /**
   * この項目が属する件の答え（選択肢の showIf を見るのに使う）。
   * 繰り返しの2件目以降は、その件だけの答え。無ければ、選択肢はすべて出す
   */
  context?: Answers;
}

/** 手入力に切り替えるための、一覧の中の特別な値 */
const OTHER = '__other__';

/** 入力欄の幅の目安。1行にたくさん並べるために、中身の長さから決める（質問に size があれば、それを使う） */
export type FieldSize = 'xs' | 's' | 'm' | 'l';
const ORDER: FieldSize[] = ['xs', 's', 'm', 'l'];
const atLeast = (a: FieldSize, b: FieldSize): FieldSize => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
export function fieldSize(q: Question, show: (s: string) => string): FieldSize {
  if (q.size) return q.size;
  // 名前の長さ（単位「（kVA）」と「必須」の札も、同じ行に並ぶので、数える）
  const label = show(q.label).length + (q.unit ? show(q.unit).length + 2 : 0) + (q.required ? 3 : 0);
  const opts = (q.options ?? []).map((o) => show(o.label).length);
  const widest = Math.max(0, ...opts);
  let size: FieldSize;
  if (q.type === 'boolean') size = 's';
  else if (q.type === 'number' || q.type === 'date') size = 'xs';
  else if (q.type === 'text') {
    // 入力例（placeholder）の見た目の長さ（半角は全角の半分ほど）で決める。例が無い欄は、名前などの自由な文字なので、ふつう（m）
    const ph = q.placeholder ?? '';
    const w = [...ph].reduce((n, c) => n + (/[\x20-\x7E]/.test(c) ? 0.55 : 1), 0);
    size = ph === '' ? 'm' : w <= 9.5 ? 's' : w <= 18 ? 'm' : 'l';
  }
  else {
    if (asButtons(q, show)) {
      // 押しボタン：並べた長さで決める（字数＋ボタンの余白）
      const total = opts.reduce((a, n) => a + n + 3, 0);
      size = total <= 12 ? 's' : total <= 22 ? 'm' : 'l';
    } else {
      // プルダウンは、「選択してください」（8字）も出るので、それより短くはしない
      // ただし、標準の値が入っていて、「選択してください」が出ないもの（7200V・200A・40kA など）は、短くてよい
      const w = q.defaultValue !== undefined && widest <= 6 ? widest : Math.max(widest, 8);
      size = w <= 6 ? 'xs' : w <= 12 ? 's' : w <= 20 ? 'm' : 'l';
    }
  }
  // 「必須」の札や単位が付く欄は、名前が3行に折れないよう、せめて s にする
  if (q.required || q.unit) size = atLeast(size, 's');
  // 名前は、2行までなら折り返してよい（その行の高さは、いちばん高い欄で決まるので、幅を広げるより、縦が増えない）。
  // 3行以上になるときだけ、幅を広げる（1行に入る字数の目安：xs 7字・s 10字・m 14字・l 21字）
  if (label > 30) size = atLeast(size, 'l');
  else if (label > 20) size = atLeast(size, 'm');
  else if (label > 14) size = atLeast(size, 's');
  return size;
}

/**
 * 説明文（help）の長さの目安。広い画面では、説明文を全文出すので、長いものを載せる欄は、幅を広げる（CSS が data-helpw を見る）。
 * 見た目の長さで数える（半角は全角の半分ほど）。短い説明文（〜26）は、いまの幅のままでよい
 */
export function helpWidth(help: string | undefined, show: (s: string) => string): 'm' | 'l' | undefined {
  if (!help) return undefined;
  const w = [...show(help)].reduce((n, c) => n + (/[\x20-\x7E]/.test(c) ? 0.55 : 1), 0);
  return w > 50 ? 'l' : w > 26 ? 'm' : undefined;
}

/**
 * 押しボタンで並べるか。選択肢が3つ以下で短いもの、または、4つで、どれもごく短い（6字まで。例：100A／200A／300A／400A）もの。
 * それ以外（5つ以上、4つで長いもの）は、プルダウン
 */
function asButtons(q: Question, show: (s: string) => string): boolean {
  if (q.allowFreeInput || q.dropdown) return false;
  const lens = (q.options ?? []).map((o) => show(o.label).length);
  const widest = Math.max(0, ...lens);
  return (lens.length <= 3 && widest <= 14) || (lens.length === 4 && widest <= 6);
}

/** 選択肢が3つ以下で短ければ押しボタン、それ以外はプルダウンにする */
export function Field({ question: question, fieldKey, value, onChange, context }: Props) {
  // 選択肢に出す条件（Choice.showIf）がある質問は、いまの答えで出すものを絞る
  const q = context && question.options?.some((o) => o.showIf)
    ? { ...question, options: question.options.filter((o) => evaluate(o.showIf, context)) }
    : question;
  const t = useT();
  const tx = useTx();
  // 設定で説明文を隠しているときは、説明文を出さない（名前の上にマウスを載せると、説明が出る）
  const { settings } = useSettings();
  const hideHelp = settings.hideHelp;
  const [pickedOther, setPickedOther] = useState(false);
  const set = (v: Value) => onChange(fieldKey, v);
  // まだ答えていないときは、いま効いている値を見せる（例：引込元がキャビネットなら、区分開閉器は既定でUGS）
  const current = value ?? context?.[question.id] ?? q.defaultValue ?? '';
  // 一覧に無い値がすでに入っているか、利用者が「その他」を選んだときだけ手入力欄を出す
  const free =
    q.allowFreeInput === true &&
    (pickedOther || (current !== '' && !q.options?.some((o) => o.value === String(current))));

  return (
    <div className="field" data-size={fieldSize(q, tx)} data-kind={q.type === 'select' && asButtons(q, tx) ? 'buttons' : undefined} data-helpw={hideHelp ? undefined : helpWidth(q.help, tx)}>
      <label htmlFor={fieldKey} title={hideHelp && q.help ? tx(q.help) : undefined}>
        {q.type === 'boolean' ? '' : tx(q.label)}
        {q.required && <span className="req">{t('field.required')}</span>}
        {q.unit && <span className="unit">（{tx(q.unit)}）</span>}
      </label>

      {q.type === 'select' && asButtons(q, tx) ? (
        <div className="radio-row" id={fieldKey}>
          {q.options?.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={current === o.value}
              onClick={() => set(current === o.value ? undefined : o.value)}
            >
              {tx(o.label)}
              {o.share && <span className="share">　{tx(o.share)}</span>}
            </button>
          ))}
        </div>
      ) : q.type === 'select' ? (
        <>
          <select
            id={fieldKey}
            value={free ? OTHER : String(current)}
            onChange={(e) => {
              // 「その他」を選んだときは、手入力の欄を出すだけで値はまだ決めない
              if (e.target.value === OTHER) setPickedOther(true);
              else {
                setPickedOther(false);
                set(e.target.value || undefined);
              }
            }}
          >
            <option value="">{t('field.choose')}</option>
            {q.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {tx(o.label)}
                {o.share ? `（${tx(o.share)}）` : ''}
              </option>
            ))}
            {q.allowFreeInput && <option value={OTHER}>{t('field.other')}</option>}
          </select>
          {free && (
            <input
              type="text"
              maxLength={MAX_TEXT_LENGTH}
              aria-label={t('field.otherValue', { label: tx(q.label) })}
              placeholder={t('field.otherPlaceholder')}
              value={q.options?.some((o) => o.value === String(current)) ? '' : String(current)}
              // 台数の欄に、大きすぎる数を打つと、その数だけ繰り返して組み立てて、画面が固まる。上限におさめる
              onChange={(e) => set(e.target.value ? (/Count$/.test(q.id) ? limitCountText(q.id, e.target.value) : e.target.value) : undefined)}
            />
          )}
        </>
      ) : q.type === 'boolean' ? (
        // 入れる・入れないだけの項目は、チェックの箱で出す
        <label className="check">
          <input
            id={fieldKey}
            type="checkbox"
            checked={current === 'yes'}
            onChange={(e) => set(e.target.checked ? 'yes' : 'no')}
          />
          <span>{tx(q.label)}</span>
        </label>
      ) : q.type === 'number' ? (
        <input
          id={fieldKey}
          type="number"
          value={current === '' ? '' : String(current)}
          placeholder={q.placeholder ? tx(q.placeholder) : undefined}
          // 数の欄も、文字数は 100 まで（type="number" には maxLength が効かないので、ここで止める）
          onChange={(e) => {
            if (e.target.value.length > MAX_TEXT_LENGTH) return;
            set(e.target.value === '' ? undefined : Number(e.target.value));
          }}
        />
      ) : q.type === 'date' ? (
        <input id={fieldKey} type="date" value={String(current)} onChange={(e) => set(e.target.value || undefined)} />
      ) : (
        <input
          id={fieldKey}
          type="text"
          maxLength={MAX_TEXT_LENGTH}
          value={String(current)}
          placeholder={q.placeholder ? tx(q.placeholder) : undefined}
          // 自動で入る欄（autoValue）は、空にしたことを覚える（空に戻すと、また自動で入ってしまうため）
          onChange={(e) => set(e.target.value === '' && q.keepEmpty ? '' : e.target.value || undefined)}
          onBlur={(e) => {
            // 数字だけが入っていたら、決まった後ろの文字を足す（CTの「100」→「100/5A」）
            const v = e.target.value.trim();
            if (q.appendOnBlur && /^\d+(\.\d+)?$/.test(v)) set(`${v}${q.appendOnBlur}`);
          }}
        />
      )}

      {q.help && !hideHelp && <p className="help" title={tx(q.help)}>{tx(q.help)}</p>}
    </div>
  );
}
