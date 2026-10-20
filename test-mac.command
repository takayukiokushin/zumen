#!/bin/bash
# macOS：このファイルをダブルクリックすると、ひととおりの動作診断を行う。
cd "$(dirname "$0")" || exit 1
LOG="$(pwd)/test-result.txt"
NG=0

echo "================================================"
echo " 単線結線図作成：動作診断"
echo "================================================"
echo
echo "結果は test-result.txt にも保存されます。"
echo

{ echo "単線結線図作成：動作診断"; echo "実行日時: $(date)"; echo; } > "$LOG"

if ! command -v node >/dev/null 2>&1; then
  echo "[×] Node.js が見つかりません。"
  echo "    https://nodejs.org/ja から LTS版 を入れてから、もう一度実行してください。"
  read -r -p "Enterキーで閉じます"
  exit 1
fi
echo "[1/6] Node.js $(node -v)"
echo "[1/6] Node.js $(node -v)" >> "$LOG"

# pnpm を使えるようにする（無ければ用意する）
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm を用意しています…"
  corepack enable >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@10.33.0 >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[×] pnpm を用意できませんでした。"
  echo "    ターミナルで次の1行を実行してから、もう一度ダブルクリックしてください。"
  echo
  echo "        sudo npm install -g pnpm"
  echo
  read -r -p "Enterキーで閉じます"
  exit 1
fi

step() {
  local n="$1" label="$2"; shift 2
  echo "[$n] $label…"
  { echo; echo "---- $* ----"; } >> "$LOG"
  if "$@" >>"$LOG" 2>&1; then echo "    [○] 完了"; else echo "    [×] 失敗"; NG=1; fi
}
step 2/6 "部品をそろえています（初回は数分かかります）" pnpm install
step 3/6 "型の確認" pnpm typecheck
step 4/6 "図記号と質問の確認" pnpm check
step 5/6 "画面のビルド" pnpm build

echo "[6/6] 通しの動作確認…"
echo
{ echo; echo "---- pnpm selftest ----"; } >> "$LOG"
SELFTEST_LOG="$LOG" pnpm selftest || NG=1

echo
echo "================================================"
if [ "$NG" = "1" ]; then
  echo " 問題が見つかりました。"
  echo " test-result.txt を開いて、中身をそのまま渡してください。"
else
  echo " すべて正常です。このまま進めて問題ありません。"
fi
echo "================================================"
echo
read -r -p "続けて実際の画面も確かめますか？（y / そのままEnterで終了）: " yn
if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
  pnpm --filter @zumen/server user:add test テスト太郎 testpass123 >/dev/null 2>&1 || true
  echo
  echo "ログインID: test ／ パスワード: testpass123"
  echo "止めるときは Control + C。"
  echo
  ( sleep 12; open http://127.0.0.1:8787 ) &
  pnpm start
fi

echo
read -r -p "Enterキーで閉じます"
