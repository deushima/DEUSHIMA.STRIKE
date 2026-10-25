@echo off
title DEUSHIMA STRIKE
cd /d "%~dp0"
echo Iniciando DEUSHIMA STRIKE...
start "DEUSHIMA STRIKE - servidor" cmd /k "node server.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8095/"
