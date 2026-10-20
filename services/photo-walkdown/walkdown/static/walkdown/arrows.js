// Arrows on a photo. Same shape the platform stores and prints
// (apps/web/lib/photoAnnotations.ts): {type:'arrow', x1,y1,x2,y2, label?}
// with 0-1 coordinates relative to the photo, tail (x1,y1) to head (x2,y2).
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const COLOUR = '#bf1414';
  const MAX_ARROWS = 6;
  const TAP_DISTANCE = 0.04;
  const TAIL_OFFSET = 0.2;

  function element(name, attributes) {
    const node = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  // Draw into `svg`, whose viewBox matches the photo's own pixels so arrow
  // heads are not stretched, however the photo is scaled on screen.
  function draw(svg, image, arrows) {
    const width = image.naturalWidth || 4;
    const height = image.naturalHeight || 3;
    const unit = Math.max(width, height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.replaceChildren();
    arrows.forEach((arrow) => {
      const x1 = arrow.x1 * width;
      const y1 = arrow.y1 * height;
      const x2 = arrow.x2 * width;
      const y2 = arrow.y2 * height;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = unit * 0.05;
      const stroke = unit * 0.012;
      svg.append(element('line', {
        x1, y1, x2: x2 - Math.cos(angle) * head * 0.6, y2: y2 - Math.sin(angle) * head * 0.6,
        stroke: COLOUR, 'stroke-width': stroke, 'stroke-linecap': 'round',
      }));
      const point = (turn) => `${x2 - Math.cos(angle + turn) * head},${y2 - Math.sin(angle + turn) * head}`;
      svg.append(element('polygon', { points: `${x2},${y2} ${point(0.45)} ${point(-0.45)}`, fill: COLOUR }));
      if (arrow.label) {
        const text = element('text', {
          x: Math.min(Math.max(x1, unit * 0.02), width - unit * 0.02), y: y1 < height / 2 ? y1 - stroke * 2 : y1 + unit * 0.05,
          'font-size': unit * 0.04, 'font-weight': 700, fill: COLOUR,
          stroke: '#fff', 'stroke-width': unit * 0.01, 'paint-order': 'stroke',
          'text-anchor': x1 > width * 0.7 ? 'end' : x1 < width * 0.3 ? 'start' : 'middle',
        });
        text.textContent = arrow.label;
        svg.append(text);
      }
    });
  }

  // Paint a slot card's overlay once its photo has loaded.
  function paint(wrap, arrows) {
    const image = wrap.querySelector('img');
    const svg = wrap.querySelector('svg.overlay');
    const render = () => draw(svg, image, arrows);
    if (image.complete && image.naturalWidth) render();
    else image.addEventListener('load', render, { once: true });
  }

  function defaultTail(x, y) {
    const offsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dy] of offsets) {
      const tx = x + dx * TAIL_OFFSET;
      const ty = y + dy * TAIL_OFFSET;
      if (tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1) return { x: tx, y: ty };
    }
    return { x: 0.5, y: 0.5 };
  }

  // Full-screen editor. Resolves with the arrows (possibly none) on Save, or
  // null on Cancel. Drag from open space to the isolation point, or just tap
  // the point and the arrow is drawn for you.
  function edit({ imageUrl, arrows, labelOptions }) {
    const dialog = document.getElementById('annotator');
    const image = document.getElementById('annotator-image');
    const svg = document.getElementById('annotator-overlay');
    const wrap = dialog.querySelector('.annotator-wrap');
    const labelInput = document.getElementById('annotator-label');
    const chips = document.getElementById('annotator-labels');
    const message = document.getElementById('annotator-message');
    const working = arrows.map((arrow) => Object.assign({}, arrow));
    let drag = null;

    function redraw() {
      const shown = drag ? working.concat([drag]) : working;
      draw(svg, image, shown);
      labelInput.disabled = working.length === 0;
      labelInput.value = working.length ? (working[working.length - 1].label || '') : '';
      message.textContent = working.length >= MAX_ARROWS ? `That is the most arrows (${MAX_ARROWS}).` : '';
    }

    function relative(event) {
      const box = wrap.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
        y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
      };
    }

    chips.replaceChildren(...labelOptions.map((text) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = text;
      chip.addEventListener('click', () => {
        if (!working.length) return;
        working[working.length - 1].label = text;
        redraw();
      });
      return chip;
    }));

    return new Promise((resolve) => {
      const controller = new AbortController();
      const { signal } = controller;
      const finish = (result) => {
        controller.abort();
        dialog.close();
        resolve(result);
      };

      wrap.addEventListener('pointerdown', (event) => {
        if (working.length >= MAX_ARROWS) { redraw(); return; }
        wrap.setPointerCapture(event.pointerId);
        const start = relative(event);
        drag = { type: 'arrow', x1: start.x, y1: start.y, x2: start.x, y2: start.y };
      }, { signal });
      wrap.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const point = relative(event);
        drag.x2 = point.x;
        drag.y2 = point.y;
        redraw();
      }, { signal });
      wrap.addEventListener('pointerup', () => {
        if (!drag) return;
        const finished = drag;
        drag = null;
        if (Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) < TAP_DISTANCE) {
          const tail = defaultTail(finished.x1, finished.y1);
          working.push({ type: 'arrow', x1: tail.x, y1: tail.y, x2: finished.x1, y2: finished.y1 });
        } else {
          working.push(finished);
        }
        redraw();
      }, { signal });
      wrap.addEventListener('pointercancel', () => { drag = null; redraw(); }, { signal });

      labelInput.addEventListener('input', () => {
        if (!working.length) return;
        const value = labelInput.value.trim();
        if (value) working[working.length - 1].label = value;
        else delete working[working.length - 1].label;
        redraw();
      }, { signal });
      document.getElementById('annotator-undo').addEventListener('click', () => { working.pop(); redraw(); }, { signal });
      document.getElementById('annotator-clear').addEventListener('click', () => { working.length = 0; redraw(); }, { signal });
      document.getElementById('annotator-cancel').addEventListener('click', () => finish(null), { signal });
      document.getElementById('annotator-save').addEventListener('click', () => finish(working), { signal });
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); }, { signal });

      image.onload = redraw;
      image.src = imageUrl;
      dialog.showModal();
      if (image.complete) redraw();
    });
  }

  window.WalkdownArrows = { paint, edit };
}());
