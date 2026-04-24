@echo off
title Actualizador de Tienda Free Fire
cls
echo =========================================
echo   ACTUALIZANDO TIENDA EN LA NUBE...
echo =========================================
echo.

echo 1. Guardando cambios locales...
git add .

echo 2. Creando punto de restauracion...
git commit -m "Actualizacion de precios/datos %date% %time%"

echo 3. Subiendo a la nube (GitHub/Render)...
git push origin master

echo.
echo =========================================
echo   ¡TIENDA ACTUALIZADA CON EXITO!
echo   Los cambios seran visibles en 1-2 min.
echo =========================================
pause
