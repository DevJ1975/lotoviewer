// Department page: instant client-side filtering (works offline) and the
// "Download for offline" button that saves every page and photo here.
(function () {
  'use strict';

  const list = document.getElementById('machine-list');
  const text = document.getElementById('filter-text');
  const chips = document.querySelectorAll('[data-filter]');
  let state = 'all';

  function applyFilter() {
    const needle = text.value.trim().toLowerCase();
    list.querySelectorAll('li').forEach((row) => {
      const stateMatches = state === 'all' || row.dataset.state === state;
      row.hidden = !(stateMatches && row.dataset.text.includes(needle));
    });
  }

  chips.forEach((chip) => chip.addEventListener('click', () => {
    state = chip.dataset.filter;
    chips.forEach((other) => other.classList.toggle('active', other === chip));
    applyFilter();
  }));
  text.addEventListener('input', applyFilter);

  async function showQueued() {
    const waiting = new Set((await window.WalkdownQueue.all()).map((item) => item.machine));
    list.querySelectorAll('[data-queued-for]').forEach((badge) => {
      badge.hidden = !waiting.has(badge.dataset.queuedFor);
    });
  }
  document.addEventListener('walkdown:queue-changed', showQueued);
  showQueued();

  const button = document.getElementById('download-offline');
  const status = document.getElementById('download-status');
  button.addEventListener('click', async () => {
    // Pages are saved by the service worker; until it controls this page
    // the downloads would silently save nothing.
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
      status.textContent = 'Almost ready. Reload this page, then tap Download again.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Preparing…';
    try {
      const manifest = await (await fetch(button.dataset.manifest, { credentials: 'same-origin' })).json();
      const urls = manifest.urls.slice();
      let finished = 0;
      let failed = 0;
      const workers = Array.from({ length: 4 }, async () => {
        while (urls.length) {
          const url = urls.shift();
          try {
            const response = await fetch(url, {
              credentials: 'same-origin', headers: { 'X-Walkdown-Precache': '1' },
            });
            if (!response.ok) failed += 1;
          } catch (error) {
            failed += 1;
          }
          finished += 1;
          status.textContent = `Saving ${finished} of ${manifest.urls.length}…`;
        }
      });
      await Promise.all(workers);
      status.textContent = failed
        ? `Saved, but ${failed} items did not download. Try again with better signal.`
        : `Ready offline: ${manifest.urls.length} pages and photos saved on this phone.`;
    } catch (error) {
      status.textContent = 'Could not download. Check your signal and try again.';
    } finally {
      button.disabled = false;
    }
  });
}());
