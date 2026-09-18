# zumen — 単線結線図作成アプリ

高圧・自家用電気工作物の**単線結線図**を作成するアプリケーション。
現地のラフスケッチ（写真・PDF）とヒアリング回答から図面のたたき台を生成し、
編集してPDF/PNGで出力する。

- **導入手順（インストールのしかた）**：[docs/install.md](docs/install.md)
- 仕様書：[docs/spec.md](docs/spec.md)
- 記号ナレッジベース（現場知識）：[docs/knowledge-base.md](docs/knowledge-base.md)
- 記号カタログ（生成物）：[docs/symbol-catalog.html](docs/symbol-catalog.html)

## 現在の状態

フェーズ1（MVP）の実装順序 1〜11 が一通り完了。

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
| 10 | サーバー保管・ログイン・案件管理 | 完了 |
| 10b | 同時編集の排他（編集中は他の人は閲覧のみ） | 完了 |
| 11 | Electron配布（mac / Windows） | 完了（コード署名は未設定） |

## 構成

```
apps/web           画面（スケッチ読み取り・事前ヒアリング・図面の編集）
apps/server        サーバー（案件の保管・ログイン・解析の中継。APIキーはここにだけ置く）
apps/desktop       デスクトップ版（Electron。社内サーバーに接続して同じ画面を使う）
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

`.env.example` を参考に `ANTHROPIC_API_KEY` を設定してサーバーを起動する
（キーはサーバーにだけ置き、端末には配らない）。案件・回答・図面・現地写真は
すべてサーバー側の SQLite（`data/zumen.db`）と `data/files/` に保管される。

利用者はサーバー側で登録する。

```sh
pnpm --filter @zumen/server user:add <ID> <名前> <パスワード>   # 追加
pnpm --filter @zumen/server user:passwd <ID> <新しいパスワード> # パスワード変更
pnpm --filter @zumen/server user:list                          # 一覧
```

```sh
pnpm install
pnpm dev         # 画面を起動
pnpm dev:server  # 解析サーバーを起動（別の端末で）
pnpm typecheck   # 型チェック
pnpm check       # 質問定義・構成ルールの検証（実図面との一致確認を含む）
pnpm catalog     # docs/symbol-catalog.html を再生成
pnpm sample      # docs/sample-drawing.svg を再生成
pnpm start       # 画面をビルドしてサーバーを起動（実際に使うとき）
                 # ダブルクリックで起動するなら start-server.command / .bat
                 # ログイン時に自動で立ち上げるなら install-autostart.command / .bat
pnpm --filter @zumen/server backup <保存先>   # 案件の控えを取る
```

## デスクトップ版（Electron）

デスクトップ版は画面を作り直したものではなく、**社内サーバーの画面をそのまま表示する薄い殻**。
Web版と機能差が出ないようにしてある。

- 初回起動時に接続先（社内サーバーのURL）を入力する。設定は端末のユーザーデータに保存される
- メニューから「接続先を変える」でいつでも変更できる
- 「ファイル > PDFとして保存」でA4のPDFを書き出せる（`⌘P` / `Ctrl+P` は印刷）
- APIキーは端末に一切置かない。解析はサーバー経由のまま

サーバーは `apps/web` のビルド結果も配信するので、ブラウザでも同じURLでそのまま使える。

```sh
pnpm build                    # apps/web を apps/server が配信できる形にビルド
pnpm dev:server               # サーバーを起動（既定 http://127.0.0.1:8787）
pnpm desktop                  # デスクトップ版を起動（開発用）

pnpm dist:mac                 # macOS用 dmg を作る（macOS上で実行）
pnpm dist:win                 # Windows用インストーラを作る（Windows上で実行）
```

インストーラの作成は**その OS 上で実行する必要がある**（macのdmgはmacで、Windowsのexeは
Windowsで作る）。また、現時点では以下が未設定：

- macOSのコード署名・公証、Windowsのコード署名
  （未署名でも社内配布は可能だが、初回起動時に警告が出る）。
  費用と手順は [docs/install.md](docs/install.md) の「5. コード署名について」を参照。
  社内利用のみのため当面は署名しない方針

アイコンは「単結」をIPAゴシックで縦2段、地はオレンジ（`#d97757`）。
デスクトップ版は `apps/desktop/build/icon.png`（electron-builder が mac用 `.icns` と
Windows用 `.ico` を自動生成）、ブラウザ版は `apps/web/public/` の各サイズ。

ブラウザ版は `manifest.webmanifest` を持たせてあるので、Chrome / Edge の
「ページをアプリとしてインストール」でデスクトップから直接起動できる。
インストーラを配らずに済むぶん、こちらのほうが手軽（→ [docs/install.md](docs/install.md) の 3-1.）。

## 位置づけ

本アプリは作図支援ツールであり、電気事業法・保安規程等への適合性の最終確認は
有資格者（電気主任技術者等）が行うことを前提とする。AI解析の出力は「下書き」として扱い、
人間が確認・修正するステップを必須とする。
