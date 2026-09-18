#!/bin/bash
# macOS：サーバーの自動起動をやめる。
cd "$(dirname "$0")"
PLIST="$HOME/Library/LaunchAgents/jp.co.fuji-elex.zumen.plist"
launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
echo "自動起動をやめました。これからは start-server.command をダブルクリックして起動してください。"
read -r -p "Enterキーで閉じます"
