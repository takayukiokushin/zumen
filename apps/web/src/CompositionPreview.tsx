import { buildComposition, missingRequired } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { findSymbol } from '@zumen/symbols';

const KIND_LABEL: Record<string, string> = {
  series: '直列',
  'branch-left': '左分岐',
  'branch-right': '右分岐',
  inside: '内蔵',
  frame: '枠',
  feeder: '回線',
};

/**
 * 回答から組み立てた構成を、その場で表示する。
 * 質問に答えるたびに図面の中身がどう変わるかが分かるようにしている。
 */
export function CompositionPreview({ answers }: { answers: Answers }) {
  const items = buildComposition(answers);
  const missing = missingRequired(answers);

  return (
    <aside className="preview">
      <h3>いまの構成</h3>
      <p className="sub">回答から自動で組み立てた機器の並びです（上流→下流）。</p>
      <ul className="chain">
        {items.map((item) => {
          const def = findSymbol(item.symbolId);
          return (
            <li key={item.id} className={item.kind}>
              <span className="kind">{KIND_LABEL[item.kind]}</span>
              <span>
                <span className="name">{def?.abbr ?? item.symbolId}</span>
                {def && <>　{def.nameJa}</>}
                {item.label.length > 0 && <span className="lbl">{item.label.join(' / ')}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <div className="warn">
          <b>未回答の必須項目が{missing.length}件あります。</b>
          <br />
          {missing.map((q) => q.label).join(' / ')}
        </div>
      )}
    </aside>
  );
}
