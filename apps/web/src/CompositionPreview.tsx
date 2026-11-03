import { Fragment } from 'react';
import { buildComposition, missingRequired } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { findSymbol } from '@zumen/symbols';
import { useT, useTx } from './i18n/useT.ts';
import type { Key } from './i18n/index.ts';

/**
 * 回答から組み立てた構成を、その場で表示する。
 * 質問に答えるたびに図面の中身がどう変わるかが分かるようにしている。
 */
export function CompositionPreview({ answers }: { answers: Answers }) {
  const t = useT();
  const tx = useTx();
  const items = buildComposition(answers);
  const missing = missingRequired(answers);

  return (
    <aside className="preview">
      <h3>{t('comp.title')}</h3>
      <p className="sub">{t('comp.sub')}</p>
      <ul className="chain">
        {items.map((item, i) => {
          const def = findSymbol(item.symbolId);
          // 2か所目以降のエリアに入るところで、見出しを入れる
          const heading = item.area !== undefined && items[i - 1]?.area !== item.area;
          return (
            <Fragment key={item.id}>
              {heading && <li className="area-head">{t('hearing.areaNth', { n: item.area! + 1 })}</li>}
            <li className={item.kind}>
              <span className="kind">{t(`comp.kind.${item.kind}` as Key)}</span>
              <span>
                <span className="name">{def?.abbr ?? item.symbolId}</span>
                {def && <>　{tx(def.nameJa)}</>}
                {item.label.length > 0 && <span className="lbl">{item.label.join(' / ')}</span>}
              </span>
            </li>
            </Fragment>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <div className="warn">
          <b>{t('comp.missing', { n: missing.length })}</b>
          <br />
          {missing.map((q) => tx(q.label)).join(' / ')}
        </div>
      )}
    </aside>
  );
}
