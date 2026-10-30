// site.js — small bits of vanilla JS for the Onhand landing page.

const ONHAND_RELEASE = {
  version: '0.4.14',
  repo: 'https://github.com/Phineas1500/Onhand',
  sponsor: 'https://github.com/sponsors/Phineas1500',
};

const ONHAND_ANALYTICS = {
  chromeStoreEvent: 'chrome_store_click',
  releaseDownloadEvent: 'download_zip_click',
  githubSourceEvent: 'github_source_click',
  sponsorEvent: 'sponsor_click',
  demoVideoEvent: 'demo_video_play',
  phoneShareEvent: 'phone_share_click',
};

const ONHAND_STORE = {
  url: 'https://chromewebstore.google.com/detail/ogjmncmkpgdkkcibdiacmagaehjohljb',
  approvedVersion: '0.4.14',
  pendingVersion: null,
};

// Phones and tablets can't run browser extensions, so there the install
// buttons send the site to the visitor's computer instead of opening a store
// listing they can't use. The link is tagged so GA shows when it comes back.
const ONHAND_SEND_TO_COMPUTER = {
  url: 'https://useonhand.com/?utm_source=phone&utm_medium=share&utm_campaign=send-to-computer',
  subject: 'Onhand, for my computer',
  text: 'Install Onhand on my computer:',
};

function trackConversion(eventName, category, label, data){
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, {
      ...data,
      event_category: category,
      event_label: label,
      transport_type: 'beacon',
    });
  }
  if (window.umami && typeof window.umami.track === 'function') {
    window.umami.track(eventName, data);
  }
}

function isHandheldDevice(){
  const ua = navigator.userAgent || '';
  if (/CrOS/.test(ua)) return false;
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS asks for desktop sites with a Mac user agent; Macs have no touch screen.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

// 0a) Phones: relabel the install buttons and send the link instead. Plain
//     text links to the store (in support steps, say) stay as they are.
(function(){
  if (!isHandheldDevice()) return;
  document.documentElement.classList.add('is-handheld');
  const { url, subject, text } = ONHAND_SEND_TO_COMPUTER;
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text} ${url}`)}`;
  const labels = [
    ['.nav-cta', '.nav-cta-label', 'Send link'],
    ['.btn-primary, .release-download', 'span:not(.mc)', 'Send to my computer'],
    ['.inline-action', null, 'Send Onhand to my computer ↗'],
  ];

  async function send(node){
    let result = 'mailto';
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: subject, text, url });
        result = 'shared';
      } catch (error) {
        // A closed share sheet is a choice; anything else falls back to email.
        result = error && error.name === 'AbortError' ? 'cancelled' : 'mailto';
      }
    }
    trackConversion(ONHAND_ANALYTICS.phoneShareEvent, 'install', url, {
      result,
      link_url: url,
      link_text: node.textContent.replace(/\s+/g, ' ').trim(),
    });
    if (result === 'mailto') window.location.href = mailto;
  }

  document.querySelectorAll('[data-onhand-store-link]').forEach((node) => {
    const match = labels.find(([selector]) => node.matches(selector));
    if (!match) return;
    const [, labelSelector, label] = match;
    const labelNode = labelSelector ? node.querySelector(labelSelector) : node;
    if (!labelNode) return;
    labelNode.textContent = label;
    node.href = mailto;
    node.removeAttribute('target');
    node.setAttribute('data-onhand-send-to-computer', '');
    node.setAttribute('data-onhand-analytics-event', ONHAND_ANALYTICS.phoneShareEvent);
    node.addEventListener('click', (event) => {
      event.preventDefault();
      send(node);
    });
  });

  const ctas = document.querySelector('.hero-ctas');
  if (ctas && ctas.querySelector('[data-onhand-send-to-computer]')) {
    const note = document.createElement('p');
    note.className = 'handheld-note';
    note.textContent = "Onhand runs in Chrome, Edge or Firefox on a computer. Phones can't add browser extensions, so send yourself the link and install it there.";
    ctas.after(note);
  }
})();

// 0) Release metadata: keep visible version labels and release links in sync.
(function(){
  const version = ONHAND_RELEASE.version.replace(/^v/i, '');
  const versionLabel = `v${version}`;
  const fileName = `onhand-${versionLabel}-chrome.zip`;
  const releaseUrl = `${ONHAND_RELEASE.repo}/releases/tag/${versionLabel}`;
  const downloadUrl = `${ONHAND_RELEASE.repo}/releases/download/${versionLabel}/${fileName}`;
  const downloadEventName = ONHAND_ANALYTICS.releaseDownloadEvent;
  const chromeStoreEventName = ONHAND_ANALYTICS.chromeStoreEvent;
  const githubSourceEventName = ONHAND_ANALYTICS.githubSourceEvent;
  const sponsorEventName = ONHAND_ANALYTICS.sponsorEvent;

  function releaseDownloadData(node){
    return {
      release_version: versionLabel,
      file_name: fileName,
      link_url: downloadUrl,
      link_text: node.textContent.replace(/\s+/g, ' ').trim(),
    };
  }

  function trackReleaseDownload(node, onTracked){
    const data = releaseDownloadData(node);

    if (typeof window.gtag === 'function') {
      const gaData = {
        ...data,
        event_category: 'release',
        event_label: fileName,
        transport_type: 'beacon',
      };
      if (onTracked) gaData.event_callback = onTracked;
      window.gtag('event', downloadEventName, gaData);
    }

    if (window.umami && typeof window.umami.track === 'function') {
      window.umami.track(downloadEventName, data);
    }
  }

  function isPlainLeftClick(event){
    return event.button === 0
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !event.currentTarget.target;
  }

  document.querySelectorAll('[data-onhand-version-label]').forEach((node) => {
    node.textContent = versionLabel;
  });
  document.querySelectorAll('[data-onhand-release-file]').forEach((node) => {
    node.textContent = fileName;
  });
  document.querySelectorAll('[data-onhand-release-download]').forEach((node) => {
    node.href = downloadUrl;
    node.setAttribute('data-onhand-analytics-event', downloadEventName);
    node.addEventListener('click', (event) => {
      const shouldDelayNavigation = isPlainLeftClick(event);
      let didNavigate = false;
      const navigate = () => {
        if (didNavigate) return;
        didNavigate = true;
        window.location.href = node.href;
      };

      if (shouldDelayNavigation) event.preventDefault();
      trackReleaseDownload(node, shouldDelayNavigation ? navigate : undefined);
      if (shouldDelayNavigation) setTimeout(navigate, 250);
    });
  });
  document.querySelectorAll('[data-onhand-release-notes]').forEach((node) => {
    node.href = releaseUrl;
  });

  document.querySelectorAll('[data-onhand-store-link]').forEach((node) => {
    if (node.hasAttribute('data-onhand-send-to-computer')) return;
    node.href = ONHAND_STORE.url;
    node.setAttribute('data-onhand-analytics-event', chromeStoreEventName);
    node.addEventListener('click', () => {
      trackConversion(chromeStoreEventName, 'install', ONHAND_STORE.url, {
        store_version: ONHAND_STORE.approvedVersion,
        pending_version: ONHAND_STORE.pendingVersion || '',
        link_url: ONHAND_STORE.url,
        link_text: node.textContent.replace(/\s+/g, ' ').trim(),
      });
    });
  });
  document.querySelectorAll('[data-onhand-source-link]').forEach((node) => {
    node.href = ONHAND_RELEASE.repo;
    node.setAttribute('data-onhand-analytics-event', githubSourceEventName);
    node.addEventListener('click', () => {
      trackConversion(githubSourceEventName, 'source', ONHAND_RELEASE.repo, {
        release_version: versionLabel,
        link_url: ONHAND_RELEASE.repo,
        link_text: node.textContent.replace(/\s+/g, ' ').trim(),
      });
    });
  });
  document.querySelectorAll('[data-onhand-sponsor-link]').forEach((node) => {
    node.href = ONHAND_RELEASE.sponsor;
    node.setAttribute('data-onhand-analytics-event', sponsorEventName);
    node.addEventListener('click', () => {
      trackConversion(sponsorEventName, 'support', ONHAND_RELEASE.sponsor, {
        release_version: versionLabel,
        link_url: ONHAND_RELEASE.sponsor,
        link_text: node.textContent.replace(/\s+/g, ' ').trim(),
      });
    });
  });
  document.querySelectorAll('[data-onhand-store-version]').forEach((node) => {
    node.textContent = `v${ONHAND_STORE.approvedVersion}`;
  });
  document.querySelectorAll('[data-onhand-pending-version]').forEach((node) => {
    node.textContent = ONHAND_STORE.pendingVersion ? `v${ONHAND_STORE.pendingVersion}` : '';
  });
})();

// 1) Interactive product demo: Onhand scripts itself working the page —
//    highlights bloom, the answer streams, citations light up — then the
//    settled state stays clickable (jump to evidence) and hoverable (link
//    chip <-> source). A suggested follow-up plays a second grounded turn.
(function(){
  const demo = document.querySelector('[data-onhand-demo]');
  if (!demo) return;

  const page = demo.querySelector('[data-demo-page]');
  const scroller = demo.querySelector('[data-demo-scroller]');
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const citationButtons = Array.from(demo.querySelectorAll('[data-demo-cite]'));
  const reveals = Array.from(demo.querySelectorAll('[data-demo-reveal]'));
  const highlights = {};
  demo.querySelectorAll('[data-demo-hl]').forEach((el) => { highlights[el.getAttribute('data-demo-hl')] = el; });
  const turn1Chips = Array.from(demo.querySelectorAll('[data-demo-turn="1"] .demo-cite'));
  const answerReveals = Array.from(demo.querySelectorAll('[data-demo-turn="1"] [data-demo-reveal="a"]'));
  const srcDef = demo.querySelector('[data-demo-cite="demo-source-definition"][data-demo-reveal="src"]');
  const srcCode = demo.querySelector('[data-demo-cite="demo-source-code"][data-demo-reveal="src"]');
  const turn2 = demo.querySelector('[data-demo-turn="2"]');
  const source3 = demo.querySelector('[data-demo-reveal="src2"]');
  const sourcesLabel = demo.querySelector('[data-demo-sources-label]');
  const askButtons = Array.from(demo.querySelectorAll('[data-demo-ask]'));
  const composer = demo.querySelector('.demo-composer');
  const replayBtn = demo.querySelector('[data-demo-replay]');

  let timers = [];
  let activeTarget = null;
  let played = false;
  let followupPlayed = false;

  const at = (ms, fn) => timers.push(window.setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(window.clearTimeout); timers = []; };
  const show = (el) => { if (el) el.classList.add('is-shown'); };
  const hide = (el) => { if (el) el.classList.remove('is-shown'); };

  // --- settled interactions: click-to-jump + hover-link (chip <-> source) ---
  function setActiveButton(targetId){
    citationButtons.forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-demo-cite') === targetId));
  }
  function focusSource(targetId){
    const target = targetId && demo.querySelector('#' + CSS.escape(targetId));
    if (!target || !page) return;
    if (activeTarget) activeTarget.classList.remove('is-targeted');
    activeTarget = target;
    target.classList.add('is-targeted');
    setActiveButton(targetId);
    const top = target.offsetTop - (page.clientHeight - target.clientHeight) / 2;
    page.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function linkSource(targetId, on){
    const target = targetId && demo.querySelector('#' + CSS.escape(targetId));
    if (target) target.classList.toggle('is-linked', on);
    citationButtons.forEach((b) => { if (b.getAttribute('data-demo-cite') === targetId) b.classList.toggle('is-linked', on); });
  }
  citationButtons.forEach((b) => {
    const id = b.getAttribute('data-demo-cite') || '';
    b.addEventListener('click', () => focusSource(id));
    b.addEventListener('mouseenter', () => linkSource(id, true));
    b.addEventListener('mouseleave', () => linkSource(id, false));
    b.addEventListener('focus', () => linkSource(id, true));
    b.addEventListener('blur', () => linkSource(id, false));
  });

  // --- arm: blank the annotations so the build can play them in ---
  function arm(){
    clearTimers();
    demo.classList.remove('is-settled', 'is-reading');
    demo.classList.add('is-armed', 'is-resetting');
    reveals.forEach(hide);
    turn1Chips.forEach(hide);
    Object.keys(highlights).forEach((k) => hide(highlights[k]));
    if (activeTarget){ activeTarget.classList.remove('is-targeted'); activeTarget = null; }
    setActiveButton('');
    if (scroller) scroller.scrollTop = 0;
    if (page) page.scrollTop = 0;
  }

  // --- the scripted build of the first turn ---
  function play(){
    arm();
    void demo.offsetWidth; // commit the blanked state, then re-enable transitions
    demo.classList.remove('is-resetting');
    demo.classList.add('is-reading');
    at(720, () => show(highlights.def));
    at(1050, () => show(srcDef));
    at(1380, () => show(demo.querySelector('[data-demo-reveal="note"]')));
    at(2000, () => show(highlights.code));
    at(2340, () => show(srcCode));
    at(2500, () => demo.classList.remove('is-reading'));
    const base = 2800, stepGap = 360;
    answerReveals.forEach((el, i) => {
      at(base + i * stepGap, () => show(el));
      const chip = el.querySelector('.demo-cite');
      if (chip) at(base + i * stepGap + 250, () => chip.classList.add('is-shown'));
    });
    const settleAt = base + answerReveals.length * stepGap + 450;
    at(settleAt, () => { demo.classList.add('is-settled'); focusSource('demo-source-definition'); played = true; });
  }

  // --- the follow-up turn, driven by the composer suggestion ---
  function playFollowup(){
    if (followupPlayed) return;
    // Asking before the first answer finishes skips straight to it.
    if (!demo.classList.contains('is-settled')) settleInstant();
    followupPlayed = true;
    if (composer) composer.classList.add('is-used');
    askButtons.forEach((b) => b.setAttribute('aria-disabled', 'true'));
    if (turn2) turn2.hidden = false;
    demo.classList.add('is-reading');
    at(520, () => { show(highlights.soft); demo.classList.remove('is-reading'); });
    at(760, () => {
      if (source3){ source3.hidden = false; show(source3); }
      if (sourcesLabel) sourcesLabel.textContent = 'On this page · 3 highlights, 1 note';
    });
    const p2 = turn2 && turn2.querySelector('[data-demo-reveal="b"]');
    at(980, () => show(p2));
    const chip2 = turn2 && turn2.querySelector('.demo-cite');
    at(1240, () => { if (chip2) chip2.classList.add('is-shown'); });
    at(1320, () => {
      if (scroller && turn2){
        const delta = turn2.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTo({ top: scroller.scrollTop + delta - 10, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    });
    at(1720, () => focusSource('demo-source-softmax'));
  }
  askButtons.forEach((b) => b.addEventListener('click', playFollowup));

  // --- reduced motion / no build: jump straight to the settled state ---
  function settleInstant(){
    clearTimers();
    demo.classList.remove('is-armed', 'is-reading', 'is-resetting');
    demo.classList.add('is-settled');
    played = true;
  }

  // --- replay ---
  function resetFollowup(){
    followupPlayed = false;
    if (turn2) turn2.hidden = true;
    if (source3){ source3.hidden = true; hide(source3); }
    if (composer) composer.classList.remove('is-used');
    askButtons.forEach((b) => b.removeAttribute('aria-disabled'));
    if (sourcesLabel) sourcesLabel.textContent = 'On this page · 2 highlights, 1 note';
  }
  if (replayBtn) replayBtn.addEventListener('click', () => {
    resetFollowup();
    if (reduceMotion) settleInstant(); else play();
  });

  // --- kick off when scrolled into view (blank until then, no first-paint flash) ---
  if (reduceMotion){
    settleInstant();
  } else if ('IntersectionObserver' in window){
    arm();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting && !played){ play(); io.disconnect(); } });
    }, { threshold: 0.3 });
    io.observe(demo);
  } else {
    play();
  }
})();

// 2) Theme toggle: cycles light → dark → auto. Light is the default; "auto"
//    follows the OS. Persisted in localStorage.
(function(){
  const root = document.documentElement;
  const btn = document.querySelector('[data-theme-toggle]');

  function apply(mode){
    if (mode === 'light') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    if (!btn) return;
    btn.setAttribute('data-mode', mode);
    btn.title = `Theme: ${mode}`;
  }

  let saved = 'light';
  try { saved = localStorage.getItem('onhand-theme') || 'light'; } catch {}
  apply(['light', 'dark', 'auto'].includes(saved) ? saved : 'light');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const next = btn.getAttribute('data-mode') === 'light' ? 'dark'
              : btn.getAttribute('data-mode') === 'dark'  ? 'auto'
              : 'light';
    localStorage.setItem('onhand-theme', next);
    apply(next);
  });
})();

// 3) Live GitHub star count on the nav GitHub button.
(function(){
  const counters = document.querySelectorAll('[data-onhand-star-count]');
  if (!counters.length || typeof fetch !== 'function') return;
  const CACHE_KEY = 'onhand-github-stars';
  const CACHE_TTL_MS = 60 * 60 * 1000;
  const repoPath = ONHAND_RELEASE.repo.replace(/^https?:\/\/github\.com\//i, '');

  function formatStars(count){
    if (!Number.isFinite(count) || count < 0) return '';
    if (count >= 10000) return `${Math.round(count / 1000)}k`;
    if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(count);
  }

  function render(count){
    const label = formatStars(count);
    if (!label) return;
    counters.forEach((node) => {
      const value = node.querySelector('[data-onhand-star-value]');
      if (value) value.textContent = label;
      node.hidden = false;
    });
  }

  function readCache(){
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && typeof raw.count === 'number' && Date.now() - raw.at < CACHE_TTL_MS) return raw.count;
    } catch {}
    return null;
  }

  const cached = readCache();
  if (cached !== null) {
    render(cached);
    return;
  }
  fetch(`https://api.github.com/repos/${repoPath}`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const count = Number(data && data.stargazers_count);
      if (!Number.isFinite(count)) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ count, at: Date.now() })); } catch {}
      render(count);
    })
    .catch(() => {});
})();

// 4) Demo video: the page shows YouTube's preview image and loads the player
//    (youtube-nocookie.com) only when someone presses play. Modified clicks
//    fall through to the YouTube link.
(function(){
  document.querySelectorAll('[data-onhand-video]').forEach((link) => {
    link.setAttribute('data-onhand-analytics-event', ONHAND_ANALYTICS.demoVideoEvent);
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const id = link.getAttribute('data-onhand-video');
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
      iframe.title = link.getAttribute('data-onhand-video-title') || 'Onhand demo video';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      link.replaceWith(iframe);
      iframe.focus();
      const eventName = ONHAND_ANALYTICS.demoVideoEvent;
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, { event_category: 'video', event_label: id, video_id: id, transport_type: 'beacon' });
      }
      if (window.umami && typeof window.umami.track === 'function') {
        window.umami.track(eventName, { video_id: id });
      }
    });
  });
})();
