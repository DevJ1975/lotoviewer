import io
import json
import re

import httpx
import pytest
import respx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from PIL import Image

from walkdown.models import Machine

TENANT = settings.WALKDOWN_TENANT_ID
BASE = settings.SUPABASE_URL


def jpeg_bytes(size=(64, 48), colour="red") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "JPEG")
    return buffer.getvalue()


def live_row(**overrides) -> dict:
    row = {"equipment_id": "SK-001", "equip_photo_url": f"{BASE}/storage/v1/object/public/loto-photos/old_equip.jpg",
           "iso_photo_url": f"{BASE}/storage/v1/object/public/loto-photos/old_iso.jpg",
           "needs_equip_photo": True, "needs_iso_photo": True, "iso_photo_is_placeholder": True,
           "equip_photo_provenance": "reference_placeholder", "iso_photo_provenance": "reference_placeholder",
           "annotations": [], "iso_annotations": [{"type": "arrow", "x1": .1, "y1": .1, "x2": .2, "y2": .2}],
           "qr_token": "tok-sk-001", "photo_status": "partial"}
    row.update(overrides)
    return row


class FakeSupabase:
    """Stands in for Supabase and records every write the app makes."""

    def __init__(self, router: respx.MockRouter, rows: dict[str, dict]):
        self.rows = rows
        self.uploads: list[str] = []
        self.patches: list[dict] = []
        self.hygiene: list[dict] = []
        self.patch_status = 200
        host = "test.supabase.co"
        router.route(method="GET", host=host, path="/rest/v1/loto_equipment").mock(side_effect=self._get)
        router.route(method="PATCH", host=host, path="/rest/v1/loto_equipment").mock(side_effect=self._patch)
        router.route(method="POST", host=host, path__startswith="/storage/v1/object/loto-photos/").mock(side_effect=self._upload)
        router.route(method="POST", host=host, path="/rest/v1/loto_hygiene_log").mock(side_effect=self._log)
        router.route(method="GET", host=host, path__startswith="/storage/v1/object/public/").mock(
            return_value=httpx.Response(200, content=jpeg_bytes((960, 720))))

    def _get(self, request):
        wanted = re.findall(r'"((?:[^"]|"")*)"', request.url.params["equipment_id"])
        return httpx.Response(200, json=[self.rows[w] for w in wanted if w in self.rows])

    def _patch(self, request):
        if self.patch_status != 200:
            return httpx.Response(self.patch_status, json={"message": "boom"})
        body = json.loads(request.content)
        equipment_id = request.url.params["equipment_id"].removeprefix("eq.")
        self.patches.append(body)
        self.rows[equipment_id].update(body)
        return httpx.Response(200, json=[self.rows[equipment_id]])

    def _upload(self, request):
        self.uploads.append(request.url.path)
        return httpx.Response(200, json={"Key": "ok"})

    def _log(self, request):
        self.hygiene.append(json.loads(request.content))
        return httpx.Response(201)


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


@pytest.fixture
def supabase_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
def fake(supabase_mock):
    return FakeSupabase(supabase_mock, {"SK-001": live_row()})


@pytest.fixture
def machine(db) -> Machine:
    audit = {"equipment_id": "SK-001", "description": "SK-001 (Fryer)", "department": "Fryers",
             "energy_codes": ["E", "P"], "merged_iso_verdict": "mismatch",
             "equip_photo": {"verdict": "low_confidence", "notes": "n"},
             "iso_photo": {"verdict": "mismatch", "notes": "Shows another machine", "shows_isolation_point": True,
                           "consistent_with_energy_steps": False},
             "recommended_fix": "Re-shoot the disconnect", "consensus": {}, "action_priority": "high"}
    return Machine.objects.create(
        equipment_id="SK-001", department="Fryers", description="SK-001 (Fryer)",
        energy_codes=["E", "P"], equip_verdict="low_confidence", iso_verdict="mismatch",
        equip_photo_note="n", iso_photo_note="Shows another machine", recommended_fix="Re-shoot the disconnect",
        walk_order=1, audit=audit, qr_token="tok-sk-001",
        equip_photo_url=live_row()["equip_photo_url"], iso_photo_url=live_row()["iso_photo_url"])


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user("tech@snakking.example", "tech@snakking.example")


@pytest.fixture
def logged_in(client, user):
    client.force_login(user)
    return client
