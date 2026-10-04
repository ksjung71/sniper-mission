# 인터페이스 계약 (CONTRACT) — v1.5

> v1.1 (Phase A 후): game-designer의 변경 요청 3건을 반영했습니다. §4에 경로 의미, extras 치수표, 배치 규칙 확장(경로 선분, 차량, 도주로)을 추가했습니다.
> v1.2 (Phase B 중): gameplay-dev의 문서 명확화 요청을 반영했습니다(`vipEta`, `hits`, `holding`, `alert.pos`). 시그니처 변경은 없습니다.
> v1.3 (Phase B 후): qa-tester의 요청을 반영했습니다. 잠긴 카드 표현, PC 첫 클릭과 대체 조작 규칙을 명시했고, `vehicles()`는 내부 필드를 제외합니다. `?autotest`는 실제 진행 상황을 표시합니다(전 스테이지 잠금 해제는 `?debug` 단독일 때만).
> v1.4 (2026-10-04, 앱 v1.1.0): 난이도(`DIFFICULTY`, `level.difficulty`, `settings.difficulty`)를 추가했습니다(§3·§4·§6). 인물은 뼈대 SkinnedMesh로 바꾸고 actors가 `hit`을 구독합니다(§6·§7·§11). export 시그니처 변경은 없고, `audio.js`에 테스트용 `synth` export가 추가됐습니다.
> v1.5 (2026-10-05, 앱 v1.1.1): 달리는 표적이 명중하지 않던 문제 수정. Agent에 `pose`(ai가 계산, actors·ballistics가 읽음)를 추가하고, 히트박스가 자세(숙임·상하·보폭)를 따릅니다. 이동 표적 허용 오차(`BALANCE.leadTol` × 난이도 `lead`), 스텝 시각 보간, `nearMiss` 이벤트, `ballistics.partPos` export, debug `actors()`의 head·chest가 자세 반영 위치로 바뀌었습니다(§4·§5·§6·§7·§10).

> PM 소유 문서입니다. 병렬로 개발하는 에이전트들이 서로의 코드를 보지 않고도 맞물리게 하는 **유일한 기준**입니다.
> 현재 `docs/js/**`의 **스텁 코드가 이 계약의 실행 가능한 형태**입니다. 스텁도 실제로 돌아가는 게임입니다(스텁 상태에서 smoke와 e2e 테스트를 통과함).
> 각 담당자는 자기 파일의 **본문만 교체**하고 **export 이름과 시그니처는 유지**합니다.
> 계약을 바꿔야 하면 최종 응답 끝에 `CONTRACT CHANGE REQUEST: <내용/이유>`를 남깁니다. PM이 판단해 반영합니다.

## 1. 공통 원칙
- **파일 소유권**(§12)을 지킵니다. 남의 파일은 읽기만 합니다. 새 파일이 필요하면 PM에게 요청합니다(`sw.js`가 precache 목록을 알아야 하기 때문).
- **경로는 상대경로만** 씁니다. `/`로 시작하는 URL이나 import는 금지입니다. 게임은 `https://<id>.github.io/<repo>/` 같은 하위 경로에서 서빙됩니다.
- three.js는 `import * as THREE from '../../vendor/three.module.min.js'`로 가져옵니다(gfx 폴더 기준). `examples/jsm` 애드온과 importmap은 쓰지 않습니다.
- **프레임 루프 안에서 메모리를 새로 할당하지 않습니다.** `new`, 배열/객체 리터럴, 클로저 생성을 피합니다. 임시 벡터는 모듈 스코프에 두고 재사용합니다. 이벤트 payload는 드물게 발생하므로 할당해도 됩니다.
- 이벤트 구독은 **생성자에서 한 번만** 합니다. `reset()`에서 다시 구독하지 않습니다.
- 색상은 숫자 `0xRRGGBB`로 씁니다. 각도는 라디안, 거리는 미터, 시간은 초입니다. 단 `fov`는 **도(degree)**입니다(three.js 규약).
- 콘솔 에러가 하나라도 나오면 smoke가 실패합니다. `console.error`는 진짜 오류에만 씁니다.
- 외부 리소스(CDN, 폰트, 이미지 URL)는 금지입니다. 오프라인 PWA여야 하기 때문입니다.

## 2. 좌표·각도 규약
- **월드**: Y가 위쪽이고 지면은 `y=0`입니다. 플레이어는 원점 근처 옥상(예: `(0, 25, 20)`)에서 **−Z 방향**을 봅니다.
- **표적 영역**: x는 대략 −150~150, z는 −60~−400입니다(거리 80~350m).
- **카메라**: `camera.rotation.order='YXZ'`, `rotation.y = yaw`, `rotation.x = pitch`입니다.
  - `yaw=0, pitch=0`이면 −Z를 봅니다.
  - **yaw가 커지면 왼쪽**을 보고, **pitch가 커지면 위쪽**을 봅니다.
  - 방향 벡터는 `util.dirFromYawPitch(yaw, pitch)` = `(-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))`입니다.
- **인물·차량 heading**:
  - 정면 벡터 = `(sin h, 0, cos h)`입니다. 메시는 **+Z를 정면**으로 만들고 `mesh.rotation.y = heading`을 적용합니다.
  - 경로를 따라 이동할 때는 `heading = util.headingTo(dx, dz) = atan2(dx, dz)`입니다.
- **바람**:
  - `wind.dir` = 바람이 **불어가는** 방향의 각도입니다. 벡터는 `(cos(dir), 0, sin(dir)) * speed`이므로 `dir=0`이면 +X(화면 오른쪽)로 붑니다.
  - 탄에 주는 가속도 = 벡터 × `windFactor`입니다.
- **드래그 감도**: `rad/px = (fov(rad) / 화면높이px) * BALANCE.aimSens * 사용자감도`입니다. 줌 배율과 관계없이 화면 높이만큼 드래그하면 시야 하나만큼 돕니다.

## 3. 공유 상수 — `js/config.js` (PM, 고정)
| 이름 | 내용 |
|---|---|
| `APP_VERSION` | `'1.1.1'`. `sw.js`의 `VERSION`과 같아야 합니다. 타이틀에 표시합니다. |
| `STATES` | `BOOT TITLE SELECT BRIEFING PLAYING PAUSED RESULT` |
| `BODY` | 인물 치수. 발=(0,0,0), 정면 +Z.<br>`head{y:1.62,r:0.13}`(구)<br>`torso{y0:0.9,y1:1.5,hw:0.24,hd:0.15}`(박스)<br>`legs{y0:0,y1:0.9,hw:0.2,hd:0.13}`(박스)<br>graphics 메시와 ballistics 히트박스가 **같은 값**을 씁니다. |
| `VEHICLE` | `sedan{l:4.6,w:1.9,h:1.45}`. 로컬 정면 +Z = 길이 |
| `LOOKS` | 인물 외형 키와 설명: `red_cap suit_black vip guard worker civ_a civ_b civ_c civ_d`. graphics는 **전부** 구분되게 구현해야 하고, 레벨은 이 키만 씁니다. |
| `BUDGET` | `{drawCalls:100, tris:120000, maxPixelRatio:2, minPixelRatio:1}` |
| `FLAGS` | URL 쿼리: `autotest`, `debug`(autotest면 true), `nosw`(autotest면 true), `sw`(`?sw=1`), `seed`, `stage` |

`js/util.js`(PM): `DEG, rng(seed), clamp, lerp, damp(a,b,lambda,dt), wrapAngle, dirFromYawPitch(yaw,pitch,out?), headingTo(dx,dz)`

## 4. 레벨 데이터 — `js/data/levels.js` (game-designer)
```js
export const BALANCE = {
  hipFov: 50,            // 비조준 수직 시야각(도)
  muzzle: 850,           // 탄속 m/s
  boltTime: 1.0, reloadTime: 2.2, magSize: 5,
  swayAmp: 0.0035,       // 흔들림 진폭(rad)
  swayFreq: [0.23, 0.31],// 리사주 주파수(Hz) x,y
  breathMax: 3.0, breathRecover: 2.5, breathMul: 0.12, exhaleMul: 2.0, exhaleTime: 1.2,
  recoilKick: 0.03, recoilReturn: 6, hipSpread: 0.02, aimSens: 1.0,
  score: { kill:1000, head:500, perMeter:1, guard:200, civilian:-1500, timePerSec:10, accuracy:1000 },
};
export const LEVELS = [ /* 정확히 5개, id 1..5 */ ];
// v1.4 난이도: 모든 값은 BALANCE·레벨 값에 곱하는 배수. normal = 기준(v1.0 대비 흔들림만 ×0.8)
export const DIFFICULTY = {
  easy:   { label: '쉬움',   sway: 0.55, breath: 1.5, react: 1.6,  time: 1.25, score: 0.8, lead: 1.4 },
  normal: { label: '보통',   sway: 0.8,  breath: 1,   react: 1,    time: 1,    score: 1,   lead: 1 },
  hard:   { label: '어려움', sway: 1,    breath: 0.8, react: 0.65, time: 0.85, score: 1.2, lead: 0.35 },
};
// v1.5: BALANCE.leadTol = 0.06(초). 이동 표적 판정을 진행 방향 앞뒤로 '속도 × leadTol × lead'만큼 늘림
```
- **난이도 적용(v1.4)**: main이 레벨을 불러올 때 `{ ...level, timeLimit: round(timeLimit × time), difficulty: { key, ...DIFFICULTY[key] } }`(얕은 복사)를 만들어 모든 `reset(level)`에 넘깁니다. weapon은 `sway`(swayAmp)·`breath`(breathMax), ai는 `react`(경계 → 도주 반응 시간), session은 `score`(클리어 시 최종 점수, 결과표에 `난이도 보정` 행)를 읽습니다. `level.difficulty`가 없으면 모두 배수 1입니다. 별 기준(`stars`)은 난이도와 무관합니다.
- 난이도는 레벨을 불러올 때 정해집니다. 브리핑에서 바꾸면 main이 레벨을 다시 불러오고, 플레이·일시정지 중 변경은 다음 시도부터 적용됩니다.
Level 객체(필드는 **모두 필수**, `?`가 붙은 것만 선택):
```js
{
  id: 1, theme: 'downtown',            // 'downtown'|'harbor'|'market'|'night'|'vip' — world.js가 테마별로 장면 생성
  name: '도심 첫 임무', subtitle: '고정 표적',
  briefing: '...',                     // 브리핑 본문(한글, 2~4문장)
  targetDesc: '검은 정장의 남자 2명',  // HUD/브리핑에 표시. LOOKS 설명과 일치해야 함
  hints: ['화면을 드래그해 조준하세요', ...],   // 튜토리얼 힌트(스테이지 1만), 없으면 []
  env: {
    sky: [0x4a90e2, 0xbfe3ff],         // [천정색, 지평선색]
    fog: { color: 0xbfe3ff, near: 150, far: 700 },  // far는 최장 교전거리보다 충분히 멀게
    sun: { color: 0xffffff, intensity: 1.6, dir: [0.4, 1, 0.3] },
    hemi: { sky: 0xdfefff, ground: 0x556655, intensity: 1.1 },
  },
  nightVision: false,                  // true면 NV 버튼 사용 가능(스테이지 4)
  player: { pos: [0, 25, 20], yaw: 0, pitch: -0.1, yawLimit: [-0.8, 0.8], pitchLimit: [-0.45, 0.15] },
  weapon: { scopeFovs: [8, 3.5], zoomLabels: ['6x', '14x'], reserve: 10 },  // 탄창 외 예비탄
  ballistics: { gravity: 0, wind: { speed: 0, dir: 0 }, windFactor: 0.9 },
  timeLimit: 150,                      // 초
  objective: { ids: ['t1', 't2'], escapeVehicle?: 'car1' },  // 반드시 사살해야 할 actor id
  rules: { civilianFail: false, alertRadius: 12, witnessRadius: 25 },
  stars: [0, 2600, 3400],              // [★1, ★2, ★3] 최종 점수 기준. 클리어하면 최소 ★1
  exits: [[-160, -320], [160, -320]],  // 도주 목적지 [x,z]. 도달하면 escaped
  world: { seed: 11, density: 0.7, extras: [ { type: 'container', x: 10, z: -150, rot: 0, color: 0xd84315 } ] },
  actors: [ Actor, ... ],
  vehicles: [ { id: 'car1', kind: 'sedan', pos: [x, z], heading: 0, color: 0x222222, path: [[x,z], ...] } ],
}
```
- **extras.type**: `'container'|'awning'|'wall'|'car'|'stall'|'crate'|'lamp'|'tree'`. 의도적인 엄폐물이나 소품입니다. world.js가 그리고 충돌체(collider)도 만듭니다(lamp, tree, awning 제외).
- **Actor**:
```js
{ id: 't1', role: 'target'|'civilian'|'guard'|'vip', look: 'suit_black',  // LOOKS 키
  pos: [x, z], y?: 0,                 // y 생략 시 지면. 옥상 배치 시 높이 지정
  heading: 0,
  behavior: 'idle'|'patrol'|'walk'|'escort'|'toVehicle',
  path: [[x, z], ...],                // patrol: 왕복 순찰, walk: 한 번 이동 후 정지, toVehicle: 경로 끝에서 차량 탑승
  speed: 1.3, wait: 2,                // 걷기 m/s, 경유지 대기(초)
  follow?: 'vip', offset?: [dx, dz],  // escort 전용: 대상의 로컬 오프셋 위치를 따라감
  vehicle?: 'car1' }                  // toVehicle 전용
```
- **경로 의미**(v1.1, GDD §9.2):
  - actor는 `pos`에서 출발해 `path[0], path[1], …` 순서로 이동하고, **경유지마다 `wait`초 대기**합니다.
  - `patrol`: `pos = path[0]`이고 끝에 닿으면 역순으로 왕복합니다(양 끝과 중간점에서 대기).
  - `walk`: 마지막 점에서는 대기 없이 `idle`이 됩니다.
  - `toVehicle`: 마지막 점(차량 옆 약 2.3m)에 도착하면 즉시 `boarded`가 됩니다.
  - `escort`: 월드 위치 = 대상 위치 + `(dx·cos h + dz·sin h, −dx·sin h + dz·cos h)`(h = 대상 heading)입니다. heading은 대상과 같게 둡니다. VIP가 탑승하면 경호원은 그 자리에서 `idle`이 됩니다.
  - 이동 중 heading = `headingTo(dx, dz)`입니다. heading 0 = +Z = **플레이어를 바라봄**입니다.
- **extras 치수**(v1.1, world.js의 시각·충돌체와 레벨 검증이 공유). `rot`은 0 또는 π/2만 씁니다(AABB와 일치).

  | type | 로컬 X × 높이 × Z (m) | 충돌체 |
  |---|---|---|
  | `container` | 12.2 × 2.6 × 2.44 (rot 0이면 길이가 X) | O `prop` |
  | `stall` | 3.0 × 1.1 × 1.6 (판매대만) | O `prop` |
  | `awning` | 4.0 × 2.6~2.75 × 3.0 (판매대 위 차양) | X (탄 통과, 시각 엄폐) |
  | `wall` | 8.0 × 2.2 × 0.4 | O `prop` |
  | `car` | 1.9 × 1.45 × 4.6 (=`VEHICLE.sedan`, +Z가 길이) | O `prop` |
  | `crate` | 1.2 × 1.2 × 1.2 | O `prop` |
  | `lamp` | 0.3 × 6 × 0.3 | X |
  | `tree` | 수관 반경 2, 줄기 0~2.5 / 수관 2.5~6 | X (시각 엄폐) |
- **배치 규칙**(world.js와의 약속, v1.1 확장). world.js는 다음 영역에 **절차 생성 건물이나 큰 소품을 두지 않습니다**.
  1. actor 시작점, 경로점, exit 주변 반경 3m
  2. **경로 선분**(연속된 경로점 사이를 5m 이하 간격으로 샘플링) 주변 반경 3m
  3. **차량** `pos`, `path`와 그 선분 주변 반경 3m
  4. 플레이어 눈 → 각 시작점·경로점(높이 1.2m와 1.62m) 사선
  5. (권장) 각 actor 시작점 → 가장 가까운 exit 직선(도주로) 반경 2m
  - 디자이너는 actor를 자유롭게 배치하되 `yawLimit`/`pitchLimit` 안에 둡니다. 일부러 가리고 싶으면 `extras`로 명시합니다(world.js는 extras를 그대로 배치).

## 5. 런타임 객체 (gameplay가 소유하고 쓰기, 나머지는 읽기만)
```js
Agent   = { id, role, look, required, x, y, z, heading, vx, vz,           // vx,vz = 현재 속도 m/s
            state: 'idle'|'walk'|'alert'|'flee'|'dead'|'escaped'|'boarded',
            anim: 'stand'|'walk'|'run'|'dead'|'hidden', gait /*0..1 걸음 주기*/, deadT /*사망 후 경과초, 생존 -1*/,
            pose: { spd, walk, run, al /*0..1 걷기·달리기·경계 비율*/, lean /*척추(1.04m) 기준 앞 숙임 rad*/, bob /*골반 상하 m*/, stride /*허벅지 스윙 rad*/ } }
            // v1.5 pose: ai가 매 프레임 계산(재사용 객체). actors.js는 이 값으로 뼈를 움직이고, ballistics는 같은 값으로 히트박스를 맞춘다
            //   → 화면에 보이는 머리·몸통 = 판정 위치. 그래픽 쪽에서 판정에 영향을 주는 자세를 따로 만들지 않는다
Vehicle = { id, kind, color, x, y, z, heading, speed, state: 'parked'|'driving'|'gone' }
Bullet  = { active, x, y, z, vx, vy, vz, t, px, py, pz /*직전 위치*/, ox, oy, oz /*발사 위치*/ }  // 풀 8개
AABB    = { min: [x,y,z], max: [x,y,z], surface: 'building'|'prop'|'vehicle' }
View    = { x, y, z, yaw, pitch, fov }                     // weapon.view — 흔들림·반동 포함, 재사용 객체
InputState = { aimDX, aimDY /*px, 감도·반전 적용 후*/, gyroYaw, gyroPitch /*rad 증분*/,
               fire, scope, reload, nv, pause /*한 번만 true(edge)*/, zoom /*+1 확대 순환, -1 축소, 0*/, breath /*누르는 동안 true*/ }
WeaponStatus = { mag, magSize, reserve, scoped, zoomIdx, zoomLabel, boltT /*0..1*/, reloadT /*0..1*/,
                 breath /*스태미나 0..1*/, holding /*실제로 숨 참는 중(강제 호흡·스태미나 0이면 false)*/, exhausted, canFire }
SessionSnap  = { timeLeft, score, kills, required, shots,
                 hits /*적(target·guard·vip) 명중 수. 민간인은 civHits*/, headshots, civHits, objectiveText,
                 vipEta /*탑승 전: 탑승까지 초, 탑승 후: 차량 탈출까지 초, 해당 없음·사망·탈출: -1*/ }
HudFrame     = { weapon: WeaponStatus, session: SessionSnap, range /*m, 없음 -1*/, view: View, level, nv }
```

## 6. 모듈 API
### gfx (graphics-dev)
```js
// gfx/renderer.js
createRenderer(canvas) → { scene, camera, renderer,
  setEnv(env),            // 하늘 그라디언트, 안개, 조명
  setNightVision(on),     // 조명과 안개를 녹색 야간투시로(추가 패스 없음)
  setView(view),          // 카메라 위치·회전·fov
  resize(),               // 캔버스 CSS 크기에 맞춤(main이 resize/orientationchange 때 호출)
  render(), compile(),
  setQuality('auto'|'high'|'low'),  // auto = 프레임타임 기반 동적 pixelRatio
  stats() → { drawCalls, tris, pixelRatio } }
// gfx/world.js
buildWorld(scene, level) → { colliders: AABB[], surfaceAt(x, z) → 'ground'|'water', dispose() }
// gfx/actors.js — 생성자에서 bus 구독: hit(탄 방향·부위 → 사망 연출). 인물 = 뼈대 13개 SkinnedMesh(외형별 지오메트리 공유, 인물별 Skeleton)
class ActorViews { constructor(scene); build(agents, vehicles); sync(agents, vehicles, dt); setNightVision(on); clear(); }
// gfx/fx.js  — 생성자에서 bus 구독: shot, impact, hit
class Fx { constructor(scene); update(dt, bullets); clear(); }
// gfx/mesh.js — 내부 유틸(자유). 예: mergeGeometries(geos)
```
### game (gameplay-dev)
```js
// game/weapon.js  — emits: shot, bolt, reload{phase}, dryfire, scope{on,zoomIdx}
class Weapon { view; status; reset(level); update(dt, input, viewportH); setScope(on, zoomIdx?); aimAt(x, y, z); setAssist({noSway}); }
// game/ballistics.js — 생성자에서 'shot' 구독, emits: impact{pos,surface}, hit{agentId,role,part,pos,dist}, nearMiss{...}(v1.5)
class Ballistics { bullets; reset(level, world); update(dt, agents, vehicles); rangeAt(view, agents) → m|-1; setAssist({noDrop, noWind}); }
export function partPos(agent, 'head'|'chest', out?) → [x,y,z]  // v1.5: 자세 반영 부위 위치(판정과 같은 식). debug가 사용
//   인물 판정(v1.5): 다리 상자(보폭만큼 넓힘) + 척추 기준으로 기운 몸통 상자 + 머리 구. 이동 중이면 진행 방향(로컬 +Z)으로
//   '속도 × leadTol × 난이도 lead'만큼 늘리고(머리는 캡슐), 1/120초 스텝마다 위치를 '프레임 끝 위치 − 속도 × 남은 시간'으로 보간
// game/ai.js — 'hit','impact' 구독, emits: alert{agentId,pos}, escaped{agentId,role,required}
class AI { agents; vehicles; reset(level, world); update(dt); get(id); }
// game/session.js — 'shot','hit','escaped' 구독, emits: score{delta,label,total}, objective{text,done,total}, missionEnd
class Session { snap; ended; reset(level, ai, weapon); update(dt); }
```
### ui (mobile-ios-dev)
```js
// ui/hud.js — emits ui:* ; 'score','hit','alert','objective','shot','bolt','reload','settings' 등을 구독해 연출
createHud(root) → { show(screen, data), update(frame: HudFrame), toast(text, kind?: 'info'|'warn'|'bad'), setNightVision(on) }
// ui/input.js
createInput(root, canvas) → { poll() → InputState, inject(partial), enableGyro() → Promise<bool> /*탭 안에서 호출*/, disableGyro(),
                              setSensitivity(k), setInvertY(b), setEnabled(b) }
// ui/audio.js — 게임 이벤트 구독해 합성음 재생
createAudio() → { unlock() /*탭 안에서*/, setEnabled(b), suspend(), resume() }
// ui/storage.js
loadProgress() → Progress; saveProgress(p); clearProgress(); defaultProgress()
//   Progress = { v:1, unlocked:1, stars:{[id]:n}, best:{[id]:score}, settings:{ sens:1, gyro:false, sound:true, quality:'auto', invertY:false, difficulty:'normal' } }
//   difficulty: 'easy'|'normal'|'hard' (v1.4, 없거나 잘못되면 'normal'). 설정 화면과 브리핑의 [data-set="difficulty"] 버튼으로 바꿈
// ui/pwa.js
initPwa({ canvas, onHidden, onVisible, onContextLost, onUpdateReady })
```

## 7. 이벤트 카탈로그 (`bus.emit(type, payload)`, 모두 동기)
| type | payload | 발신 | 주요 수신 |
|---|---|---|---|
| `shot` | `{origin:[x,y,z], dir:[x,y,z], scoped, zoomIdx}` | weapon | ballistics, fx, audio, hud, session |
| `bolt` | `{}` 볼트 조작 시작 | weapon | audio, hud |
| `reload` | `{phase:'start'\|'end'}` | weapon | audio, hud |
| `dryfire` | `{}` | weapon | audio, hud |
| `scope` | `{on, zoomIdx}` | weapon | audio, hud |
| `impact` | `{pos, surface:'ground'\|'water'\|'building'\|'prop'\|'vehicle'}` | ballistics | fx, audio, ai(경계) |
| `hit` | `{agentId, role, part:'head'\|'body'\|'legs', pos, dist}` | ballistics | ai(사망), session, fx, audio, hud, actors(사망 연출) |
| `alert` | `{agentId, pos}` — pos = 머리 위치 `[x, y+1.62, z]` | ai | hud, audio |
| `nearMiss` | `{agentId, ahead, off, lead, dist}` — 1m/s 넘게 움직이는 비민간인의 가슴 1.6m 안을 지났지만 빗나감. ahead = 진행 방향 앞으로 지남, off = 진행 방향 오차(m), lead = 필요 리드(m), dist = 거리(m). impact 다음에 발신 (v1.5) | ballistics | hud(리드 안내 토스트, off ≥ 0.25m일 때) |
| `escaped` | `{agentId, role, required}` | ai | session, hud |
| `score` | `{delta, label, total}` | session | hud |
| `objective` | `{text, done, total}` | session | hud |
| `missionEnd` | `{success, reason:'cleared'\|'civilian'\|'escaped'\|'time'\|'ammo', score, stars, breakdown:[{label,value}], levelId}` | session | main, hud, audio |
| `state` | `{state}` | main | hud, audio |
| `nv` | `{on}` | main | hud, audio |
| `settings` | `{settings}` 변경이 반영됨 | main | hud |
| `ui:start` `ui:back` `ui:begin` `ui:resume` `ui:retry` `ui:next` `ui:menu` | `{}` | hud | main |
| `ui:select` | `{id}` | hud | main |
| `ui:settings` | `{settings: 부분 객체}` | hud | main |
| `ui:gyro` | `{on}` — 탭 핸들러 안에서 동기 emit | hud | main |

- 사람에 대한 명중(`hit`)은 **즉사**입니다(ai가 `dead`로 바꿈).
- 이미 `dead`/`boarded`/`escaped` 상태인 인물은 판정 대상이 아닙니다.

## 8. DOM / 화면 계약
- `index.html`(mobile)에는 `<canvas id="gl">`, `<div id="hud">`, `<div id="rotate">`(세로 화면 안내), `<div id="dbg">`(디버그 오버레이, `.on`일 때 표시), `<script type="module" src="js/main.js">`가 반드시 있어야 합니다.
- 인게임 버튼은 `data-btn="fire|scope|zoom|breath|reload|nv|pause"` 속성을 가진 DOM입니다(hud가 만들고 input이 읽음).
  - 버튼이 아닌 곳을 누르면 조준 드래그로 처리합니다(`pointerId`별 추적 → 멀티터치).
- `hud.show(screen, data)`:
  | screen | data |
  |---|---|
  | `title` | `{version, settings}` |
  | `select` | `{levels, progress}` |
  | `briefing` | `{level, best, stars}` |
  | `playing` | `{level, resume?}` |
  | `paused` | `{level}` |
  | `result` | `{result: missionEnd payload, level, hasNext, best, progress}` |
  - 설정 화면은 hud가 자체적으로 엽니다(title이나 paused에서). 변경 사항은 `ui:settings`로 알립니다.
- QA가 탭할 수 있도록 다음 셀렉터를 유지합니다:
  - 스테이지 카드 `[data-stage="N"]`. 잠긴 카드는 `disabled` + `aria-disabled="true"`(v1.3)
  - 주요 버튼 `[data-ui="start|back|begin|resume|retry|next|menu|settings"]`
  - 인게임 `[data-btn=...]`
- **PC 조작**(input):
  - 캔버스를 클릭하면 Pointer Lock이 걸리고, 마우스 이동 = 조준입니다.
  - 좌클릭 발사, 우클릭 스코프, 휠 위 = zoom +1 / 휠 아래 = zoom −1, Shift 숨참기, R 재장전, N 야간투시, Esc 일시정지
  - 잠금이 풀리면 `pause`를 보냅니다. 단 코드가 `setEnabled(false)`로 직접 푼 경우는 제외합니다.
  - **잠금을 거는 첫 클릭은 발사하지 않습니다**(v1.3). 잠긴 뒤의 좌클릭부터 발사합니다.
  - 대체 조작(잠금 불가 또는 거절 직후 1.2초): **좌버튼 드래그 = 조준**(좌클릭으로 발사하지 않음), Space 발사, E 스코프, Q 줌

## 9. 상태 머신과 메인 루프 (`main.js`, PM)
```
BOOT → TITLE → ui:start(오디오 unlock) → SELECT → ui:select → BRIEFING(loadLevel: setEnv → buildWorld → ai.reset → weapon.reset
     → ballistics.reset → actors.build → compile) → ui:begin → PLAYING(session.reset)
PLAYING → input.pause / 백그라운드 / 세로(터치기기) / 컨텍스트 손실 → PAUSED → ui:resume → PLAYING | ui:retry → BRIEFING | ui:menu → SELECT
PLAYING → missionEnd → 1.5초 진행(입력 차단) → RESULT(진행 저장) → ui:next | ui:retry | ui:menu
```
- **매 프레임 순서**(PLAYING):
  1. `input.poll()`
  2. (pause, nv 처리)
  3. `weapon.update(dt, input, 캔버스높이)`
  4. `ai.update(dt)`
  5. `ballistics.update(dt, ai.agents, ai.vehicles)`
  6. `session.update(dt)`
  7. `actors.sync(...)`
  8. `fx.update(dt, ballistics.bullets)`
  9. 4프레임마다 `ballistics.rangeAt`
  10. `gfx.setView(weapon.view)`
  11. `hud.update(hudFrame)`
  12. `gfx.render()`
- 메뉴, 브리핑, 일시정지 화면에서는 월드가 로드돼 있으면 30fps로 렌더링하고, 없으면 렌더링하지 않습니다.
- `dt`는 최대 0.05초로 자릅니다. 디버그 `timeScale`을 곱합니다.

## 10. 디버그 API — `window.__SNIPER__` (`?debug` 또는 `?autotest`)
| 함수 | 설명 |
|---|---|
| `state()` | 현재 상태 |
| `startStage(id)` | 브리핑을 건너뛰고 바로 PLAYING |
| `level()` | 현재 레벨 객체 |
| `actors()` | `{id, role, required, state, x, y, z, heading, vx, vz, head:[..], chest:[..], pose}` 목록. head·chest는 자세 반영 위치(= 화면에 보이는 곳 = 판정 위치, v1.5) |
| `vehicles()` | 차량 목록 |
| `aimAt([x,y,z])` | 해당 지점을 조준 |
| `scope(on, zoomIdx)` | 스코프 상태 지정 |
| `fire()` | `input.inject({fire:true})` — 실제 입력 경로를 거침 |
| `input(partial)` | 입력 주입 |
| `assist({noSway, noDrop, noWind})` | 흔들림·낙차·바람 끄기 |
| `timeScale(k)` | 시간 배속 |
| `session()` | 세션 스냅샷 |
| `weapon()` | 무기 상태 |
| `stats()` | `{fps, frameMsAvg, frameMsP95, drawCalls, tris, pixelRatio, state}` |
| `events(type?)` / `clearEvents()` | 최근 이벤트 200개 |
| `unlockAll()` / `resetProgress()` | 진행 상황 조작 |
| `nv(on)` | 야간투시 |
| `emit(type, payload)` | 이벤트 직접 발신 |

## 11. 성능 예산 (iOS Safari 기준)
- **드로우콜**: 보통 60개 이하, 최대 100개. **삼각형** 12만 개 이하. **재질(셰이더)** 12개 이하. **캔버스 텍스처** 256² 이하 3장까지.
- 그림자, 후처리, 톤매핑, 점광원/스포트라이트는 금지입니다. 조명은 Hemisphere + Directional만 씁니다. 재질은 Lambert/Basic입니다.
- 인물 SkinnedMesh는 인물당 드로우콜 1개이고, Skeleton마다 작은 뼈 텍스처(DataTexture) 1장이 생깁니다. `clear()`에서 `skeleton.dispose()`로 해제합니다(캔버스 텍스처 제한과는 별개).
- **월드 정적 지오메트리**는 재질별로 병합합니다(mesh.js). **반복 소품**은 `InstancedMesh` + `setColorAt`로 그립니다. 정적 메시는 `matrixAutoUpdate=false`로 둡니다.
- **동적 해상도**: pixelRatio는 `min(dpr, 2)`에서 시작합니다. 평균 20ms 초과가 2초 이어지면 −0.25, 13ms 미만이 4초 이어지면 +0.25입니다(최저 1.0).
- **판정**: `THREE.Raycaster`를 쓰지 않고 해석적 선분 판정을 씁니다.
- **HUD**: 값이 바뀔 때만 DOM에 씁니다. CSS 애니메이션, `backdrop-filter`, `mix-blend-mode`는 금지입니다.

## 12. 파일 소유권과 JS 줄 수 예산
| 담당 | 파일 | 예산 |
|---|---|---|
| PM | `docs/js/{main,bus,config,util,debug}.js`, `docs/vendor/**`, `docs/.nojekyll`, `tests/smoke.mjs`, `tests/package.json`, `tools/serve.py`, `play_pc.bat`, `design/CONTRACT.md`, `design/workflow-log.md`, `CLAUDE.md`, `README.md`, `report/**` | ~365줄 |
| game-designer | `design/GDD.md`, `docs/js/data/levels.js` | ~300줄 |
| graphics-dev | `docs/js/gfx/{renderer,world,actors,fx,mesh}.js` | ~650줄 |
| gameplay-dev | `docs/js/game/{weapon,ballistics,ai,session}.js` | ~550줄 |
| mobile-ios-dev | `docs/{index.html, manifest.webmanifest, sw.js}`, `docs/css/style.css`, `docs/icons/*`, `docs/js/ui/{hud,input,audio,storage,pwa}.js`, `tools/make_icons.py`, `design/INSTALL.md` | ~650줄(JS) |
| qa-tester | `tests/{qa.mjs, QA_REPORT.md, qa-results.json}`, `tests/screenshots/*` | 제한 없음 |

## 13. 자가 점검 (모든 담당자, 작업 종료 전 필수)
```bash
cd C:/MyWork/Claude_PJT/Sniper_Game
# 1) 문법 검사 (node --check는 ESM에서 실패하므로 아래 형식 사용)
for f in docs/js/*.js docs/js/*/*.js; do node --input-type=module --check < "$f" || echo "FAIL $f"; done
# 2) 스모크 (서버는 PM이 띄워 둠. 꺼져 있으면: python tools/serve.py --quiet 를 백그라운드로)
cd tests && node smoke.mjs --stage all     # 5스테이지 진입·스크린샷·에러 0 확인
node smoke.mjs --desktop                     # PC(1280x720) 타이틀 화면
```
- 스크린샷 `tests/screenshots/smoke-stageN.png`를 **직접 열어 확인**합니다(Read 도구로 이미지 보기 가능).
- 서버를 새로 띄우지 마세요(포트 8123 하나를 공유). 꺼져 있을 때만 띄웁니다.
