@echo off
rem ============================================================
rem  WorkBuddy Score Badge uninstaller v1.0.0  (ASCII only)
rem  Removes the plugin files, autostart task and shortcut.
rem  WorkBuddy itself is NOT modified.
rem ============================================================
setlocal EnableExtensions
set "DEST=%LOCALAPPDATA%\wb-score-badge"
echo === WorkBuddy Score Badge uninstaller ===
schtasks /Delete /F /TN "WorkBuddyScoreBadge" >nul 2>&1 && echo Autostart task removed.
if exist "%USERPROFILE%\Desktop\WorkBuddy Score Badge.lnk" (
  del "%USERPROFILE%\Desktop\WorkBuddy Score Badge.lnk" >nul 2>&1
  echo Desktop shortcut removed.
)
if exist "%DEST%" (
  rmdir /s /q "%DEST%"
  echo Removed %DEST%
)
echo Done. WorkBuddy itself was not modified - just start it as usual.
pause
