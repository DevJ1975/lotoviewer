from unittest.mock import Mock

import pytest
from django.db import DatabaseError


@pytest.mark.django_db
def test_healthz_reports_ok_when_database_is_reachable(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_versioned_api_health_reports_ok(client, monkeypatch):
    monkeypatch.setattr("config.api.database_health", lambda: (200, {"status": "ok"}))

    response = client.get("/api/v1/health", secure=True)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_versioned_api_health_reports_database_failure(client, monkeypatch):
    monkeypatch.setattr(
        "config.health.connection.cursor",
        Mock(side_effect=DatabaseError("database offline")),
    )

    response = client.get("/api/v1/health", secure=True)
    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "unreachable"}


def test_versioned_api_openapi_schema_is_available(client):
    response = client.get("/api/v1/openapi.json", secure=True)
    assert response.status_code == 200
    assert response.json()["info"]["version"] == "1.0.0"
    assert "/api/v1/health" in response.json()["paths"]


def test_admin_is_not_mounted_by_default(client):
    assert client.get("/admin/", secure=True).status_code == 404


def test_plain_http_is_redirected_except_for_the_health_probe(client):
    assert client.get("/admin/").status_code == 301
