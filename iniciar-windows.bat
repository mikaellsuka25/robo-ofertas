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
  echo      1. Instale em: https://www.docker.com/products/docker-desktop/
  echo      2. Abra o Docker Desktop e espere aparecer "Engine running".
  echo      3. Rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo  Criando senhas...
  powershell -NoProfile -Command ^
    "$r={ -join ((48..57)+(65..90)+(97..122) | Get-Random -Count $args[0] | %% {[char]$_}) };" ^
    "Set-Content -Encoding ascii .env @('PANEL_PASSWORD=' + (& $r 10), 'EVOLUTION_API_KEY=' + (& $r 32), 'POSTGRES_PASSWORD=' + (& $r 24), 'PORTA=3000')"
)

echo  Ligando tudo. Na primeira vez leva uns 5 minutos...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  [!] Deu erro ao ligar. Tire um print desta janela e mande para o Claude.
  pause
  exit /b 1
)

for /f "tokens=2 delims==" %%a in ('findstr /b "PANEL_PASSWORD=" .env') do set SENHA=%%a
echo.
echo  ============================================
echo   PRONTO!  Painel: http://localhost:3000
echo   Senha:   %SENHA%
echo  ============================================
echo.
echo  O robo so funciona com o computador ligado e o Docker aberto.
echo  Para desligar o robo, rode "parar-windows.bat".
echo.
timeout /t 20 /nobreak >nul
start "" http://localhost:3000
pause
