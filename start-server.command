#!/bin/bash
# macOS：このファイルをダブルクリックするとサーバーが立ち上がる。
# 終わるときはこのウィンドウで Control + C を押すか、ウィンドウを閉じる。
cd "$(dirname "$0")" || exit 1

echo "単線結線図作成：サーバーを起動します"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。https://nodejs.org/ja から LTS版 を入れてください。"
  read -r -p "Enterキーで閉じます"
  exit 1
fi

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

pnpm install || { read -r -p "うまくいきませんでした。Enterキーで閉じます"; exit 1; }
pnpm start

echo
read -r -p "サーバーが止まりました。Enterキーで閉じます"
