/**
 * CDP connection diagnostic.
 *
 * Records, step by step, what a headless Chrome session actually does: process start,
 * debugger port opening, /json/list targets, WebSocket handshake, and the latency of
 * every CDP command. It exists to tell "the browser never came up" apart from
 * "the browser came up but a command never answered".
 *
 * Usage: node tools/cdp-doctor.cjs
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const log = [];
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
const say = (msg) => { const line = `${stamp()} ${msg}`; log.push(line); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(port) {
  say(`--- environment ---`);
  say(`node ${process.version} on ${process.platform}/${process.arch}`);
  say(`cwd ${process.cwd()}`);
  say(`TEMP ${process.env.TEMP}`);
  say(`chrome exists: ${fs.existsSync(CHROME)}`);
  say(`chrome path: ${CHROME}`);

  // Is the debugger port already taken? A stale Chrome from an earlier run holds it.
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    say(`port ${port} ALREADY ANSWERING (status ${res.status}) - a previous session owns it`);
    return { polluted: true };
  } catch (e) {
    say(`port ${port} free (${e.cause?.code || e.name})`);
  }
  return { polluted: false };
}

function launch(port) {
  const profile = path.join(os.tmpdir(), `toby-doctor-${Date.now()}`);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-crash-reporter', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank'
  ];
  say(`spawn: chrome ${args.join(' ')}`);
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Chrome writes startup failures to stderr; keeping them is what separates
  // "never started" from "started but silent".
  const errs = [];
  proc.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) errs.push(s);
  });
  proc.on('error', (e) => say(`spawn error: ${e.message}`));
  proc.on('exit', (code, signal) => say(`chrome exited code=${code} signal=${signal}`));
  return { proc, errs };
}

async function waitForTargets(port, deadlineMs) {
  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts++;
    const elapsed = Date.now() - started;
    if (elapsed > deadlineMs) {
      say(`/json/list never produced a page target after ${attempts} attempts in ${elapsed}ms`);
      return null;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        say(`/json/list ok after ${attempts} attempts (${elapsed}ms): ${list.length} targets, page ws=${page.webSocketDebuggerUrl}`);
        return page;
      }
      if (attempts % 10 === 0) say(`/json/list has ${list.length} targets but no page yet (${elapsed}ms)`);
    } catch (e) {
      if (attempts % 10 === 0) say(`/json/list not ready (${elapsed}ms): ${e.cause?.code || e.name}`);
    }
    await sleep(250);
  }
}

async function run(port) {
  const state = await probe(port);
  if (state.polluted) return { rootCause: 'port-occupied' };

  const { proc, errs } = launch(port);
  try {
    const page = await waitForTargets(port, 45000);
    if (!page) {
      say(`--- chrome stderr (${errs.length} lines) ---`);
      errs.slice(0, 20).forEach((l) => say(`  ${l}`));
      return { rootCause: 'no-page-target' };
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const opened = await Promise.race([
      new Promise((res) => ws.addEventListener('open', () => res(true), { once: true })),
      new Promise((res) => setTimeout(() => res(false), 10000))
    ]);
    if (!opened) { say('WebSocket did not open within 10s'); return { rootCause: 'ws-open' }; }
    say('WebSocket open');

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, sentAt, method } = pending.get(m.id);
        pending.delete(m.id);
        say(`  <- ${method} answered in ${Date.now() - sentAt}ms${m.error ? ' ERROR ' + m.error.message : ''}`);
        resolve(m);
      }
    });
    const send = (method, params = {}, timeout = 20000) => {
      const mid = ++id;
      say(`  -> ${method}`);
      const sentAt = Date.now();
      ws.send(JSON.stringify({ id: mid, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, sentAt, method });
        setTimeout(() => {
          if (pending.delete(mid)) {
            say(`  !! ${method} TIMED OUT after ${timeout}ms`);
            reject(new Error(`timeout ${method}`));
          }
        }, timeout);
      });
    };

    // The exact command sequence verify.cjs uses, with per-step latency.
    say('--- CDP sequence ---');
    await send('Page.enable', {}, 60000);
    await send('Runtime.enable', {}, 60000);
    await send('DOM.enable');
    const nav = await send('Page.navigate', { url: BASE });
    say(`navigate returned frameId=${nav.result?.frameId} errorText=${nav.result?.errorText || 'none'}`);
    await sleep(2500);
    const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    say(`page title: ${JSON.stringify(title.result?.result?.value)}`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    say(`screenshot bytes: ${Math.round((shot.result?.data || '').length * 0.75)}`);
    ws.close();
    return { rootCause: null };
  } finally {
    proc.kill();
  }
}

(async () => {
  const port = Number(process.env.CDP_PORT || 9525);
  say(`=== CDP doctor, port ${port} ===`);
  let result;
  try {
    result = await run(port);
  } catch (e) {
    say(`FAILED: ${e.message}`);
    say(`--- chrome stderr (${errs.length} lines) ---`);
    errs.slice(-20).forEach((l) => say(`  ${l}`));
    if (!errs.length) say('  (no stderr: Chrome is running but silent, which points at the DevTools channel, not the page)');
    result = { rootCause: e.message };
  }
  say(`=== result: ${result.rootCause ? 'BLOCKED (' + result.rootCause + ')' : 'SESSION OK'} ===`);

  const out = path.resolve(__dirname, '..', 'docs', 'cdp-doctor.log');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, log.join('\n') + '\n', 'utf8');
  console.log(`\nlog: ${out}`);
  process.exitCode = result.rootCause ? 1 : 0;
})();
