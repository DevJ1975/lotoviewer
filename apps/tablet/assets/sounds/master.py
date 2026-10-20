#!/usr/bin/env python3
"""Trim, fade and level the chosen STRIKE UI sounds.

Per file: find the last moment the sound is meaningfully above its own noise floor
(within 40 dB of its peak and at least 6 dB over the floor), keep 150 ms of natural
decay, fade out over 80 ms, then set gain so sustained sounds sit near -20 LUFS with a
-3 dBFS peak ceiling. Clips under 0.4 s are gated out of LUFS, so they use the peak.
"""
import array, math, os, re, subprocess, sys, tempfile, wave
from pathlib import Path

SRC = Path(sys.argv[1]); OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
PICKS = {'tap':2,'scene-complete':3,'correct':2,'incorrect':1,'hint':3,'locked':1,
         'module-pass':1,'badge':4,'sync-done':1,'transition':4,'brand-sting':4}
WIN, PAD, FADE, PEAK_CEIL, TARGET = 0.01, 0.15, 0.08, -3.0, -20.0

def run(*a, capture=False):
    r = subprocess.run(a, check=True, capture_output=capture, text=True)
    return (r.stdout + r.stderr) if capture else None

def decode(path):
    t = tempfile.mktemp(suffix='.wav')
    run('ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(path),'-ac','1','-ar','44100',t)
    w = wave.open(t); a = array.array('h'); a.frombytes(w.readframes(w.getnframes())); w.close(); os.remove(t)
    return a

def envelope_db(a, sr=44100):
    step = int(sr*WIN); out = []
    for i in range(0, len(a), step):
        seg = a[i:i+step]
        rms = math.sqrt(sum(x*x for x in seg)/len(seg))/32768
        out.append(20*math.log10(rms) if rms > 0 else -150.0)
    return out

def cut_points(env):
    peak = max(env)
    tail = sorted(env[int(len(env)*0.8):])
    floor = tail[len(tail)//2]
    cutoff = max(peak - 40.0, floor + 6.0)
    loud = [i for i, v in enumerate(env) if v > cutoff]
    return max(0, loud[0]*WIN - 0.005), min(len(env)*WIN, (loud[-1]+1)*WIN + PAD)

def measure(path):
    txt = run('ffmpeg','-hide_banner','-nostats','-i',str(path),'-af','ebur128=peak=true','-f','null','-', capture=True)
    lufs = re.findall(r'^\s+I:\s+(-?[\d.]+) LUFS', txt, re.M)[-1]
    peak = re.findall(r'^\s+Peak:\s+(-?[\d.]+) dBFS', txt, re.M)[-1]
    return float(lufs), float(peak)

rows = []
for name, take in PICKS.items():
    src = SRC/name/f'{name}-v{take}.mp3'
    start, end = cut_points(envelope_db(decode(src)))
    dur = end - start
    tmp = Path(tempfile.mktemp(suffix='.wav'))
    run('ffmpeg','-hide_banner','-loglevel','error','-y','-ss',f'{start:.3f}','-t',f'{dur:.3f}','-i',str(src),
        '-af',f'afade=t=out:st={max(0,dur-FADE):.3f}:d={FADE}', str(tmp))
    lufs, peak = measure(tmp)
    by_peak = PEAK_CEIL - peak
    gain = min(TARGET - lufs, by_peak) if (dur >= 0.4 and lufs > -60) else by_peak
    dest = OUT/f'{name}.mp3'
    # MP3 encoding can overshoot sharp transients, so re-encode with less gain until the
    # encoded file itself clears the ceiling.
    for _ in range(4):
        run('ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(tmp),'-af',f'volume={gain:.2f}dB',
            '-c:a','libmp3lame','-q:a','2','-ar','44100','-ac','1',str(dest))
        l2, p2 = measure(dest)
        if p2 <= PEAK_CEIL + 0.5: break
        gain -= (p2 - PEAK_CEIL)
    tmp.unlink()
    rows.append((name, dur, gain, l2, p2, dest.stat().st_size//1024))
print(f"{'sound':<15}{'dur s':>6}{'gain dB':>9}{'LUFS':>7}{'peak':>7}{'KB':>5}")
for r in rows:
    print(f"{r[0]:<15}{r[1]:>6.2f}{r[2]:>9.1f}{r[3]:>7.1f}{r[4]:>7.1f}{r[5]:>5}")
