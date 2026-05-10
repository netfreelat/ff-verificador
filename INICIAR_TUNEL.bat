@echo off
:inicio
title Tunel Local para Telegram - REINICIO AUTOMATICO
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
echo [!] El tunel se ha cerrado de forma inesperada.
echo [!] Reiniciando en 5 segundos... (Presiona Ctrl+C para salir)
echo.
timeout /t 5
goto inicio
