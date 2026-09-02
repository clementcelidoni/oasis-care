@echo off
title Oasis Care Pro - serveur web
cd /d "%~dp0web-pro"

echo.
echo   ==================================================
echo     OASIS CARE PRO
echo   ==================================================
echo.

if not exist "node_modules" (
  echo   Premiere utilisation : installation des dependances.
  echo   Cela peut prendre quelques minutes.
  echo.
  call npm install
  if errorlevel 1 goto erreur
  echo.
)

if not exist ".env.local" (
  echo   ERREUR : le fichier web-pro\.env.local est introuvable.
  echo   Copiez .env.example en .env.local et renseignez les valeurs.
  echo.
  goto fin
)

echo   Le site sera disponible sur :
echo.
echo       http://localhost:3000
echo.
echo   LAISSEZ CETTE FENETRE OUVERTE tant que vous utilisez le site.
echo   Pour arreter : fermez cette fenetre, ou Ctrl+C.
echo.
echo   ==================================================
echo.

call npm run dev
goto fin

:erreur
echo.
echo   L'installation a echoue. Verifiez que Node.js est installe.
echo.

:fin
echo.
pause
