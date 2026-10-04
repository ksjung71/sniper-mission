# 에이전트 팀 작업 기록 (workflow-log)

> PM이 단계별 시작·종료 시각과 산출물을 기록합니다. 최종 보고서(report/index.html)의 타임라인 원본입니다.

| 시각 (2026-10-04) | 단계 | 담당 | 내용 | 산출물 |
|---|---|---|---|---|
| 11:20 | 기획 회의 | PM ↔ 사용자 | 요구사항 확인: Three.js 3D 로우폴리, GitHub Pages PWA, Sniper_Game 폴더, 미션 5스테이지 | 질의응답 4건 |
| 11:25 | 설계 | Plan 에이전트 | 모듈 인터페이스·성능 예산·iOS 함정·QA 방식 설계. three r186에 min 빌드가 없음을 발견해 r185.1로 고정 | 설계안 |
| 11:38 | 계획 보완 | PM ↔ 사용자 | 사용자 요청 반영: ① PC 먼저 테스트 ② Unity 사용 여부 확인. Unity 미설치 확인, 비교한 뒤 사용자가 "Unity 없이 Three.js"로 확정 | 승인된 계획 |
| 11:43 | Phase 0 준비 | PM | 폴더 골격, three r185.1 vendoring(module 365KB + core 385KB) | `docs/vendor/*` |
| 11:45~11:50 | Phase 0 준비 | PM | 계약 상수, 이벤트 버스, 유틸, main(상태 머신과 루프), debug 훅, **전 모듈 동작 스텁** | `docs/js/**` |
| 11:50 | Phase 0 준비 | PM | PC 테스트 도구 `tools/serve.py`(MIME 고정, no-store), `play_pc.bat`(메뉴 3종), puppeteer-core 설치, `tests/smoke.mjs` | 테스트 인프라 |
| 11:51 | Phase 0 검증 | PM | 문법 검사 통과. smoke 5스테이지 에러 0. e2e: 조준 → 발사 → 122m 헤드샷 → 임무 성공 → 결과 화면 | `tests/screenshots/smoke-*.png` |
| 11:52~12:22 | Phase 0 문서 | PM | `CONTRACT.md`(인터페이스 계약), `CLAUDE.md`, 역할 정의 5종 `.claude/agents/*.md` | 설계 문서 |
| 12:24~12:45 | **Phase A 기획** | game-designer | GDD(351줄)과 5스테이지 데이터(239줄) 작성. 별 기준은 플레이어 프로필로 계산. 검증 스크립트(yaw/pitch, 거리, 사선, 민간인 위험 구역)와 smoke 통과 | `design/GDD.md`, `docs/js/data/levels.js` |
| 12:50 | 계약 변경 | PM | designer 요청 3건 수용 → CONTRACT v1.1: 경로 의미, extras 치수표, 배치 규칙 확장(경로 선분·차량·도주로). 역할 파일의 heading 오기 수정 | `design/CONTRACT.md` |
| 12:51 | **Phase B 개발 시작** | graphics-dev · gameplay-dev · mobile-ios-dev · qa-tester (병렬 4) | 한 메시지로 동시 실행. 파일 소유권 분리(gfx/ · game/ · ui/+셸 · tests/qa.mjs) | — |
| 13:08 | Phase B 완료(1/4) | gameplay-dev | weapon 183 · ballistics 173 · ai 236 · session 99줄. 헤드샷·볼트·재장전·경계 도주·VIP 탈출(59.4s 탑승/78.3s 탈출)·민간인·낙차(예측=실제 0.1346m) 검증 통과. 문서 명확화 요청 4건 → CONTRACT v1.2, mobile에 전달 | `docs/js/game/*` |
| 15:42 | 중단 → 재개 | PM | 사용량 한도로 graphics·mobile·qa를 일시 중단한 뒤, 같은 맥락으로 재개. 상태: gfx 전부 스텁 / ui 대부분 완료(css·INSTALL 남음) / qa.mjs 작성 전 | — |
| 15:51 | Phase B 완료(2/4) | mobile-ios-dev | UI JS 730줄 + css 330 + sw/manifest/아이콘 4종/INSTALL.md 142줄. 터치·멀티터치·PC 포인터 락·세로 오버레이·SW 오프라인 검증 통과. PM 후속 조치: autotest는 실제 진행 상황을 쓰게 함(main.js), GDD 밀도트 단위 정정 | `docs/js/ui/*`, `docs/*` |
| 15:52 | Phase B 완료(3/4) | qa-tester | qa.mjs 1450줄: 16개 시나리오(터치·PC·탄도·AI·PWA·성능·이미지 자동 판정). 시험 실행 16/16(gfx 스텁 기준 참고). 요청 3건 → CONTRACT v1.3, debug vehicles() 정리 | `tests/qa.mjs` |
| 16:03 | Phase B 완료(4/4) | graphics-dev | renderer 140 · world 417 · actors 147 · fx 131 · mesh 77줄. 테마 5종, LOOKS 9종, 1인칭 소총, 트레이서·퍼프, NV. dc 14~22, tri 2.6만~4.8만. 배치 규칙 위반 0 | `docs/js/gfx/*` |
| 16:03 | **Phase C 통합** | PM | 문법 전체 통과, smoke 5스테이지 에러 0, 배포 용량 1.16MB(three 750KB + 게임 JS 170KB + 아이콘). 메뉴 3종 + 스테이지별 맨눈·스코프 10장 육안 확인. debug stats에 GPU 메모리(geometries/textures) 추가 | 통합 빌드 |
| 16:14 | **Phase D 검증** | qa-tester | 전체 실행 200초 → 16/16 pass(최초 1 fail은 메모리 판정 기준 오류, 수정 후 재검증). 메모리 누수 없음(1→5 순환 3회, S5 재로드 10회). 성능: dc ≤22, tri ≤4.8만, CPU×4에서 S5 p95 14ms. 수동 소견: UI 경미 2건(결과 화면 토스트 잔상, 스코프 상단 겹침) → mobile-ios-dev | `tests/QA_REPORT.md` |
| 16:14 | 수정 라운드 1 | mobile-ios-dev | QA 소견 2건 수정 지시 | — |
| 16:14~16:18 | 수정 라운드 1 완료 | mobile-ios-dev | 토스트 즉시 정리(show·missionEnd), 종료 연출 중 새 토스트 차단, 스코프 중 상단 정보를 원 밖 좌우 검은 영역으로 이동. QA --only 1,3,4,11,16 재검증 통과 → 전체 16/16 | `docs/js/ui/hud.js`, `css` |
| 16:15~16:30 | Phase E 준비 | PM | 최종 스크린샷 10장 재촬영, README.md, 웹 보고서 report/index.html 작성 | `report/` |
| 22:14 | 공유용 PC 빌드 | PM | 사용자 요청: 친구 테스트용. tools/build_share.py(표준 라이브러리, import map + data URL로 모듈 22개를 HTML 1개에 담음) → dist/SniperMission_PC.html(1.26MB)·zip(411KB). pwa.js는 file://에서 SW를 등록하지 않게 함. file:// 더블클릭 흐름·포인터 락·5스테이지·헤드샷 검증, 에러 0 | `dist/` |
| 22:30~ | **v1.1.0 개선** | PM(직접) | 사용자 요청 3건: ① 총 흔들림 감소 → 사용자와 협의해 **난이도 3단계**(쉬움/보통/어려움: 흔들림·숨 참기·적 반응·제한 시간·점수 배율)로 확장, 보통 = 흔들림 ×0.8 ② 인물 상세화 → 뼈대 13개 SkinnedMesh(얼굴·팔다리·외형별 소품), 절차 애니메이션(대기·보행·달리기·경계), 간이 물리 사망(탄 방향 진자 + 무릎 꺾임 + 팔·머리 스프링 지연) ③ 저격총 사운드 → 사전 렌더링 합성(크랙·폭발·저음·메아리·꼬리 3종, 볼트 6단계 + 탄피, 재장전, 빈 격발), 컴프레서 완화. CONTRACT v1.4, GDD §3.2·§11. 검증: 문법·smoke 에러 0, QA 16/16, 난이도 기능 8/8, dc 14~22, tri ≤5.3만 | `docs/js/{data,game,gfx,ui}/*`, `design/*` |
| 10-05 | **v1.1.1 보완** | PM(직접) | 사용자 피드백 2건: ① `play_pc.bat` [2] 메뉴 누락 → 원인: UTF-8 + chcp 65001에서 cmd.exe가 한글 줄을 잘못 읽음(재현: [2] 줄 누락, '모든' is not recognized). CP949 + chcp 949로 저장, 949·65001 콘솔 모두 검증 ② 달리는 표적에 총알이 통과·저격 실패 → 원인: v1.1 달리기 숙임(0.24rad) 때문에 보이는 머리가 판정 머리보다 약 14cm 앞(머리 반지름 13cm). 수정: ai가 `agent.pose`(숙임·상하·보폭)를 계산해 그래픽과 판정이 공유, 1/120초 스텝 위치 보간, 이동 허용 오차(`leadTol` 0.06초 × 난이도 1.4/1/0.35), 아깝게 빗나가면 리드 안내(`nearMiss`). 검증: 정확한 리드 헤드샷 6/6, 난이도별 경계 확인, 조준점-머리 정렬 촬영, QA 16/16 | `play_pc.bat`, `docs/js/game/{ai,ballistics}.js`, `docs/js/gfx/actors.js`, `docs/js/{debug,ui/hud}.js`, `design/*` |
