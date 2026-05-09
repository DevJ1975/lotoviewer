# Login background photos

Background images for `/login`. `<LoginBackground/>` (in
`apps/web/components/LoginBackground.tsx`) picks one at random on
every mount, applies CSS `grayscale` + a navy tint, and runs a slow
zoom/drift plus pointer-driven parallax over it.

Drop **five** JPEGs at the filenames below. Aim for ~1920×1080,
≤500 KB each (these load on every login):

- `worker-1.jpg`
- `worker-2.jpg`
- `worker-3.jpg`
- `worker-4.jpg`
- `worker-5.jpg`

Image criteria:
- Industrial / field-worker scenes (matches the LOTO Viewer audience).
- Decent contrast so the white sign-in card reads after the navy tint.
- Important subject roughly centered — the image is `object-cover`
  and gets cropped on narrow viewports.

To change the count or filenames, update the `BACKGROUNDS` array in
`LoginBackground.tsx` to match.
