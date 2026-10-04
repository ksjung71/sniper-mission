@echo off
rem 이 파일은 CP949(ANSI)로 저장합니다. UTF-8 + chcp 65001은 cmd가 한글 줄을 잘못 읽는 버그가 있습니다.
chcp 949 >nul
cd /d "%~dp0"
title Sniper Mission - PC Test
where python >nul 2>nul
if errorlevel 1 (
  echo [오류] Python이 필요합니다. https://www.python.org 에서 설치 후 다시 실행하세요.
  pause
  exit /b 1
)
echo.
echo   ===== 스나이퍼 미션 : PC 테스트 =====
echo.
echo   [1] 일반 플레이
echo   [2] 테스트 모드 (모든 스테이지 열림 + FPS 표시)
echo   [3] 같은 Wi-Fi의 아이폰에서 테스트
echo.
echo   PC 조작: 화면 클릭 후 마우스로 조준 / 좌클릭 발사 / 우클릭 스코프
echo            휠 줌 / Shift 숨참기 / R 재장전 / N 야간투시 / Esc 일시정지
echo.
choice /c 123 /n /m "  번호를 누르세요 (1/2/3): "
set MODE=%errorlevel%
set URL=http://localhost:8123/docs/
if "%MODE%"=="2" set URL=http://localhost:8123/docs/?debug

if "%MODE%"=="3" (
  start "Sniper Server (LAN)" python tools\serve.py --lan
  echo.
  echo   새로 뜬 서버 창에 표시된 http://192.168.x.x:8123/docs/ 주소를
  echo   아이폰 Safari에 입력하세요. ^(PC와 같은 Wi-Fi여야 합니다^)
  echo.
  pause
  exit /b 0
)

start "Sniper Server" /min python tools\serve.py
timeout /t 1 /nobreak >nul
set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if exist "%CHROME%" (
  start "" "%CHROME%" "%URL%"
) else (
  start "" "%URL%"
)
echo.
echo   브라우저에서 게임이 열립니다: %URL%
echo   끝낼 때는 작업표시줄의 "Sniper Server" 창을 닫으세요.
echo.
timeout /t 5 >nul
