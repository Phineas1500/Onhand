// site.js — small bits of vanilla JS for the Onhand landing page.

const ONHAND_RELEASE = {
  version: '0.2.9',
  repo: 'https://github.com/Phineas1500/Onhand',
};

const ONHAND_ANALYTICS = {
  chromeStoreEvent: 'chrome_store_click',
  releaseDownloadEvent: 'download_zip_click',
  githubSourceEvent: 'github_source_click',
};

const ONHAND_STORE = {
  url: 'https://chromewebstore.google.com/detail/ogjmncmkpgdkkcibdiacmagaehjohljb',
  approvedVersion: '0.2.9',
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
