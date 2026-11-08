(() => {
  'use strict';

  // The photo easter egg depends on nothing but the DOM, so it must be wired before
  // any animation-library check. It stays inert until the button is actually used.
  const setupEgg = () => {
    try {
      const trigger = document.querySelector('.egg-trigger');
      const panel = document.getElementById('egg-panel');
      if (!trigger || !panel) return;
      trigger.hidden = false;
      const closer = panel.querySelector('.egg-close');
      const open = () => {
        if (typeof panel.showModal === 'function') panel.showModal();
        else panel.setAttribute('open', '');
        trigger.setAttribute('aria-expanded', 'true');
        if (closer) closer.focus();
      };
      const close = () => {
        if (panel.open && typeof panel.close === 'function') panel.close();
        else panel.removeAttribute('open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus({ preventScroll: true });
      };
      trigger.addEventListener('click', open);
      if (closer) closer.addEventListener('click', close);
      panel.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
      panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    } catch {
      // The button stays hidden when the dialog cannot be wired; the page stays usable.
    }
  };
  setupEgg();
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  let lastProgress = null;
  let initialized = false;
  let rebuilding = false;
  let readingLayout = false;
  let readingIndex = null;
  // GSAP reverts tweens before invoking context cleanup; preserve progress before that reset.
  gsap.addEventListener('matchMediaInit', () => { rebuilding = true; });
  gsap.addEventListener('matchMedia', () => { rebuilding = false; });

  try {
    media.add({
      // The horizontal journey needs a wide, tall-enough viewport. It matches the
      // 780px CSS breakpoint exactly, so layout and motion never disagree.
      immersive: '(min-width: 781px) and (min-height: 620px)',
      desktop: '(min-width: 781px)',
      mobile: '(max-width: 780px)',
      pointer: '(hover: hover) and (pointer: fine)',
      roomy: '(min-height: 620px)',
      reduced: '(prefers-reduced-motion: reduce)'
    }, (context) => {
      const { mobile, pointer, reduced, immersive } = context.conditions;
      if (reduced || !immersive) {
        readingLayout = true;
        readingIndex = null;
        const sections = [...document.querySelectorAll('.scene')];
        // Leaving the horizontal journey resets the document scroll to the top. Put the
        // reader back on the chapter they were viewing so switching to a phone layout
        // and back does not silently restart the page.
        if (lastProgress !== null) {
          const index = Math.round(lastProgress * (sections.length - 1));
          readingIndex = index;
          window.scrollTo(0, window.scrollY + sections[index].getBoundingClientRect().top);
        }
        const rememberReading = () => {
          if (rebuilding) return;
          readingIndex = sections.reduce((best, scene, index) => Math.abs(scene.getBoundingClientRect().top) < Math.abs(sections[best].getBoundingClientRect().top) ? index : best, 0);
        };
        window.addEventListener('scroll', rememberReading, { passive: true });
        return () => window.removeEventListener('scroll', rememberReading);
      }
      let resumeProgress = lastProgress;

      const root = document.documentElement;
      const viewport = document.querySelector('.viewport');
      const scenes = [...document.querySelectorAll('.scene')];
      if (readingLayout && readingIndex !== null) {
        resumeProgress = readingIndex / (scenes.length - 1);
        initialized = true;
      }
      readingLayout = false;
      const links = [...document.querySelectorAll('a[href^="#"]')];
      const chapterLinks = [...document.querySelectorAll('.chapter-nav a')];
      const headerLinks = [...document.querySelectorAll('.site-header nav a')];
      const count = document.querySelector('.chapter-count');
      const caption = document.querySelector('.chapter-name');
      const names = ['你好，世界。', '把好奇写成代码。', '人机交互 × 情感计算', 'Paper Highlights', 'Code Visualier', 'IELTS Graded Vocab', '继续保持好奇。'];
      // Warm white opens; the three project chapters and the outro ride into charcoal.
      const colors = ['#F1EDE5', '#F1EDE5', '#EDE7DC', '#1C1B19', '#1C1B19', '#1C1B19', '#1C1B19'];
      const darkFrom = 3;
      const cleanup = [];
      let active = -1;
      let navigation;
      let camera;
      root.classList.add('is-immersive');

      const listen = (target, event, handler, options) => {
        target.addEventListener(event, handler, options);
        cleanup.push(() => target.removeEventListener(event, handler, options));
      };

      const ambient = gsap.timeline({ repeat: -1, yoyo: true })
        .to('.field-mark', { rotation: 40, y: -10, duration: 5.2, ease: 'sine.inOut' }, 0);
      const decorations = [ambient];

      const syncAmbient = () => {
        decorations.forEach(animation => document.hidden ? animation.pause() : animation.resume());
      };
      listen(document, 'visibilitychange', syncAmbient);

      const updateChapter = (progress) => {
        if (!rebuilding) lastProgress = progress;
        const index = Math.round(progress * (scenes.length - 1));
        if (index === active) return;
        active = index;
        root.classList.toggle('is-dark', index >= darkFrom);
        count.textContent = `${String(index + 1).padStart(2, '0')} / 07`;
        caption.textContent = names[index];
        chapterLinks.forEach((link, i) => i === index ? link.setAttribute('aria-current', 'step') : link.removeAttribute('aria-current'));
        headerLinks.forEach(link => {
          const target = link.getAttribute('href');
          const selected = target === '#about' ? index === 1 : target === '#feel' ? index === 2 : target === '#work' ? index >= 3 && index <= 5 : index === 6;
          selected ? link.setAttribute('aria-current', 'true') : link.removeAttribute('aria-current');
        });
        syncAmbient();
      };

      // The viewport stays in place; only its children travel through the shared space.
      camera = gsap.timeline({
        defaults: { ease: 'none' },
        onUpdate: () => updateChapter(camera.progress()),
        scrollTrigger: {
          trigger: '.journey', pin: viewport, start: 'top top',
          end: () => `+=${Math.max(window.innerHeight * 1.12, 660) * (scenes.length - 1)}`,
          scrub: 0.85, invalidateOnRefresh: true, anticipatePin: 1,
          onRefresh: () => { if (camera) updateChapter(camera.progress()); }
        }
      });
      const travel = () => window.innerWidth * (scenes.length - 1);
      camera.to('.rail', { x: () => -travel(), duration: scenes.length - 1 }, 0)
        .to('.seam', { x: () => -travel(), duration: scenes.length - 1 }, 0)
        .to('.journey-progress i', { scaleX: 1, duration: scenes.length - 1 }, 0)
        .to('.field-rule', { x: () => window.innerWidth * 6, duration: scenes.length - 1 }, 0);

      scenes.forEach((scene, index) => {
        if (!index) return;
        camera.to('.viewport', { backgroundColor: colors[index], duration: 1 }, index - 1)
          .fromTo(scene.querySelector('.scene-inner'), { x: mobile ? 20 : 60, y: 30 }, { x: 0, y: 0, duration: 0.8, ease: 'power2.out' }, index - 0.8);
        const art = scene.querySelector('.project-art');
        if (art) camera.fromTo(art, { y: 70, rotation: 4, scale: 0.95 }, { y: 0, rotation: 0, scale: 1, duration: 1, ease: 'power2.out' }, index - 1);
      });

      // The portrait enters with the hero and drifts on scroll, slower than the type.
      const portrait = document.querySelector('.portrait-figure');
      if (portrait && !mobile) {
        camera.fromTo(portrait, { y: 46, scale: 1.04 }, { y: 0, scale: 1, duration: 1, ease: 'power2.out' }, 0)
          .to(portrait, { y: -34, duration: 1.2, ease: 'none' }, 0.2);
      }
      // Every extra tween must finish inside 0 .. scenes.length-1, otherwise the
      // timeline grows and the rail overshoots its position for the chapter.
      camera.fromTo('.aside-big', { y: 40, opacity: 0.4 }, { y: 0, opacity: 1, duration: 0.9, ease: 'power2.out' }, 0.1)
        .to('.feel-symbol', { y: -40, rotation: 8, duration: 1.4, ease: 'none' }, 1.1)
        .to('.outro-word', { y: -30, duration: 1.4, ease: 'none' }, 4.6);

      if (pointer) {
        const setters = [];
        const quick = (target, property, duration = 0.85) => {
          const setter = gsap.quickTo(target, property, { duration, ease: 'power3.out' });
          setters.push(setter);
          return setter;
        };
        // Each entry names the axis of pointer input that drives it, so vertical mouse
        // movement produces vertical parallax instead of repeating the horizontal one.
        const makeSetter = (selector, property, axis, strength, duration) => {
          const node = document.querySelector(selector);
          return node ? { set: quick(node, property, duration), axis, strength } : null;
        };
        // Scroll animates .portrait-figure; the pointer moves .portrait-inner. Two
        // different elements, so no single transform property has two writers.
        const parallax = [
          makeSetter('.portrait-inner', 'x', 'x', -16, 1.3),
          makeSetter('.portrait-inner', 'y', 'y', -12, 1.3),
          makeSetter('.field-mark', 'x', 'x', -26, 1.5),
          makeSetter('.field-mark', 'y', 'y', -20, 1.5),
          makeSetter('.outro-word', 'x', 'x', -18, 1.5)
        ].filter(Boolean);
        listen(viewport, 'pointermove', event => {
          const x = event.clientX / window.innerWidth - 0.5;
          const y = event.clientY / window.innerHeight - 0.5;
          parallax.forEach(({ set, axis, strength }) => set((axis === 'y' ? y : x) * strength));
        }, { passive: true });
        listen(viewport, 'pointerleave', () => parallax.forEach(({ set }) => set(0)));

        // Magnetic pull on primary links, without stealing the click target's layout.
        document.querySelectorAll('.magnet').forEach(link => {
          const mx = quick(link, 'x', 0.5);
          const my = quick(link, 'y', 0.5);
          listen(link, 'pointermove', event => {
            const rect = link.getBoundingClientRect();
            mx((event.clientX - rect.left - rect.width / 2) * 0.22);
            my((event.clientY - rect.top - rect.height / 2) * 0.28);
          }, { passive: true });
          listen(link, 'pointerleave', () => { mx(0); my(0); });
        });

        document.querySelectorAll('.project-art').forEach(art => {
          const tilt = art.querySelector('.project-tilt');
          if (!tilt) return;
          const tiltX = quick(tilt, 'rotationX', 0.65);
          const tiltY = quick(tilt, 'rotationY', 0.65);
          let rect;
          listen(art, 'pointerenter', () => { rect = art.getBoundingClientRect(); });
          listen(art, 'pointermove', event => {
            if (!rect) return;
            tiltX(-((event.clientY - rect.top) / rect.height - 0.5) * 11);
            tiltY(((event.clientX - rect.left) / rect.width - 0.5) * 15);
          }, { passive: true });
          listen(art, 'pointerleave', () => { tiltX(0); tiltY(0); });
        });
        cleanup.push(() => setters.forEach(setter => setter.tween.kill()));
      }

      const cancelNavigation = () => { if (navigation) navigation.kill(); };
      const navigate = (index, focus, immediate = false) => {
        cancelNavigation();
        const trigger = camera.scrollTrigger;
        const position = trigger.start + index / (scenes.length - 1) * (trigger.end - trigger.start);
        navigation = gsap.to(document.scrollingElement, {
          scrollTop: position, duration: immediate ? 0 : 1.15, ease: 'power3.inOut', overwrite: 'auto',
          onComplete: () => {
            if (immediate) {
              ScrollTrigger.update();
              camera.progress(trigger.progress);
              updateChapter(camera.progress());
            }
            if (focus) scenes[index].focus({ preventScroll: true });
          }
        });
      };
      links.forEach(link => {
        const target = link.getAttribute('href').slice(1);
        const index = target === 'main' ? 0 : scenes.findIndex(scene => scene.id === target);
        if (index < 0) return;
        listen(link, 'click', event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          history.replaceState(null, '', `#${scenes[index].id}`);
          navigate(index, true);
        });
      });
      listen(window, 'wheel', cancelNavigation, { passive: true });
      listen(window, 'touchstart', cancelNavigation, { passive: true });
      listen(window, 'keydown', event => {
        if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) cancelNavigation();
      });
      listen(viewport, 'focusin', event => {
        const scene = event.target.closest('.scene');
        if (!scene) return;
        const index = scenes.indexOf(scene);
        viewport.scrollLeft = 0;
        if (event.target !== scene) navigate(index, false);
      });

      // Fragment jumps and browser focus must not create a second horizontal scroller.
      listen(viewport, 'scroll', () => {
        if (viewport.scrollLeft) viewport.scrollLeft = 0;
      }, { passive: true });
      const followHash = () => {
        const index = scenes.findIndex(scene => `#${scene.id}` === location.hash);
        if (index >= 0) navigate(index, true);
      };
      listen(window, 'hashchange', followHash);

      ScrollTrigger.refresh();
      updateChapter(camera.progress());
      if (!initialized) {
        initialized = true;
        const initialIndex = scenes.findIndex(scene => `#${scene.id}` === location.hash);
        if (initialIndex >= 0) navigate(initialIndex, false, true);
      } else if (resumeProgress !== null) {
        navigate(resumeProgress * (scenes.length - 1), false, true);
      }
      return () => {
        cancelNavigation();
        cleanup.forEach(remove => remove());
        root.classList.remove('is-immersive', 'is-dark');
        [...chapterLinks, ...headerLinks].forEach(link => link.removeAttribute('aria-current'));
        count.textContent = '01 / 07'; caption.textContent = names[0];
      };
    });
  } catch (error) {
    media.revert();
    document.documentElement.classList.remove('is-immersive', 'is-dark');
    console.warn('Motion enhancement unavailable; the page remains readable.', error);
  }
})();
