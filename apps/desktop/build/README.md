# アイコン

「単結」2文字を縦に並べる。地は黄色（`#FFC800`）、文字は黒（`#111111`）。
書体は **UDゴシック（BIZ UDPGothic Bold）**。文字は図形に変えてあるので、書体の登録は要らない。

- `icon.png`（1024×1024・背景透過）が本体。electron-builder がここから
  macOS用の `.icns` と Windows用の `.ico` を自動生成する
- 原図は `icon.svg`（ブラウザ用の `apps/web/public/icon.svg` と同じ図形を、1024 の中に 824 の大きさで置いたもの。
  まわりの余白は、macOS の流儀に合わせている）

ブラウザ用の同じアイコンは `apps/web/public/` にある。

- ホーム画面・アプリ用：`icon-192.png` / `icon-512.png` / `icon-maskable-512.png` / `apple-touch-icon.png`（「単結」2文字）
- ブラウザのタブ用：`icon-tab.svg` / `favicon-tab.ico` / `favicon-tab-16.png` / `favicon-tab-32.png` / `favicon-tab-48.png`（「単」1文字。小さくても読めるように）

**色や字を変えるときは、デスクトップ版とブラウザ版の両方をそろえること。**
