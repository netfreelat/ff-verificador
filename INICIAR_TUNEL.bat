@echo off
title Tunel Local para Telegram
color 0E
echo =========================================
echo   Iniciando Tunel para Bot de Telegram
echo =========================================
echo.
echo [*] El servidor debe estar corriendo en el puerto 3500
echo [*] Creando conexion segura...
echo.
npx localtunnel --port 3500 --subdomain recargas-ff-seguro-venezuela
echo.
echo =========================================
pause
