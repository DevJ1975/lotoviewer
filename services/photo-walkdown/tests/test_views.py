
import httpx
from django.urls import reverse

from walkdown.models import photo_version


def test_departments_and_machine_pages_render(logged_in, machine, fake):
    home = logged_in.get(reverse("departments")).content.decode()
    assert "Fryers" in home and "of 1 machines done" in home
    page = logged_in.get(reverse("machine", args=[machine.pk])).content.decode()
    assert "SK-001" in page and "Electrical disconnect" in page and "Air lockout valve" in page
    assert "Mark isolation point" in page
    assert 'data-label-options="[&quot;Electrical disconnect&quot;' in page


def test_placeholder_or_wrong_photo_offers_neither_confirm_nor_arrow(logged_in, machine, fake):
    # The live row says the isolation photo is a reference placeholder and the
    # audit said it shows another machine: the iso card must offer a new photo only.
    page = logged_in.get(reverse("machine", args=[machine.pk])).content.decode()
    iso_card = page[page.index('data-slot="iso"'):]
    assert 'data-can-mark="0"' in iso_card
    assert "data-confirm-existing" not in iso_card
    equip_card = page[page.index('data-slot="equip"'):page.index('data-slot="iso"')]
    assert "data-confirm-existing" in equip_card          # equipment photo is only "confirm at machine"


def test_unknown_pages_404(logged_in, db):
    assert logged_in.get(reverse("machine", args=[999])).status_code == 404
    assert logged_in.get(reverse("department", args=["nope"])).status_code == 404


def test_department_precache_lists_versioned_thumbnails(logged_in, machine):
    body = logged_in.get(reverse("precache", args=["fryers"])).json()
    assert reverse("department", args=["fryers"]) in body["urls"]
    assert reverse("machine", args=[machine.pk]) in body["urls"]
    expected = f"{reverse('thumb', args=[machine.pk, 'iso'])}?v={photo_version(machine.iso_photo_url)}"
    assert expected in body["urls"]


def test_thumbnail_is_resized_cached_and_fetched_once(logged_in, machine, fake, supabase_mock):
    first = logged_in.get(reverse("thumb", args=[machine.pk, "iso"]))
    assert first.status_code == 200 and first["Content-Type"] == "image/jpeg"
    import io

    from PIL import Image
    assert max(Image.open(io.BytesIO(b"".join(first.streaming_content))).size) <= 480
    before = len(supabase_mock.calls)
    logged_in.get(reverse("thumb", args=[machine.pk, "iso"]))
    assert len(supabase_mock.calls) == before


def test_thumbnail_proxy_refuses_urls_outside_the_photo_bucket(logged_in, machine, supabase_mock):
    machine.iso_photo_url = "https://evil.example/x.jpg"
    machine.save()
    route = supabase_mock.route(host="evil.example").mock(return_value=httpx.Response(200, content=b"x"))
    response = logged_in.get(reverse("thumb", args=[machine.pk, "iso"]))
    assert response.status_code == 200 and not route.called


def test_search_finds_by_id_and_name(logged_in, machine):
    assert "SK-001" in logged_in.get(reverse("search"), {"q": "sk-0"}).content.decode()
    assert "SK-001" in logged_in.get(reverse("search"), {"q": "fryer"}).content.decode()
    assert "No machine" in logged_in.get(reverse("search"), {"q": "zzzz"}).content.decode()


def test_responses_carry_a_strict_csp(logged_in, machine):
    policy = logged_in.get(reverse("departments"))["Content-Security-Policy"]
    assert "script-src 'self'" in policy and "unsafe-inline" not in policy


def test_service_worker_has_root_scope(client, db):
    response = client.get(reverse("service_worker"))
    assert response["Service-Worker-Allowed"] == "/" and "text/javascript" in response["Content-Type"]


def test_machine_status_partial_refreshes_after_sync(logged_in, machine, fake):
    html = logged_in.get(reverse("machine_status", args=[machine.pk])).content.decode()
    assert 'data-slot="iso"' in html and "<html" not in html


def test_health_probe_works_when_only_the_public_domain_is_configured(client, settings):
    settings.ALLOWED_HOSTS = ["photos.soteriafield.app", *settings.HEALTH_PROBE_HOSTS]
    assert client.get(reverse("healthz"), HTTP_HOST="127.0.0.1:8000").status_code == 200
    assert client.get(reverse("healthz"), HTTP_HOST="evil.example").status_code == 400
