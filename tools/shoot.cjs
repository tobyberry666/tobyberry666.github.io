/**
 * Screenshot helper: drives a headless Chrome over the DevTools protocol so we can
 * scroll to any chapter and capture the immersive layout, which plain --screenshot
 * cannot reach (it always renders scroll position 0).
 *
 * Usage: node tools/shoot.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots');
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    });
  }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await listTargets();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Chrome debugger did not come up');
}

async function shoot(cdp, name, fullPage = false) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const { size } = fs.statSync(file);
  console.log(`${name}.png ${Math.round(size / 1024)}KB`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(process.env.TEMP || '.', `toby-cdp-${Date.now()}`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-crash-reporter', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await connect();
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const load = async (url) => {
      await cdp.send('Page.navigate', { url });
      await sleep(2200);
    };
    const viewport = async (width, height, mobile = false) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile,
      });
    };
    const scrollTo = async (fraction) => {
      // Use the pinned ScrollTrigger's own range; scrolling by document height lands
      // mid-transition because the pin spacer is taller than the tween.
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const st = window.ScrollTrigger && window.ScrollTrigger.getAll()[0];
          const max = document.documentElement.scrollHeight - innerHeight;
          let y = Math.round(max * ${fraction});
          if (st) y = Math.round(st.start + (st.end - st.start) * ${fraction});
          window.scrollTo(0, y);
          return [window.scrollY, y, st ? [st.start, st.end] : null];
        })()`,
        returnByValue: true,
      });
      await sleep(2200);
    };

    // Anchors the frame on a chapter by its element, which is what the reading layout
    // needs: there is no ScrollTrigger range to interpolate on phones.
    const scrollToSection = async (id, offset = 0) => {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.getElementById(${JSON.stringify(id)});
          if (!el) return null;
          window.scrollTo(0, Math.round(window.scrollY + el.getBoundingClientRect().top) + ${offset});
          return Math.round(window.scrollY);
        })()`,
        returnByValue: true,
      });
      await sleep(1200);
    };
    // --- desktop immersive ---
    await viewport(1440, 900);
    await load(BASE);
    await sleep(1200);
    await shoot(cdp, 'immersive-desktop-01-hero');

    for (const [name, fraction] of [
      ['immersive-desktop-02-about', 1 / 6],
      ['immersive-desktop-03-feel', 2 / 6],
      ['immersive-desktop-04-work', 3 / 6],
      ['immersive-desktop-05-code', 4 / 6],
      ['immersive-desktop-06-vocab', 5 / 6],
      ['immersive-desktop-07-connect', 1],
    ]) {
      await scrollTo(fraction);
      await shoot(cdp, name);
    }

    // --- easter egg open ---
    await scrollTo(0);
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.egg-trigger').click()` });
    await sleep(700);
    await shoot(cdp, 'immersive-desktop-08-easter-egg');
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('.egg-close').click()` });
    await sleep(400);

    // --- mobile ---
    // The phone layout is a normal vertical document, so each frame is anchored on its
    // chapter element rather than on a scroll fraction.
    await viewport(390, 844, true);
    await load(BASE);
    await sleep(1200);
    await shoot(cdp, 'mobile-390-01-hero');
    for (const [name, id] of [
      ['mobile-390-02-about', 'about'],
      ['mobile-390-03-feel', 'feel'],
      ['mobile-390-04-work', 'work'],
      ['mobile-390-05-code', 'code'],
      ['mobile-390-06-vocab', 'vocab'],
      ['mobile-390-07-connect', 'connect'],
    ]) {
      await scrollToSection(id);
      await shoot(cdp, name);
    }

    // --- narrow 320 ---
    await viewport(320, 568, true);
    await load(BASE);
    await sleep(1200);
    await shoot(cdp, 'mobile-320-01-hero');
    await scrollToSection('work');
    await shoot(cdp, 'mobile-320-04-work');
    await scrollToSection('code');
    await shoot(cdp, 'mobile-320-05-code');

    // --- short desktop ---
    await viewport(1440, 600);
    await load(BASE);
    await sleep(1200);
    await shoot(cdp, 'desktop-short-1440x600-hero');
    await scrollToSection('work');
    await shoot(cdp, 'desktop-short-1440x600-work');
    await scrollToSection('connect');
    await shoot(cdp, 'desktop-short-1440x600-connect');

    // --- reading layout (reduced motion emulation) ---
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await viewport(1440, 900);
    await load(BASE);
    await sleep(1200);
    await shoot(cdp, 'reading-desktop-reduced-motion');
    await shoot(cdp, 'reading-desktop-reduced-motion-full', true);

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((error) => {
  console.error('Screenshot run failed:', error.message);
  process.exit(1);
});
