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

rem ---- pnpm の呼び出し方を決める（管理者権限が要らない順に試す） ----
set "PNPM=pnpm"
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_ready
call corepack pnpm --version >nul 2>nul
if not errorlevel 1 (
  rem corepack 経由なら、入れ直さずにそのまま使える
  set "PNPM=corepack pnpm"
  goto :pnpm_ready
)
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

call %PNPM% install || (echo うまくいきませんでした。 & pause & exit /b 1)
call %PNPM% start

echo.
echo サーバーが止まりました。
pause
