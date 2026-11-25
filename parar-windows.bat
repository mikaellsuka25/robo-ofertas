@echo off
cd /d "%~dp0"
docker compose stop
echo Robo desligado. Para ligar de novo, rode iniciar-windows.bat
pause
