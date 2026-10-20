"""Render a STRIKE module to a downloadable MP4 with ffmpeg.

The in-app player is the primary experience (crisp text, live interactions);
this MP4 is the offline/shareable copy. Each block becomes one segment encoded
with identical parameters, so the segments concatenate losslessly.

Command building is pure (testable without ffmpeg); `render_module` runs it.
Every piece of on-screen text goes through drawtext's `textfile=` option, so
script content never needs filter-graph escaping.
"""
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from .captions import group_cues, words_from_script, wrap

WIDTH, HEIGHT, FPS = 1920, 1080, 30
NAVY, YELLOW = "0x1D3ECF", "0xFFD900"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
NARRATION_TAIL_S = 0.75
SILENT_SCENE_MIN_S = 5.0
CARD_SECONDS = 3.0
CALLOUT_SECONDS = 6.0
ZOOM = 0.12

VIDEO_CODEC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
               "-r", str(FPS)]
AUDIO_CODEC = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"]


@dataclass(frozen=True)
class SceneSegment:
    key: str
    image: Path | None
    audio: Path | None
    duration_s: float
    animation: str
    eyebrow: str
    title: str
    beats: tuple[tuple[float, str], ...]
    script: str


@dataclass(frozen=True)
class CardSegment:
    key: str
    heading: str
    body: str
    footer: str
    duration_s: float


Segment = SceneSegment | CardSegment


@dataclass
class SegmentCommand:
    args: list[str]
    text_files: dict[Path, str] = field(default_factory=dict)


def local_media(seed_dir: Path, path: str | None) -> Path | None:
    """Media refs are bare filenames in the seed and bucket paths after import;
    either way the local copy is the basename inside the seed directory."""
    if not path:
        return None
    candidate = seed_dir / PurePosixPath(path).name
    return candidate if candidate.is_file() else None


def build_segments(module: dict, seed_dir: Path) -> list[Segment]:
    segments: list[Segment] = []
    for block in module["content"]["blocks"]:
        kind = block["kind"]
        if kind == "motion_scene":
            narration = block.get("narration") or {}
            audio = local_media(seed_dir, narration.get("audio_path"))
            beats = tuple((b["at_ms"] / 1000, b["text"]) for b in block.get("beats", []))
            if audio and narration.get("duration_ms"):
                duration = narration["duration_ms"] / 1000 + NARRATION_TAIL_S
            else:
                last_beat = beats[-1][0] if beats else 0.0
                duration = max(SILENT_SCENE_MIN_S, last_beat + 2.5)
                audio = None
            segments.append(SceneSegment(
                key=block["key"],
                image=local_media(seed_dir, (block.get("image") or {}).get("path")),
                audio=audio,
                duration_s=round(duration, 3),
                animation=block.get("animation", "ken_burns_in"),
                eyebrow=block.get("eyebrow") or "",
                title=block["title"],
                beats=beats,
                script=block.get("script", ""),
            ))
        elif kind == "callout":
            segments.append(CardSegment(block["key"], block["title"], block.get("body", ""),
                                        "", CALLOUT_SECONDS))
        else:
            prompt = block.get("prompt") or block.get("stem") or ""
            segments.append(CardSegment(block["key"], "Interactive check", prompt,
                                        "Complete it in the Soteria app", CARD_SECONDS))
    return segments


def zoompan_expr(animation: str, frames: int) -> str:
    progress = f"on/{max(1, frames - 1)}"
    centre = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if animation == "ken_burns_in":
        return f"zoompan=z='1+{ZOOM}*{progress}':{centre}"
    if animation == "ken_burns_out":
        return f"zoompan=z='{1 + ZOOM}-{ZOOM}*{progress}':{centre}"
    if animation == "pan_left":
        return f"zoompan=z='{1 + ZOOM}':x='(iw-iw/zoom)*(1-{progress})':y='ih/2-(ih/zoom/2)'"
    if animation == "pan_right":
        return f"zoompan=z='{1 + ZOOM}':x='(iw-iw/zoom)*{progress}':y='ih/2-(ih/zoom/2)'"
    return f"zoompan=z='1':{centre}"


def _drawtext(textfile: Path, *, font: str, size: int, color: str, x: str, y: str,
              enable: str | None = None, box: bool = False) -> str:
    parts = [f"drawtext=fontfile={font}", f"textfile={textfile}", f"fontsize={size}",
             f"fontcolor={color}", f"x={x}", f"y={y}", "line_spacing=10"]
    if box:
        parts += ["box=1", "boxcolor=black@0.55", "boxborderw=18"]
    if enable:
        parts.append(f"enable='{enable}'")
    return ":".join(parts)


def scene_command(segment: SceneSegment, out: Path, workdir: Path, *,
                  burn_captions: bool = False, ffmpeg: str = "ffmpeg") -> SegmentCommand:
    frames = max(1, round(segment.duration_s * FPS))
    texts: dict[Path, str] = {}

    def textfile(name: str, content: str) -> Path:
        path = workdir / f"{segment.key}-{name}.txt"
        texts[path] = content
        return path

    if segment.image:
        video_input = ["-loop", "1", "-framerate", str(FPS), "-t", f"{segment.duration_s}",
                       "-i", str(segment.image)]
        base = (f"[0:v]scale={WIDTH * 2}:{HEIGHT * 2}:force_original_aspect_ratio=increase,"
                f"crop={WIDTH * 2}:{HEIGHT * 2},{zoompan_expr(segment.animation, frames)}"
                f":d=1:s={WIDTH}x{HEIGHT}:fps={FPS}")
    else:
        video_input = ["-f", "lavfi", "-t", f"{segment.duration_s}",
                       "-i", f"color=c={NAVY}:s={WIDTH}x{HEIGHT}:r={FPS}"]
        base = "[0:v]null"

    if segment.audio:
        audio_input = ["-i", str(segment.audio)]
        audio_filter = "[1:a]aresample=44100,aformat=channel_layouts=stereo,apad[a]"
    else:
        audio_input = ["-f", "lavfi", "-t", f"{segment.duration_s}",
                       "-i", "anullsrc=r=44100:cl=stereo"]
        audio_filter = "[1:a]anull[a]"

    overlays = [
        f"drawbox=x=0:y=ih-230:w=iw:h=230:color={NAVY}@0.88:t=fill",
        f"drawbox=x=0:y=ih-230:w=14:h=230:color={YELLOW}:t=fill",
    ]
    if segment.eyebrow:
        overlays.append(_drawtext(textfile("eyebrow", segment.eyebrow.upper()), font=FONT_BOLD,
                                  size=30, color=YELLOW, x="60", y="h-200"))
    overlays.append(_drawtext(textfile("title", segment.title), font=FONT_BOLD, size=56,
                              color="white", x="60", y="h-150"))
    for index, (at_s, text) in enumerate(segment.beats):
        overlays.append(_drawtext(textfile(f"beat{index}", f"▸ {text}"), font=FONT_BOLD,
                                  size=40, color="white", x="70", y=f"{70 + index * 78}",
                                  enable=f"gte(t,{at_s:.3f})", box=True))
    if burn_captions and segment.script:
        speech_s = segment.duration_s - (NARRATION_TAIL_S if segment.audio else 0)
        for index, cue in enumerate(group_cues(words_from_script(segment.script,
                                                                 round(speech_s * 1000)))):
            overlays.append(_drawtext(textfile(f"cue{index}", "\n".join(cue.lines)),
                                      font=FONT_REGULAR, size=38, color=YELLOW,
                                      x="(w-text_w)/2", y="h-330",
                                      enable=f"between(t,{cue.start:.3f},{cue.end:.3f})",
                                      box=True))

    graph = f"{base},{','.join(overlays)},format=yuv420p[v];{audio_filter}"
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *video_input, *audio_input,
            "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", f"{segment.duration_s}",
            *VIDEO_CODEC, *AUDIO_CODEC, str(out)]
    return SegmentCommand(args, texts)


def card_command(segment: CardSegment, out: Path, workdir: Path, *,
                 ffmpeg: str = "ffmpeg") -> SegmentCommand:
    texts: dict[Path, str] = {}

    def textfile(name: str, content: str) -> Path:
        path = workdir / f"{segment.key}-{name}.txt"
        texts[path] = content
        return path

    overlays = [
        f"drawbox=x=120:y=300:w=18:h=480:color={YELLOW}:t=fill",
        _drawtext(textfile("heading", segment.heading.upper()), font=FONT_BOLD, size=44,
                  color=YELLOW, x="180", y="320"),
        _drawtext(textfile("body", "\n".join(wrap(segment.body, 44))), font=FONT_BOLD, size=54,
                  color="white", x="180", y="400"),
    ]
    if segment.footer:
        overlays.append(_drawtext(textfile("footer", segment.footer), font=FONT_REGULAR, size=36,
                                  color="white@0.85", x="180", y="h-200"))
    graph = f"[0:v]{','.join(overlays)},format=yuv420p[v];[1:a]anull[a]"
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-t", f"{segment.duration_s}",
            "-i", f"color=c={NAVY}:s={WIDTH}x{HEIGHT}:r={FPS}",
            "-f", "lavfi", "-t", f"{segment.duration_s}", "-i", "anullsrc=r=44100:cl=stereo",
            "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", f"{segment.duration_s}",
            *VIDEO_CODEC, *AUDIO_CODEC, str(out)]
    return SegmentCommand(args, texts)


def concat_command(parts: list[Path], list_file: Path, out: Path,
                   ffmpeg: str = "ffmpeg") -> SegmentCommand:
    listing = "".join(f"file '{p.as_posix()}'\n" for p in parts)
    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
            "-i", str(list_file), "-c", "copy", "-movflags", "+faststart", str(out)]
    return SegmentCommand(args, {list_file: listing})


def _run(command: SegmentCommand) -> None:
    for path, content in command.text_files.items():
        path.write_text(content, encoding="utf-8")
    result = subprocess.run(command.args, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.strip()[-800:]}")


def render_module(module: dict, seed_dir: Path, out: Path, *, burn_captions: bool = False,
                  ffmpeg: str = "ffmpeg", on_segment=None) -> Path:
    segments = build_segments(module, seed_dir)
    if not segments:
        raise ValueError("Module has no blocks to render")
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="strike-render-") as tmp:
        workdir = Path(tmp)
        parts: list[Path] = []
        for index, segment in enumerate(segments):
            part = workdir / f"{index:03d}-{segment.key}.mp4"
            if isinstance(segment, SceneSegment):
                command = scene_command(segment, part, workdir, burn_captions=burn_captions,
                                        ffmpeg=ffmpeg)
            else:
                command = card_command(segment, part, workdir, ffmpeg=ffmpeg)
            _run(command)
            parts.append(part)
            if on_segment:
                on_segment(index + 1, len(segments), segment.key)
        _run(concat_command(parts, workdir / "parts.txt", out, ffmpeg=ffmpeg))
    return out


def probe_duration(path: Path, ffprobe: str = "ffprobe") -> float:
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(result.stdout.strip())
