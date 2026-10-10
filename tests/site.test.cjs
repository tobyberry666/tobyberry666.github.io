const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1], m[2]]));
const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => attributes(m[0]));

test('page title uses only the public identity', () => {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.ok(/^Toby\s*[—|·-]\s*(代码与感受|Code & Feeling)$/.test(title || ''), 'Use the approved anonymous page title');
});

test('page contains no private contact links or identifying biography labels', () => {
  assert.ok(!/(?:mailto:|tel:|tencent:|wpa\.qq\.com)/i.test(html), 'Private contact links must be absent');
  assert.ok(!/(?:真实姓名|学号|班级|学院|大学|实验室|辅导员|联系电话|电子邮箱|QQ号码|专业排名|班长|学生会)/.test(html), 'Identifying biography labels must be absent');
  assert.ok(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html), 'Email addresses must be absent');
  assert.ok(!/(?:data:image|<img\b)/i.test(html), 'Portraits and embedded image material must be absent');
});

test('all local assets resolve inside the site and runtime assets stay local', () => {
  const refs = [...html.matchAll(/<(?:script|link|img|source)\b[^>]*>/g)]
    .map((m) => attributes(m[0])).map((a) => a.src || a.href).filter(Boolean);
  const cssPath = path.join(root, 'styles.css');
  if (fs.existsSync(cssPath)) {
    refs.push(...[...fs.readFileSync(cssPath, 'utf8').matchAll(/url\(["']?([^\s)'";]+)/g)].map((m) => m[1]));
  }
  assert.ok(refs.length > 0, 'Site should reference its local assets');
  for (const ref of refs) {
    assert.ok(!/^(?:https?:|\/\/|data:|\/)/i.test(ref), 'Runtime assets must use local relative paths');
    const resolved = path.resolve(root, decodeURIComponent(ref.split(/[?#]/)[0]));
    assert.ok(resolved.startsWith(root + path.sep), 'Asset must stay inside site');
    assert.ok(fs.existsSync(resolved), `Missing local asset: ${ref}`);
  }
});

test('navigation fragments resolve to unique section IDs', () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  const fragments = anchors.filter((a) => a.href?.startsWith('#'));
  assert.ok(fragments.length >= 3, 'Provide usable in-page navigation');
  for (const a of fragments) assert.ok(ids.includes(a.href.slice(1)), 'Navigation fragment needs a real target');
});

test('selected projects and GitHub destination have real, safe links', () => {
  for (const suffix of ['paper-highlighter', 'code-visualier', 'ielts-graded-vocab', '']) {
    const url = 'https://github.com/tobyberry666' + (suffix ? '/' + suffix : '');
    assert.ok(anchors.some((a) => a.href === url), `Missing required GitHub destination: ${suffix || 'profile'}`);
  }
  assert.ok(anchors.some((a) => a.href === 'https://tobyberry666.github.io/ielts-graded-vocab/'), 'Vocabulary demo must be linked');
  for (const a of anchors.filter((a) => a.target === '_blank')) {
    assert.ok(a.rel?.split(/\s+/).includes('noopener') && a.rel?.split(/\s+/).includes('noreferrer'), 'New tabs require safe rel tokens');
  }
});

test('content has one primary heading and schematic project illustrations', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'Exactly one primary heading');
  assert.ok(/情感计算/.test(html), 'State the approved research direction');
  assert.ok(/示意/.test(html), 'Identify schematic illustrations');
  assert.ok(!/\b(?:onclick|onmousemove|onwheel)=/.test(html), 'Keep event handlers in the local script');
});

test('the approved scholarship is preserved without dates or institutional attribution', () => {
  const note = html.match(/<p class="scholarship-note">([^<]+)<\/p>/)?.[1];
  assert.equal(note, '曾获校级二等奖学金');
});

test('project names retain word spacing when mobile hides decorative line breaks', () => {
  for (const [id, expected] of [['paper-title', 'Paper Highlights'], ['code-title', 'Code Visualier'], ['vocab-title', 'IELTS Graded Vocab']]) {
    const heading = html.match(new RegExp(`<h3 id="${id}">([\\s\\S]*?)<\\/h3>`))?.[1];
    const text = heading?.replace(/<span[^>]*>[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    assert.equal(text, expected, 'Names need real text spacing independent of visual line breaks');
  }
});

test('each journey chapter is labelled and reachable through a real anchor', () => {
  const chapters = ['home', 'about', 'feel', 'work', 'code', 'vocab', 'connect'];
  for (const id of chapters) {
    const tag = [...html.matchAll(/<(?:section|article|footer)\b[^>]*>/g)].map(m => attributes(m[0])).find(a => a.id === id);
    assert.ok(tag?.['aria-labelledby'], `Chapter ${id} needs a heading`);
    assert.ok(anchors.some(a => a.href === '#' + id), `Chapter ${id} must be reachable without animation`);
  }
});
