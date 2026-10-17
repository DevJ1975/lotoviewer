"""Stress test: does the walkdown still deliver on a weak cellular link or bad Wi-Fi?

    python e2e/run_network.py

Runs against the real app and the fake Supabase, throttling the browser to weak-3G
speeds and breaking requests on purpose, then checks the fake Supabase for what
actually arrived: every photo exactly once, nothing lost, nothing duplicated.

  A  slow link + failures   a dropped connection, a 503, and a reply lost AFTER the
                            server applied the photo (the dangerous one: a naive retry
                            would upload twice)
  B  stalled request        a request that never answers; the timeout fires and the
                            photo is re-encoded smaller after repeated stalls
  C  lying "offline" flag   navigator.onLine says offline although the link works
  D  two tabs               both try to send the same photo; only one request goes out
  E  burst                  30 phones uploading at once against the single server
"""
import io
import re
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
from pathlib import Path

import httpx
from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_e2e as e2e

DELTAS = [m for m in e2e.SEED
          if m["merged_iso_verdict"] != "match" or m["equip_photo"]["verdict"] != "match"]
PK = {m["equipment_id"]: index + 1 for index, m in enumerate(DELTAS)}  # load_deltas order
WEAK_3G = {"offline": False, "latency": 900, "downloadThroughput": 60_000, "uploadThroughput": 40_000}
ID_IN_BODY = re.compile(rb'name="client_capture_id"\r\n\r\n([0-9a-f-]{36})')


def noisy_photo(size=(2400, 1800), seed=0) -> bytes:
    """A photo that does not compress away: about 1 MB after the phone's compression."""
    image = Image.effect_noise(size, 80 + seed % 5).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=95)
    return buffer.getvalue()


def uploads_for(state, equipment_id):
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", equipment_id)
    return [key for key in state["uploads"] if f"/{safe}/" in key]


def patches_for(state, equipment_id):
    return [p for p in state["patches"] if p["equipment_id"] == equipment_id]


def open_machine(page, equipment_id):
    page.goto(f"{e2e.APP}/m/{PK[equipment_id]}/")
    page.wait_for_selector("section[data-slot=iso]")


def take_photo(page, seed=0):
    page.set_input_files("section[data-slot=iso] [data-capture-input]",
                         files=[{"name": "p.jpg", "mimeType": "image/jpeg", "buffer": noisy_photo(seed=seed)}])


def queued(page):
    return page.evaluate("async () => (await window.WalkdownQueue.all()).map(i => ({id: i.client_capture_id, attempts: i.attempts, size: i.blob ? i.blob.size : 0, error: i.error}))")


def drain(page):
    return page.evaluate("() => window.WalkdownQueue.drain({force: true})")


def sign_in(context):
    page = context.new_page()
    page.goto(f"{e2e.APP}/login/")
    page.fill("#email", "tech@snakking.example")
    page.fill("#password", "pw")
    page.click("button[type=submit]")
    page.wait_for_selector("input[name=q]")
    return page


def run() -> int:
    fake, app = e2e.start_servers(tempfile.mkdtemp(prefix="walkdown-network-"))
    failures: list[str] = []

    def check(condition, message):
        print(("ok  " if condition else "FAIL ") + message, flush=True)
        if not condition:
            failures.append(message)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 414, "height": 896}, has_touch=True)
            page = sign_in(context)
            cdp = context.new_cdp_session(page)

            # ── A: weak 3G, with failures injected on the way ─────────────────────
            a_ids = [m["equipment_id"] for m in DELTAS[:3]]
            attempts: dict[str, int] = {}

            def flaky(route):
                match = ID_IN_BODY.search(route.request.post_data_buffer or b"")
                capture = match.group(1).decode() if match else "?"
                attempts[capture] = attempts.get(capture, 0) + 1
                step = attempts[capture]
                if step == 1:
                    route.abort("connectionreset")
                elif step == 2:
                    route.fulfill(status=503, json={"error": "busy"})
                elif step == 3:
                    route.fetch()           # the server applies it ...
                    route.abort("connectionreset")  # ... but the phone never hears
                else:
                    route.continue_()

            page.route("**/api/captures/", flaky)
            cdp.send("Network.enable")
            cdp.send("Network.emulateNetworkConditions", WEAK_3G)
            started = time.time()
            for index, equipment_id in enumerate(a_ids):
                open_machine(page, equipment_id)
                take_photo(page, index)
                e2e.wait_for(lambda: len(queued(page)) >= 1, "the photo to queue", timeout=60)
                # Wait for the capture to be queued before leaving the page.
                time.sleep(0.5)
            for _ in range(40):  # the user pressing "Sync now" / signal blipping back
                if not queued(page):
                    break
                drain(page)
                time.sleep(1)
            state = e2e.fake_state()
            check(not queued(page), f"A: queue drained over weak 3G in {time.time() - started:.0f}s")
            for equipment_id in a_ids:
                check(len(uploads_for(state, equipment_id)) == 1 and len(patches_for(state, equipment_id)) == 1,
                      f"A: {equipment_id} reached Supabase exactly once despite drop, 503 and a lost reply")
            check(max(attempts.values()) >= 4, f"A: every capture took {min(attempts.values())}-{max(attempts.values())} attempts")
            page.unroute("**/api/captures/")
            cdp.send("Network.emulateNetworkConditions", {**WEAK_3G, "latency": 0,
                     "downloadThroughput": -1, "uploadThroughput": -1})

            # ── B: a request that never answers ────────────────────────────────────
            b_id = DELTAS[3]["equipment_id"]
            page.evaluate("() => { Object.assign(window.WalkdownQueue.tuning, {baseTimeoutMs: 1500, slowestBytesPerSecond: 1e9}); }")
            hung = {"count": 0}

            def stall(route):
                hung["count"] += 1
                if hung["count"] <= 2:
                    return  # never answered
                route.continue_()

            page.route("**/api/captures/", stall)
            open_machine(page, b_id)
            page.evaluate("() => Object.assign(window.WalkdownQueue.tuning, {baseTimeoutMs: 1500, slowestBytesPerSecond: 1e9})")
            take_photo(page, 7)
            e2e.wait_for(lambda: queued(page), "the photo to queue")
            before = queued(page)[0]["size"] if queued(page) else 0
            for _ in range(8):
                if not queued(page):
                    break
                drain(page)
                time.sleep(0.3)
            state = e2e.fake_state()
            check(not queued(page), "B: a stalled request timed out and the photo still arrived")
            sent = patches_for(state, b_id)
            check(len(sent) == 1 and len(uploads_for(state, b_id)) == 1, "B: delivered exactly once after the stalls")
            if uploads_for(state, b_id):
                size = len(urllib.request.urlopen(
                    f"{e2e.FAKE}/storage/v1/object/public/loto-photos/{uploads_for(state, b_id)[0]}").read())
                check(size < before, f"B: re-encoded smaller after repeated stalls ({before // 1024} KB -> {size // 1024} KB)")
            page.unroute("**/api/captures/")

            # ── C: the phone wrongly believes it is offline ───────────────────────
            c_id = DELTAS[4]["equipment_id"]
            lying = context.new_page()
            lying.add_init_script("Object.defineProperty(navigator, 'onLine', {get: () => false})")
            open_machine(lying, c_id)
            take_photo(lying, 3)
            e2e.wait_for(lambda: queued(lying), "the photo to queue")
            for _ in range(10):
                if not queued(lying):
                    break
                drain(lying)
                time.sleep(0.3)
            check(not queued(lying) and len(patches_for(e2e.fake_state(), c_id)) == 1,
                  "C: delivered although navigator.onLine claimed offline")
            lying.close()

            # ── D: two tabs, one photo ─────────────────────────────────────────────
            d_id = DELTAS[5]["equipment_id"]
            sent_requests = {"n": 0}
            context.route("**/api/captures/", lambda route: (sent_requests.__setitem__("n", sent_requests["n"] + 1), route.continue_()))
            tab_one = context.new_page()
            open_machine(tab_one, d_id)
            tab_two = context.new_page()
            open_machine(tab_two, d_id)
            take_photo(tab_one, 5)
            e2e.wait_for(lambda: queued(tab_one), "the photo to queue")
            # A slow link keeps the first send in flight while the second tab tries.
            cdp.send("Network.emulateNetworkConditions", {**WEAK_3G, "latency": 2500})
            tab_one.evaluate("() => { window.__first = window.WalkdownQueue.drain({force: true}); }")
            time.sleep(0.3)
            second = tab_two.evaluate("() => window.WalkdownQueue.drain({force: true})")
            tab_one.evaluate("() => window.__first")  # let the first drain finish
            cdp.send("Network.emulateNetworkConditions", {**WEAK_3G, "latency": 0,
                     "downloadThroughput": -1, "uploadThroughput": -1})
            time.sleep(1)
            # The first tab's own automatic sync is already sending, so its forced drain
            # also stands down; what matters is that nobody sends a second copy.
            check(second["sent"] == 0 and sent_requests["n"] == 1,
                  f"D: the second tab stood down; {sent_requests['n']} request on the wire")
            check(len(patches_for(e2e.fake_state(), d_id)) == 1 and len(uploads_for(e2e.fake_state(), d_id)) == 1,
                  f"D: two tabs produced one upload ({sent_requests['n']} request(s) on the wire)")
            tab_one.close()
            tab_two.close()
            context.unroute("**/api/captures/")

            # ── E: a burst of simultaneous uploads against the single server ──────
            cookies = {c["name"]: c["value"] for c in context.cookies()}
            burst = DELTAS[10:40]
            results: dict[str, int] = {}
            jpeg = noisy_photo(size=(640, 480))

            def post(equipment_id):
                with httpx.Client(cookies=cookies, headers={"X-CSRFToken": cookies["csrftoken"]},
                                  timeout=60) as client:
                    response = client.post(f"{e2e.APP}/api/captures/", data={
                        "client_capture_id": str(uuid.uuid4()), "machine": PK[equipment_id],
                        "slot": "iso", "kind": "photo", "confirmed": "1",
                        "captured_at": "2026-10-20T10:00:00+00:00", "annotations": "[]"},
                        files={"photo": ("p.jpg", jpeg, "image/jpeg")})
                    results[equipment_id] = response.status_code

            workers = [threading.Thread(target=post, args=(m["equipment_id"],)) for m in burst]
            started = time.time()
            [w.start() for w in workers]
            [w.join() for w in workers]
            elapsed = time.time() - started
            state = e2e.fake_state()
            check(all(code == 200 for code in results.values()),
                  f"E: {len(burst)} simultaneous uploads all accepted ({sorted(set(results.values()))}) in {elapsed:.1f}s")
            check(all(len(patches_for(state, m["equipment_id"])) == 1 for m in burst),
                  "E: each reached Supabase exactly once")
            browser.close()
    finally:
        app.terminate()
        fake.terminate()
    print(f"\n{len(failures)} weak-network failures")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(run())
