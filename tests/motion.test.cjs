const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

test('missing animation libraries leave the readable document untouched', () => {
  for (const libraries of [{}, { gsap: {} }, { ScrollTrigger: {} }]) {
    let touched = false;
    const document = new Proxy({}, { get() { touched = true; throw new Error('Unexpected DOM access'); } });
    assert.doesNotThrow(() => vm.runInNewContext(source, { window: libraries, document }));
    assert.equal(touched, false);
  }
});

test('reduced motion skips animation creation and pointer listeners', () => {
  let registered = 0;
  let preferenceChecked = 0;
  const unexpected = () => { throw new Error('Reduced motion must not start animations or access the DOM'); };
  const ScrollTrigger = {};
  const gsap = {
    registerPlugin(plugin) { assert.equal(plugin, ScrollTrigger); registered++; },
    addEventListener() {},
    matchMedia() {
      return {
        add(conditions, callback) {
          assert.equal(conditions.reduced, '(prefers-reduced-motion: reduce)');
          preferenceChecked++;
          callback({ conditions: { desktop: true, pointer: true, reduced: true } });
        },
        revert: unexpected
      };
    },
    timeline: unexpected, quickTo: unexpected, fromTo: unexpected
  };
  const document = new Proxy({}, { get: unexpected });
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    window: { gsap, ScrollTrigger, addEventListener() {} }, gsap, ScrollTrigger, document,
    console: { warn: unexpected }
  }));
  assert.equal(registered, 1);
  assert.equal(preferenceChecked, 1);
});

test('short viewports keep the document readable without pinning or animation', () => {
  let checked = false;
  const unexpected = () => { throw new Error('Short viewports must keep the normal reading layout'); };
  const gsap = {
    registerPlugin() {}, addEventListener() {},
    matchMedia() { return {
      add(conditions, callback) {
        assert.equal(conditions.roomy, '(min-height: 620px), (max-width: 600px) and (min-height: 520px)');
        checked = true;
        callback({ conditions: { mobile: false, pointer: true, reduced: false, roomy: false } });
      }, revert: unexpected
    }; },
    timeline: unexpected, to: unexpected, quickTo: unexpected
  };
  const ScrollTrigger = {};
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    window: { gsap, ScrollTrigger, addEventListener() {} }, gsap, ScrollTrigger,
    document: new Proxy({}, { get: unexpected }), console: { warn: unexpected }
  }));
  assert.equal(checked, true);
});
