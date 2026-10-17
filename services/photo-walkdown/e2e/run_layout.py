"""Does every screen fit the devices the walkdown is used on?

    python e2e/run_layout.py [--shots DIR]

Opens each screen at iPhone 17 Pro and iPad Pro 12.9" sizes, portrait and
landscape, and checks what a person would notice: nothing wider than the
screen, tap targets big enough for a gloved thumb, the arrow editor and its
Save button fully on screen, and no text so small that iOS zooms the page.
Reuses the servers from run_e2e.py.
"""
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_e2e as e2e

# CSS pixels, as reported by the devices.
DEVICES = {
    "iphone-17-pro": {"viewport": {"width": 402, "height": 874}, "scale": 3},
    "iphone-17-pro-landscape": {"viewport": {"width": 874, "height": 402}, "scale": 3},
    "ipad-pro-12.9": {"viewport": {"width": 1024, "height": 1366}, "scale": 2},
    "ipad-pro-12.9-landscape": {"viewport": {"width": 1366, "height": 1024}, "scale": 2},
}
MIN_TAP_PX = 44  # Apple's minimum touch target
MIN_INPUT_FONT_PX = 16  # below this iOS zooms the page when a field is focused

CHECK = """() => {
  const width = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('button, a.btn, a.row, .bar a, label.btn, label.check, input:not([type=checkbox]):not([type=radio]):not([hidden]), textarea')) {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue;
    if (box.height < __TAP__ - 0.5 && !el.matches('input[type=file]')) bad.push(['tap target', el.outerHTML.slice(0, 70), Math.round(box.height)]);
    if (box.right > width + 0.5 || box.left < -0.5) bad.push(['off screen', el.outerHTML.slice(0, 70), Math.round(box.right)]);
    if (el.matches('input[type=search], input[type=text], input[type=email], input[type=password], textarea')
        && parseFloat(getComputedStyle(el).fontSize) < __FONT__) bad.push(['iOS zoom', el.outerHTML.slice(0, 70)]);
  }
  const overflow = document.documentElement.scrollWidth - width;
  if (overflow > 0) bad.push(['page wider than screen by', overflow]);
  return bad;
}""".replace("__TAP__", str(MIN_TAP_PX)).replace("__FONT__", str(MIN_INPUT_FONT_PX))


def run(shots: Path | None) -> int:
    fake, app = e2e.start_servers(tempfile.mkdtemp(prefix="walkdown-layout-"))
    failures: list[str] = []
    mismatch = next(m for m in e2e.SEED if m["merged_iso_verdict"] == "mismatch")
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(args=["--no-sandbox"])
            for name, device in DEVICES.items():
                print(f"checking {name}", flush=True)
                context = browser.new_context(
                    viewport=device["viewport"], device_scale_factor=device["scale"],
                    is_mobile=True, has_touch=True)
                page = context.new_page()
                page.goto(f"{e2e.APP}/login/")
                for problem in page.evaluate(CHECK):
                    failures.append(f"{name} / login: {problem}")
                if shots:
                    page.screenshot(path=str(shots / f"{name}-login.png"), full_page=True)
                screens = []
                page.fill("#email", "tech@snakking.example")
                page.fill("#password", "pw")
                page.click("button[type=submit]")
                try:
                    page.wait_for_selector("input[name=q]", timeout=15000)
                except Exception:
                    print("login did not complete:", page.url, page.locator(".error").all_inner_texts(),
                          page.locator("h1").all_inner_texts(), flush=True)
                    raise
                screens += [("departments", f"{e2e.APP}/"), ("sync", f"{e2e.APP}/sync/"),
                            ("report", f"{e2e.APP}/report/")]
                page.fill("input[name=q]", mismatch["equipment_id"])
                page.locator("#search-results a.row").first.click()
                page.wait_for_selector("section.slot")
                machine_url = page.url
                screens += [("machine", machine_url)]
                page.click(".bar-title")
                page.wait_for_selector("#machine-list")
                screens += [("department", page.url)]
                request_url = machine_url.rstrip("/") + "/confirm-request/"
                screens += [("confirm-request", request_url)]

                for screen, url in screens:
                    if url:
                        page.goto(url)
                        page.wait_for_load_state("networkidle")
                    for problem in page.evaluate(CHECK):
                        failures.append(f"{name} / {screen}: {problem}")
                    if shots:
                        page.screenshot(path=str(shots / f"{name}-{screen}.png"), full_page=True)

                # The request result and the supervisor's public page.
                page.goto(request_url)
                page.fill("#to_email", "supervisor@snakking.example")
                page.click("button[type=submit]")
                page.wait_for_selector("#confirm-link")
                for problem in page.evaluate(CHECK):
                    failures.append(f"{name} / confirm-request-result: {problem}")
                supervisor_page = context.new_page()
                supervisor_page.goto(page.input_value("#confirm-link"))
                supervisor_page.wait_for_selector("#confirm-form")
                supervisor_page.wait_for_load_state("networkidle")
                for problem in supervisor_page.evaluate(CHECK):
                    failures.append(f"{name} / supervisor-page: {problem}")
                if shots:
                    supervisor_page.screenshot(path=str(shots / f"{name}-supervisor.png"), full_page=True)
                supervisor_page.close()

                # The arrow editor: whole dialog and its Save button on screen.
                page.goto(machine_url)
                page.wait_for_selector("section[data-slot=iso]")
                # Offline, as in the plant: online the photo uploads at once and the
                # "Queued" badge is gone before a poll can see it.
                context.set_offline(True)
                page.set_input_files("section[data-slot=iso] [data-capture-input]",
                                     files=[{"name": "p.jpg", "mimeType": "image/jpeg",
                                             "buffer": e2e.exif_rotated_jpeg()}])
                badge = page.locator("section[data-slot=iso] [data-queued-slot]")
                e2e.wait_for(badge.is_visible, "the photo to queue")
                page.click("[data-mark-isolation]")
                page.wait_for_selector("#annotator[open]")
                page.locator("#annotator-image").evaluate("i => i.complete || new Promise(r => i.onload = r)")
                page.mouse.click(device["viewport"]["width"] * 0.4, device["viewport"]["height"] * 0.4)
                view = device["viewport"]
                for control in ("#annotator-save", "#annotator-undo", "#annotator-cancel", "#annotator-clear"):
                    box = page.locator(control).bounding_box()
                    if not box or box["y"] < 0 or box["y"] + box["height"] > view["height"] + 0.5 \
                            or box["x"] + box["width"] > view["width"] + 0.5:
                        failures.append(f"{name} / editor: {control} not fully on screen {box}")
                    elif box["height"] < MIN_TAP_PX - 0.5:
                        failures.append(f"{name} / editor: {control} only {box['height']:.0f}px tall")
                dialog = page.locator("#annotator").bounding_box()
                if dialog["y"] < -0.5 or dialog["y"] + dialog["height"] > view["height"] + 0.5:
                    failures.append(f"{name} / editor: dialog taller than the screen {dialog}")
                if shots:
                    page.screenshot(path=str(shots / f"{name}-editor.png"))
                context.close()
            browser.close()
    finally:
        app.terminate()
        fake.terminate()
    for failure in failures:
        print("FAIL", failure)
    print(f"{len(failures)} layout problems across {len(DEVICES)} device sizes")
    return 1 if failures else 0


if __name__ == "__main__":
    out = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    raise SystemExit(run(out))
