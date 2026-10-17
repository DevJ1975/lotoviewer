// Supervisor confirmation page: draw the arrows on the photo, and make the
// "what is wrong?" note required only when the answer is "not right".
(function () {
  'use strict';

  document.querySelectorAll('.slot[data-annotations]').forEach((card) => {
    const wrap = card.querySelector('.thumb-wrap');
    if (wrap) window.WalkdownArrows.paint(wrap, JSON.parse(card.dataset.annotations || '[]'));
    const note = card.querySelector('textarea');
    const sync = () => {
      const rejected = card.querySelector('input[value=rejected]:checked');
      note.required = Boolean(rejected);
    };
    card.querySelectorAll('input[type=radio]').forEach((radio) => radio.addEventListener('change', sync));
    sync();
  });
}());
