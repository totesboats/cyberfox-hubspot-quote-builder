@echo off
rem Runs push.ps1 without changing PowerShell's script policy. Usage: push "what changed"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
