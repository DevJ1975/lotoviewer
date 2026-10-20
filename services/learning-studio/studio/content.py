"""Pure helpers over a module's `content` document (see packages/core/src/strikeContent.ts).

No I/O except load/save of a seed's module.json. Everything else takes and
returns plain dicts so commands and views share one tested implementation.
"""
import copy
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

WORDS_PER_SECOND = 2.5  # the pace the seed scripts' beat cues were authored against
CONTENT_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".mp3": "audio/mpeg", ".vtt": "text/vtt", ".mp4": "video/mp4",
}


def load_module(seed_dir: Path) -> dict:
    return json.loads((seed_dir / "module.json").read_text(encoding="utf-8"))


def save_module(seed_dir: Path, module: dict) -> None:
    text = json.dumps(module, indent=2, ensure_ascii=False) + "\n"
    (seed_dir / "module.json").write_text(text, encoding="utf-8")


def scenes(content: dict) -> list[dict]:
    return [b for b in content["blocks"] if b.get("kind") == "motion_scene"]


def estimated_script_ms(script: str) -> int:
    return round(len(script.split()) / WORDS_PER_SECOND * 1000)


def rescale_beats(beats: list[dict], reference_ms: int, actual_ms: int) -> list[dict]:
    """Stretch authored cue times to the real narration length, keeping order
    and never cueing a beat after the audio ends."""
    if reference_ms <= 0 or actual_ms <= 0:
        return [dict(b) for b in beats]
    factor = actual_ms / reference_ms
    ceiling = max(0, actual_ms - 500)
    return [{**b, "at_ms": min(ceiling, round(b["at_ms"] * factor))} for b in beats]


def content_type_for(path: str) -> str:
    return CONTENT_TYPES.get(PurePosixPath(path).suffix.lower(), "application/octet-stream")


def media_prefix_for(module: dict, tenant_id: str | None = None) -> str:
    """Storage folder for a module's media. Tenant-owned modules must live under
    the tenant's own top-level folder (strike-media storage policy), so the
    seed's global/ prefix is swapped for the tenant id."""
    prefix = module["media_prefix"].strip("/")
    if not tenant_id:
        return prefix
    rest = prefix.split("/", 1)[1] if prefix.startswith("global/") else prefix
    return f"{tenant_id}/{rest}"


def bucket_path(prefix: str, path: str) -> str:
    """Seed refs are bare filenames; bucket refs already carry the prefix."""
    return path if "/" in path else f"{prefix.strip('/')}/{path}"


def _media_refs(block: dict):
    """Yield (owner dict, field name) for every media path in a block."""
    for key in ("image",):
        ref = block.get(key)
        if isinstance(ref, dict) and ref.get("path"):
            yield ref, "path"
    narration = block.get("narration")
    if isinstance(narration, dict):
        for field in ("audio_path", "captions_path"):
            if narration.get(field):
                yield narration, field


@dataclass(frozen=True)
class Upload:
    local: Path
    bucket_path: str


def rewrite_media_paths(content: dict, prefix: str, seed_dir: Path) -> tuple[dict, list[Upload], list[str]]:
    """Return (content with bucket paths, files to upload, missing local files)."""
    rewritten = copy.deepcopy(content)
    uploads: dict[str, Upload] = {}
    missing: list[str] = []
    for block in rewritten["blocks"]:
        for owner, field in _media_refs(block):
            original = owner[field]
            target = bucket_path(prefix, original)
            owner[field] = target
            local = seed_dir / PurePosixPath(original).name
            if local.is_file():
                uploads[target] = Upload(local, target)
            elif "/" not in original:
                missing.append(original)
    return rewritten, list(uploads.values()), sorted(set(missing))


def set_approval(content: dict, asset_path: str, approver: str | None, at: str | None) -> tuple[dict, int]:
    """Stamp (or clear, when approver is None) the approval on every image or
    narration whose path matches. Returns the new content and match count."""
    updated = copy.deepcopy(content)
    matched = 0
    for block in updated["blocks"]:
        image = block.get("image")
        if isinstance(image, dict) and image.get("path") == asset_path:
            image["approved_by"], image["approved_at"] = approver, at
            matched += 1
        narration = block.get("narration")
        if isinstance(narration, dict) and narration.get("audio_path") == asset_path:
            narration["approved_by"], narration["approved_at"] = approver, at
            matched += 1
    return updated, matched


@dataclass(frozen=True)
class BoardAsset:
    block_key: str
    title: str
    kind: str  # image | narration
    path: str
    alt_or_transcript: str
    captions_path: str | None
    ai_generated: bool
    approved_by: str | None
    approved_at: str | None


def board_assets(content: dict) -> list[BoardAsset]:
    """Everything a reviewer must look at, in playback order."""
    assets: list[BoardAsset] = []
    for block in content.get("blocks", []):
        title = block.get("title") or block.get("prompt") or block.get("stem") or block["key"]
        image = block.get("image")
        if isinstance(image, dict) and image.get("path"):
            assets.append(BoardAsset(block["key"], title, "image", image["path"],
                                     image.get("alt", ""), None, bool(image.get("ai_generated")),
                                     image.get("approved_by"), image.get("approved_at")))
        narration = block.get("narration")
        if isinstance(narration, dict) and narration.get("audio_path"):
            assets.append(BoardAsset(block["key"], title, "narration", narration["audio_path"],
                                     narration.get("transcript", ""), narration.get("captions_path"),
                                     bool(narration.get("ai_generated")),
                                     narration.get("approved_by"), narration.get("approved_at")))
    return assets
