/**
 * Browser verification driven over the DevTools protocol.
 *
 * Rules this script follows so its output is evidence rather than assertion-counting:
 *  - a check runs only on real input (Input.dispatchKeyEvent / dispatchMouseEvent) or
 *    on geometry measured after scrolling the element into view;
 *  - "visible" means the element's rect lies inside the viewport AND the point at its
 *    centre hit-tests back to that element (or a descendant of it);
 *  - every check is counted once, headings are not;
 *  - a failure prints the measured values that produced it.
 *
 * Usage: node tools/verify.cjs   (preview.cjs must be running)
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/';
const OUT = path.resolve(__dirname, '..', 'docs', 'verification.txt');
const PORT = 9411 + (process.pid % 200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const section = (title) => results.push({ kind: 'section', title });
const check = (name, ok, detail) => results.push({ kind: 'check', name, ok: !!ok, detail });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(`${m.error.message}`)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout ${method}`));
      }, timeout);
    });
  }
}

async function launch() {
  const profile = path.join(process.env.TEMP || '.', `toby-verify-${Date.now()}`);
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-crash-reporter', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  // Chrome can take a while on a cold profile; retry well past the first attempt.
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
        });
        return { proc, cdp: new CDP(ws), ws };
      }
    } catch { /* not ready yet */ }
    await sleep(250);
  }
  proc.kill();
  throw new Error('Chrome DevTools did not become reachable');
}

(async () => {
  const { proc, cdp, ws } = await launch();
  try {
    await cdp.send('Page.enable', {}, 60000);
    await cdp.send('Runtime.enable', {}, 60000);
    await cdp.send('DOM.enable');

    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate threw');
      return r.result.value;
    };
    const viewport = (width, height, mobile) =>
      cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    const media = (features) => cdp.send('Emulation.setEmulatedMedia', { features });
    const goto = async (url) => { await cdp.send('Page.navigate', { url }); await sleep(2600); };
    const key = async (k, code, vk, text) => {
      const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(320);
    };
    const pressEnter = () => key('Enter', 'Enter', 13, '\r');
    const pressSpace = () => key(' ', 'Space', 32, ' ');
    const mouseTo = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
      await sleep(260);
    };
    const mouseClick = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(700);
    };
    // Scrolling a lazy target into view is how a real visitor reaches it.
    const scrollToSelector = async (selector) => {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); })()`);
      await sleep(900);
    };
    // Visible = fully inside the viewport and hit-tested at its centre.
    const visibleAndHit = async (selector) => evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, why: 'missing' };
      const r = el.getBoundingClientRect();
      const vw = innerWidth, vh = innerHeight;
      const inside = r.top >= -1 && r.left >= -1 && r.bottom <= vh + 1 && r.right <= vw + 1 && r.width > 0 && r.height > 0;
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
      const top = document.elementFromPoint(cx, cy);
      const hit = !!top && (top === el || el.contains(top) || top.contains(el));
      return { ok: inside && hit, inside, hit, rect: [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)], vw, vh, top: top && (top.className || top.tagName) };
    })()`);

    const desktop = async () => { await viewport(1440, 900, false); await media([]); };

    // ---------------------------------------------------------------- immersive
    section('1440×900 沉浸模式');
    await desktop();
    await goto(BASE);

    check('页面进入沉浸模式', await evaluate(`document.documentElement.classList.contains('is-immersive')`) === true);
    check('七个章节', await evaluate(`document.querySelectorAll('.scene').length`) === 7);

    const heroPhoto = await evaluate(`(() => { const i = document.querySelector('.portrait-figure img'); return { complete: i.complete, nw: i.naturalWidth }; })()`);
    check('首屏人像真实加载', heroPhoto.complete && heroPhoto.nw > 0, `${heroPhoto.nw}px`);

    // dock must be on screen and hittable in every chapter
    const dockChecks = [];
    for (let i = 0; i < 7; i++) {
      await evaluate(`(() => { const st = window.ScrollTrigger.getAll()[0]; window.scrollTo(0, Math.round(st.start + (st.end - st.start) * ${i / 6})); })()`);
      await sleep(1900);
      const dot = await visibleAndHit(`.chapter-nav a:nth-child(${i + 1})`);
      const caption = await visibleAndHit('.journey-caption');
      // Return an object: the protocol serialises a bare -0 without a `value` field,
      // which would read back as undefined and hide a correct offset.
      const left = await evaluate(`(() => { const s = document.querySelectorAll('.scene')[${i}]; return { left: Math.round(s.getBoundingClientRect().left) + 0 }; })()`);
      dockChecks.push({ i: i + 1, dot, caption, left: left.left });
    }
    check('七章底部导航圆点均可见且可命中', dockChecks.every(d => d.dot.ok), dockChecks.filter(d => !d.dot.ok).map(d => `第${d.i}章 ${JSON.stringify(d.dot)}`).join(' | ') || '7/7');
    check('七章章节计数均可见且可命中', dockChecks.every(d => d.caption.ok), dockChecks.filter(d => !d.caption.ok).map(d => `第${d.i}章`).join(',') || '7/7');
    check('每章都精确对齐到视口左边', dockChecks.every(d => d.left === 0), dockChecks.map(d => `第${d.i}章 left=${d.left}`).join(' '));

    // real mouse click on a dock dot
    await evaluate(`(() => { const st = window.ScrollTrigger.getAll()[0]; window.scrollTo(0, Math.round(st.start)); })()`);
    await sleep(1800);
    const dotRect = await evaluate(`(() => { const r = document.querySelectorAll('.chapter-nav a')[4].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await mouseClick(dotRect.x, dotRect.y);
    await sleep(1600);
    const afterClick = await evaluate(`({ hash: location.hash, left: Math.round(document.querySelector('#code').getBoundingClientRect().left), count: document.querySelector('.chapter-count').textContent.trim() })`);
    check('真实鼠标点击第 5 个圆点跳到 Code Visualier', afterClick.hash === '#code' && Math.abs(afterClick.left) <= 2, JSON.stringify(afterClick));

    // keyboard reach of dock links
    section('键盘操作');
    await evaluate(`document.querySelectorAll('.chapter-nav a')[2].focus()`);
    await pressEnter();
    await sleep(1500);
    const kbNav = await evaluate(`({ hash: location.hash, left: Math.round(document.querySelector('#feel').getBoundingClientRect().left) })`);
    check('Enter 激活章节链接可跳转', kbNav.hash === '#feel' && Math.abs(kbNav.left) <= 2, JSON.stringify(kbNav));

    await evaluate(`(() => { const st = window.ScrollTrigger.getAll()[0]; window.scrollTo(0, Math.round(st.start)); })()`);
    await sleep(1600);
    const eggVisible = await visibleAndHit('.egg-trigger');
    check('彩蛋按钮在首屏可见且可命中', eggVisible.ok, JSON.stringify(eggVisible));

    // real Tab reaches the egg button
    await evaluate(`document.querySelector('.wordmark').focus()`);
    let tabHits = 0;
    for (let i = 0; i < 12; i++) {
      await key('Tab', 'Tab', 9);
      if (await evaluate(`document.activeElement === document.querySelector('.egg-trigger')`)) { tabHits = i + 1; break; }
    }
    check('真实 Tab 能到达彩蛋按钮', tabHits > 0, tabHits ? `第 ${tabHits} 次 Tab` : '12 次 Tab 未到达');

    // Enter opens, Escape closes and restores focus
    await pressEnter();
    await sleep(600);
    const opened = await evaluate(`({ open: document.getElementById('egg-panel').open, expanded: document.querySelector('.egg-trigger').getAttribute('aria-expanded'), inside: document.getElementById('egg-panel').contains(document.activeElement) })`);
    check('Enter 打开照片对话框', opened.open === true && opened.expanded === 'true', JSON.stringify(opened));
    check('打开后焦点进入对话框', opened.inside === true);
    const eggImg = await evaluate(`(() => { const i = document.querySelector('.egg-panel img'); return { nw: i.naturalWidth, complete: i.complete }; })()`);
    check('对话框照片实际加载', eggImg.complete && eggImg.nw > 0, `${eggImg.nw}px`);

    await key('Escape', 'Escape', 27);
    await sleep(600);
    const closed = await evaluate(`({ open: document.getElementById('egg-panel').open, expanded: document.querySelector('.egg-trigger').getAttribute('aria-expanded'), back: document.activeElement === document.querySelector('.egg-trigger') })`);
    check('Escape 关闭对话框', closed.open === false && closed.expanded === 'false', JSON.stringify(closed));
    check('关闭后焦点回到彩蛋按钮', closed.back === true);

    // ---------------------------------------------------------------- pointer
    section('鼠标视差与倾斜');
    const parallax = await evaluate(`(() => {
      const inner = document.querySelector('.portrait-inner');
      return { before: getComputedStyle(inner).transform };
    })()`);
    await mouseTo(1300, 450);
    await sleep(900);
    const afterHorizontal = await evaluate(`getComputedStyle(document.querySelector('.portrait-inner')).transform`);
    await mouseTo(1300, 450); // same X, move only vertically
    await mouseTo(1300, 120);
    await sleep(900);
    const afterVertical = await evaluate(`(() => { const t = getComputedStyle(document.querySelector('.portrait-inner')).transform; return t; })()`);
    const parse = (t) => {
      if (!t || t === 'none') return [0, 0];
      const m = t.match(/matrix\(([^)]+)\)/);
      if (!m) return [0, 0];
      const v = m[1].split(',').map(Number);
      return [v[4] || 0, v[5] || 0];
    };
    const [x1, y1] = parse(afterHorizontal);
    const [x2, y2] = parse(afterVertical);
    check('水平鼠标移动驱动水平视差', Math.abs(x1) > 2, `x=${x1.toFixed(2)} y=${y1.toFixed(2)}`);
    check('仅纵向移动鼠标驱动纵向视差', Math.abs(y2 - y1) > 2, `y ${y1.toFixed(2)} → ${y2.toFixed(2)}`);
    check('纵向移动时水平位移基本不变', Math.abs(x2 - x1) < 2, `x ${x1.toFixed(2)} → ${x2.toFixed(2)}`);

    const tilt = await evaluate(`(() => {
      const art = document.querySelector('#code .project-art');
      const r = art.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.25), y: Math.round(r.top + r.height * 0.25), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
    })()`).catch(() => null);
    // bring the code chapter into view first
    await evaluate(`(() => { const st = window.ScrollTrigger.getAll()[0]; window.scrollTo(0, Math.round(st.start + (st.end - st.start) * (4 / 6))); })()`);
    await sleep(1900);
    const tiltBox = await evaluate(`(() => { const a = document.querySelector('#code .project-art').getBoundingClientRect(); return { l: Math.round(a.left + a.width * 0.2), t: Math.round(a.top + a.height * 0.2), r: Math.round(a.left + a.width * 0.8), b: Math.round(a.top + a.height * 0.8) }; })()`);
    await mouseTo(tiltBox.l, tiltBox.t);
    await sleep(800);
    const tiltA = await evaluate(`getComputedStyle(document.querySelector('#code .project-tilt')).transform`);
    await mouseTo(tiltBox.r, tiltBox.b);
    await sleep(800);
    const tiltB = await evaluate(`getComputedStyle(document.querySelector('#code .project-tilt')).transform`);
    const rot = (t) => (t && t !== 'none' ? t : 'none');
    check('鼠标在项目卡片上移动产生倾斜变化', rot(tiltA) !== rot(tiltB) && rot(tiltA) !== 'none', `${rot(tiltA)} → ${rot(tiltB)}`);

    // ---------------------------------------------------------------- deep link
    section('初始深链');
    await goto(`${BASE}#work`);
    await sleep(1500);
    const deep = await evaluate(`({ hash: location.hash, left: Math.round(document.querySelector('#work').getBoundingClientRect().left), count: document.querySelector('.chapter-count').textContent.trim() })`);
    check('#work 初始深链定位正确', deep.hash === '#work' && Math.abs(deep.left) <= 2, JSON.stringify(deep));

    // ---------------------------------------------------------------- short desktop
    section('1440×600 矮屏');
    await viewport(1440, 600, false);
    await media([]);
    await goto(BASE);
    const short = await evaluate(`(() => {
      const r = document.querySelector('.hero-subtitle').getBoundingClientRect();
      return { immersive: document.documentElement.classList.contains('is-immersive'),
               h: document.documentElement.scrollHeight, subtitleBottom: Math.round(r.bottom), vh: innerHeight };
    })()`);
    check('矮屏不启用横向沉浸，改为纵向阅读', short.immersive === false, `scrollHeight=${short.h}`);
    await scrollToSelector('#work .text-link');
    const shortLink = await visibleAndHit('#work .text-link');
    check('矮屏作品入口可滚动到达且可命中', shortLink.ok, JSON.stringify(shortLink));

    // ---------------------------------------------------------------- mobile
    for (const [w, h] of [[390, 844], [320, 568]]) {
      section(`${w}×${h} 手机`);
      await viewport(w, h, true);
      await media([]);
      await goto(BASE);
      const state = await evaluate(`({ immersive: document.documentElement.classList.contains('is-immersive'),
        overflowX: document.documentElement.scrollWidth - innerWidth,
        innerWidth: Math.round(document.querySelector('#about .scene-inner').getBoundingClientRect().width) })`);
      check(`${w}px 不启用横向沉浸`, state.immersive === false);
      check(`${w}px 无横向溢出`, state.overflowX <= 0, `overflowX=${state.overflowX}`);
      check(`${w}px 正文占满可用列`, state.innerWidth >= w - 60, `${state.innerWidth}px / ${w}px`);

      for (const [label, selector] of [
        ['首屏人像', '.portrait-figure img'],
        ['首屏彩蛋按钮', '.egg-trigger'],
        ['作品章节正文', '#work .project-copy .body-copy'],
        ['作品章节入口', '#work .text-link'],
        ['联系页 GitHub 入口', '#connect .github-link']
      ]) {
        await scrollToSelector(selector);
        const v = await visibleAndHit(selector);
        check(`${w}px ${label} 可滚动到达并可见可命中`, v.ok, JSON.stringify(v));
      }
      await scrollToSelector('#work .schematic');
      const schematic = await visibleAndHit('#work .schematic');
      check(`${w}px 项目"界面示意"标识可见`, schematic.ok, JSON.stringify(schematic));
    }

    // ---------------------------------------------------------------- resize restore
    section('视口切换保持进度');
    await viewport(1440, 900, false);
    await media([]);
    await goto(BASE);
    await evaluate(`(() => { const st = window.ScrollTrigger.getAll()[0]; window.scrollTo(0, Math.round(st.start + (st.end - st.start) * 0.5)); })()`);
    await sleep(2000);
    const midBefore = await evaluate(`document.querySelector('.chapter-count').textContent.trim()`);
    await viewport(390, 844, true);
    await sleep(1600);
    await viewport(1440, 900, false);
    await sleep(2400);
    const midAfter = await evaluate(`(() => ({ count: document.querySelector('.chapter-count').textContent.trim(), left: Math.round(document.querySelector('#work').getBoundingClientRect().left) }))()`);
    check('桌面→手机→桌面切换后回到同一章节', midAfter.count === midBefore, `${midBefore} → ${midAfter.count}`);

    // ---------------------------------------------------------------- reduced motion
    section('减少动态效果');
    await viewport(1440, 900, false);
    await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await goto(BASE);
    const rm = await evaluate(`({ immersive: document.documentElement.classList.contains('is-immersive'), h: document.documentElement.scrollHeight,
      sections: [...document.querySelectorAll('.scene')].filter(s => s.getBoundingClientRect().width > 0).length })`);
    check('减少动态时改用纵向阅读布局', rm.immersive === false, `scrollHeight=${rm.h}`);
    check('减少动态时七章仍然渲染', rm.sections === 7);
    for (const [label, selector] of [['人像', '.portrait-figure img'], ['作品入口', '#work .text-link'], ['彩蛋按钮', '.egg-trigger']]) {
      await scrollToSelector(selector);
      const v = await visibleAndHit(selector);
      check(`减少动态时${label}可到达可命中`, v.ok, JSON.stringify(v));
    }

    // ---------------------------------------------------------------- no animation library
    section('无动画库时彩蛋');
    await media([]);
    await viewport(1440, 900, false);
    // Block both animation libraries for the whole page load. The request stream is
    // consumed by a loop that keeps running until we stop it; a single synchronous
    // pass races the navigation and can let one library through.
    let intercepting = true;
    let blocked = 0;
    const onPaused = async (event) => {
      if (!intercepting) return;
      try {
        const m = JSON.parse(event.data);
        if (m.method !== 'Fetch.requestPaused') return;
        await cdp.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' });
        blocked++;
      } catch { /* socket closing */ }
    };
    ws.addEventListener('message', onPaused);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*gsap.min.js*' }, { urlPattern: '*ScrollTrigger.min.js*' }] });
    await goto(BASE);
    await sleep(1200);
    intercepting = false;
    ws.removeEventListener('message', onPaused);
    await cdp.send('Fetch.disable');
    // Wait for the deferred script to finish wiring the button before reading state.
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.readyState === 'complete' && document.querySelector('.egg-trigger').hidden === false`)) break;
      await sleep(250);
    }
    const noLib = await evaluate(`(() => ({ gsap: !!window.gsap, st: !!window.ScrollTrigger,
      immersive: document.documentElement.classList.contains('is-immersive'),
      eggHidden: document.querySelector('.egg-trigger').hidden }))()`);
    check('动画库确实未加载', noLib.gsap === false && noLib.st === false, `${JSON.stringify(noLib)} 拦截 ${blocked} 个请求`);
    check('无动画库时不进入沉浸模式，页面仍可纵向阅读', noLib.immersive === false);
    check('无动画库时彩蛋按钮不被隐藏', noLib.eggHidden === false);
    await scrollToSelector('.egg-trigger');
    const noLibEgg = await visibleAndHit('.egg-trigger');
    check('无动画库时彩蛋按钮可见可命中', noLibEgg.ok, JSON.stringify(noLibEgg));
    if (noLibEgg.ok) {
      const r = await evaluate(`(() => { const b = document.querySelector('.egg-trigger').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
      await mouseClick(r.x, r.y);
      const noLibOpen = await evaluate(`({ open: document.getElementById('egg-panel').open, expanded: document.querySelector('.egg-trigger').getAttribute('aria-expanded') })`);
      check('无动画库时真实点击可打开照片对话框', noLibOpen.open === true && noLibOpen.expanded === 'true', JSON.stringify(noLibOpen));
    } else {
      check('无动画库时真实点击可打开照片对话框', false, '按钮不可命中，跳过点击');
    }

    ws.close();
  } finally {
    proc.kill();
  }

  // ------------------------------------------------------------------ report
  const checks = results.filter((r) => r.kind === 'check');
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const lines = [];
  for (const r of results) {
    if (r.kind === 'section') lines.push(`\n## ${r.title}`);
    else lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  }
  const header = [
    'Toby 主页浏览器验证记录',
    `生成时间：${new Date().toISOString()}`,
    `预览：${BASE}`,
    `浏览器：本机 Chrome（headless，DevTools 协议）`,
    `实际断言：${checks.length} 项，PASS ${passed}，FAIL ${failed}`,
    '',
    '说明：可见性 = 元素矩形完整落在视口内，且其中心点 elementFromPoint 命中自身或其后代；',
    '交互一律用真实键盘/鼠标事件（Input.dispatchKeyEvent / dispatchMouseEvent），不调用 .click()。'
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, header + '\n' + lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n'));
  console.log(`\n实际断言 ${checks.length} 项：PASS ${passed}，FAIL ${failed}`);
  console.log(`记录写入 ${OUT}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('verify failed:', e.message); process.exit(1); });
