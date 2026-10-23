import { useState } from 'react';
import type { Question } from '@zumen/knowledge';
import type { Value } from '@zumen/knowledge';

interface Props {
  question: Question;
  /** 繰り返しグループの2件目以降は、実際の保存キーが変わる */
  fieldKey: string;
  value: Value;
  onChange: (key: string, value: Value) => void;
}

/** 手入力に切り替えるための、一覧の中の特別な値 */
const OTHER = '__other__';

/** 選択肢が3つ以下で短ければ押しボタン、それ以外はプルダウンにする */
export function Field({ question: q, fieldKey, value, onChange }: Props) {
  const [pickedOther, setPickedOther] = useState(false);
  const set = (v: Value) => onChange(fieldKey, v);
  const current = value ?? q.defaultValue ?? '';
  // 一覧に無い値がすでに入っているか、利用者が「その他」を選んだときだけ手入力欄を出す
  const free =
    q.allowFreeInput === true &&
    (pickedOther || (current !== '' && !q.options?.some((o) => o.value === String(current))));

  return (
    <div className="field">
      <label htmlFor={fieldKey}>
        {q.type === 'boolean' ? '' : q.label}
        {q.required && <span className="req">必須</span>}
        {q.ask === 'ai-uncertain' && <span className="ai">AI判定可</span>}
        {q.unit && <span className="unit">（{q.unit}）</span>}
      </label>

      {q.type === 'select' &&
      !q.allowFreeInput &&
      (q.options?.length ?? 0) <= 3 &&
      (q.options ?? []).every((o) => o.label.length <= 12) ? (
        <div className="radio-row" id={fieldKey}>
          {q.options?.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={current === o.value}
              onClick={() => set(current === o.value ? undefined : o.value)}
            >
              {o.label}
              {o.share && <span className="share">　{o.share}</span>}
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
            <option value="">選択してください</option>
            {q.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.share ? `（${o.share}）` : ''}
              </option>
            ))}
            {q.allowFreeInput && <option value={OTHER}>その他（手入力）</option>}
          </select>
          {free && (
            <input
              type="text"
              aria-label={`${q.label}（一覧にない値）`}
              placeholder="一覧にない値を入力"
              value={q.options?.some((o) => o.value === String(current)) ? '' : String(current)}
              onChange={(e) => set(e.target.value || undefined)}
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
          <span>{q.label}</span>
        </label>
      ) : q.type === 'number' ? (
        <input
          id={fieldKey}
          type="number"
          value={current === '' ? '' : String(current)}
          placeholder={q.placeholder}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      ) : q.type === 'date' ? (
        <input id={fieldKey} type="date" value={String(current)} onChange={(e) => set(e.target.value || undefined)} />
      ) : (
        <input
          id={fieldKey}
          type="text"
          value={String(current)}
          placeholder={q.placeholder}
          onChange={(e) => set(e.target.value || undefined)}
        />
      )}

      {q.help && <p className="help">{q.help}</p>}
    </div>
  );
}
