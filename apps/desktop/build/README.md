# アイコン

「単結」をIPAゴシックで縦2段。地はオレンジ（`#d97757`）、文字は白。

- `icon.png`（1024×1024・背景透過）が本体。electron-builder がここから
  macOS用の `.icns` と Windows用の `.ico` を自動生成する
- 原図は `icon.svg`
- 角丸は macOS の流儀に合わせ、1024 の中に 824 の角丸四角（余白100・角丸215）を置いている
- 書体は **IPAゴシック**。他のフォントに落ちると漢字の字形が変わるので使わない

ブラウザ用の同じアイコンは `apps/web/public/` にある（`icon-192.png` /
`icon-512.png` / `icon-maskable-512.png` / `apple-touch-icon.png` / `favicon-32.png`）。
**色や字を変えるときは両方そろえること。**
