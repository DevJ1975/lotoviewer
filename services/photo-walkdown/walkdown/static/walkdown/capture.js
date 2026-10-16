// Machine page: turn a camera photo into a small JPEG, store it in the
// upload queue, and show it straight away. Compression is a port of
// apps/web/lib/imageUtils.ts (2048 px, JPEG, under 1 MB, EXIF baked in).
(function () {
  'use strict';

  const MAX_DIMENSION = 2048;
  const MAX_BYTES = 1000000;
  const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05];
  const queue = window.WalkdownQueue;
  const previewUrls = new Map();

  async function compress(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encode = (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      for (const quality of QUALITY_STEPS) {
        const blob = await encode(quality);
        if (blob && blob.size <= MAX_BYTES) return blob;
      }
      const lowest = await encode(0.05);
      if (!lowest) throw new Error('Could not compress the photo');
      return lowest;
    } finally {
      bitmap.close();
    }
  }

  function cardFor(element) {
    return element.closest('.slot');
  }

  function say(card, text) {
    const message = card.querySelector('[data-capture-message]');
    if (message) message.textContent = text;
  }

  function preview(card, blob) {
    const image = card.querySelector('.thumb');
    const previous = previewUrls.get(card.dataset.slot);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    previewUrls.set(card.dataset.slot, url);
    image.src = url;
  }

  function waitingFor(items, card) {
    return items.filter((item) => item.machine === card.dataset.machine && item.slot === card.dataset.slot);
  }

  async function queueFrom(card, fields) {
    // A newer photo makes anything still waiting for this slot pointless:
    // the older photo, and arrows drawn on it, would only be overwritten.
    if (fields.kind === 'photo') {
      const superseded = waitingFor(await queue.all(), card);
      await Promise.all(superseded.map((item) => queue.remove(item.client_capture_id)));
    }
    await queue.enqueue(Object.assign({
      machine: card.dataset.machine, slot: card.dataset.slot,
      equipment_id: card.dataset.equipmentId,
      confirmed: card.querySelector('[data-confirmed]').checked,
    }, fields));
    markQueued();
    queue.drain();
  }

  document.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-capture-input]');
    if (!input || !input.files.length) return;
    const card = cardFor(input);
    const file = input.files[0];
    input.value = '';
    say(card, 'Saving photo…');
    try {
      const blob = await compress(file);
      await queueFrom(card, { kind: 'photo', blob, annotations: [] });
      preview(card, blob);
      say(card, navigator.onLine
        ? 'Saved. Uploading…'
        : 'Saved on this phone. It uploads when you have signal.');
    } catch (error) {
      say(card, 'That photo could not be saved. Try taking it again.');
    }
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-confirm-existing]');
    if (!button) return;
    const card = cardFor(button);
    button.disabled = true;
    await queueFrom(card, { kind: 'confirm', confirmed: true });
    say(card, navigator.onLine ? 'Saved. Uploading…' : 'Saved on this phone. It uploads when you have signal.');
  });

  // Mark the isolation point on this slot's photo.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-mark-isolation]');
    if (!button) return;
    const card = cardFor(button);
    const items = waitingFor(await queue.all(), card);
    const queuedPhoto = items.find((item) => item.kind === 'photo');
    if (!queuedPhoto && card.dataset.hasPhoto !== '1') {
      say(card, 'Take the isolation photo first, then mark the arrow on it.');
      return;
    }
    if (!queuedPhoto && card.dataset.canMark !== '1') {
      say(card, 'The photo on file is not this machine\'s isolation point. Take a new photo first.');
      return;
    }
    const labelOptions = JSON.parse(document.getElementById('slots').dataset.labelOptions);
    // Arrows from the placard's current photo are meaningless on a new one.
    const start = queuedPhoto ? (queuedPhoto.annotations || [])
      : (items.find((item) => item.kind === 'annotate') || {}).annotations
        || JSON.parse(card.dataset.annotations || '[]');
    const arrows = await window.WalkdownArrows.edit({
      imageUrl: card.querySelector('.thumb').src, arrows: start, labelOptions,
    });
    if (arrows === null) return;

    if (queuedPhoto) {
      const stillQueued = (await queue.all()).find((item) => item.client_capture_id === queuedPhoto.client_capture_id);
      if (!stillQueued) {
        say(card, 'That photo had just uploaded. Tap Mark isolation point again.');
        return;
      }
      await queue.put(Object.assign(stillQueued, { annotations: arrows }));
      queue.changed();
    } else {
      const previous = items.filter((item) => item.kind === 'annotate');
      await Promise.all(previous.map((item) => queue.remove(item.client_capture_id)));
      await queueFrom(card, { kind: 'annotate', annotations: arrows, expect_version: card.dataset.version });
    }
    say(card, arrows.length ? 'Arrow saved. It uploads with the photo.' : 'Arrows cleared.');
    queue.drain();
  });

  // Show "Queued" on every slot that has something waiting to upload, put
  // the photo just taken in place of the old one, and draw the arrows that
  // will be on the placard once it uploads.
  async function markQueued() {
    const root = document.getElementById('slots');
    if (!root) return;
    const waiting = (await queue.all()).filter((item) => item.machine === root.dataset.machine);
    root.querySelectorAll('.slot').forEach((card) => {
      const mine = waitingFor(waiting, card);
      const badge = card.querySelector('[data-queued-slot]');
      if (badge) {
        badge.hidden = mine.length === 0;
        badge.textContent = mine.some((item) => item.state === 'failed') ? 'Upload failed' : 'Queued';
      }
      const withPhoto = mine.filter((item) => item.blob).pop();
      if (withPhoto && !previewUrls.has(card.dataset.slot)) preview(card, withPhoto.blob);
      const withArrows = mine.filter((item) => item.annotations).pop();
      window.WalkdownArrows.paint(card.querySelector('.thumb-wrap'),
        withArrows ? withArrows.annotations : JSON.parse(card.dataset.annotations || '[]'));
    });
  }

  document.addEventListener('walkdown:queue-changed', markQueued);
  document.body.addEventListener('htmx:afterSwap', () => { previewUrls.clear(); markQueued(); });
  markQueued();
}());
