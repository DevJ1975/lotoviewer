import json
import shutil
import uuid
from pathlib import Path

import httpx
import pytest
import respx
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone

HOST = "test.supabase.co"
TENANT = "ae3f1973-4c3e-4b6e-b91f-9de5ff10529e"
SEED = Path(__file__).resolve().parent.parent / "seed" / "loto-101"


def _eq(params, name):
    value = params.get(name)
    return value.removeprefix("eq.") if value and value.startswith("eq.") else None


def _in(params, name):
    value = params.get(name)
    if value and value.startswith("in.("):
        return set(value[4:-1].split(","))
    return None


class FakeSupabase:
    """In-memory stand-in for the PostgREST/Storage/Auth calls the studio makes."""

    def __init__(self, router: respx.MockRouter):
        self.tables: dict[str, list[dict]] = {
            "strike_modules": [], "strike_module_versions": [],
            "strike_quiz_questions": [], "strike_quiz_answers": [],
        }
        self.uploads: dict[str, bytes] = {}
        self.users = {"root@example.com": ("user-root", "pw")}
        self.superadmins = {"user-root"}
        self.memberships: list[dict] = []
        r = router
        r.route(method="POST", host=HOST, path="/auth/v1/token").mock(side_effect=self._sign_in)
        r.route(method="GET", host=HOST, path="/rest/v1/profiles").mock(side_effect=self._profiles)
        r.route(method="GET", host=HOST, path="/rest/v1/tenant_memberships").mock(
            side_effect=self._memberships)
        r.route(method="GET", host=HOST, path="/rest/v1/strike_modules").mock(side_effect=self._modules)
        r.route(method="GET", host=HOST, path="/rest/v1/strike_module_versions").mock(
            side_effect=self._get_versions)
        r.route(method="POST", host=HOST, path__startswith="/rest/v1/").mock(side_effect=self._insert)
        r.route(method="PATCH", host=HOST, path__startswith="/rest/v1/").mock(side_effect=self._patch)
        r.route(method="DELETE", host=HOST, path="/rest/v1/strike_quiz_questions").mock(
            side_effect=self._delete_questions)
        r.route(method="POST", host=HOST, path__startswith="/storage/v1/object/sign/").mock(
            side_effect=self._sign)
        r.route(method="POST", host=HOST, path__startswith="/storage/v1/object/strike-media/").mock(
            side_effect=self._upload)

    # auth
    def _sign_in(self, request):
        body = json.loads(request.content)
        user = self.users.get(body["email"])
        if not user or user[1] != body["password"]:
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"user": {"id": user[0], "email": body["email"]}})

    def _profiles(self, request):
        user_id = _eq(request.url.params, "id")
        return httpx.Response(200, json=[{"is_superadmin": user_id in self.superadmins}])

    def _memberships(self, request):
        params = request.url.params
        user_id, tenants = _eq(params, "user_id"), _in(params, "tenant_id")
        return httpx.Response(200, json=[
            m for m in self.memberships
            if m["user_id"] == user_id and m["tenant_id"] in tenants and m["role"] in ("owner", "admin")])

    # tables
    def module_with_versions(self, module):
        versions = [v for v in self.tables["strike_module_versions"] if v["module_id"] == module["id"]]
        return {**module, "strike_module_versions": versions}

    def _modules(self, request):
        params = request.url.params
        rows = self.tables["strike_modules"]
        if module_id := _eq(params, "id"):
            rows = [m for m in rows if m["id"] == module_id]
        if slug := _eq(params, "slug"):
            rows = [m for m in rows if m["slug"] == slug]
        if scope := _eq(params, "library_scope"):
            rows = [m for m in rows if m["library_scope"] == scope]
        if "or" in params:
            clause = params["or"]
            rows = [m for m in rows if ("library_scope.eq.global" in clause and m["library_scope"] == "global")
                    or (m.get("tenant_id") and m["tenant_id"] in clause)]
        return httpx.Response(200, json=[self.module_with_versions(m) for m in rows])

    def _get_versions(self, request):
        version_id = _eq(request.url.params, "id")
        return httpx.Response(200, json=[v for v in self.tables["strike_module_versions"]
                                         if v["id"] == version_id])

    def _insert(self, request):
        table = request.url.path.removeprefix("/rest/v1/")
        body = json.loads(request.content)
        rows = body if isinstance(body, list) else [body]
        created = []
        for row in rows:
            row = {"id": str(uuid.uuid4()), **row}
            if table == "strike_module_versions":
                row.setdefault("download_path", None)
            if table == "strike_modules":
                row.setdefault("estimated_minutes", None)
            self.tables[table].append(row)
            created.append(row)
        return httpx.Response(201, json=created)

    def _patch(self, request):
        table = request.url.path.removeprefix("/rest/v1/")
        params = request.url.params
        changes = json.loads(request.content)
        statuses = _in(params, "status")
        matched = [r for r in self.tables[table] if r["id"] == _eq(params, "id")
                   and (statuses is None or r["status"] in statuses)]
        for row in matched:
            row.update(changes)
        return httpx.Response(200, json=matched)

    def _delete_questions(self, request):
        version_id = _eq(request.url.params, "module_version_id")
        doomed = {q["id"] for q in self.tables["strike_quiz_questions"]
                  if q["module_version_id"] == version_id}
        self.tables["strike_quiz_questions"] = [q for q in self.tables["strike_quiz_questions"]
                                                if q["id"] not in doomed]
        self.tables["strike_quiz_answers"] = [a for a in self.tables["strike_quiz_answers"]
                                              if a["question_id"] not in doomed]
        return httpx.Response(204)

    # storage
    def _upload(self, request):
        path = request.url.path.removeprefix("/storage/v1/object/strike-media/")
        self.uploads[path] = request.content
        return httpx.Response(200, json={"Key": path})

    def _sign(self, request):
        path = request.url.path.removeprefix("/storage/v1/object/sign/")
        return httpx.Response(200, json={"signedURL": f"/object/sign/{path}?token=t"})

    # helpers for tests
    def add_module(self, *, status="in_review", version_status="draft", scope="global",
                   tenant_id=None, content=None, download_path=None):
        module = {"id": str(uuid.uuid4()), "slug": "loto-101", "title": "LOTO 101",
                  "library_scope": scope, "tenant_id": tenant_id, "status": status,
                  "estimated_minutes": 5, "updated_at": "2026-10-19T00:00:00Z"}
        self.tables["strike_modules"].append(module)
        version = {"id": str(uuid.uuid4()), "module_id": module["id"], "version_number": 1,
                   "status": version_status, "content": content or {"blocks": []},
                   "download_path": download_path, "passing_score": 80, "published_at": None}
        self.tables["strike_module_versions"].append(version)
        return module, version


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


@pytest.fixture
def fake():
    with respx.mock(assert_all_called=False) as router:
        yield FakeSupabase(router)


@pytest.fixture
def seed_dir(tmp_path):
    target = tmp_path / "loto-101"
    target.mkdir()
    shutil.copy(SEED / "module.json", target / "module.json")
    return target


def scene_content(**image_overrides):
    return {"blocks": [{
        "key": "s1", "kind": "motion_scene", "title": "Why LOTO", "beats": [],
        "image": {"path": "global/loto-101/v1/s1.png", "alt": "Machine", "ai_generated": True,
                  "approved_by": None, "approved_at": None, **image_overrides},
        "narration": {"audio_path": "global/loto-101/v1/s1.mp3",
                      "captions_path": "global/loto-101/v1/s1.vtt", "transcript": "Hi",
                      "duration_ms": 1000, "ai_generated": True, "approved_by": None,
                      "approved_at": None},
    }]}


def sign_in_as(client, email, *, superadmin=True, tenants=()):
    user = get_user_model().objects.create_user(email, email)
    client.force_login(user)
    session = client.session
    session["supabase_user_id"] = "user-root" if superadmin else "user-tenant"
    session["access"] = {"superadmin": superadmin, "tenants": list(tenants)}
    session["access_checked_at"] = timezone.now().timestamp()
    session.save()
    return client


@pytest.fixture
def superadmin_client(client, db):
    return sign_in_as(client, "root@example.com")
