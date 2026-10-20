@echo off
chcp 65001 >nul
rem Windows：このファイルをダブルクリックするとサーバーが立ち上がる。
rem 終わるときはこのウィンドウで Ctrl + C を押すか、ウィンドウを閉じる。
cd /d "%~dp0"
rem corepack が確認を求めて止まらないようにする
set COREPACK_ENABLE_DOWNLOAD_PROMPT=0

echo 単線結線図作成：サーバーを起動します
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS版 を入れてください。
  pause
  exit /b 1
)

rem ---- pnpm を使えるようにする（無ければ用意する） ----
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
echo pnpm を用意しています…
call corepack enable >nul 2>nul
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

call pnpm install || (echo うまくいきませんでした。 & pause & exit /b 1)
call pnpm start

echo.
echo サーバーが止まりました。
pause
