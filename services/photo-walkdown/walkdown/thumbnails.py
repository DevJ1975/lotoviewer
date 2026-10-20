"""Photo thumbnails served from this app, never straight from Supabase.

Keeps the page's img-src to 'self' and keeps a department's worth of photos small
enough to cache on a phone. The proxy only ever fetches objects in our own bucket.
"""
import hashlib
import io
import logging

from django.conf import settings
from django.http import FileResponse, HttpResponse
from PIL import Image, UnidentifiedImageError

from . import supabase

log = logging.getLogger(__name__)


def placeholder(text: str, size: int) -> bytes:
    from PIL import ImageDraw

    image = Image.new("RGB", (size, size * 3 // 4), "#E8EEF8")
    ImageDraw.Draw(image).text((20, size * 3 // 8 - 6), text, fill="#6B7385")
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=80)
    return buffer.getvalue()


def cached_thumbnail(url: str, size: int):
    """Path of a cached JPEG no larger than `size` px, or None if it cannot be made."""
    cache_dir = settings.THUMBNAIL_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}-{size}.jpg"
    if path.exists():
        return path
    try:
        image = Image.open(io.BytesIO(supabase.download(url)))
        image.thumbnail((size, size))
        image.convert("RGB").save(path, "JPEG", quality=78)
    except (supabase.SupabaseError, supabase.httpx.HTTPError, UnidentifiedImageError, OSError):
        log.warning("Thumbnail unavailable for %s", url, exc_info=True)
        return None
    return path


def thumbnail_response(url: str, size: int):
    """The HTTP response for a photo thumbnail, or a labelled placeholder."""
    if not url:
        return _placeholder_response("No photo on file", size)
    path = cached_thumbnail(url, size)
    if path is None:
        return _placeholder_response("Photo unavailable", size)
    response = FileResponse(path.open("rb"), content_type="image/jpeg")
    # The URL changes whenever the photo does, so a day is safe for the phone.
    response["Cache-Control"] = "private, max-age=86400"
    return response


def _placeholder_response(text: str, size: int):
    response = HttpResponse(placeholder(text, size), content_type="image/jpeg")
    response["Cache-Control"] = "no-store"
    return response
