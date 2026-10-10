(() => {
  'use strict';
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
      desktop: '(min-width: 601px)',
      mobile: '(max-width: 600px)',
      pointer: '(hover: hover) and (pointer: fine)',
      roomy: '(min-height: 620px), (max-width: 600px) and (min-height: 520px)',
      reduced: '(prefers-reduced-motion: reduce)'
    }, (context) => {
      const { mobile, pointer, reduced, roomy } = context.conditions;
      if (reduced || !roomy) {
        readingLayout = true;
        readingIndex = null;
        const rememberReading = () => {
          if (rebuilding) return;
          const sections = [...document.querySelectorAll('.scene')];
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
        .to('.orb-breathe', { y: 7, scale: 1.025, duration: 3.6, ease: 'sine.inOut' }, 0)
        .to('.field-cross', { rotation: 35, y: -12, duration: 3.6, ease: 'sine.inOut' }, 0);
      const orbit = gsap.to('.orbit-back', { rotation: 360, transformOrigin: '50% 50%', duration: 65, repeat: -1, ease: 'none' });
      const star = gsap.to('.field-star', { rotation: 360, duration: 45, repeat: -1, ease: 'none' });
      const thread = gsap.to('.thread path', { strokeDashoffset: -300, duration: 30, repeat: -1, ease: 'none' });
      const decorations = [ambient, orbit, star, thread];
      const cardMotion = scenes.map((scene) => {
        const decoration = scene.querySelector('.paper-star, .vocab-asterisk, .active-code');
        if (!decoration) return null;
        return gsap.to(decoration, {
          y: scene.id === 'code' ? 2 : -10,
          rotation: scene.id === 'code' ? 0 : 10,
          duration: 2.8, repeat: -1, yoyo: true, ease: 'sine.inOut', paused: true
        });
      });
      const syncAmbient = () => {
        decorations.forEach(animation => document.hidden ? animation.pause() : animation.resume());
        cardMotion.forEach((animation, index) => {
          if (animation) index === active && !document.hidden ? animation.resume() : animation.pause();
        });
      };
      listen(document, 'visibilitychange', syncAmbient);

      const updateChapter = (progress) => {
        if (!rebuilding) lastProgress = progress;
        const index = Math.round(progress * (scenes.length - 1));
        if (index === active) return;
        active = index;
        count.textContent = `${String(index + 1).padStart(2, '0')} / 07`;
        caption.textContent = names[index];
        chapterLinks.forEach((link, i) => i === index ? link.setAttribute('aria-current', 'step') : link.removeAttribute('aria-current'));
        headerLinks.forEach(link => {
          const target = link.getAttribute('href');
          const selected = target === '#about' ? index === 1 || index === 2 : target === '#work' ? index >= 3 && index <= 5 : index === 6;
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
        .to('.thread', { x: () => -travel() * 0.91, duration: scenes.length - 1 }, 0)
        .to('.journey-progress i', { scaleX: 1, duration: scenes.length - 1 }, 0)
        .to('.field-ring', { rotation: 95, x: -120, duration: scenes.length - 1 }, 0);

      const colors = ['#201e28', '#24232d', '#292330', '#292531', '#202b2b', '#302724', '#24272b'];
      const orbStops = mobile
        ? [[0, 0, 1, 0], [0.04, 0.02, 0.43, -30], [0.2, -0.02, 0.18, 20], [0.2, 0.13, 0.16, 110], [0.2, 0.13, 0.16, 200], [0.2, 0.13, 0.16, 300], [-0.12, -0.03, 0.85, 360]]
        : [[0, 0, 1, 0], [0.07, 0.21, 0.46, -35], [0.01, 0, 0.73, 20], [-0.55, 0.33, 0.18, 100], [-0.55, 0.33, 0.18, 200], [-0.55, 0.33, 0.18, 290], [0.02, 0.01, 0.9, 360]];
      scenes.forEach((scene, index) => {
        if (!index) return;
        const [x, y, scale, rotation] = orbStops[index];
        camera.to('.viewport', { backgroundColor: colors[index], duration: 1 }, index - 1)
          .to('.shared-orb', {
            x: () => x * window.innerWidth, y: () => y * window.innerHeight,
            scale, rotation, opacity: mobile && index >= 3 && index <= 5 ? 0 : 1,
            duration: 1, ease: 'power1.inOut'
          }, index - 1)
          .fromTo(scene.querySelector('.scene-inner'), { x: mobile ? 20 : 65, y: 35 }, { x: 0, y: 0, duration: 0.8, ease: 'power2.out' }, index - 0.8);
        const art = scene.querySelector('.project-art');
        if (art) camera.fromTo(art, { y: 70, rotation: 5, scale: 0.94 }, { y: 0, rotation: 0, scale: 1, duration: 1, ease: 'power2.out' }, index - 1);
      });
      camera.fromTo('.brace-left', { x: -40, rotation: -12 }, { x: 0, rotation: 0, duration: 1 }, 0)
        .fromTo('.brace-right', { x: 40, rotation: 12 }, { x: 0, rotation: 0, duration: 1 }, 0)
        .to('.emotion-ring', { rotation: '+=110', duration: 2 }, 1)
        .to('.emotion-dot', { x: mobile ? 55 : 120, y: 65, duration: 2 }, 1)
        .to('.art-bracket', { rotation: 55, transformOrigin: '50% 50%', duration: 6 }, 0)
        .to('.art-spark', { rotation: -150, transformOrigin: '50% 50%', duration: 6 }, 0);

      if (pointer) {
        const setters = [];
        const quick = (target, property, duration = 0.85) => {
          const setter = gsap.quickTo(target, property, { duration, ease: 'power3.out' });
          setters.push(setter);
          return setter;
        };
        const orbX = quick('.orb-pointer', 'x');
        const orbY = quick('.orb-pointer', 'y');
        const orbRotate = quick('.orb-pointer', 'rotation', 1.1);
        const wordsX = quick('.orbit-words', 'x', 1.2);
        const wordsY = quick('.orbit-words', 'y', 1.2);
        const fieldX = quick('.field', 'x', 1.4);
        const fieldY = quick('.field', 'y', 1.4);
        listen(viewport, 'pointermove', event => {
          const x = event.clientX / window.innerWidth - 0.5;
          const y = event.clientY / window.innerHeight - 0.5;
          orbX(x * 70); orbY(y * 55); orbRotate(x * 12);
          wordsX(-x * 32); wordsY(-y * 24); fieldX(-x * 18); fieldY(-y * 16);
        }, { passive: true });
        listen(viewport, 'pointerleave', () => [orbX, orbY, orbRotate, wordsX, wordsY, fieldX, fieldY].forEach(setter => setter(0)));
        document.querySelectorAll('.project-art').forEach(art => {
          const tilt = art.querySelector('.project-tilt');
          const tiltX = quick(tilt, 'rotationX', 0.65);
          const tiltY = quick(tilt, 'rotationY', 0.65);
          let rect;
          listen(art, 'pointerenter', () => { rect = art.getBoundingClientRect(); });
          listen(art, 'pointermove', event => {
            if (!rect) return;
            tiltX(-((event.clientY - rect.top) / rect.height - 0.5) * 12);
            tiltY(((event.clientX - rect.left) / rect.width - 0.5) * 16);
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
        root.classList.remove('is-immersive');
        [...chapterLinks, ...headerLinks].forEach(link => link.removeAttribute('aria-current'));
        count.textContent = '01 / 07'; caption.textContent = names[0];
      };
    });
  } catch (error) {
    media.revert();
    document.documentElement.classList.remove('is-immersive');
    console.warn('Motion enhancement unavailable; the page remains readable.', error);
  }
})();
