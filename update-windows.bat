@echo off
rem Windows：このファイルをダブルクリックすると、アプリを最新の内容に入れ替える。
rem   ・APIキー（.env）と案件のデータ（data）はそのまま残る
rem   ・入れ替えたあと、start-server.bat で立ち上げ直してください
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set "ZIP_URL=https://github.com/takayukiokushin/zumen/archive/refs/heads/claude/single-line-diagram-app-h1mp73.zip"

echo 単線結線図作成：アプリを新しくします
echo   場所: %CD%
echo.

if not exist "package.json" (
  echo [x] ここはアプリのフォルダではないようです。
  echo     start-server.bat と同じ場所に置いてから、もう一度ダブルクリックしてください。
  pause
  exit /b 1
)

rem ---- 1. いまの .env と data を控えておく ----
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DT=%%I"
set "STAMP=%DT:~0,8%-%DT:~8,6%"
set "SAFE=%USERPROFILE%\zumen-更新前の控え\%STAMP%"
mkdir "%SAFE%" >nul 2>&1
if exist ".env" copy /y ".env" "%SAFE%\" >nul
if exist "data" xcopy /e /i /y /q "data" "%SAFE%\data" >nul
echo [1/5] いまの設定とデータを控えました
echo       %SAFE%

rem ---- 2. 新しい中身を取ってくる ----
rem   まず直接ダウンロードしてみる（リポジトリが「公開」のとき）。
rem   「非公開」にしてあると通らないので、そのときはブラウザで落としてもらった
rem   ダウンロードフォルダの zumen-*.zip を使う。
echo [2/5] 新しい中身を取ってきています...
set "TMP_DIR=%TEMP%\zumen-update-%RANDOM%"
mkdir "%TMP_DIR%" >nul 2>&1
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TMP_DIR%\zumen.zip' -ErrorAction Stop }" ^
  "catch {" ^
  "  $z = Get-ChildItem \"$env:USERPROFILE\Downloads\zumen-*.zip\" -ErrorAction SilentlyContinue |" ^
  "       Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
  "  if ($z) { Write-Host ('      ダウンロードフォルダの ' + $z.Name + ' を使います');" ^
  "            Copy-Item $z.FullName '%TMP_DIR%\zumen.zip' }" ^
  "  else { exit 1 } };" ^
  "Expand-Archive -Path '%TMP_DIR%\zumen.zip' -DestinationPath '%TMP_DIR%\out' -Force"
if errorlevel 1 (
  echo.
  echo [x] 新しい中身を取ってこられませんでした。
  echo.
  echo     リポジトリを「非公開」にしている場合は、先にブラウザで落としてください。
  echo.
  echo       1. GitHubにログインした状態で
  echo          https://github.com/takayukiokushin/zumen を開く
  echo       2. 緑色の「Code」→「Download ZIP」
  echo       3. 落とし終わったら、このファイルをもう一度ダブルクリック
  echo.
  echo     （ZIPはダウンロードフォルダに置いたままで構いません。
  echo       古いZIPが残っていると間違えるので、先に捨てておくこと）
  echo.
  pause
  exit /b 1
)

rem ---- 3. 入れ替える（.env と data と node_modules は触らない） ----
echo [3/5] 入れ替えています...
for /d %%D in ("%TMP_DIR%\out\*") do set "NEW=%%D"
if not defined NEW (
  echo [x] ダウンロードした中身が見つかりませんでした。
  pause
  exit /b 1
)
robocopy "%NEW%" "%CD%" /e /xf ".env" /xd "data" "node_modules" ".git" /njh /njs /ndl /nfl >nul
rmdir /s /q "%TMP_DIR%" >nul 2>&1

rem ---- 4. .env と data が残っているか確かめる ----
if exist "%SAFE%\.env" if not exist ".env" copy /y "%SAFE%\.env" ".env" >nul
if exist "%SAFE%\data" if not exist "data" xcopy /e /i /y /q "%SAFE%\data" "data" >nul
echo [4/5] APIキーと案件のデータは、そのまま残っています

rem ---- 5. 立ち上げ直し方を案内する ----
echo [5/5] 入れ替えが終わりました
echo.
echo 黒い画面でサーバーが動いていたら、その画面で Ctrl + C を押して止めてから、
echo start-server.bat をダブルクリックしてください。
echo そのあとブラウザで Ctrl + Shift + R を押して読み込み直してください。
echo.
pause
