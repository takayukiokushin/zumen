# zumen — 単線結線図作成アプリ

高圧・自家用電気工作物の**単線結線図**を作成するアプリケーション。
現地のラフスケッチ（写真・PDF）とヒアリング回答から図面のたたき台を生成し、
編集してPDF/PNGで出力する。

- 仕様書：[docs/spec.md](docs/spec.md)
- 記号ナレッジベース（現場知識）：[docs/knowledge-base.md](docs/knowledge-base.md)
- 記号カタログ（生成物）：[docs/symbol-catalog.html](docs/symbol-catalog.html)

## 現在の状態

フェーズ1（MVP）の実装順序 3 まで完了。記号ライブラリのレビュー待ち。

| # | 内容 | 状態 |
|---|---|---|
| 1 | モノレポ基盤・ドキュメント・CI | 完了 |
| 2 | ドメインモデル | 完了 |
| 3 | 記号ライブラリ（独自SVG 62種）＋ カタログ | 完了（全記号確定） |
| 4 | ナレッジベースのルール・質問定義（質問73件・構成ルール38件） | 完了 |
| 5 | ヒアリングフォーム | 完了 |
| 6 | 自動レイアウト・レンダリング（低圧側の分岐を含む） | 完了 |
| 7 | 編集機能（追加・削除・差し替え・移動・結線・注記・元に戻す） | 完了 |
| 8 | PDF/PNG出力 | 完了 |
| 9 | AI解析（手書きメモの読み取り・確認画面） | 完了 |
| 10〜11 | サーバー保管・Electron配布 | 未着手 |

## 構成

```
apps/web           画面（スケッチ読み取り・事前ヒアリング・図面の編集）
apps/server        解析用の中継サーバー（Claude APIキーはここにだけ置く）
packages/core      ドメインモデル（Project / SubstationArea / Equipment / Connection …）
packages/symbols   記号マスタ。図形プリミティブ・記号定義・SVG生成
packages/knowledge 質問定義と構成ルール（条件式つきのデータ）
packages/layout    自動レイアウトとSVG出力
packages/ai        手書きメモ読み取りのスキーマ・指示文・確認事項の組み立て
docs/              仕様書・ナレッジベース・生成された記号カタログ
scripts/           カタログ生成などの補助スクリプト
```

## 記号の持ち方

記号はReactコンポーネントではなく**純粋なデータ**（`Shape[]` + メタデータ）として定義している。

- 画面描画・PDF出力・カタログ生成が同じ定義を参照できる
- 新しい機器は `packages/symbols/src/defs/` に1件足すだけで、パレット・プロパティ入力欄・
  出力すべてに反映される
- 「PASにVT内蔵」のようなバリエーションは新しい記号を増やさず、`slots` と
  ルール定義（今後 `packages/knowledge` に追加）の組み合わせで表現する

記号は**すべて独自に描き起こしている**。JIS C 0617 等の規格書の図版は複製せず、
規格の仕様（形状・比率・意味）を参照して作図している。

## 開発

Node.js 22.6 以上（TypeScriptの型ストリップを使用）と pnpm が必要。

解析を使う場合は、`.env.example` を参考に `ANTHROPIC_API_KEY` を設定して
解析サーバーを起動する（キーはサーバーにだけ置き、端末には配らない）。

```sh
pnpm install
pnpm dev         # 画面を起動
pnpm dev:server  # 解析サーバーを起動（別の端末で）
pnpm typecheck   # 型チェック
pnpm check       # 質問定義・構成ルールの検証（実図面との一致確認を含む）
pnpm catalog     # docs/symbol-catalog.html を再生成
pnpm sample      # docs/sample-drawing.svg を再生成
```

## 位置づけ

本アプリは作図支援ツールであり、電気事業法・保安規程等への適合性の最終確認は
有資格者（電気主任技術者等）が行うことを前提とする。AI解析の出力は「下書き」として扱い、
人間が確認・修正するステップを必須とする。
