@echo off
setlocal
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe" start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
start "" "%~dp0release-final\win-unpacked\JARVIS.exe"
endlocal
