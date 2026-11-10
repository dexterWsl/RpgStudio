@echo off
chcp 65001 >nul
setlocal
title 改图
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0改图.py" %*
  goto :end
)
where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0改图.py" %*
  goto :end
)

echo.
echo 找不到 Python。
echo   · 装一个 Python 3（安装时勾上 Add Python to PATH）：https://www.python.org/downloads/
echo   · 再装图片库：pip install pillow
echo.
pause
:end
endlocal
