@echo off
rem NexWipe for Windows: double-click to start. Read-only; see nexwipe.ps1.
rem Asks for administrator rights once (needed only for "Reboot into NexWipe").
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title NexWipe
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nexwipe.ps1"
if errorlevel 1 pause
