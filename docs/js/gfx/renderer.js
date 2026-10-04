// 렌더러 (graphics-dev): 그라디언트 하늘 구, 안개·조명, 야간투시(추가 패스 없음), 1인칭 소총, 동적 해상도.
import * as THREE from '../../vendor/three.module.min.js';
import { BUDGET } from '../config.js';
import { bus } from '../bus.js';
import { prep, mergeGeometries } from './mesh.js';

const LIGHT_K = 1.6;   // r155+ 물리 기반 조명 보정: 레벨 env 세기를 체감 밝기로 맞추는 공통 배율(상대 비율은 유지)
const NV = { top: 0x041406, hor: 0x123d16, fog: 0x0a2a0d, hemi: 0x7dff7d, ground: 0x1a4a1a, hemiI: 1.15 }; // 배경은 중간 녹색, 인물은 발광으로 도드라지게
const RIFLE_POS = [0.38, -0.29, -0.8], RIFLE_SCALE = 0.75;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{scene, camera, renderer, setEnv(env), setNightVision(on), setView(view), resize(),
 *            render(), compile(), setQuality(q), stats(): {drawCalls, tris, pixelRatio}}}
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  const maxPR = () => Math.max(BUDGET.minPixelRatio, Math.min(window.devicePixelRatio || 1, BUDGET.maxPixelRatio));
  let pr = maxPR();
  renderer.setPixelRatio(pr);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a8c8);
  scene.fog = new THREE.Fog(0x87a8c8, 150, 700);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // 카메라 자식(소총)을 렌더링하기 위해
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.1), sun = new THREE.DirectionalLight(0xffffff, 1.5);
  scene.add(hemi, sun);

  // ---- 하늘: 버텍스 컬러 그라디언트 구 1개(드로우콜 1). 지평선 아래는 안개색 → 땅 끝과 이음매 없음 ----
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1; sky.frustumCulled = false; sky.matrixAutoUpdate = false;
  scene.add(sky);
  const cT = new THREE.Color(), cH = new THREE.Color(), cF = new THREE.Color(), cX = new THREE.Color();
  function paintSky(top, hor, fog) {
    cT.setHex(top); cH.setHex(hor); cF.setHex(fog);
    const p = skyGeo.attributes.position.array, c = skyGeo.attributes.color.array;
    for (let i = 0; i < p.length; i += 3) {
      const h = p[i + 1] / 900;
      if (h <= 0) cX.copy(cF);
      else if (h < 0.06) cX.copy(cF).lerp(cH, h / 0.06);
      else cX.copy(cH).lerp(cT, Math.pow((h - 0.06) / 0.94, 0.65));
      c[i] = cX.r; c[i + 1] = cX.g; c[i + 2] = cX.b;
    }
    skyGeo.attributes.color.needsUpdate = true;
  }

  // ---- 1인칭 소총(카메라 자식, 안개 영향 없음). 스코프 중(fov<20)에는 숨김 ----
  const rp = [];
  const B = (w, h, d, c, x, y, z) => rp.push(prep(new THREE.BoxGeometry(w, h, d), c, x, y, z));
  const C = (r0, r1, len, c, y, z, seg = 8) => rp.push(prep(new THREE.CylinderGeometry(r0, r1, len, seg), c, 0, y, z, 0, c, Math.PI / 2));
  const metal = 0x2b2f36, furn = 0x55603f, dark = 0x15171b;
  B(0.075, 0.15, 0.34, furn, 0, -0.06, 0.36); B(0.07, 0.09, 0.4, metal, 0, 0, 0.02); B(0.08, 0.085, 0.42, furn, 0, -0.01, -0.38);
  C(0.02, 0.016, 0.52, metal, 0.005, -0.8); C(0.024, 0.024, 0.08, dark, 0.005, -1.08, 8);
  C(0.03, 0.03, 0.34, dark, 0.095, -0.02); C(0.03, 0.044, 0.09, dark, 0.095, -0.22); C(0.04, 0.03, 0.08, dark, 0.095, 0.18);
  B(0.03, 0.05, 0.03, metal, 0, 0.055, -0.08); B(0.03, 0.05, 0.03, metal, 0, 0.055, 0.08);
  B(0.1, 0.02, 0.02, metal, 0.06, 0.01, 0.12); B(0.03, 0.03, 0.03, dark, 0.11, 0.01, 0.12);
  B(0.05, 0.08, 0.1, dark, 0, -0.08, -0.02); B(0.05, 0.13, 0.06, furn, 0, -0.1, 0.17);
  const rifle = new THREE.Mesh(mergeGeometries(rp), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  rifle.position.fromArray(RIFLE_POS); rifle.scale.setScalar(RIFLE_SCALE); rifle.frustumCulled = false; rifle.renderOrder = 10;
  camera.add(rifle);
  let kick = 0;
  bus.on('shot', (s) => { if (!s.scoped) kick = 1; });

  // ---- 환경·야간투시 ----
  let env = null, nv = false;
  function applyEnv() {
    if (!env) return;
    const f = scene.fog;
    if (nv) {
      paintSky(NV.top, NV.hor, NV.fog); f.color.setHex(NV.fog); f.near = 120; f.far = Math.max(env.fog.far, 650);
      hemi.color.setHex(NV.hemi); hemi.groundColor.setHex(NV.ground); hemi.intensity = NV.hemiI * LIGHT_K; sun.intensity = 0;
    } else {
      paintSky(env.sky[0], env.sky[1], env.fog.color); f.color.setHex(env.fog.color); f.near = env.fog.near; f.far = env.fog.far;
      hemi.color.setHex(env.hemi.sky); hemi.groundColor.setHex(env.hemi.ground); hemi.intensity = env.hemi.intensity * LIGHT_K;
      sun.color.setHex(env.sun.color); sun.intensity = env.sun.intensity * LIGHT_K;
      sun.position.fromArray(env.sun.dir).normalize().multiplyScalar(100);
    }
    scene.background.copy(f.color);
    // world 재질(발광 창문·가로등 글로우)이 userData.nv로 야간투시 색 전환을 등록해 둔다
    scene.traverse((o) => { const m = o.material; if (m && m.userData && m.userData.nv) m.userData.nv(nv); });
  }

  // ---- 해상도 ----
  let quality = 'auto', last = 0, avg = 0, slowT = 0, fastT = 0, viewed = false;
  function setPR(p) {
    const n = Math.min(maxPR(), Math.max(BUDGET.minPixelRatio, p));
    if (n !== pr) { pr = n; renderer.setPixelRatio(pr); }
    slowT = fastT = 0;
  }
  function measure(ms) { // 평균 20ms 초과 2초 → -0.25, 13ms 미만 4초 → +0.25
    if (quality !== 'auto' || ms > 250) return;
    avg = avg ? avg * 0.9 + ms * 0.1 : ms;
    slowT = avg > 20 ? slowT + ms / 1000 : 0;
    fastT = avg < 13 ? fastT + ms / 1000 : 0;
    if (slowT >= 2) setPR(pr - 0.25);
    else if (fastT >= 4) setPR(pr + 0.25);
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();

  return {
    scene, camera, renderer,
    setEnv(e) { env = e; applyEnv(); },
    setNightVision(on) { nv = !!on; applyEnv(); },
    setView(v) {
      camera.position.set(v.x, v.y, v.z);
      camera.rotation.set(v.pitch, v.yaw, 0);
      if (camera.fov !== v.fov) { camera.fov = v.fov; camera.updateProjectionMatrix(); }
      rifle.visible = v.fov >= 20;
      viewed = true; // 플레이 중 프레임만 측정(메뉴의 30fps 렌더는 제외)
    },
    resize,
    render() {
      const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      if (viewed && last) measure(now - last);
      viewed = false; last = now;
      kick *= Math.exp(-dt * 9);
      rifle.position.z = RIFLE_POS[2] + kick * 0.07;
      rifle.rotation.x = kick * 0.12;
      sky.position.copy(camera.position); sky.updateMatrix();
      renderer.render(scene, camera);
    },
    compile() { renderer.compile(scene, camera); },
    setQuality(q) {
      quality = q === 'high' || q === 'low' ? q : 'auto';
      if (quality === 'high') setPR(maxPR()); else if (quality === 'low') setPR(1); else { avg = 0; slowT = fastT = 0; }
    },
    stats() {
      return { drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles, pixelRatio: pr };
    },
  };
}
