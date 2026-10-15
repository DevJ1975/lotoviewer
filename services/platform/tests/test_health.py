import pytest


@pytest.mark.django_db
def test_healthz_reports_ok_when_database_is_reachable(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_admin_is_not_mounted_by_default(client):
    assert client.get("/admin/", secure=True).status_code == 404


def test_plain_http_is_redirected_except_for_the_health_probe(client):
    assert client.get("/admin/").status_code == 301
