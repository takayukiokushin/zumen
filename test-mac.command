#!/bin/bash
# macOS：このファイルをダブルクリックすると、ひととおりの動作診断を行う。
cd "$(dirname "$0")" || exit 1
LOG="$(pwd)/test-result.txt"
NG=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

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

# pnpm の用意。管理者権限が要らない順に試す
if command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
elif command -v corepack >/dev/null 2>&1 && corepack pnpm --version >/dev/null 2>&1; then
  # corepack 経由なら、入れ直さずにそのまま使える（管理者権限が要らない）
  PNPM="corepack pnpm"
  echo "      pnpm は corepack 経由で使います"
else
  echo "[×] pnpm を用意できませんでした。"
  echo "    ターミナルで次の1行を実行してから、もう一度ダブルクリックしてください。"
  echo
  echo "        sudo npm install -g pnpm"
  echo
  read -r -p "Enterキーで閉じます"
  exit 1
fi

# 古いbash（macOS標準の3.2）でも確実に動くように、printfで出す
step() {
  step_n="$1"
  step_label="$2"
  shift 2
  printf '[%s] %s…\n' "$step_n" "$step_label"
  { echo; echo "---- $* ----"; } >> "$LOG"
  before=$(wc -l < "$LOG")
  if "$@" >>"$LOG" 2>&1; then
    printf '    [○] 完了\n'
  else
    printf '    [×] 失敗\n'
    NG=1
    # 失敗した理由をその場で出す（ファイルを開かなくても分かるように）
    printf '\n    ---- 失敗した理由（最後の15行）----\n'
    tail -n +"$((before + 1))" "$LOG" | tail -15 | sed 's/^/    /'
    printf '    ----------------------------------\n\n'
  fi
}
step 2/6 "部品をそろえています（初回は数分かかります）" $PNPM install
step 3/6 "型の確認" $PNPM typecheck
step 4/6 "図記号と質問の確認" $PNPM check
step 5/6 "画面のビルド" $PNPM build

echo "[6/6] 通しの動作確認…"
echo
{ echo; echo "---- selftest ----"; } >> "$LOG"
SELFTEST_LOG="$LOG" $PNPM selftest || NG=1

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
  $PNPM --filter @zumen/server user:add test テスト太郎 testpass123 >/dev/null 2>&1 || true
  echo
  echo "ログインID: test ／ パスワード: testpass123"
  echo "止めるときは Control + C。"
  echo
  ( sleep 12; open http://127.0.0.1:8787 ) &
  $PNPM start
fi

echo
read -r -p "Enterキーで閉じます"
