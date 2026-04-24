@echo off
title Verificador Free Fire - Servidor
color 0A
echo =========================================
echo   Iniciando Verificador de ID Free Fire
echo =========================================
echo.
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado!
    echo Por favor instala Node.js desde: https://nodejs.org
    pause
    exit
)
echo [OK] Node.js detectado.
echo.
echo [*] Iniciando servidor en http://localhost:3500
echo [*] Ahora abre el archivo index.html en tu navegador
echo.
node "%~dp0server.js"
pause
