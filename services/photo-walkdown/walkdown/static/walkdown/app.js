// Shared page behaviour: service worker, online/offline indicator, queue
// badge, and draining the upload queue whenever signal might be back.
(function () {
  'use strict';

  const netState = document.getElementById('net-state');
  const queueBadge = document.getElementById('queue-count');
  const queue = window.WalkdownQueue;

  function showNetwork() {
    if (!netState) return;
    const online = navigator.onLine;
    netState.textContent = online ? netState.dataset.onlineText : netState.dataset.offlineText;
    netState.classList.toggle('offline', !online);
  }

  async function showQueueCount() {
    if (!queueBadge) return;
    const waiting = (await queue.all()).filter((item) => item.state !== 'failed').length;
    queueBadge.textContent = String(waiting);
    queueBadge.hidden = waiting === 0;
  }

  function sync() {
    if (queue && document.visibilityState === 'visible') queue.drain();
  }

  window.addEventListener('online', () => { showNetwork(); sync(); });
  window.addEventListener('offline', showNetwork);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('walkdown:queue-changed', showQueueCount);
  setInterval(sync, 60000);
  showNetwork();
  showQueueCount();
  sync();

  // Ask the browser not to evict the queued photos when storage runs low.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  if ('serviceWorker' in navigator) {
    const banner = document.getElementById('update-banner');
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller && banner) {
            banner.hidden = false;
            document.getElementById('update-reload').addEventListener('click', () => {
              worker.postMessage('SKIP_WAITING');
            });
          }
        });
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
}());
