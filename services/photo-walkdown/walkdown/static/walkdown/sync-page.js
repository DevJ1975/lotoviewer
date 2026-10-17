// Sync screen: what is waiting on this phone, with retry and discard.
(function () {
  'use strict';

  const queue = window.WalkdownQueue;
  const list = document.getElementById('queue-list');
  const total = document.getElementById('queue-total');
  const message = document.getElementById('sync-message');

  function row(item) {
    const li = document.createElement('li');
    li.className = 'row';
    const label = document.createElement('span');
    label.className = 'grow';
    const strong = document.createElement('strong');
    strong.textContent = item.equipment_id;
    const detail = document.createElement('span');
    detail.className = 'muted small';
    const slot = item.slot === 'iso' ? 'Isolation' : 'Equipment';
    detail.textContent = ` ${slot} · ${item.kind === 'photo' ? 'new photo' : 'confirmation'}` +
      (item.state === 'failed' ? ` · failed: ${item.error}` : item.error ? ` · retrying: ${item.error}` : '');
    label.append(strong, detail);
    li.append(label);

    if (item.state === 'failed') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn small';
      retry.textContent = 'Retry';
      retry.addEventListener('click', async () => {
        await queue.put(Object.assign(item, { state: 'queued', error: '', next_try: 0 }));
        queue.changed();
        queue.drain({ force: true });
      });
      li.append(retry);
    }
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'btn small danger';
    discard.textContent = 'Discard';
    discard.addEventListener('click', async () => {
      if (window.confirm(`Discard this ${slot.toLowerCase()} photo for ${item.equipment_id}?`)) {
        await queue.remove(item.client_capture_id);
        queue.changed();
      }
    });
    li.append(discard);
    return li;
  }

  async function render() {
    const items = await queue.all();
    total.textContent = String(items.length);
    list.replaceChildren(...items.map(row));
  }

  document.getElementById('sync-now').addEventListener('click', async () => {
    message.textContent = navigator.onLine ? 'Syncing…' : 'No signal. Your photos are safe on this phone.';
    const { sent, blocked } = await queue.drain({ force: true });
    if (blocked === 'auth') {
      message.textContent = 'Your session has expired. Sign in again; your photos are kept.';
    } else if (navigator.onLine) {
      message.textContent = sent ? `${sent} uploaded.` : 'Nothing to upload.';
    }
  });

  document.addEventListener('walkdown:queue-changed', render);
  render();
}());
