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
# Chromium's built-in test pattern stands in for the phone's rear camera.
FAKE_CAMERA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]


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
                                                 args=["--no-sandbox", *FAKE_CAMERA])
            context = browser.new_context(viewport={"width": 414, "height": 896}, has_touch=True,
                                          permissions=["camera"])
            page = context.new_page()
            page.on("console", lambda m: problems.append(f"{m.text} @ {m.location.get('url', '')}")
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: problems.append(str(e)))
            # Navigating away cancels in-flight loads (ERR_ABORTED): not a fault.
            page.on("requestfailed", lambda r: problems.append(f"request failed: {r.url} ({r.failure})")
                    if "ERR_ABORTED" not in (r.failure or "") else None)

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
            wait_for(lambda: page.locator("section[data-slot=iso] [data-queued-slot]").is_visible(),
                     "the Queued badge")
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
            # The audit row is written just after the placard update, so wait for it.
            wait_for(lambda: fake_state()["hygiene"], "the audit row")
            assert fake_state()["hygiene"][-1]["action"] == "photo_reshoot"
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

            # 9b. the case that failed in production: a machine whose photo the audit
            #     found wrong. Tapping "mark arrow" must take the photo first, then open
            #     the editor, and the arrow must still arrive after the photo uploaded
            #     while the editor was open.
            fresh = next(m for m in SEED if m["merged_iso_verdict"] == "mismatch"
                         and m["equipment_id"] != target["equipment_id"])
            page.goto(f"{APP}/")
            page.fill("input[name=q]", fresh["equipment_id"])
            page.locator("#search-results a.row").first.wait_for()
            page.locator("#search-results a.row").first.click()
            page.wait_for_selector("section[data-slot=iso]")
            mark = page.locator("[data-mark-isolation]")
            assert mark.inner_text() == "Take photo, then mark arrow", mark.inner_text()
            patches, hygiene = len(fake_state()["patches"]), len(fake_state()["hygiene"])
            mark.click()                                     # opens the live camera, not a file menu
            page.wait_for_selector("#camera[open]")
            assert "another machine" in text_of(page, "section[data-slot=iso] [data-capture-message]")
            page.wait_for_function("() => document.getElementById('camera-video').videoWidth > 0")
            page.click("#camera-shutter")
            page.wait_for_selector("#annotator[open]")
            page.locator("#annotator-image").evaluate("i => i.complete || new Promise(r => i.onload = r)")
            wrap = page.locator(".annotator-wrap").bounding_box()
            page.mouse.click(wrap["x"] + wrap["width"] * 0.4, wrap["y"] + wrap["height"] * 0.6)
            # The photo uploads while the editor is still open.
            wait_for(lambda: len(fake_state()["patches"]) > patches, "the photo to upload")
            page.click("#annotator-save")
            wait_for(lambda: len(fake_state()["patches"]) > patches + 1, "the arrow to upload")
            photo_patch, arrow_patch = fake_state()["patches"][patches:patches + 2]
            assert photo_patch["equipment_id"] == fresh["equipment_id"] == arrow_patch["equipment_id"]
            assert "iso_photo_url" in photo_patch and photo_patch["iso_annotations"] == []
            assert "iso_photo_url" not in arrow_patch and len(arrow_patch["iso_annotations"]) == 1
            wait_for(lambda: len(fake_state()["hygiene"]) >= hygiene + 2, "both audit rows")
            assert all(r["tenant_id"] for r in fake_state()["hygiene"])
            print("ok  wrong-photo machine: camera opened, editor opened, arrow followed the photo")

            # 9c. camera blocked or missing: the phone's own capture input takes over
            blocked = browser.new_context(viewport={"width": 414, "height": 896}, has_touch=True)
            blocked.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError'))")
            other = blocked.new_page()
            other.goto(f"{APP}/login/")
            other.fill("#email", "tech@snakking.example")
            other.fill("#password", "pw")
            other.click("button[type=submit]")
            try:
                other.wait_for_selector("input[name=q]", timeout=15000)
            except Exception:
                print("second sign-in stalled:", other.url, other.locator(".error").all_inner_texts(),
                      other.locator("h1").all_inner_texts(), flush=True)
                raise
            other.goto(machine_url)
            other.wait_for_selector("section[data-slot=iso]")
            with other.expect_file_chooser() as picker:
                other.click("section[data-slot=iso] [data-take-photo]")
            assert picker.value.element.get_attribute("capture") == "environment"
            print("ok  camera blocked: falls back to the capture file input")
            blocked.close()

            # 9d. ask a maintenance supervisor to confirm; they answer from a phone, signed out
            page.goto(machine_url)
            page.click("a[href$='/confirm-request/']")
            page.fill("#to_email", "supervisor@snakking.example")
            page.fill("#to_name", "Maria")
            page.click("button[type=submit]")
            page.wait_for_selector("#confirm-link")
            assert "Not sent yet" in page.content()          # no email key in this environment
            assert page.locator("a[href^='mailto:supervisor']").count() == 1
            confirm_link = page.input_value("#confirm-link")
            supervisor = browser.new_context(viewport={"width": 402, "height": 874}, has_touch=True)
            sp = supervisor.new_page()
            sp.goto(confirm_link)
            sp.wait_for_selector("section.slot[data-slot=iso]")
            assert sp.locator(".bar a").count() == 0 and "Sync" not in sp.content()
            sp.wait_for_function("() => [...document.querySelectorAll('.thumb')].every(i => i.complete && i.naturalWidth > 0)")
            sp.check("input[name=equip_decision][value=confirmed]")
            sp.check("input[name=iso_decision][value=rejected]")
            sp.click("button[type=submit]")                    # no note and no name yet: the browser blocks it
            assert sp.locator("input[name=iso_note], textarea[name=iso_note]").evaluate("e => e.validity.valueMissing")
            sp.fill("#iso_note", "That arrow is on the wrong disconnect")
            sp.fill("#name", "Maria Lopez")
            sp.click("button[type=submit]")
            sp.wait_for_selector("text=Thank you, Maria Lopez")
            assert "flagged as not right" in sp.content()
            page.goto(machine_url)
            assert "Maria Lopez" in page.content() and "flagged as not right" in page.content()
            page.goto(f"{APP}/report/")
            assert "Maria Lopez" in page.content()
            supervisor.close()
            print("ok  supervisor confirmation: request, answer from a signed-out phone, shown to staff and in the report")

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

            # While the test holds the browser offline the app still tries to upload (it
            # cannot trust navigator.onLine on cellular); that failed attempt is expected.
            problems[:] = [p for p in problems
                           if not ("ERR_INTERNET_DISCONNECTED" in p and "/api/captures/" in p)]
            csp = [p for p in problems if "Content Security Policy" in p or "Refused" in p]
            assert not csp, csp
            assert not problems, problems
            print("ok  no console errors or CSP violations")
            browser.close()
    finally:
        if problems:
            print("browser console errors:", *problems, sep="\n  ", file=sys.stderr)
        app.terminate()
        fake.terminate()


if __name__ == "__main__":
    run(headed="--headed" in sys.argv)
    print("E2E PASSED")
