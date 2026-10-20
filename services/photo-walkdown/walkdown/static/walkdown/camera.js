// Live rear-camera capture. Tapping "Take photo" opens the camera itself, so the
// phone never offers a photo-library menu. If the camera cannot be used (no
// permission, no camera, an old browser) the caller falls back to the file input
// that carries capture="environment".
(function () {
  'use strict';

  const CONSTRAINTS = {
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
  };

  function stop(stream) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }

  // Resolves with { blob } for a photo, { fallback: true } when the camera cannot
  // be used, or null when the person cancelled.
  async function capture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { fallback: true };
    const dialog = document.getElementById('camera');
    const video = document.getElementById('camera-video');
    const message = document.getElementById('camera-message');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (error) {
      return { fallback: true };
    }

    return new Promise((resolve) => {
      const controller = new AbortController();
      const { signal } = controller;
      const finish = (result) => {
        controller.abort();
        stop(stream);
        video.srcObject = null;
        if (dialog.open) dialog.close();
        resolve(result);
      };

      message.textContent = '';
      video.srcObject = stream;
      video.play().catch(() => { /* autoplay is on; some browsers still reject play() */ });
      dialog.showModal();

      document.getElementById('camera-cancel').addEventListener('click', () => finish(null), { signal });
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); }, { signal });
      // Leaving the page or locking the phone must release the camera.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') finish(null);
      }, { signal });
      document.getElementById('camera-shutter').addEventListener('click', () => {
        if (!video.videoWidth) { message.textContent = 'The camera is still starting. Try again.'; return; }
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) finish({ blob });
          else message.textContent = 'That photo could not be taken. Try again.';
        }, 'image/jpeg', 0.92);
      }, { signal });
    });
  }

  window.WalkdownCamera = { capture };
}());
