@echo off
setlocal
cd /d "%~dp0"
title PDF Lecture Reader website

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js is not installed, so the website cannot start.
  echo  Install the LTS version from https://nodejs.org , then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "downloads\PDF-Lecture-Reader-Setup-1.0.0.exe" if not exist "..\PDF-Lecture-Reader-Setup-1.0.0.exe" (
  echo.
  echo  Warning: PDF-Lecture-Reader-Setup-1.0.0.exe was not found.
  echo  Put it in the "downloads" folder, or in the folder above this one.
  echo.
)

if "%PORT%"=="" set "PORT=8080"
echo  Opening http://localhost:%PORT% in your browser...
start "" "http://localhost:%PORT%"
node server.js
echo.
echo  The website has stopped.
pause
