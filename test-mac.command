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

# pnpm の用意。管理者権限が要らない順に試す。
# スクリプトの中から pnpm を呼ぶ場面があるので、PATHに通った本物を用意する
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    mkdir -p "$HOME/.zumen-bin"
    corepack enable --install-directory "$HOME/.zumen-bin" >/dev/null 2>&1
    PATH="$HOME/.zumen-bin:$PATH"
    export PATH
  fi
fi
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@10.33.0 >/dev/null 2>&1
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

# 次から普通のターミナルでも pnpm が使えるように、設定ファイルに1行足しておく
if [ -d "$HOME/.zumen-bin" ]; then
  for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
    [ -e "$rc" ] || continue
    if ! grep -q '.zumen-bin' "$rc" 2>/dev/null; then
      {
        echo ''
        echo '# 単線結線図作成アプリで使う pnpm'
        echo 'export PATH="$HOME/.zumen-bin:$PATH"'
      } >> "$rc"
      echo "      $rc に pnpm の場所を追記しました（次に開くターミナルから有効）"
    fi
  done
  # zshrc が無い人のために作る
  if [ ! -e "$HOME/.zshrc" ]; then
    {
      echo '# 単線結線図作成アプリで使う pnpm'
      echo 'export PATH="$HOME/.zumen-bin:$PATH"'
    } > "$HOME/.zshrc"
    echo "      ~/.zshrc を作って pnpm の場所を書きました（次に開くターミナルから有効）"
  fi
fi

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
step 2/6 "部品をそろえています（初回は数分かかります）" pnpm install
step 3/6 "型の確認" pnpm typecheck
step 4/6 "図記号と質問の確認" pnpm check
step 5/6 "画面のビルド" pnpm build

echo "[6/6] 通しの動作確認…"
echo
{ echo; echo "---- selftest ----"; } >> "$LOG"
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
  # 確認用のIDは、このあと必ず消す（パスワードが手順書に書いてあるため）
  trap 'pnpm --filter @zumen/server user:remove test >/dev/null 2>&1 || true' EXIT
  echo
  echo "ログインID: test ／ パスワード: testpass123"
  echo "※ この確認用のIDは、終了すると自動で消えます。"
  echo "止めるときは Control + C。"
  echo
  # 起動したのを確かめてからブラウザを開く（ビルドに時間がかかることがあるため）
  (
    i=0
    while [ "$i" -lt 120 ]; do
      if curl -sf -o /dev/null http://127.0.0.1:8787/api/health 2>/dev/null; then
        open http://127.0.0.1:8787
        exit 0
      fi
      i=$((i + 1))
      sleep 1
    done
    echo
    echo "※ 2分待ちましたが、サーバーの応答がありません。"
    echo "  ブラウザで http://127.0.0.1:8787 を自分で開いてみてください。"
  ) &
  pnpm start
  pnpm --filter @zumen/server user:remove test >/dev/null 2>&1 || true
  echo
  echo "確認用のID（test）は消しました。"
  echo "実際に使う人のIDは、次のように作ってください。"
  echo "  pnpm --filter @zumen/server user:add <ID> <名前> <8文字以上のパスワード>"
fi

echo
read -r -p "Enterキーで閉じます"
