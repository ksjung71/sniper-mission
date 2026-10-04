# 스나이퍼 미션 (Sniper Mission)

아이폰에서 가볍게 돌아가는 **컬러 3D 로우폴리 1인칭 스나이퍼 게임**입니다. 옥상에서 스코프로 조준하고, 숨을 참은 채 한 발로 임무를 끝냅니다.

- 엔진: Three.js r185(로컬 vendoring)에 순수 ES module을 씁니다. 빌드 도구는 없습니다.
- 용량: 배포물 전체 약 1.2MB입니다(three.js 750KB + 게임 코드 170KB + 아이콘).
- 설치: App Store 없이 설치합니다. GitHub Pages(HTTPS)에 올린 뒤 Safari "홈 화면에 추가"로 앱처럼 설치하고, 오프라인에서도 실행됩니다.
- 미션 5개:

  | 스테이지 | 장소 | 특징 |
  |---|---|---|
  | 1 | 도심 | 튜토리얼 |
  | 2 | 노을 항구 | 순찰하는 표적 |
  | 3 | 시장 | 인상착의로 표적 식별, 민간인 주의 |
  | 4 | 야간 창고 | 야간투시, 낙차와 바람 |
  | 5 | 호텔 앞 | 탈출 전에 VIP 저지 |

- 난이도: 쉬움/보통/어려움(⚙ 설정·브리핑에서 선택). 흔들림·숨 참기·적 반응·제한 시간·점수 배율이 달라집니다(GDD §11).
- 인물: 관절이 있는 로우폴리 인체(얼굴·팔다리)로, 걷고 두리번거리며, 맞으면 탄 방향으로 쓰러집니다.

## 빠른 시작
| 하고 싶은 것 | 방법 |
|---|---|
| **PC에서 먼저 플레이** | `play_pc.bat` 더블클릭 → [1] 일반 / [2] 테스트 모드(전 스테이지 열림 + FPS) |
| 같은 Wi-Fi의 아이폰으로 빠르게 보기 | `play_pc.bat` → [3] |
| 아이폰에 설치 | GitHub Pages에 배포한 뒤 Safari → 공유 → 홈 화면에 추가 |
| **친구에게 PC 버전 보내기** | `python tools/build_share.py` 실행 → `dist/SniperMission_PC.zip` 전송. 친구는 압축을 풀고 `SniperMission_PC.html`을 더블클릭하면 됩니다(설치·서버 필요 없음). 게임을 고친 뒤에는 다시 실행하세요. |

자세한 PC 조작법, 배포 절차, 아이폰 설치 방법, 문제 해결은 **[design/INSTALL.md](design/INSTALL.md)**에 있습니다.

## 폴더 구조
```
docs/            ← 배포물 전체 (GitHub Pages: main 브랜치 /docs)
  index.html  manifest.webmanifest  sw.js  css/  icons/  vendor/(three r185)
  js/main.js bus.js config.js util.js debug.js
  js/data/levels.js        스테이지·밸런스 데이터
  js/gfx/*                 렌더러·월드·인물·이펙트
  js/game/*                무기·탄도·AI·점수
  js/ui/*                  HUD·입력·사운드·저장·PWA
design/          CONTRACT.md(인터페이스 계약) · GDD.md(기획서) · INSTALL.md · workflow-log.md
tests/           smoke.mjs · qa.mjs(16개 시나리오) · QA_REPORT.md · screenshots/
tools/           serve.py(로컬 서버) · make_icons.py
report/          index.html — 에이전트 팀 개발 보고서(웹)
.claude/agents/  에이전트 팀 역할 정의 5종
play_pc.bat      PC 테스트 실행기
```

## 에이전트 팀
이 게임은 Claude Code 에이전트 팀이 만들었습니다. PM(메인 세션)이 인터페이스 계약과 동작하는 뼈대 코드를 먼저 고정했고, 그 위에서 아래 다섯 역할이 각자 맡은 파일만 개발했습니다.

| 역할 | 맡은 일 |
|---|---|
| game-designer | 기획서, 레벨 데이터 |
| graphics-dev | 3D 그래픽 |
| gameplay-dev | 조작감과 규칙 |
| mobile-ios-dev | UI, 입력, PWA |
| qa-tester | 자동 테스트 |

이 폴더에서 Claude Code를 열면 `.claude/agents/`의 팀을 그대로 다시 쓸 수 있습니다. 예: "graphics-dev 에이전트로 스테이지 2 하늘을 더 붉게 바꿔줘"

작업 과정, 테스트 결과, 스크린샷은 `report/index.html`에 정리돼 있습니다.

## 개발 명령
```bash
python tools/serve.py --quiet              # 로컬 서버 → http://localhost:8123/docs/
cd tests && npm install                    # 최초 1회 (puppeteer-core, 설치된 Chrome 사용)
node smoke.mjs --stage all                 # 스모크
node qa.mjs                                # 전체 QA → QA_REPORT.md
```
- 버전을 올릴 때는 `docs/js/config.js`의 `APP_VERSION`과 `docs/sw.js`의 `VERSION`을 함께 바꿉니다.
- 새 파일을 추가하면 `sw.js`의 precache 목록에도 넣어야 합니다.

## 라이선스
- three.js: MIT (`docs/vendor/three-LICENSE.txt`)
