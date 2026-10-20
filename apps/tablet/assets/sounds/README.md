# Soteria STRIKE UI sounds

Eleven short sounds for the tablet app, generated with ElevenLabs Sound Effects v2
(`eleven_text_to_sound_v2`, prompt influence 0.3) and chosen by ear from four takes each.

| File | Plays when | Chosen | ElevenLabs generation | Prompt |
|---|---|---|---|---|
| `tap.mp3` | Every button press | take 2 | `Tz2SIUazivqV63nhyHUn` | Soft glassy UI tap, short crisp tick with a tiny warm resonance, premium touchscreen button press |
| `scene-complete.mp3` | A narrated scene finishes | take 3 | `CYjnJ7L4DmbKJ9vsJx0f` | Gentle two-note rising chime, soft mallet on glass bells, calm and reassuring, clean tail |
| `correct.mp3` | Right answer in a practice check or the quiz | take 2 | `zcnJXgVNkzfnix0SsC62` | Single bright warm bell ping, clean sine-like tone, quick shimmer decay, premium correct-answer confirmation |
| `incorrect.mp3` | Wrong answer (deliberately gentle) | take 1 | `mCCfm45NkNfTuCABcfbi` | Soft low muted wooden knock, short and gentle, non-harsh try-again tone |
| `hint.mp3` | A hint is revealed | take 3 | `KfdVNPncpZn72xAV7gmb` | Airy sparkle chime, three tiny high bell notes with a soft shimmer, light and curious |
| `locked.mp3` | Tapping a block that is still locked | take 1 | `HWWaJPGSl2fGtovvOE2G` | Dull soft thud of a closed padded lock, short low muted click, subtle and unobtrusive |
| `module-pass.mp3` | Celebration after a passing score | take 1 | `NIrI5UKCDi2GzdqPDGKT` | Triumphant ascending chime cascade, glass bells and soft synth pad swell, warm, refined and celebratory, ends on a sustained bright note |
| `badge.mp3` | A badge is unlocked | take 4 | `wObdNXnMwiVAEGPtG6sQ` | Shimmering bell arpeggio rising, magical glittering tail, rewarding achievement unlock |
| `sync-done.mp3` | Offline attempts reached the server | take 1 | `pH3sQyxwKaKHCgJSlchZ` | Soft double blip confirmation, two quick rounded tones, subtle and clean, background sync complete |
| `transition.mp3` | Kiosk moves to the next worker | take 4 | `sdlPOHXrI4tdJKrW48Qn` | Smooth airy whoosh, soft swipe transition with a faint tonal lift, quick and clean |
| `brand-sting.mp3` | App launch, behind the bolt logo | take 4 | `HddriH5eCaOoUVNnu4a8` | Short electric zap that resolves into a deep resonant bell chime, powerful yet polished, brand logo sting |

## Mastering

`master.py` turns the chosen raw takes into the files here. Per sound it trims leading and
trailing silence (keeping 150 ms of natural decay), fades out over 80 ms, sets sustained
sounds near -20 LUFS with a -3 dBFS peak ceiling, and writes mono 44.1 kHz MP3. Clips under
0.4 s are gated out of LUFS, so they are leveled by peak. The wrong-answer and locked sounds
sit a few dB quieter than the rest on purpose.

The raw takes are not kept in the repository. To re-master, download the generations above
from ElevenLabs into `<dir>/<name>/<name>-v<take>.mp3` and run
`python3 master.py <dir> <out-dir>` (needs `ffmpeg` and `ffprobe` on the PATH).

## Before a store release

Confirm the ElevenLabs plan used to generate these covers commercial use of the audio.
