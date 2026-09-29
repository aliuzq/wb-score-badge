@echo off
rem ============================================================
rem  WorkBuddy Score Badge launcher v1.0.0  (ASCII only)
rem  Starts WorkBuddy with the official CDP env var, then runs
rem  the badge bridge in a hidden background process.
rem ============================================================
setlocal EnableExtensions
set "HERE=%~dp0"
if exist "%HERE%config.cmd" call "%HERE%config.cmd"
if not defined CDP_PORT set "CDP_PORT=9223"
if not defined WB_EXE set "WB_EXE=D:\ProgramData\WorkBuddy\WorkBuddy.exe"

rem ---- locate node.exe ----
if defined NODE_EXE if exist "%NODE_EXE%" goto node_ok
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE_EXE%" (
  echo [wb-score-badge] Node.js 22+ not found. Set NODE_EXE in config.cmd.
  pause
  exit /b 1
)
:node_ok

rem ---- is WorkBuddy already running? ----
set "WB_RUNNING="
tasklist /FI "IMAGENAME eq WorkBuddy.exe" 2>nul | find /I "WorkBuddy.exe" >nul && set "WB_RUNNING=1"

if defined WB_RUNNING (
  "%NODE_EXE%" -e "const n=require('net');const s=n.connect({port:+process.env.CDP_PORT||9223,host:'127.0.0.1'},()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)"
  if errorlevel 1 (
    echo [wb-score-badge] WorkBuddy is already running WITHOUT the CDP debug port.
    echo [wb-score-badge] Quit WorkBuddy completely, then run this launcher again.
    pause
    exit /b 1
  )
  echo [wb-score-badge] WorkBuddy already running with CDP - starting bridge only.
) else (
  if not exist "%WB_EXE%" (
    echo [wb-score-badge] WorkBuddy.exe not found: %WB_EXE%
    echo [wb-score-badge] Set WB_EXE in config.cmd.
    pause
    exit /b 1
  )
  echo [wb-score-badge] Starting WorkBuddy with CDP port %CDP_PORT% ...
  set "WORKBUDDY_REMOTE_DEBUGGING_PORT=%CDP_PORT%"
  start "" "%WB_EXE%"
  ping -n 6 127.0.0.1 >nul
)

rem ---- launch bridge hidden (vbs generated with literal paths) ----
> "%HERE%_run_bridge.vbs" echo CreateObject("WScript.Shell").Run """%NODE_EXE%"" ""%HERE%wb_score_badge.mjs""", 0, False
cscript //nologo "%HERE%_run_bridge.vbs" >nul 2>&1
echo [wb-score-badge] Bridge started in background.
echo [wb-score-badge] The credit badge will appear in the WorkBuddy chat window shortly.
exit /b 0
