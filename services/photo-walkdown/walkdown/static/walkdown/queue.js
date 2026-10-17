// Offline upload queue. Photos are saved in IndexedDB on the phone the
// moment they are taken and removed only after the server confirms it has
// applied them. Modelled on apps/web/lib/uploadQueue.ts.
(function () {
  'use strict';

  const DB_NAME = 'walkdown';
  const STORE = 'queue';
  const ENDPOINT = '/api/captures/';
  const BACKOFF_MS = [15000, 60000, 300000, 900000];
  // On a weak link the budget has to grow with the photo: 30 s plus the time to
  // push the bytes at ~6 KB/s (a 1 MB photo gets about three minutes).
  // `tuning` is exposed so the weak-network test can shorten the waits.
  const tuning = { baseTimeoutMs: 30000, slowestBytesPerSecond: 6000, shrinkAfterTimeouts: 2 };
  const SHRUNK = { maxDimension: 1600, quality: 0.6 };
  // Worth retrying: the server or the path to it is struggling, nothing is wrong
  // with the request itself.
  const RETRYABLE_STATUS = new Set([408, 425, 429]);

  let draining = false;

  function timeoutFor(item) {
    return tuning.baseTimeoutMs + ((item.blob ? item.blob.size : 0) / tuning.slowestBytesPerSecond) * 1000;
  }

  function backoffFor(attempts) {
    const base = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    return base * (0.8 + Math.random() * 0.4); // jitter, so phones do not retry in lockstep
  }

  async function shrink(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, SHRUNK.maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const smaller = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRUNK.quality));
      return smaller && smaller.size < blob.size ? smaller : blob;
    } finally {
      bitmap.close();
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'client_capture_id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => { db.close(); resolve(request && request.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    });
  }

  const put = (item) => run('readwrite', (store) => store.put(item));
  const remove = (id) => run('readwrite', (store) => store.delete(id));
  const all = () => run('readonly', (store) => store.getAll())
    .then((items) => (items || []).sort((a, b) => a.created - b.created));

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function changed() {
    document.dispatchEvent(new CustomEvent('walkdown:queue-changed'));
  }

  async function enqueue(fields) {
    const item = Object.assign({
      client_capture_id: crypto.randomUUID(),
      captured_at: new Date().toISOString(),
      created: Date.now(), attempts: 0, next_try: 0, state: 'queued', error: '', blob: null,
    }, fields);
    await put(item);
    changed();
    return item;
  }

  // Resolves to { result: 'ok' | 'auth' | 'rejected' | 'retry' | 'offline' | 'timeout' }.
  async function send(item) {
    const form = new FormData();
    ['client_capture_id', 'machine', 'slot', 'kind', 'captured_at'].forEach((key) => {
      form.append(key, item[key]);
    });
    form.append('confirmed', item.confirmed ? '1' : '0');
    // Absent means "leave the placard's arrows alone"; [] means "no arrows".
    if (item.annotations) form.append('annotations', JSON.stringify(item.annotations));
    if (item.expect_version) form.append('expect_version', item.expect_version);
    if (item.for_capture) form.append('for_capture', item.for_capture);
    if (item.blob) form.append('photo', item.blob, 'photo.jpg');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutFor(item));
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST', body: form, credentials: 'same-origin', signal: controller.signal,
        headers: { 'X-CSRFToken': csrfToken() },
      });
    } catch (error) {
      // An abort means the link is up but too slow; anything else, there is no link.
      return { result: error && error.name === 'AbortError' ? 'timeout' : 'offline' };
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return { result: 'ok' };
    if (response.status === 401 || response.status === 403) return { result: 'auth' };
    let message = 'The server could not accept this photo.';
    try { message = (await response.json()).error || message; } catch (error) { /* keep default */ }
    const retry = response.status >= 500 || RETRYABLE_STATUS.has(response.status);
    return { result: retry ? 'retry' : 'rejected', message };
  }

  async function schedule(item, patch) {
    const attempts = item.attempts + 1;
    await put(Object.assign(item, patch, { attempts, next_try: Date.now() + backoffFor(attempts) }));
  }

  async function drainOnce(force) {
    let sent = 0;
    let blocked = '';
    for (const item of await all()) {
      if (item.state === 'failed' || (!force && item.next_try > Date.now())) continue;
      const { result, message } = await send(item);
      if (result === 'ok') {
        await remove(item.client_capture_id);
        sent += 1;
      } else if (result === 'auth') {
        blocked = 'auth';
        break;
      } else if (result === 'rejected') {
        await put(Object.assign(item, { state: 'failed', error: message }));
      } else if (result === 'retry') {
        await schedule(item, { error: message });
      } else {
        // 'offline' or 'timeout': the link is bad, so stop here rather than waiting
        // out the same failure for every other item. This one is skipped by the next
        // pass, which then reaches the items behind it.
        const patch = { error: result === 'timeout' ? 'The signal is too slow; will retry.' : '' };
        if (result === 'timeout' && item.blob && item.attempts + 1 >= tuning.shrinkAfterTimeouts) {
          try { patch.blob = await shrink(item.blob); } catch (error) { /* keep the original */ }
        }
        if (result === 'offline') await put(Object.assign(item, patch));
        else await schedule(item, patch);
        changed();
        break;
      }
      changed();
    }
    return { sent, blocked };
  }

  // Sends queued items one at a time, oldest first. `force` ignores the retry
  // delay (the Sync now button). navigator.onLine is deliberately not consulted:
  // on cellular it is often wrong in both directions, and a failed fetch is cheap.
  async function drain(options) {
    const force = Boolean(options && options.force);
    if (draining) return { sent: 0, blocked: '' };
    draining = true;
    let outcome = { sent: 0, blocked: '' };
    try {
      // Two open tabs must not both drain; the server would cope (capture ids are
      // idempotent) but it would double the traffic on a link that is already weak.
      if (navigator.locks) {
        await navigator.locks.request('walkdown-drain', { ifAvailable: true }, async (lock) => {
          if (lock) outcome = await drainOnce(force);
        });
      } else {
        outcome = await drainOnce(force);
      }
    } finally {
      draining = false;
    }
    changed();
    if (outcome.sent) document.body.dispatchEvent(new CustomEvent('walkdown:synced', { bubbles: true }));
    if (outcome.blocked === 'auth') document.dispatchEvent(new CustomEvent('walkdown:auth-needed'));
    return outcome;
  }

  window.WalkdownQueue = { enqueue, all, remove, put, drain, changed, tuning };
}());
