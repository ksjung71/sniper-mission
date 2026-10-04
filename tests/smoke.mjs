// 공용 스모크 테스트 (PM 소유). 모든 에이전트가 자가 점검에 사용한다.
// 사용: node tests/smoke.mjs [--stage N|all] [--out file.png] [--desktop] [--wait ms] [--headful]
// 전제: 서버 실행 중 → python tools/serve.py --quiet  (http://localhost:8123/docs/)
// 결과: 콘솔 에러 / pageerror / 4xx·5xx 응답이 하나라도 있으면 exit 1. 스크린샷은 tests/screenshots/.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const BASE = 'http://localhost:8123/docs/';
export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const IPHONE_LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true };
export const DESKTOP = { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true };

/** Chrome 실행 + 페이지 생성 + 에러 수집기 부착. qa.mjs에서도 재사용 가능 */
export async function openGame({ desktop = false, headful = false, query = 'autotest&nosw&seed=1' } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !headful,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--no-first-run'],
    defaultViewport: null,
  });
  const page = await browser.newPage();
  if (!desktop) await page.setUserAgent(IPHONE_UA);
  await page.setViewport(desktop ? DESKTOP : IPHONE_LANDSCAPE);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__SNIPER__, { timeout: 15000 });
  return { browser, page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const stageArg = opt('--stage', null);
  const wait = +opt('--wait', 2000);
  const desktop = args.includes('--desktop');
  const headful = args.includes('--headful');

  try { await fetch(BASE); } catch {
    console.error('[smoke] 서버가 꺼져 있습니다. 먼저 실행: python tools/serve.py --quiet');
    process.exit(2);
  }

  const { browser, page, errors } = await openGame({ desktop, headful });
  const shots = [];
  const report = { ok: true, mode: desktop ? 'desktop' : 'iphone-landscape', stages: [] };
  try {
    fs.mkdirSync(path.join(HERE, 'screenshots'), { recursive: true });
    const stages = stageArg === 'all' ? [1, 2, 3, 4, 5] : stageArg ? [+stageArg] : [];
    if (!stages.length) {
      await sleep(wait);
      const out = opt('--out', path.join(HERE, 'screenshots', `smoke-title${desktop ? '-desktop' : ''}.png`));
      await page.screenshot({ path: out }); shots.push(out);
      report.state = await page.evaluate(() => window.__SNIPER__.state());
    }
    for (const id of stages) {
      await page.evaluate((n) => window.__SNIPER__.startStage(n), id);
      await sleep(wait);
      const out = stages.length === 1 && opt('--out', null) ? opt('--out') : path.join(HERE, 'screenshots', `smoke-stage${id}${desktop ? '-desktop' : ''}.png`);
      await page.screenshot({ path: out }); shots.push(out);
      const info = await page.evaluate(() => ({ state: window.__SNIPER__.state(), stats: window.__SNIPER__.stats(), actors: window.__SNIPER__.actors().length }));
      report.stages.push({ id, ...info });
    }
  } catch (e) {
    errors.push(`smoke: ${e.message}`);
  } finally {
    await browser.close();
  }
  report.ok = errors.length === 0;
  report.errors = errors;
  report.screenshots = shots;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
