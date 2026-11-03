import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { tr } from './i18n/index.ts';

/**
 * 画面の中でエラーが起きたとき、画面が真っ白にならないようにする「受け皿」。
 *
 * - scope="screen"：いま開いている画面（一覧・入力・図面・音声）の中だけを止める。
 *   案件の入力内容・図面は、この受け皿より外（App）が持っているので、消えない。
 *   「保存」ボタンも、受け皿の外にあるので、そのまま使える。
 * - scope="app"：いちばん外側の、最後の受け皿。ここまで来たときは、画面全体を作り直すしかない
 *   （保存していない入力は、消えている可能性がある）。
 *
 * resetKey が変わったとき（タブを替えた、別の案件を開いたなど）は、自動で元に戻して、もう一度表示する。
 */
interface Props {
  scope: 'screen' | 'app';
  /** これが変わったら、エラーの表示をやめて、もう一度中身を表示する */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 原因を調べられるように、ブラウザの記録（コンソール）にも残す
    console.error('Screen error', error, info.componentStack);
    this.setState({ stack: (info.componentStack ?? '').split('\n').slice(0, 6).join('\n').trim() });
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: '' });
  }

  override render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    const app = this.props.scope === 'app';
    return (
      <div className="error-boundary" role="alert">
        <h2>{tr('err.boundary.title')}</h2>
        <p>{tr(app ? 'err.boundary.app' : 'err.boundary.screen')}</p>
        <div className="eb-actions">
          {app ? (
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              {tr('err.boundary.reload')}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => this.setState({ error: null, stack: '' })}>
              {tr('err.boundary.retry')}
            </button>
          )}
        </div>
        <details>
          <summary>{tr('err.boundary.detail')}</summary>
          <pre>{`${error.name}: ${error.message}${stack ? `\n${stack}` : ''}`}</pre>
        </details>
      </div>
    );
  }
}
