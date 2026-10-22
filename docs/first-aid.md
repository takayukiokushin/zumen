# 困ったとき用の1枚

**この1枚だけは、アプリのフォルダの外に置いておくこと。**
印刷するか、Macの「メモ」アプリに丸ごと貼り付けておく。

> アプリの手順書（`docs/server-setup.md`）は**アプリのフォルダの中**にある。
> フォルダがまだ無いとき・開けないときに読めないので、この1枚を別に持っておく。

---

## 0. 場所の早見表

| もの | 場所 |
|---|---|
| アプリのフォルダ | デスクトップの **`zumen`**（`test-mac.command` が見えるところ） |
| APIキー | そのフォルダの **`.env`** |
| 案件のデータ | そのフォルダの **`data/`** |
| 記録（ログ） | そのフォルダの **`data/server.log`** |
| 控え（バックアップ） | `.env` の `BACKUP_DIR` に書いた場所 |
| 手順書（全文） | そのフォルダの `docs/server-setup.md` |
| 置き場所（GitHub） | <https://github.com/takayukiokushin/zumen> |
| アプリを開く住所 | `http://127.0.0.1:8787`（このMac自身から） |

**`.env` と `data/` の2つさえ無事なら、他は何度でも入れ直せる。**

---

## 1. まず試すこと

### いちばん確実：貼るだけのテキスト

`docs/start-here.md` の枠の中を**まるごとコピーして Claude Code に貼る**。
設置から利用者の登録、非公開化まで、これ1つで最後まで進む。
フォルダがまだ無くても使える（そこから作ってくれる）。

<https://github.com/takayukiokushin/zumen/blob/claude/single-line-diagram-app-h1mp73/docs/start-here.md>

### フォルダがすでにあるなら：合言葉

アプリのフォルダで Claude Code を開いて、こう言う。

```
今から会社のMacをサーバーにする設定を行います。以前作成したマニュアルを出して
```

これで、設置手順 → 利用者の管理 → 非公開化 の順に出てくる。

---

## 2. 合言葉が効かないとき

### 2-A. フォルダはあるが、Claudeが手順書を出してくれない

**ほとんどの原因は「Claude Code が別の場所で動いている」こと。**
ターミナルで、アプリのフォルダに入ってから開き直す。

```sh
cd ~/Desktop/zumen
claude
```

> フォルダ名が違うときは、`cd ` と打って（うしろに半角スペース）、
> デスクトップのフォルダをターミナルの窓に**ドラッグ**して Enter。

入り直したら、次をそのまま貼る。

```
このフォルダの docs/server-setup.md を読んで、次の3つをこの順で全文表示してください。
要約しないでください。

 1. 第2部（2-1〜2-11）サーバー用Macでの操作手順
 2. 第3部の「利用者を増やす・パスワードを変える」と、2-7「利用者を登録する」
 3. 第4部（4-1〜4-6）リポジトリをprivateに変更する手順

区切りごとに止めて、私が「次」と言ったら続けてください。
```

### 2-B. 「リポジトリにアクセスできません」と言われる

リポジトリを**非公開（private）にしたあと**に出る。GitHubの許可を入れ直す。

1. <https://github.com/apps/claude/installations/select_target> を開く
2. `takayukiokushin` を選ぶ
3. `zumen` に**チェックを入れて** Save

それでも出るときは <https://claude.ai/connect-github> でつなぎ直す。

### 2-C. フォルダがまだ無い／Claudeが何も読めない

**この文をそのまま Claude に貼れば、手順書なしで案内できる。**

```
会社のMac miniを、単線結線図アプリのサーバーにしたいです。
あなたはこのフォルダを読めないので、下の要点だけで案内してください。
私はプログラマーではないので、専門用語を使わず、1つずつ区切って進めてください。

【やること】
1. Node.js（LTS版）を https://nodejs.org/ja から入れる。`node -v` で v22 以上を確認
2. https://github.com/takayukiokushin/zumen を開き、緑の「Code」→「Download ZIP」
   展開してデスクトップに置く（test-mac.command が見えるところが本体）
3. ターミナルでそのフォルダに cd して `xattr -dr com.apple.quarantine .`
4. `./test-mac.command` で動作確認（初回5〜10分。「すべて正常」と出れば成功）
5. `cp .env.example .env && open -e .env` で .env を作り、
   ANTHROPIC_API_KEY= の右側にAPIキーを貼って保存
   確認は `pnpm --filter @zumen/server apikey`
6. 同じ .env の一番下の BACKUP_DIR= に、Dropboxなど同期フォルダのパスを書く（先頭の#を消す）
7. 最初のアカウントを作る（パスワードは8文字以上）
   pnpm --filter @zumen/server user:add kanri 管理者 パスワード admin
   pnpm --filter @zumen/server user:add fujielex 株式会社フジエレックス パスワード member
   pnpm --filter @zumen/server user:add renshu 練習用 パスワード sandbox
   一覧は user:list、消すのは user:remove <ID>、パスワード変更は user:passwd <ID> <新>
8. `./install-autostart.command` で自動起動にする
9. `pnpm start` の2行目に出る「社内の他のパソコンからは: http://192.168.x.x:8787」を控える
10. システム設定 → ロック画面 でスリープさせない、
    ユーザとグループ で自動ログインをオンにする
11. 別のパソコンのブラウザで9の住所を開き、ログインできれば完成

【注意】
- APIキーはこのMac 1台だけに置く。他のパソコンには配らない
- .env と data/ は、何があっても消さない・引き継ぐ
- 2番目以降の利用者は、管理用アカウントでログインして画面の「利用者の管理」から作れる
```

### 2-D. Claude Code そのものが使えない

**ブラウザで手順書を直接読む。**
GitHubにログインした状態で、次を開く。

<https://github.com/takayukiokushin/zumen/blob/claude/single-line-diagram-app-h1mp73/docs/server-setup.md>

GitHubの画面でそのまま読める（ダウンロード不要）。
上の **2-C の【やること】11項目**だけでも、ひととおり終わる。

---

## 3. 症状別の対処

| 症状 | 原因 | どうするか |
|---|---|---|
| `command not found: node` | Node.js が未インストール | <https://nodejs.org/ja> のLTS版を入れ、ターミナルを開き直す |
| `command not found: pnpm` | 準備が未了 | 先に `./test-mac.command` を1回動かす |
| 「マルウェアが含まれていないことを検証できません」 | macOSの保護 | フォルダで `xattr -dr com.apple.quarantine .` |
| `./test-mac.command` が「問題が見つかりました」 | — | 同じフォルダの `test-result.txt` の中身を見せる |
| 他のパソコンからつながらない | サーバーが止まっている | サーバー役のMacで `./start-server.command` |
| 〃（サーバーは動いている） | ファイアウォール | システム設定 → ネットワーク → ファイアウォール → オプション で Node を許可 |
| 再起動したら使えない | 自動ログインがオフ | システム設定 → ユーザとグループ → 自動ログインをオン |
| 「利用券（APIキー）が設定されていません」 | `.env` が無い／名前違い | `.env.txt` になっていないか確認 |
| 「アカウントの残高がありません」 | クレジット未購入 | <https://platform.claude.com/settings/billing> で残高を買う |
| ログインが10回失敗して止まった | 総当たり対策 | 30分待つか、管理用アカウントの「利用者の管理」→「ログインを解除」 |
| 管理用のパスワードも分からない | — | ターミナルで `pnpm --filter @zumen/server user:passwd kanri 新しいパスワード` |
| 画面が古いまま変わらない | ブラウザのキャッシュ | `command + shift + R` で読み込み直す |
| 動きがおかしい | — | `data/server.log` の最後の20行を見せる |

---

## 4. いざというとき

### サーバーを手で動かす・止める

```sh
cd ~/Desktop/zumen   # アプリのフォルダへ
./start-server.command         # 動かす（止めるのは control + C）
```

### 控えから案件を戻す

控えのフォルダ（`BACKUP_DIR` に書いた場所）の、日付のフォルダの中にある
`zumen.db` と `files/` を、アプリのフォルダの `data/` に上書きする。
先にサーバーを止めてから行うこと。

### 全部おかしくなった

1. `.env` と `data/` を**どこか別の場所にコピー**する（これが全財産）
2. アプリのフォルダを捨てる
3. 2-C の手順1〜4をやり直す
4. 退避した `.env` と `data/` を、新しいフォルダに戻す
5. `./start-server.command`

---

## 5. これだけは守る

1. **`.env`（APIキー）と `data/`（案件のデータ）は、何があっても消さない**
2. **APIキーはサーバー役のMac 1台だけ。** 他のパソコンやチャットに貼らない
3. **サーバー役のMacの電源を切ると、全員が使えなくなる**
4. **控えが取れているか、月に1回は目で見て確かめる**

---

## 6. 伝えるときのひな形

誰かに相談するときは、これを埋めて渡すと早い。

```
・何をしようとしたか：
・画面に出た文字（そのままコピー）：
・アプリのフォルダの場所：
・サーバーは動いているか（http://127.0.0.1:8787 が開くか）：
・data/server.log の最後の20行：
```
