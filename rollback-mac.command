#!/bin/bash
# macOS：このファイルをダブルクリックすると、アプリを「更新する前の版」に戻す。
#
#   ・update-mac.command で更新したあと、新しい版がうまく動かないときに使う
#   ・戻るのは、アプリ本体だけ。APIキー（.env）と案件のデータ（data/）は、そのまま残る
#     （案件のデータも、更新前の状態に戻したいときは、途中で聞かれる）
#   ・戻す前の状態（本体・設定・データ）も、あらためて控える。「やっぱり新しい版のほうがよかった」ときに使える
#
# 中身を全部読んでから動き出すように、{ } でくくってある。
{
set -u
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
LABEL="jp.co.fuji-elex.zumen"
COPIES_DIR="$HOME/zumen-更新前の控え"

say() { printf '%s\n' "$1"; }
die() { say ""; say "[×] $1"; say ""; read -r -p "Enterキーで閉じます"; exit 1; }
# 「はい」「いいえ」を聞く（Enter だけなら、いいえ）。自動の試験では、$2 の値を使う
ask_yes() {
  if [ -n "${2:-}" ]; then [ "$2" = "yes" ]; return; fi
  read -r -p "$1 [はい=y / いいえ=Enter] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ]
}
version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1; }

# アプリの中身（.env・data・node_modules・.git 以外）を、$1 から $2 へ写す。$2 にだけあるファイルは消す。
mirror_app() {
  if [ "${ZUMEN_NO_RSYNC:-}" != "1" ] && command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude '/.env' --exclude '/data/' --exclude 'node_modules/' --exclude '.git/' "$1/" "$2/"
    return
  fi
  ( cd "$2" && find . \( -path ./.env -o -path ./data -o -name node_modules -o -name .git \) -prune -o -type f -print ) | while IFS= read -r f; do
    [ -e "$1/$f" ] || rm -f -- "$2/$f"
  done
  ( cd "$1" && tar cf - --exclude=./.env --exclude=./data --exclude=node_modules --exclude=.git . ) | ( cd "$2" && tar xf - )
}

say "単線結線図作成：アプリを、更新する前の版に戻します"
say "  場所: $DIR"
say ""

[ -f "$DIR/package.json" ] || die "ここはアプリのフォルダではないようです。
    start-server.command と同じ場所に置いてから、もう一度ダブルクリックしてください。"
grep -q '"name": "zumen"' "$DIR/package.json" || die "ここはアプリのフォルダではないようです。"

# ---- 1. 戻し先を探す（update-mac.command が控えた、いちばん新しい「アプリ本体つき」の控え） ----
# 「年月日-時分秒」の名前のものだけが対象。この戻す操作が作る控え（名前の終わりが「-戻す前」）は、対象にしない
SRC="$(ls -1d "$COPIES_DIR"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null | sort -r | while IFS= read -r d; do
  if [ -f "$d/app/package.json" ]; then printf '%s' "$d"; break; fi
done)"
[ -n "$SRC" ] || die "戻せる「更新前の版」が見つかりません。

    アプリ本体も控えるようになる前の更新では、本体の控えがありません。
    その場合は、GitHub の ZIP から、前の版を手で入れ替えてください（手順書「手で入れ替えるとき」）。
    案件のデータは、何も変えていません。"
NOW_VER="$(version_of "$DIR/package.json")"
OLD_VER="$(version_of "$SRC/app/package.json")"
say "[1/5] 戻し先: $(basename "$SRC") の更新の前の版（版 ${OLD_VER:-?}）"
say "      いまの版: ${NOW_VER:-?}"
say ""
ask_yes "この版に戻しますか？" "${ZUMEN_YES:-}" || die "やめました。何も変えていません。"

RESTORE_DATA=""
if [ -d "$SRC/data" ]; then
  say ""
  say "案件のデータも、更新前の状態に戻しますか？"
  say "  ・ふつうは「いいえ」（Enter）です。案件は、いまのまま残ります。"
  say "  ・「はい」にすると、更新したあとに作った・直した案件や、利用者の変更が、消えます。"
  say "    （新しい版を動かしたあと、データがおかしくなったときだけ）"
  if ask_yes "データも戻しますか？" "${ZUMEN_RESTORE_DATA:-}"; then RESTORE_DATA="yes"; fi
fi

# ---- 2. 戻す前の状態を控える ----
STAMP="${ZUMEN_STAMP:-$(date +%Y%m%d-%H%M%S)}"
BEFORE="$COPIES_DIR/$STAMP-戻す前"
mkdir -p "$BEFORE/app" || die "控えの場所を作れませんでした。何も変えていません。"
[ -f "$DIR/.env" ] && cp "$DIR/.env" "$BEFORE/" 2>/dev/null
[ -d "$DIR/data" ] && cp -R "$DIR/data" "$BEFORE/" 2>/dev/null
mirror_app "$DIR" "$BEFORE/app" || die "戻す前の状態を控えられませんでした。何も変えていません。"
say "[2/5] 戻す前の状態を控えました"
say "      $BEFORE"

# ---- 3. サーバーを止める（データも戻すときは、必ず止めてから） ----
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ -n "$RESTORE_DATA" ] && [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" >/dev/null 2>&1
  sleep 2
  say "[3/5] サーバーを止めました"
else
  say "[3/5] （サーバーは止めずに、入れ替えます）"
fi

# ---- 4. 入れ替える ----
mirror_app "$SRC/app" "$DIR" || die "入れ替えに失敗しました。

    戻す前の状態は $BEFORE にあります。"
chmod +x "$DIR"/*.command 2>/dev/null
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null
if [ -n "$RESTORE_DATA" ]; then
  rm -rf "$DIR/data" || die "いまのデータを片づけられませんでした。戻す前の状態は $BEFORE にあります。"
  cp -R "$SRC/data" "$DIR/data" || die "データを戻せませんでした。戻す前の状態は $BEFORE にあります。"
  say "[4/5] アプリ本体とデータを、更新前に戻しました"
else
  say "[4/5] アプリ本体を、更新前に戻しました（案件のデータ・APIキーは、そのままです）"
fi

# ---- 5. 部品をそろえて、立ち上げ直す ----
say "[5/5] 部品をそろえて、サーバーを立ち上げ直しています…"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ "${ZUMEN_SKIP_INSTALL:-}" != "1" ]; then
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
fi
if [ -f "$PLIST" ]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
    || { launchctl unload "$PLIST" >/dev/null 2>&1; launchctl load -w "$PLIST" >/dev/null 2>&1; }
  for _ in $(seq 1 120); do
    if curl -fs http://127.0.0.1:8787/api/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if curl -fs http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    say ""
    say "元の版（${OLD_VER:-?}）に戻りました。ブラウザを開きます。"
    say "（開いたページで、command + shift + R を押して読み込み直してください）"
    open "http://127.0.0.1:8787"
  else
    say ""
    say "サーバーがまだ立ち上がりません。data/server.log を見てください。"
    say "（戻す前の状態は $BEFORE にあります）"
  fi
else
  say ""
  say "元の版（${OLD_VER:-?}）に戻りました。"
  say "いま黒い画面でサーバーが動いていたら、その画面で control + C を押して止めてから、"
  say "start-server.command をダブルクリックしてください。"
fi

say ""
say "戻す前の状態の控え: $BEFORE"
say "（「やっぱり新しい版のほうがよかった」ときは、この中の app を元に戻せます）"
read -r -p "Enterキーで閉じます"
exit 0
}
