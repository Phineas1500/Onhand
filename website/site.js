// site.js — small bits of vanilla JS for the Onhand landing page.

const ONHAND_RELEASE = {
  version: '0.3.6',
  repo: 'https://github.com/Phineas1500/Onhand',
};

const ONHAND_ANALYTICS = {
  chromeStoreEvent: 'chrome_store_click',
  releaseDownloadEvent: 'download_zip_click',
  githubSourceEvent: 'github_source_click',
};

const ONHAND_STORE = {
  url: 'https://chromewebstore.google.com/detail/ogjmncmkpgdkkcibdiacmagaehjohljb',
  approvedVersion: '0.3.5',
  pendingVersion: null,
};

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

  document.querySelectorAll('[data-onhand-store-link]').forEach((node) => {
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
  document.querySelectorAll('[data-onhand-store-version]').forEach((node) => {
    node.textContent = `v${ONHAND_STORE.approvedVersion}`;
  });
  document.querySelectorAll('[data-onhand-pending-version]').forEach((node) => {
    node.textContent = ONHAND_STORE.pendingVersion ? `v${ONHAND_STORE.pendingVersion}` : '';
  });
})();

// 1) Interactive product demo: citation buttons jump back to page evidence.
(function(){
  const demo = document.querySelector('[data-onhand-demo]');
  if (!demo) return;

  const page = demo.querySelector('[data-demo-page]');
  const citationButtons = Array.from(demo.querySelectorAll('[data-demo-cite]'));
  let activeTarget = null;

  function setActiveButton(targetId){
    citationButtons.forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-demo-cite') === targetId);
    });
  }

  function focusSource(targetId){
    const target = demo.querySelector(`#${CSS.escape(targetId)}`);
    if (!target || !page) return;

    if (activeTarget) activeTarget.classList.remove('is-targeted');
    activeTarget = target;
    activeTarget.classList.add('is-targeted');
    setActiveButton(targetId);

    const top = target.offsetTop - (page.clientHeight - target.clientHeight) / 2;
    page.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  citationButtons.forEach((button) => {
    button.addEventListener('click', () => {
      focusSource(button.getAttribute('data-demo-cite') || '');
    });
  });

  window.setTimeout(() => focusSource('demo-source-definition'), 450);
})();

// 2) Theme toggle: cycles light → dark → auto. Persisted in localStorage.
(function(){
  const root = document.documentElement;
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;

  function apply(mode){
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    btn.setAttribute('data-mode', mode);
    btn.title = `Theme: ${mode}`;
  }

  const saved = localStorage.getItem('onhand-theme') || 'auto';
  apply(saved);

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
