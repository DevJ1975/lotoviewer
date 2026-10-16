"""Browser test of the walkdown against the real Django app (gunicorn, as in
Docker) and a fake Supabase. It proves what unit tests cannot: the service
worker serves a downloaded department with no signal, a photo and arrow taken
offline queue on the phone, and everything reaches Supabase once signal is back.

    pip install -r requirements-dev.txt playwright
    python e2e/run_e2e.py [--headed]

Uses the Chromium that ships with Playwright (PLAYWRIGHT_BROWSERS_PATH).
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SEED = json.loads((ROOT / "seed" / "snak_king_photo_audit.json").read_text())["machines"]
FAKE_PORT, APP_PORT = 54321, 8765
APP = f"http://localhost:{APP_PORT}"
FAKE = f"http://127.0.0.1:{FAKE_PORT}"
CHROMIUM = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")


def wait_for(condition, what, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = condition()
        if value:
            return value
        time.sleep(0.2)
    raise AssertionError(f"Timed out waiting for {what}")


def fake_state():
    with urllib.request.urlopen(f"{FAKE}/__state", timeout=5) as response:
        return json.load(response)


def exif_rotated_jpeg() -> bytes:
    """A landscape 3000x2000 frame flagged "rotate 90°", as a phone saves a portrait shot."""
    exif = Image.Exif()
    exif[0x0112] = 6
    buffer = io.BytesIO()
    Image.new("RGB", (3000, 2000), "#7a9").save(buffer, "JPEG", exif=exif, quality=92)
    return buffer.getvalue()


def start_servers(data_dir: str):
    env = {**os.environ, "DJANGO_SECRET_KEY": "e2e", "DJANGO_SSL_REDIRECT": "0",
           "SUPABASE_URL": FAKE, "SUPABASE_ANON_KEY": "a", "SUPABASE_SERVICE_ROLE_KEY": "s",
           "WALKDOWN_TENANT_ID": "ae3f1973-4c3e-4b6e-b91f-9de5ff10529e",
           "ALLOWED_HOSTS": "localhost", "WALKDOWN_DATA_DIR": data_dir,
           "PLATFORM_URL": "https://soteriafield.app"}
    env.pop("DJANGO_DEBUG", None)
    fake = subprocess.Popen([sys.executable, str(ROOT / "e2e/fake_supabase.py"), str(FAKE_PORT)])
    for command in (["migrate", "--noinput"], ["load_deltas", "--no-refresh"],
                    ["collectstatic", "--noinput"]):
        subprocess.run([sys.executable, "manage.py", *command], cwd=ROOT, env=env, check=True,
                       stdout=subprocess.DEVNULL)
    app = subprocess.Popen([sys.executable, "-m", "gunicorn", "config.wsgi", "--bind",
                            f"127.0.0.1:{APP_PORT}", "--workers", "1", "--threads", "8"],
                           cwd=ROOT, env=env)
    wait_for(lambda: _up(f"{APP}/healthz"), "the app to start")
    return fake, app


def _up(url):
    try:
        return urllib.request.urlopen(url, timeout=2).status == 200
    except OSError:
        return False


def text_of(page: Page, selector: str) -> str:
    return page.locator(selector).first.inner_text()


def run(headed: bool) -> None:
    data_dir = tempfile.mkdtemp(prefix="walkdown-e2e-")
    fake, app = start_servers(data_dir)
    problems: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=f"{CHROMIUM}/chrome-linux/chrome"
                                                 if Path(f"{CHROMIUM}/chrome-linux/chrome").exists()
                                                 else None, headless=not headed,
                                                 args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 414, "height": 896}, has_touch=True)
            page = context.new_page()
            page.on("console", lambda m: problems.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: problems.append(str(e)))

            # 1. sign in
            page.goto(f"{APP}/login/")
            page.fill("#email", "tech@snakking.example")
            page.fill("#password", "pw")
            page.click("button[type=submit]")
            page.wait_for_url(f"{APP}/")
            print("ok  signed in")

            # 2. pick a machine whose isolation photo the audit could not rule out, so
            #    both "confirm" and "mark arrow on existing photo" are available
            target = next(m for m in SEED if m["merged_iso_verdict"] == "mismatch")
            confirm_only = next(m for m in SEED if m["merged_iso_verdict"] == "low_confidence")
            page.fill("input[name=q]", target["equipment_id"])
            page.locator("#search-results a.row").first.wait_for()
            assert target["equipment_id"] in page.locator("#search-results a.row").first.inner_text()
            page.locator("#search-results a.row").first.click()
            page.wait_for_selector("section.slot")
            machine_url = page.url
            department_url = page.locator(".bar-title").inner_text()
            print(f"ok  opened {target['equipment_id']} ({department_url})")

            # 3. download the department for offline use
            page.evaluate("navigator.serviceWorker.ready")
            page.reload()
            page.wait_for_function("navigator.serviceWorker.controller !== null")
            page.click(".bar-title")                        # back to the department page
            page.wait_for_selector("#download-offline")
            page.click("#download-offline")
            wait_for(lambda: "Ready offline" in text_of(page, "#download-status"),
                     "the offline download", timeout=120)
            print("ok  department downloaded:", text_of(page, "#download-status"))

            # 4. lose signal; the cached machine page still opens with photos
            context.set_offline(True)
            page.goto(machine_url)
            page.wait_for_selector("section.slot[data-slot=iso]")
            page.wait_for_function(
                "[...document.querySelectorAll('.thumb')].every(i => i.complete && i.naturalWidth > 0)")
            assert "Offline" in text_of(page, "#net-state")
            print("ok  machine page and photos load offline")

            # 5. take an isolation photo offline
            before_patches = len(fake_state()["patches"])
            page.set_input_files("section[data-slot=iso] [data-capture-input]",
                                 files=[{"name": "p.jpg", "mimeType": "image/jpeg",
                                         "buffer": exif_rotated_jpeg()}])
            wait_for(lambda: "Saved on this phone" in text_of(page, "section[data-slot=iso] [data-capture-message]"),
                     "the photo to be saved")
            assert page.locator("section[data-slot=iso] [data-queued-slot]").is_visible()
            assert page.locator("#queue-count").inner_text() == "1"
            print("ok  photo queued on the phone, nothing sent")

            # 6. mark the isolation point on it, offline
            page.click("[data-mark-isolation]")
            page.wait_for_selector("#annotator[open]")
            wrap = page.locator(".annotator-wrap").bounding_box()
            page.mouse.click(wrap["x"] + wrap["width"] * 0.6, wrap["y"] + wrap["height"] * 0.4)
            page.wait_for_selector("#annotator-overlay polygon")
            page.click("#annotator-labels .chip >> nth=0")
            assert page.locator("#annotator-overlay text").count() == 1
            page.mouse.move(wrap["x"] + wrap["width"] * 0.2, wrap["y"] + wrap["height"] * 0.8)
            page.mouse.down()
            page.mouse.move(wrap["x"] + wrap["width"] * 0.35, wrap["y"] + wrap["height"] * 0.7, steps=5)
            page.mouse.up()
            assert page.locator("#annotator-overlay polygon").count() == 2
            page.click("#annotator-undo")
            assert page.locator("#annotator-overlay polygon").count() == 1
            page.click("#annotator-save")
            page.wait_for_function("!document.getElementById('annotator').open")
            page.wait_for_selector("section[data-slot=iso] .overlay polygon")
            assert len(fake_state()["patches"]) == before_patches
            print("ok  arrow drawn offline and shown on the photo")

            # 7. signal returns: photo + arrow reach Supabase together
            context.set_offline(False)
            page.evaluate("window.dispatchEvent(new Event('online'))")
            wait_for(lambda: len(fake_state()["patches"]) > before_patches, "the sync", timeout=30)
            state = fake_state()
            patch = state["patches"][-1]
            assert patch["equipment_id"] == target["equipment_id"], patch
            assert patch["iso_photo_is_placeholder"] is False
            assert patch["placard_url"] is None and patch["placard_qr_backfilled"] is False
            [arrow] = patch["iso_annotations"]
            assert arrow["label"] and 0 <= arrow["x2"] <= 1
            [stored] = [key for key in state["uploads"] if key.endswith(".jpg")]
            assert "_ISO_" in stored, stored
            upload = urllib.request.urlopen(f"{FAKE}/storage/v1/object/public/loto-photos/{stored}").read()
            width, height = Image.open(io.BytesIO(upload)).size
            assert height > width and max(width, height) <= 2048 and len(upload) <= 1_000_000, (width, height)
            assert state["hygiene"][-1]["action"] == "photo_reshoot"
            wait_for(lambda: page.locator("#queue-count").is_hidden(), "the queue to empty")
            print(f"ok  synced: upright {width}x{height} JPEG under 1 MB, arrow saved, audit row written")

            # 8. the card refreshes itself via HTMX
            wait_for(lambda: "Re-shot" in text_of(page, "section[data-slot=iso] .chip") or
                     "Done" in text_of(page, "section[data-slot=iso] .chip"), "the status chip to update")
            print("ok  status refreshed in place:", text_of(page, "section[data-slot=iso] .chip"))

            # 9. arrow on a photo that is already on the placard (no new photo)
            page.goto(f"{APP}/")
            page.fill("input[name=q]", confirm_only["equipment_id"])
            page.locator("#search-results a.row").first.wait_for()
            page.locator("#search-results a.row").first.click()
            page.wait_for_selector("section[data-slot=iso]")
            patches = len(fake_state()["patches"])
            page.click("[data-mark-isolation]")
            page.wait_for_selector("#annotator[open]")
            page.locator("#annotator-image").evaluate("i => i.complete || new Promise(r => i.onload = r)")
            wrap = page.locator(".annotator-wrap").bounding_box()
            page.mouse.click(wrap["x"] + wrap["width"] * 0.5, wrap["y"] + wrap["height"] * 0.5)
            page.click("#annotator-save")
            wait_for(lambda: len(fake_state()["patches"]) > patches, "the arrow to upload")
            last = fake_state()["patches"][-1]
            assert "iso_photo_url" not in last and len(last["iso_annotations"]) == 1, last
            print("ok  arrow added to an existing photo without replacing it")

            # 10. the client report and its public link
            page.goto(f"{APP}/report/")
            assert "View placard" in page.content()
            link = page.input_value("#client-link")
            guest = browser.new_context().new_page()
            guest.goto(link)
            html = guest.content()
            assert target["equipment_id"] in html and "https://soteriafield.app/qr/tok-" in html
            assert "tech@snakking.example" not in html
            print("ok  client report link works signed out and shows the placard link")

            csp = [p for p in problems if "Content Security Policy" in p or "Refused" in p]
            assert not csp, csp
            assert not problems, problems
            print("ok  no console errors or CSP violations")
            browser.close()
    finally:
        app.terminate()
        fake.terminate()


if __name__ == "__main__":
    run(headed="--headed" in sys.argv)
    print("E2E PASSED")
