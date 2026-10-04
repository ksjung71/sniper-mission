# 스나이퍼 미션 (Sniper_Game) — 프로젝트 규칙

아이폰에서 가볍게 돌아가는 컬러 3D 로우폴리 1인칭 스나이퍼 게임입니다. Three.js r185로 만들고, PWA로 GitHub Pages에 배포합니다.
App Store 없이 Safari "홈 화면에 추가"로 설치합니다. 빌드 도구 없이 순수 ES module로 정적 서빙합니다.

## 사용자 선호 (반드시 지킬 것)
- 응답과 문서는 한국어로 작성합니다. 결론과 함께 근거를 설명합니다.
- **PC 테스트 우선**: 모든 변경은 `play_pc.bat`(PC 브라우저)에서 먼저 확인할 수 있어야 합니다. 폰 배포(git push)는 사용자가 PC에서 OK한 뒤에, 사용자 확인을 받고 진행합니다.
- **엔진·도구 변경은 사용자 확인 후** 진행합니다. 예: Unity 도입, 빌드 도구 추가, three 버전 변경. Unity는 검토 후 사용하지 않기로 결정했습니다(2026-10-04).
- 삭제, git push 등 되돌리기 어려운 작업은 사전에 확인합니다.

## 핵심 문서
- `design/CONTRACT.md`: 모듈 인터페이스 계약. 모든 개발 작업 전에 먼저 읽습니다.
- `design/GDD.md`: 게임 기획서
- `design/workflow-log.md`: 에이전트 팀 작업 기록
- `.claude/agents/*.md`: 에이전트 팀 역할 정의(game-designer, graphics-dev, gameplay-dev, mobile-ios-dev, qa-tester)

## 폴더
- `docs/`: **배포물 전체**. GitHub Pages가 `main` 브랜치의 `/docs`를 서빙합니다.
- `tools/serve.py`: 로컬 서버. MIME을 직접 지정하고 no-store로 응답합니다.
- `play_pc.bat`: PC 테스트 실행기
- `tests/`: puppeteer-core 자동 테스트(`smoke.mjs`, `qa.mjs`)
- `report/`: 한글 웹 보고서

## 명령
```bash
python tools/serve.py --quiet            # 서버 (http://localhost:8123/docs/)
cd tests && node smoke.mjs --stage all   # 스모크
cd tests && node qa.mjs                  # 전체 QA
for f in docs/js/*.js docs/js/*/*.js; do node --input-type=module --check < "$f" || echo "FAIL $f"; done
```

## 규칙 요약
- 파일 소유권을 지키고, export 시그니처는 고정입니다(CONTRACT §12). 변경이 필요하면 `CONTRACT CHANGE REQUEST`로 요청합니다.
- 상대경로만 씁니다. 외부 CDN과 리소스는 금지입니다. three는 `docs/vendor/three.module.min.js`(+`three.core.min.js`)를 씁니다.
- 프레임 루프 안에서 할당하지 않습니다. 드로우콜 100개 이하, 삼각형 12만 개 이하입니다. 그림자와 후처리는 쓰지 않습니다.
- 버전을 올릴 때는 `docs/js/config.js`의 `APP_VERSION`과 `docs/sw.js`의 `VERSION`을 함께 바꿉니다.
- `play_pc.bat`은 **CP949(ANSI)로 저장**합니다(`chcp 949`). UTF-8 + `chcp 65001`로 바꾸면 cmd.exe가 한글 줄을 잘못 읽어 메뉴 줄이 사라집니다(2026-10-05 [2] 메뉴 누락 버그). 수정할 때는 Edit 도구 대신 Python으로 cp949 인코딩·CRLF를 유지해 씁니다.
- 판정에 영향을 주는 인물 자세(숙임·상하·보폭)는 `ai.js`의 `agent.pose` 한 곳에서 계산합니다. 그래픽(`actors.js`)에서 따로 바꾸면 화면과 총알 판정이 어긋납니다(CONTRACT §5).
