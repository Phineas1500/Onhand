// site.js — small bits of vanilla JS for the Onhand landing page.

// 1) Theme toggle: cycles light → dark → auto. Persisted in localStorage.
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

// 2) Copy install command
(function(){
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sel = btn.getAttribute('data-copy');
      const target = document.querySelector(sel);
      if (!target) return;
      const text = target.textContent.replace(/\s+/g, ' ').trim();
      (navigator.clipboard?.writeText(text) || Promise.resolve()).then(() => {
        btn.classList.add('ok');
        const original = btn.textContent;
        btn.textContent = 'copied';
        setTimeout(() => {
          btn.classList.remove('ok');
          btn.textContent = original;
        }, 1200);
      });
    });
  });
})();
