@echo off
chcp 65001 >nul
setlocal
title rpgStudio 检查环境
cd /d "%~dp0"
set "NODE_EXE=%~dp0runtime\node\node.exe"
if exist "%NODE_EXE%" goto run
where node >nul 2>nul
if errorlevel 1 goto nonode
set "NODE_EXE=node"
:run
"%NODE_EXE%" "%~dp0app\start.js" --check %*
echo.
pause
endlocal
goto :eof
:nonode
echo.
echo [错] 找不到 Node.js：runtime\node\node.exe 不见了，电脑上也没有装 Node.js。
echo      重新解压一份本地版（里面自带运行环境），或者装 Node.js 18 以上：https://nodejs.org/
echo.
pause
