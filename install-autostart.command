#!/bin/bash
# macOS：このファイルをダブルクリックすると、パソコンにログインしたときに
# サーバーが自動で立ち上がるようになる。やめるときは uninstall-autostart.command。
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
LABEL="jp.co.fuji-elex.zumen"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "単線結線図作成：サーバーの自動起動を設定します"
echo "  場所: $DIR"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。先に https://nodejs.org/ja から LTS版 を入れてください。"
  read -r -p "Enterキーで閉じます"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd '$DIR' || exit 1; exec pnpm start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/server.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load -w "$PLIST"

echo "設定しました。"
echo "  ・このパソコンにログインすると、サーバーが自動で立ち上がります"
echo "  ・止まっても自動でやり直します"
echo "  ・記録は $DIR/data/server.log に残ります"
echo
echo "いま起動しているか確認します（10秒ほどかかります）…"
sleep 10
if curl -sf -o /dev/null http://127.0.0.1:8787/api/health; then
  echo "  → 起動しています。ブラウザで http://127.0.0.1:8787 を開いてください。"
else
  echo "  → まだ応答がありません。data/server.log を見てください。"
fi
echo
read -r -p "Enterキーで閉じます"
