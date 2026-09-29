@echo off
rem ============================================================
rem  WorkBuddy Score Badge installer v1.0.0  (ASCII only)
rem  Usage:
rem    install.cmd                install to %LOCALAPPDATA%\wb-score-badge + desktop shortcut
rem    install.cmd --autostart    also create a logon scheduled task
rem    install.cmd --no-shortcut  skip desktop shortcut
rem ============================================================
setlocal EnableExtensions
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\wb-score-badge"

echo === WorkBuddy Score Badge installer ===

rem ---- locate WorkBuddy.exe ----
set "WB_EXE="
for %%P in (
  "D:\ProgramData\WorkBuddy\WorkBuddy.exe"
  "%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe"
  "%ProgramFiles%\WorkBuddy\WorkBuddy.exe"
  "%ProgramFiles(x86)%\WorkBuddy\WorkBuddy.exe"
) do if not defined WB_EXE if exist %%P set "WB_EXE=%%~P"
if not defined WB_EXE (
  echo [warn] WorkBuddy.exe not auto-detected - set WB_EXE in config.cmd after install.
  set "WB_EXE=D:\ProgramData\WorkBuddy\WorkBuddy.exe"
)

rem ---- locate score skill script (data source) ----
set "SKILL_SCRIPT="
for %%S in (
  "%USERPROFILE%\.workbuddy\skills\totorosir-workbuddy-score\scripts\buddy_station.py"
  "%USERPROFILE%\.workbuddy\skills\totorosir-workbuddy-score__skillhub\scripts\buddy_station.py"
) do if not defined SKILL_SCRIPT if exist %%S set "SKILL_SCRIPT=%%~S"
if not defined SKILL_SCRIPT echo [warn] totorosir-workbuddy-score skill not found - badge will show "no data source" until installed.

rem ---- locate node.exe ----
set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

rem ---- copy files ----
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%SRC%wb_score_badge.mjs" "%DEST%\" >nul
copy /y "%SRC%badge.js" "%DEST%\" >nul
copy /y "%SRC%start.cmd" "%DEST%\" >nul
copy /y "%SRC%uninstall.cmd" "%DEST%\" >nul

> "%DEST%config.cmd" (
  echo set "WB_EXE=%WB_EXE%"
  echo set "CDP_PORT=9223"
  echo set "NODE_EXE=%NODE_EXE%"
  if defined SKILL_SCRIPT echo set "WB_SCORE_SKILL_SCRIPT=%SKILL_SCRIPT%"
)

echo Installed to : %DEST%
echo WorkBuddy    : %WB_EXE%
echo Skill script : %SKILL_SCRIPT%
echo Node.js      : %NODE_EXE%

rem ---- optional: logon autostart ----
if /i "%~1"=="--autostart" goto autostart
if /i "%~2"=="--autostart" goto autostart
goto shortcut
:autostart
schtasks /Create /F /TN "WorkBuddyScoreBadge" /SC ONLOGON /TR "%DEST%start.cmd" >nul 2>&1
if errorlevel 1 (echo [warn] autostart task creation failed - create it manually if needed.) else echo Autostart task created (runs at logon).
:shortcut

rem ---- optional: desktop shortcut (skipped with --no-shortcut) ----
if /i "%~1"=="--no-shortcut" goto done
if /i "%~2"=="--no-shortcut" goto done
> "%TEMP%\wb_score_shortcut.vbs" echo Set sh = CreateObject("WScript.Shell")
>> "%TEMP%\wb_score_shortcut.vbs" echo Set lnk = sh.CreateShortcut("%USERPROFILE%\Desktop\WorkBuddy Score Badge.lnk"^)
>> "%TEMP%\wb_score_shortcut.vbs" echo lnk.TargetPath = "%DEST%start.cmd"
>> "%TEMP%\wb_score_shortcut.vbs" echo lnk.WorkingDirectory = "%DEST%"
>> "%TEMP%\wb_score_shortcut.vbs" echo lnk.Description = "Start WorkBuddy with credit badge"
>> "%TEMP%\wb_score_shortcut.vbs" echo lnk.Save
cscript //nologo "%TEMP%\wb_score_shortcut.vbs" >nul 2>&1
if errorlevel 1 (
  echo [warn] shortcut creation failed - run "%DEST%start.cmd" manually.
) else (
  echo Desktop shortcut created: WorkBuddy Score Badge.lnk
)
del "%TEMP%\wb_score_shortcut.vbs" >nul 2>&1
:done
echo.
echo Done. Quit WorkBuddy if it is running, then double-click "%DEST%start.cmd".
pause
