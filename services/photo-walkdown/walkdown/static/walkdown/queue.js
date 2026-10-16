// Offline upload queue. Photos are saved in IndexedDB on the phone the
// moment they are taken and removed only after the server confirms it has
// applied them. Modelled on apps/web/lib/uploadQueue.ts.
(function () {
  'use strict';

  const DB_NAME = 'walkdown';
  const STORE = 'queue';
  const ENDPOINT = '/api/captures/';
  const BACKOFF_MS = [15000, 60000, 300000, 900000];

  let draining = false;

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

  // Resolves to 'ok' | 'auth' | 'rejected' | 'retry' | 'offline'.
  async function send(item) {
    const form = new FormData();
    ['client_capture_id', 'machine', 'slot', 'kind', 'captured_at'].forEach((key) => {
      form.append(key, item[key]);
    });
    form.append('confirmed', item.confirmed ? '1' : '0');
    // Absent means "leave the placard's arrows alone"; [] means "no arrows".
    if (item.annotations) form.append('annotations', JSON.stringify(item.annotations));
    if (item.expect_version) form.append('expect_version', item.expect_version);
    if (item.blob) form.append('photo', item.blob, 'photo.jpg');
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST', body: form, credentials: 'same-origin',
        headers: { 'X-CSRFToken': csrfToken() },
      });
    } catch (error) {
      return { result: 'offline' };
    }
    if (response.ok) return { result: 'ok' };
    if (response.status === 401 || response.status === 403) return { result: 'auth' };
    let message = 'The server could not accept this photo.';
    try { message = (await response.json()).error || message; } catch (error) { /* keep default */ }
    return { result: response.status >= 500 ? 'retry' : 'rejected', message };
  }

  // Sends queued items one at a time, oldest first. `force` ignores the
  // retry delay (the Sync now button).
  async function drain(options) {
    const force = Boolean(options && options.force);
    if (draining || !navigator.onLine) return { sent: 0, blocked: '' };
    draining = true;
    let sent = 0;
    let blocked = '';
    try {
      for (const item of await all()) {
        if (item.state === 'failed' || (!force && item.next_try > Date.now())) continue;
        const { result, message } = await send(item);
        if (result === 'ok') {
          await remove(item.client_capture_id);
          sent += 1;
        } else if (result === 'offline') {
          break;
        } else if (result === 'auth') {
          blocked = 'auth';
          break;
        } else if (result === 'rejected') {
          await put(Object.assign(item, { state: 'failed', error: message }));
        } else {
          const attempts = item.attempts + 1;
          const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          await put(Object.assign(item, { attempts, next_try: Date.now() + delay, error: message }));
        }
        changed();
      }
    } finally {
      draining = false;
    }
    changed();
    if (sent) document.body.dispatchEvent(new CustomEvent('walkdown:synced', { bubbles: true }));
    return { sent, blocked };
  }

  window.WalkdownQueue = { enqueue, all, remove, put, drain, changed };
}());
