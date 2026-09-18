@echo off
chcp 65001 >nul
rem Windows：このファイルをダブルクリックすると、パソコンにサインインしたときに
rem サーバーが自動で立ち上がるようになる。やめるときは uninstall-autostart.bat。
setlocal
cd /d "%~dp0"

echo 単線結線図作成：サーバーの自動起動を設定します
echo   場所: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。先に https://nodejs.org/ja から LTS版 を入れてください。
  pause
  exit /b 1
)

set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\単線結線図サーバー.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath = '%CD%\start-server.bat';" ^
  "$s.WorkingDirectory = '%CD%';" ^
  "$s.Description = '単線結線図作成のサーバー';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Save()"

if errorlevel 1 (
  echo 設定に失敗しました。
  pause
  exit /b 1
)

echo 設定しました。
echo   ・次にこのパソコンにサインインしたとき、サーバーが自動で立ち上がります
echo   ・小さくした黒い画面として残ります。閉じるとサーバーも止まります
echo.
echo いま起動しておきますか？（起動する場合は何かキーを押してください）
pause >nul
start "" "%CD%\start-server.bat"
exit /b 0
