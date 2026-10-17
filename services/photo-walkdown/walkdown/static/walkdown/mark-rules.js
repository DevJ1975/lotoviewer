// The rules behind "Mark isolation point", kept free of the page so they can
// be unit-tested (tests/js/mark-rules.test.mjs) and read in one place.
(function (root) {
  'use strict';

  const TAKE_PHOTO_MESSAGES = {
    no_photo: 'There is no isolation photo yet. Take one and the arrow editor opens.',
    wrong_photo: 'The photo on file is for another machine, so an arrow on it would mislead. '
      + 'Take a new photo and the arrow editor opens.',
  };

  // What tapping the button does.
  //   edit       open the editor now
  //   take_photo open the camera first, then the editor
  function decideMark({ queuedPhoto, hasPhoto, canMark }) {
    if (queuedPhoto) return { action: 'edit' };
    if (hasPhoto && canMark) return { action: 'edit' };
    return { action: 'take_photo', reason: hasPhoto ? 'wrong_photo' : 'no_photo' };
  }

  // Arrows already on the picture being edited. Arrows on the placard's
  // current photo mean nothing on a newly taken one.
  function startingArrows({ queuedPhoto, queuedAnnotate, serverArrows }) {
    if (queuedPhoto) return queuedPhoto.annotations || [];
    if (queuedAnnotate) return queuedAnnotate.annotations || [];
    return serverArrows || [];
  }

  // Where the saved arrows go. The photo may have uploaded while the editor
  // was open (online it takes a second or two), so "no longer queued" is
  // expected, not an error: the arrow then follows that photo to the server.
  //   attach            put the arrows on the photo still waiting to upload
  //   annotate_for_photo send them as their own change, tied to that photo
  //   annotate_existing  send them as their own change on the placard's photo
  function saveTarget({ queuedPhoto, stillQueued }) {
    if (queuedPhoto && stillQueued) return { action: 'attach' };
    if (queuedPhoto) return { action: 'annotate_for_photo', forCapture: queuedPhoto.client_capture_id };
    return { action: 'annotate_existing' };
  }

  // The label on the button, so it never promises something it will refuse.
  function buttonLabel({ queuedPhoto, hasPhoto, canMark }) {
    return decideMark({ queuedPhoto, hasPhoto, canMark }).action === 'edit'
      ? 'Mark isolation point (arrow)'
      : 'Take photo, then mark arrow';
  }

  root.WalkdownMarkRules = {
    TAKE_PHOTO_MESSAGES, decideMark, startingArrows, saveTarget, buttonLabel,
  };
}(typeof window !== 'undefined' ? window : globalThis));
