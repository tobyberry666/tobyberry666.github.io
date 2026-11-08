/**
 * Behaviour verification over CDP: keyboard access, easter egg, chapter navigation,
 * reduced-motion layout and restored scroll position. Writes docs/verification.txt.
 * Usage: node tools/verify.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const log = (msg) => { lines.push(msg); console.log(msg); };

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => rej(new Error(`timeout ${method}`)), 30000);
    });
  }
}

const check = (name, ok, detail) => log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);

(async () => {
  const profile = `${process.env.TEMP}\\toby-verify-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--disable-crash-reporter', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
      } catch { /* wait */ }
      if (!wsUrl) await sleep(500);
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const evaluate = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const goto = async (url) => { await cdp.send('Page.navigate', { url }); await sleep(2500); };

    log('--- desktop 1440x900, animation on ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto('http://127.0.0.1:4173/');

    check('immersive mode engaged', await evaluate(`document.documentElement.classList.contains('is-immersive')`) === true);
    check('seven chapters present', await evaluate(`document.querySelectorAll('.scene').length`) === 7);
    // The hero photo is eager; the easter-egg photo is lazy and only loads once its
    // dialog is opened, so assert the hero here and the egg after activation below.
    const hero = await evaluate(`(() => { const i = document.querySelector('.portrait-figure img'); return { complete: i.complete, nw: i.naturalWidth, nh: i.naturalHeight }; })()`);
    check('hero photo loaded', hero.complete === true && hero.nw > 0, `${hero.nw}x${hero.nh}`);

    log('--- keyboard: Tab reaches the easter-egg button ---');
    const order = await evaluate(`(() => {
      const trigger = document.querySelector('.egg-trigger');
      trigger.focus();
      return { focused: document.activeElement === trigger, hidden: trigger.hidden };
    })()`);
    check('easter-egg button is focusable and visible', order.focused === true && order.hidden === false);

    log('--- easter egg opens by activation (not hover) ---');
    await evaluate(`document.querySelector('.egg-trigger').click()`);
    await sleep(600);
    let egg = await evaluate(`(() => { const p = document.getElementById('egg-panel'); return { open: p.open, expanded: document.querySelector('.egg-trigger').getAttribute('aria-expanded'), focusInside: p.contains(document.activeElement) }; })()`);
    check('dialog opens on activation', egg.open === true);
    check('aria-expanded flipped to true', egg.expanded === 'true');
    check('focus moved inside the dialog', egg.focusInside === true);
    const eggImg = await evaluate(`(() => { const i = document.querySelector('.egg-panel img'); return { complete: i.complete, nw: i.naturalWidth }; })()`);
    check('easter-egg photo loads once the dialog opens', eggImg.nw > 0, `${eggImg.nw}px`);

    log('--- Escape closes and returns focus ---');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(600);
    egg = await evaluate(`(() => { const p = document.getElementById('egg-panel'); const t = document.querySelector('.egg-trigger'); return { open: p.open, expanded: t.getAttribute('aria-expanded'), focusBack: document.activeElement === t }; })()`);
    check('Escape closes the dialog', egg.open === false);
    check('aria-expanded back to false', egg.expanded === 'false');
    check('focus restored to the trigger', egg.focusBack === true);

    log('--- chapter navigation via the dock ---');
    await evaluate(`document.querySelectorAll('.chapter-nav a')[3].click()`);
    await sleep(2400);
    const nav = await evaluate(`(() => {
      const st = window.ScrollTrigger.getAll()[0];
      const work = document.querySelector('#work').getBoundingClientRect();
      return { progress: +st.progress.toFixed(3), workLeft: Math.round(work.left), hash: location.hash,
               current: document.querySelector('.chapter-count').textContent };
    })()`);
    check('dock link scrolls to the Paper Highlights chapter', nav.workLeft === 0 && nav.progress > 0.45 && nav.progress < 0.55, JSON.stringify(nav));
    check('chapter counter follows', nav.current.trim().startsWith('04'), nav.current);

    log('--- dark chrome on project scenes ---');
    check('dark class applied on project chapter', await evaluate(`document.documentElement.classList.contains('is-dark')`) === true);

    log('--- reduced motion ---');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await goto('http://127.0.0.1:4173/');
    const rm = await evaluate(`({
      immersive: document.documentElement.classList.contains('is-immersive'),
      scrollHeight: document.documentElement.scrollHeight,
      visibleSections: [...document.querySelectorAll('.scene')].filter(s => s.getBoundingClientRect().width > 0).length,
      photoVisible: (() => { const i = document.querySelector('.portrait-figure img'); const r = i.getBoundingClientRect(); return r.width > 100 && r.height > 100; })()
    })`);
    check('reduced motion falls back to the reading layout', rm.immersive === false, `scrollHeight=${rm.scrollHeight}`);
    check('all seven chapters still render', rm.visibleSections === 7);
    check('portrait still visible without animation', rm.photoVisible === true);
    check('document is vertically scrollable', rm.scrollHeight > 3000, `${rm.scrollHeight}px`);

    log('--- mobile 390x844 ---');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await goto('http://127.0.0.1:4173/');
    const mob = await evaluate(`(() => {
      const i = document.querySelector('.portrait-figure img');
      const r = i.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth - innerWidth,
        photoWidth: Math.round(r.width),
        heroTitleSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
        eggVisible: getComputedStyle(document.querySelector('.egg-trigger')).display !== 'none',
        navReachable: document.querySelectorAll('.chapter-nav a').length
      };
    })()`);
    check('no horizontal overflow on mobile', mob.overflowX <= 0, `overflowX=${mob.overflowX}`);
    check('portrait sized for the column', mob.photoWidth > 300 && mob.photoWidth <= 390, `${mob.photoWidth}px`);
    check('easter egg still reachable on mobile', mob.eggVisible === true);
    check('chapter nav present on mobile', mob.navReachable === 7);

    log('--- 320x568 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    await goto('http://127.0.0.1:4173/');
    const small = await evaluate(`({ overflowX: document.documentElement.scrollWidth - innerWidth,
      bodyText: document.querySelector('.hero-subtitle').getBoundingClientRect().width })`);
    check('no horizontal overflow at 320px', small.overflowX <= 0, `overflowX=${small.overflowX}`);

    ws.close();
  } finally {
    chrome.kill();
  }
  const out = path.resolve(__dirname, '..', 'docs', 'verification.txt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  const fails = lines.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${lines.length - fails} passed, ${fails} failed -> ${out}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('verify failed:', e.message); process.exit(1); });
