@echo off
chcp 65001 >nul
title DocuTrans AI - 학술 논문 PDF 번역 서비스

echo ========================================================
echo    DocuTrans AI - 원본 레이아웃 보존 논문 번역기
echo ========================================================
echo.
echo [1/3] 서버 환경을 확인하는 중...

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [2/3] Node.js 환경이 감지되었습니다. 웹 서버를 시작합니다...
    start "" http://localhost:8080/
    echo [3/3] 브라우저가 열렸습니다 (http://localhost:8080/)
    echo .env 파일의 GEMINI_API_KEY 가 자동으로 로드됩니다.
    echo 서버를 중지하려면 이 창을 닫거나 Ctrl+C를 누르세요.
    echo.
    node server.js
    goto end
)

where java >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [2/3] Java(JDK) 환경이 감지되었습니다. Java 서버를 시작합니다...
    echo Java 소스 컴파일 확인 중...
    javac TranslateServer.java
    start "" http://localhost:8080/
    echo [3/3] 브라우저가 열렸습니다 (http://localhost:8080/)
    echo .env 파일의 GEMINI_API_KEY 가 자동으로 로드됩니다.
    echo 서버를 중지하려면 이 창을 닫거나 Ctrl+C를 누르세요.
    echo.
    java TranslateServer 8080
    goto end
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [2/3] Python 환경이 감지되었습니다. 로컬 웹 서버(8000)를 시작합니다...
    start "" http://localhost:8000/
    echo [3/3] 브라우저가 열렸습니다 (http://localhost:8000/)
    echo .env 파일의 GEMINI_API_KEY 가 브라우저에서 자동으로 로드됩니다.
    echo 서버를 중지하려면 이 창을 닫거나 Ctrl+C를 누르세요.
    echo.
    python -m http.server 8000
    goto end
)

echo [알림] Java 또는 Python이 설치되어 있지 않아 index.html을 직접 엽니다.
start "" index.html

:end
