@echo off
rem Windows：このファイルをダブルクリックするとサーバーが立ち上がる。
rem 終わるときはこのウィンドウで Ctrl + C を押すか、ウィンドウを閉じる。
cd /d "%~dp0"

echo 単線結線図作成：サーバーを起動します
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS版 を入れてください。
  pause
  exit /b 1
)

call corepack enable >nul 2>nul
call pnpm install || (echo うまくいきませんでした。 & pause & exit /b 1)
call pnpm start

echo.
echo サーバーが止まりました。
pause
