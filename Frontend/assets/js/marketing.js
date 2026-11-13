(() => {
  const root = document.documentElement;
  root.classList.add('js-ready');

  const header = document.querySelector('[data-header]');
  const setHeaderState = () => header?.classList.toggle('is-scrolled', window.scrollY > 28);
  setHeaderState();
  window.addEventListener('scroll', setHeaderState, { passive: true });

  // The mobile menu remains a set of ordinary links; this only adds the compact disclosure.
  const menuButton = document.querySelector('[data-menu-toggle]');
  const menu = document.getElementById('primary-menu');
  const closeMenu = () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Open navigation menu');
    menu?.classList.remove('is-open');
  };
  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    menu?.classList.toggle('is-open', open);
  });
  menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760) closeMenu();
    if (video && smallScreen.matches && !video.paused) {
      stopVideo();
      videoStarted = false;
    } else if (video && !smallScreen.matches && !reduceMotion.matches && !videoStarted) {
      const bounds = hero?.getBoundingClientRect();
      if (bounds && bounds.top < window.innerHeight && bounds.bottom > 0) startVideo();
    }
  }, { passive: true });

  // Reveal transitions are enhancement only. All content is visible without JS or IO support.
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  // Existing, first-party commerce-operations film: loaded after first paint and only when motion is allowed.
  const hero = document.querySelector('.hero');
  const video = document.querySelector('[data-hero-video]');
  const motionButton = document.querySelector('[data-motion-toggle]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallScreen = window.matchMedia('(max-width: 760px)');
  let videoStarted = false;
  const stopVideo = () => {
    if (!video) return;
    video.pause();
    video.classList.remove('is-playing');
    video.closest('.hero-media')?.classList.remove('has-video');
    if (motionButton) {
      motionButton.hidden = true;
      motionButton.setAttribute('aria-label', 'Play background video');
      motionButton.querySelector('.motion-icon').textContent = '▶';
      motionButton.querySelector('.motion-label').textContent = 'Play motion';
    }
  };
  const startVideo = () => {
    if (!video || reduceMotion.matches || smallScreen.matches || videoStarted) return;
    videoStarted = true;
    video.src = '/assets/videos/commerce-operations-film.mp4';
    video.load();
    const attempt = video.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => {
        video.classList.add('is-playing');
        video.closest('.hero-media')?.classList.add('has-video');
        if (motionButton) motionButton.hidden = false;
      }).catch(() => {
        videoStarted = false;
        video.removeAttribute('src');
        video.load();
        stopVideo();
      });
    }
  };
  if (video && hero && !reduceMotion.matches && !smallScreen.matches) {
    if ('IntersectionObserver' in window) {
      const videoObserver = new IntersectionObserver((entries, observer) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 120));
          schedule(startVideo, { timeout: 1800 });
        }
      }, { threshold: 0.01 });
      videoObserver.observe(hero);
    } else {
      window.setTimeout(startVideo, 450);
    }
  }
  motionButton?.addEventListener('click', () => {
    if (!video) return;
    if (!video.paused) {
      stopVideo();
      return;
    }
    if (video.src && videoStarted) {
      const resume = video.play();
      if (resume && typeof resume.then === 'function') {
        resume.then(() => {
          video.classList.add('is-playing');
          video.closest('.hero-media')?.classList.add('has-video');
          motionButton.setAttribute('aria-label', 'Pause background video');
          motionButton.querySelector('.motion-icon').textContent = 'Ⅱ';
          motionButton.querySelector('.motion-label').textContent = 'Pause motion';
        }).catch(stopVideo);
      }
      return;
    }
    videoStarted = false;
    startVideo();
  });
  const onMotionPreferenceChange = (event) => {
    if (event.matches) stopVideo();
    else if (hero && 'IntersectionObserver' in window) {
      videoStarted = false;
      const resumeWhenVisible = new IntersectionObserver((entries, observer) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          startVideo();
        }
      }, { threshold: 0.01 });
      resumeWhenVisible.observe(hero);
    }
  };
  if (typeof reduceMotion.addEventListener === 'function') reduceMotion.addEventListener('change', onMotionPreferenceChange);
  else reduceMotion.addListener?.(onMotionPreferenceChange);
  video?.addEventListener('error', () => {
    video.classList.remove('is-playing');
    video.closest('.hero-media')?.classList.remove('has-video');
    if (motionButton) motionButton.hidden = true;
  });
  video?.addEventListener('playing', () => {
    video.classList.add('is-playing');
    video.closest('.hero-media')?.classList.add('has-video');
  });

  // Rev's product demonstration cycles through grounded example questions.
  const revExamples = {
    orders: {
      question: 'What changed in order activity?',
      status: 'Checking available order history and date coverage',
      check: 'Comparing the periods that can be verified',
      answer: 'Which order records and periods were available, what changed in that verified window, and what cannot be concluded from the data alone.'
    },
    products: {
      question: 'Which products need a closer look?',
      status: 'Checking synchronized product records and their coverage',
      check: 'Relating product context to available order activity',
      answer: 'Which products have enough available context to review, which records are missing, and where a possible pattern needs more verification.'
    },
    coverage: {
      question: 'What should I verify before deciding?',
      status: 'Checking sync status and the information available',
      check: 'Identifying gaps that could affect this investigation',
      answer: 'What is directly supported, what is only a possible explanation, and which unknowns should be resolved before acting.'
    }
  };
  const revButtons = document.querySelectorAll('[data-question]');
  revButtons.forEach((button) => button.addEventListener('click', () => {
    const example = revExamples[button.dataset.question];
    if (!example) return;
    revButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    };
    setText('[data-rev-question-output]', example.question);
    setText('[data-rev-status]', example.status);
    setText('[data-rev-check]', example.check);
    setText('[data-rev-answer]', example.answer);
  }));

  // The process remains fully explained in the markup. The controls only synchronize emphasis.
  const processSteps = document.querySelectorAll('[data-stage]');
  processSteps.forEach((button) => button.addEventListener('click', () => {
    processSteps.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-stage-detail]').forEach((detail) => {
      detail.classList.toggle('is-current', detail.dataset.stageDetail === button.dataset.stage);
    });
  }));

  // Minimal early-access form: reuse the existing waitlist endpoint through a same-origin Vercel function.
  const form = document.querySelector('[data-access-form]');
  const submitButton = document.querySelector('[data-submit-button]');
  const errorBox = document.querySelector('[data-form-error]');
  const successBox = document.querySelector('[data-form-success]');
  const successPanel = document.querySelector('[data-success-panel]');
  const successMessage = document.querySelector('[data-success-message]');
  const resetButton = document.querySelector('[data-reset-form]');
  const revealError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
    successBox.hidden = true;
  };
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    errorBox.hidden = true;
    successBox.hidden = true;
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.innerHTML = 'Sending request <span aria-hidden="true">…</span>';
    const formData = new FormData(form);
    const payload = {
      full_name: String(formData.get('full_name') || '').trim(),
      work_email: String(formData.get('work_email') || '').trim(),
      company_name: String(formData.get('company_name') || '').trim(),
      interested_in_beta: true
    };
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch('/api/waitlist/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
      let result;
      try { result = await response.json(); } catch { result = {}; }
      if (!response.ok || result.success === false) {
        const message = result.error || (Array.isArray(result.errors) ? result.errors.join(' ') : '') || (response.status === 409 ? 'This email may already be on the list. If you need help, contact hello@revluma.com.' : 'We couldn’t submit your request right now. Please try again in a moment.');
        throw new Error(message);
      }
      const position = result?.data?.waitlist_position;
      successMessage.textContent = typeof position === 'number' && position > 0
        ? `Thanks for your interest in Revluma. Your request is confirmed, and your current waitlist position is ${position}.`
        : 'Thanks for your interest in Revluma. Your request is confirmed. We’ll be in touch.';
      form.hidden = true;
      successPanel.hidden = false;
      successBox.hidden = true;
      successPanel.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'The request took too long to respond. Your details are still here — please try again.'
        : (error.message || 'We couldn’t submit your request right now. Please try again.');
      revealError(message);
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.innerHTML = 'Request early access <span aria-hidden="true">↗</span>';
    }
  });
  resetButton?.addEventListener('click', () => {
    form?.reset();
    form.hidden = false;
    successPanel.hidden = true;
    errorBox.hidden = true;
    successBox.hidden = true;
    document.getElementById('access-name')?.focus();
  });

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
