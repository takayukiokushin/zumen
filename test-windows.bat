@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
rem corepack が確認を求めて止まらないようにする
set COREPACK_ENABLE_DOWNLOAD_PROMPT=0

set "LOG=%~dp0test-result.txt"
set "NG=0"

echo ================================================
echo  単線結線図作成：Windows 動作診断
echo ================================================
echo.
echo 結果は test-result.txt にも保存されます。
echo.

echo 単線結線図作成：Windows 動作診断 > "%LOG%"
echo 実行日時: %DATE% %TIME% >> "%LOG%"
echo. >> "%LOG%"

rem ---- Node.js があるか ----
where node >nul 2>nul
if errorlevel 1 (
  echo [×] Node.js が見つかりません。
  echo     https://nodejs.org/ja から LTS版 を入れてから、もう一度実行してください。
  echo Node.js が見つかりません >> "%LOG%"
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [1/6] Node.js !NODEV!
echo [1/6] Node.js !NODEV! >> "%LOG%"

rem ---- pnpm を用意する（管理者権限が要らない順に試す） ----
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
set "ZUMEN_BIN=%LOCALAPPDATA%\zumen-bin"
if not exist "%ZUMEN_BIN%" mkdir "%ZUMEN_BIN%"
call corepack enable --install-directory "%ZUMEN_BIN%" >nul 2>nul
set "PATH=%ZUMEN_BIN%;%PATH%"
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
call npm install -g pnpm@10.33.0 >nul 2>nul
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
echo.
echo [×] pnpm を用意できませんでした。
echo     PowerShell を「管理者として実行」で開き、次の1行を実行してから、
echo     もう一度このファイルをダブルクリックしてください。
echo.
echo         npm install -g pnpm
echo.
pause
exit /b 1
:pnpm_ready
call corepack pnpm --version >>"%LOG%" 2>&1
if not errorlevel 1 (
  rem corepack 経由なら、入れ直さずにそのまま使える
  set "PNPM=corepack pnpm"
  goto :pnpm_ready
)
call npm install -g pnpm@10.33.0 >>"%LOG%" 2>&1
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
echo.
echo [×] pnpm を用意できませんでした。
echo     PowerShell を「管理者として実行」で開き、次の1行を実行してから、
echo     もう一度このファイルをダブルクリックしてください。
echo.
echo         npm install -g pnpm
echo.
pause
exit /b 1
:pnpm_ready
echo     pnpm を用意しています…
call corepack enable >>"%LOG%" 2>&1
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
call npm install -g pnpm@10.33.0 >>"%LOG%" 2>&1
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
echo.
echo [×] pnpm を用意できませんでした。
echo     PowerShell を「管理者として実行」で開き、次の1行を実行してから、
echo     もう一度このファイルをダブルクリックしてください。
echo.
echo         npm install -g pnpm
echo.
pause
exit /b 1
:pnpm_ready

echo [2/6] 部品をそろえています（初回は数分かかります）…
echo. >> "%LOG%"
echo ---- pnpm install ---- >> "%LOG%"
call pnpm install >>"%LOG%" 2>&1
if errorlevel 1 (echo     [×] 失敗 & set "NG=1") else (echo     [○] 完了)

echo [3/6] 型の確認…
echo. >> "%LOG%"
echo ---- pnpm typecheck ---- >> "%LOG%"
call pnpm typecheck >>"%LOG%" 2>&1
if errorlevel 1 (echo     [×] 失敗 & set "NG=1") else (echo     [○] 完了)

echo [4/6] 図記号と質問の確認…
echo. >> "%LOG%"
echo ---- pnpm check ---- >> "%LOG%"
call pnpm check >>"%LOG%" 2>&1
if errorlevel 1 (echo     [×] 失敗 & set "NG=1") else (echo     [○] 完了)

echo [5/6] 画面のビルド…
echo. >> "%LOG%"
echo ---- pnpm build ---- >> "%LOG%"
call pnpm build >>"%LOG%" 2>&1
if errorlevel 1 (
  echo     [×] 失敗
  set "NG=1"
  echo.
  echo     ---- 失敗した理由 ----
  powershell -NoProfile -Command "Get-Content -Tail 15 '%LOG%' | ForEach-Object { '    ' + $_ }"
  echo     ----------------------
  echo.
) else (echo     [○] 完了)

echo [6/6] 通しの動作確認…
echo.
echo. >> "%LOG%"
echo ---- pnpm selftest ---- >> "%LOG%"
set "SELFTEST_LOG=%LOG%"
call pnpm selftest
if errorlevel 1 set "NG=1"
set "SELFTEST_LOG="

echo.
echo ================================================
if "!NG!"=="1" (
  echo  問題が見つかりました。
  echo  test-result.txt を開いて、中身をそのまま渡してください。
) else (
  echo  すべて正常です。このまま進めて問題ありません。
)
echo ================================================
echo.
echo 続けて、実際の画面も確かめますか？
echo サーバーを別の窓で起動して、ブラウザで開きます。
echo.
choice /c YN /n /m "確かめる場合は Y、終わる場合は N を押してください: "
if errorlevel 2 goto :done

call pnpm --filter @zumen/server user:add test テスト太郎 testpass123 >nul 2>nul
echo ※ この確認用のIDは、あとで消してください（パスワードが手順書に書いてあるため）
echo    call pnpm --filter @zumen/server user:remove test
start "単線結線図サーバー" cmd /k "cd /d "%~dp0" && pnpm start"
echo.
echo サーバーの起動を待っています…
timeout /t 15 /nobreak >nul
start "" http://127.0.0.1:8787
echo.
echo ブラウザが開きました。次を確かめてください。
echo.
echo   ログインID: test ／ パスワード: testpass123
echo.
echo   1. ログインできるか
echo   2. 「案件を選ぶ」から新しい案件を作れるか
echo   3. 「事前ヒアリング」で質問に答えられるか
echo   4. 「図面」タブに図が出るか（漢字の形が不自然でないか）
echo   5. 図面を PDF に書き出せるか
echo.
echo   終わったら、別窓のサーバーで Ctrl + C を押すか、その窓を閉じてください。

:done
echo.
pause
