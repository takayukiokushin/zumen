#!/bin/bash
# macOS：このファイルをダブルクリックすると、アプリを最新の内容に入れ替える。
#
#   ・APIキー（.env）と案件のデータ（data/）はそのまま残る
#   ・入れ替えたあと、サーバーを立ち上げ直すところまでやる
#
# 中身を全部読んでから動き出すように、{ } でくくってある。
# （自分自身を書き換えるので、途中まで読んだ状態で入れ替わると壊れるため）
{
set -u
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
LABEL="jp.co.fuji-elex.zumen"
ZIP_URL="https://github.com/takayukiokushin/zumen/archive/refs/heads/claude/single-line-diagram-app-h1mp73.zip"

say() { printf '%s\n' "$1"; }
# ファイルの日付。macOS（BSD）とそれ以外の両方に合わせる
when_of() { stat -f '%Sm' -t '%Y/%m/%d %H:%M' "$1" 2>/dev/null || date -r "$1" '+%Y/%m/%d %H:%M' 2>/dev/null; }
die() { say ""; say "[×] $1"; say ""; read -r -p "Enterキーで閉じます"; exit 1; }

say "単線結線図作成：アプリを新しくします"
say "  場所: $DIR"
say ""

# ここが本当にアプリのフォルダかを確かめる（別の場所で走らせて消さないように）
[ -f "$DIR/package.json" ] || die "ここはアプリのフォルダではないようです。
    start-server.command と同じ場所に置いてから、もう一度ダブルクリックしてください。"
grep -q '"name": "zumen"' "$DIR/package.json" || die "ここはアプリのフォルダではないようです。"

command -v curl >/dev/null 2>&1 || die "curl が見つかりません。"
command -v unzip >/dev/null 2>&1 || die "unzip が見つかりません。"

# ---- 1. いまの .env と data を控えておく ----
STAMP="$(date +%Y%m%d-%H%M%S)"
SAFE="$HOME/zumen-更新前の控え/$STAMP"
mkdir -p "$SAFE" || die "控えの場所を作れませんでした。"
[ -f "$DIR/.env" ] && cp "$DIR/.env" "$SAFE/" 2>/dev/null
[ -d "$DIR/data" ] && cp -R "$DIR/data" "$SAFE/" 2>/dev/null
say "[1/6] いまの設定とデータを控えました"
say "      $SAFE"

# ---- 2. 新しい中身を取ってくる ----
say "[2/6] 新しい中身を取ってきています…"
TMP="$(mktemp -d)" || die "作業用の場所を作れませんでした。"
trap 'rm -rf "$TMP"' EXIT

GOT=""
# まず直接ダウンロードしてみる（リポジトリが「公開」のときはこれで通る）
if curl -fsL --retry 2 --retry-delay 2 -o "$TMP/zumen.zip" "$ZIP_URL" 2>/dev/null; then
  GOT="インターネットから取ってきた中身"
else
  # リポジトリを「非公開」にしてあると、ここは通らない。
  # そのときは、ブラウザで落としてもらったZIPを「ダウンロード」フォルダから探す
  ZIP_LOCAL="$(ls -t "$HOME/Downloads"/zumen-*.zip 2>/dev/null | head -1)"
  if [ -n "$ZIP_LOCAL" ]; then
    cp "$ZIP_LOCAL" "$TMP/zumen.zip" || die "ZIPを読めませんでした。"
    GOT="ダウンロードフォルダの $(basename "$ZIP_LOCAL")（$(when_of "$ZIP_LOCAL")）"
  fi
fi
[ -n "$GOT" ] || die "新しい中身を取ってこられませんでした。

    リポジトリを「非公開」にしている場合は、先にブラウザで落としてください。

      1. GitHubにログインした状態で
         https://github.com/takayukiokushin/zumen を開く
      2. 緑色の「Code」→「Download ZIP」
      3. 落とし終わったら、このファイルをもう一度ダブルクリック

    （ZIPはダウンロードフォルダに置いたままで構いません。
      古いZIPが残っていると間違えるので、先に捨てておくこと）"
say "      $GOT を使います"
unzip -q "$TMP/zumen.zip" -d "$TMP/out" || die "ZIPを開けませんでした。"

# 展開すると zumen-なんとか/ という1段深いフォルダになる
NEW="$(find "$TMP/out" -maxdepth 2 -name package.json -print -quit)"
[ -n "$NEW" ] || die "ダウンロードした中身が見つかりませんでした。"
NEW="$(dirname "$NEW")"

# ---- 3. 入れ替える（.env と data と node_modules は触らない） ----
say "[3/6] 入れ替えています…"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.env' --exclude 'data/' --exclude 'node_modules/' --exclude '.git/' \
    "$NEW/" "$DIR/" || die "入れ替えに失敗しました。控えは $SAFE にあります。"
else
  # rsync が無いときは、上書きコピーだけ（消えた古いファイルは残る）
  (cd "$NEW" && tar cf - .) | (cd "$DIR" && tar xf -) || die "入れ替えに失敗しました。"
fi
chmod +x "$DIR"/*.command 2>/dev/null
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

# ---- 4. .env と data が残っているか確かめる ----
if [ -f "$SAFE/.env" ] && [ ! -f "$DIR/.env" ]; then cp "$SAFE/.env" "$DIR/.env"; fi
if [ -d "$SAFE/data" ] && [ ! -d "$DIR/data" ]; then cp -R "$SAFE/data" "$DIR/data"; fi
say "[4/6] APIキーと案件のデータは、そのまま残っています"

# ---- 5. 必要な部品をそろえる（部品が増えていることがあるため） ----
say "[5/6] 必要な部品をそろえています…（初回は数分かかることがあります）"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  mkdir -p "$HOME/.zumen-bin"
  corepack enable --install-directory "$HOME/.zumen-bin" >/dev/null 2>&1
  PATH="$HOME/.zumen-bin:$PATH"
  export PATH
fi
if command -v pnpm >/dev/null 2>&1; then
  pnpm install >/dev/null 2>&1 || say "      （部品の用意でつまずきました。起動時にもう一度試します）"
else
  say "      （pnpm が見つかりません。start-server.command が用意します）"
fi

# ---- 6. 立ち上げ直す ----
say "[6/6] サーバーを立ち上げ直しています…"
if [ -f "$HOME/Library/LaunchAgents/$LABEL.plist" ]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
    || { launchctl unload "$HOME/Library/LaunchAgents/$LABEL.plist" >/dev/null 2>&1
         launchctl load -w "$HOME/Library/LaunchAgents/$LABEL.plist" >/dev/null 2>&1; }
  # 立ち上がるまで待つ（初回は組み立てに1〜2分かかることがある）
  for _ in $(seq 1 120); do
    if curl -fs http://127.0.0.1:8787/api/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if curl -fs http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    say ""
    say "新しくなりました。ブラウザを開きます。"
    say "（開いたページで、command + shift + R を押して読み込み直してください）"
    open "http://127.0.0.1:8787"
  else
    say ""
    say "サーバーがまだ立ち上がりません。data/server.log を見てください。"
  fi
else
  say ""
  say "新しくなりました。"
  say "いま黒い画面でサーバーが動いていたら、その画面で control + C を押して止めてから、"
  say "start-server.command をダブルクリックしてください。"
fi

say ""
read -r -p "Enterキーで閉じます"
exit 0
}
