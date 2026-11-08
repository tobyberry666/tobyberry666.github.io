const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// The photo easter egg is plain DOM and is wired before any library check, so a page
// run always touches the document. A document without the egg nodes must be harmless.
const silentDocument = () => ({
  querySelector: () => null,
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {}
});

test('missing animation libraries still leave a readable document and wire nothing animated', () => {
  for (const libraries of [{}, { gsap: {} }, { ScrollTrigger: {} }]) {
    let animationCalls = 0;
    const gsap = libraries.gsap && {
      registerPlugin() { animationCalls++; },
      matchMedia() { animationCalls++; throw new Error('No animation may start without both libraries'); }
    };
    assert.doesNotThrow(() => vm.runInNewContext(source, {
      window: { ...libraries, gsap }, document: silentDocument()
    }));
    assert.equal(animationCalls, 0, 'Without both libraries nothing may animate or register');
  }
});

test('reduced motion skips animation creation and pointer listeners', () => {
  let registered = 0;
  let preferenceChecked = 0;
  const unexpected = () => { throw new Error('Reduced motion must not start animations'); };
  const ScrollTrigger = {};
  const gsap = {
    registerPlugin(plugin) { assert.equal(plugin, ScrollTrigger); registered++; },
    addEventListener() {},
    matchMedia() {
      return {
        add(conditions, callback) {
          assert.equal(conditions.reduced, '(prefers-reduced-motion: reduce)');
          preferenceChecked++;
          callback({ conditions: { desktop: true, mobile: false, pointer: true, reduced: true, immersive: true } });
        },
        revert: unexpected
      };
    },
    timeline: unexpected, quickTo: unexpected, fromTo: unexpected
  };
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    window: { gsap, ScrollTrigger, addEventListener() {} }, gsap, ScrollTrigger,
    document: silentDocument(), console: { warn: unexpected }
  }));
  assert.equal(registered, 1);
  assert.equal(preferenceChecked, 1);
});

test('narrow and short viewports keep the document readable without pinning', () => {
  for (const conditions of [
    { mobile: false, immersive: false },   // short desktop
    { mobile: true, immersive: false }     // phone
  ]) {
    let checked = false;
    const unexpected = () => { throw new Error('Without an immersive viewport nothing may animate'); };
    const gsap = {
      registerPlugin() {}, addEventListener() {},
      matchMedia() {
        return {
          add(declared, callback) {
            // The journey may only run when the viewport is both wide and tall enough.
            assert.equal(declared.immersive, '(min-width: 781px) and (min-height: 620px)');
            checked = true;
            callback({ conditions: { pointer: true, reduced: false, ...conditions } });
          },
          revert: unexpected
        };
      },
      timeline: unexpected, to: unexpected, quickTo: unexpected
    };
    const ScrollTrigger = {};
    assert.doesNotThrow(() => vm.runInNewContext(source, {
      window: { gsap, ScrollTrigger, addEventListener() {} }, gsap, ScrollTrigger,
      document: silentDocument(), console: { warn: unexpected }
    }));
    assert.equal(checked, true);
  }
});
