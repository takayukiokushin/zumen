@echo off
chcp 65001 >nul
rem Windows：サーバーの自動起動をやめる。
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\単線結線図サーバー.lnk"
if exist "%LNK%" del "%LNK%"
echo 自動起動をやめました。これからは start-server.bat をダブルクリックして起動してください。
pause
