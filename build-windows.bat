@echo off
echo ============================================
echo VirtualClubDancers v2.2.0 - Windows Build
echo ============================================
echo.

echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Building Windows portable exe...
call npx electron-builder --win portable
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo [3/3] Build complete!
echo.
echo The portable exe is in the "dist" folder.
echo Copy it to any location and run it!
echo.
echo IMPORTANT:
echo   - Add http://localhost:3333 as OBS Browser Source
echo   - Admin panel opens automatically or via http://localhost:3333/admin
echo   - Use "Audio-Quelle" tab to connect audio for beat detection
echo   - Install VB-Cable from vb-audio.com/Cable for system audio
echo.
pause
