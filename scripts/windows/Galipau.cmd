@echo off
rem Galipau App launcher for Windows.
rem Starts the local server (if it is not already running) and opens the app
rem in the default browser. Create a desktop shortcut to this file.
setlocal
cd /d "%~dp0\..\.."

set "PORT=4173"
if exist .env (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if /i "%%a"=="GALIPAU_PORT" set "PORT=%%b"
  )
)
set "URL=http://localhost:%PORT%"
set "SALUD=http://127.0.0.1:%PORT%/api/salud"

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%SALUD%' | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto abrir

if not exist dist\index.html (
  echo Building the interface for the first time...
  call npm run build
  if errorlevel 1 goto fallo
)

rem The server runs in its own minimised window. Closing that window stops the app safely.
start "Galipau App - server (close this window to stop)" /min cmd /c "npm start"

powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%SALUD%' | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 goto fallo

:abrir
if defined GALIPAU_NO_BROWSER exit /b 0
start "" "%URL%"
exit /b 0

:fallo
echo.
echo Galipau App could not start. Open a terminal in this folder and run "npm start" to see the error.
pause
exit /b 1
