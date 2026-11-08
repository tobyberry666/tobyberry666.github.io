/**
 * Diagnostic: read the live camera state so we can tell a real layout bug from a
 * screenshot-timing artefact. Usage: node tools/probe.cjs
 */
const { spawn } = require('node:child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  const profile = `${process.env.TEMP}\\toby-probe-${Date.now()}`;
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
    await sleep(2500);

    const probe = async (label) => {
      const { result } = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const st = window.ScrollTrigger?.getAll()[0];
          const rail = document.querySelector('.rail');
          const scenes = [...document.querySelectorAll('.scene')];
          const about = document.querySelector('#about');
          return {
            scrollY: Math.round(scrollY),
            stStart: st && Math.round(st.start),
            stEnd: st && Math.round(st.end),
            progress: st && +st.progress.toFixed(4),
            railX: rail && getComputedStyle(rail).transform,
            aboutLeft: Math.round(about.getBoundingClientRect().left),
            aboutWidth: Math.round(about.getBoundingClientRect().width),
            innerLeft: Math.round(document.querySelector('#about .scene-inner').getBoundingClientRect().left),
            innerWidth: Math.round(document.querySelector('#about .scene-inner').getBoundingClientRect().width),
            sceneCount: scenes.length,
            innerWidthVw: innerWidth,
          };
        })()`,
      });
      console.log(label, JSON.stringify(result.value, null, 1));
    };

    await probe('AT_TOP');
    for (const f of [1 / 6, 2 / 6, 3 / 6]) {
      await cdp.send('Runtime.evaluate', { expression: `(() => { const st = window.ScrollTrigger.getAll()[0]; window.scrollTo(0, Math.round(st.start + (st.end - st.start) * ${f})); })()` });
      await sleep(2500);
      await probe(`AT_${Math.round(f * 6)}/6`);
    }
    ws.close();
  } finally { chrome.kill(); }
})().catch((e) => { console.error('probe failed:', e.message); process.exit(1); });
