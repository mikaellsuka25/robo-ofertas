@echo off
chcp 65001 >nul
title Robo de Ofertas
cd /d "%~dp0"

echo.
echo  ==== Robo de Ofertas (teste no computador) ====
echo.

docker version >nul 2>&1
if errorlevel 1 (
  echo  [!] O Docker Desktop nao esta aberto ou nao esta instalado.
  echo      Abra o Docker Desktop, espere "Engine running" e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

echo  Preparando senhas...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\criar-env.ps1"
if errorlevel 1 (
  echo  [!] Nao consegui criar o arquivo de senhas. Mande um print para o Claude.
  pause
  exit /b 1
)

echo  Ligando tudo. Na primeira vez leva uns 5 minutos...
docker compose up -d --build --force-recreate --remove-orphans
if errorlevel 1 (
  echo.
  echo  [!] Deu erro ao ligar. Tire um print desta janela e mande para o Claude.
  pause
  exit /b 1
)

for /f "tokens=2 delims==" %%a in ('findstr /b "PANEL_PASSWORD=" .env') do set SENHA=%%a
echo.
echo  ============================================
echo   PRONTO!  Painel: http://localhost
echo   Senha:   %SENHA%
echo  ============================================
echo.
echo  O robo so funciona com o computador ligado e o Docker aberto.
echo  Para desligar, rode "parar-windows.bat".
echo.
echo  Esta janela pode ser fechada.
timeout /t 15 /nobreak >nul
start "" http://localhost
pause
