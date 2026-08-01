@echo off
rem Régénérer un plan de plateforme après une modification dans OpenStreetMap.
rem Double-clic : la page s'ouvre toute seule, cette fenêtre reste ouverte
rem tant que le serveur tourne (Ctrl+C ou la fermer pour arrêter).
cd /d "%~dp0"
node Tools\regen-server.js
if errorlevel 1 pause
