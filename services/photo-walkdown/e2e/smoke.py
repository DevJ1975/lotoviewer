"""Smoke test for a running walkdown: is it up, locked down, and wired to Supabase?

    python e2e/smoke.py https://photos.soteriafield.app
    SMOKE_EMAIL=you@x.com SMOKE_PASSWORD=... python e2e/smoke.py https://photos.soteriafield.app --signed-in

Read-only: it never uploads, confirms or changes anything. The credentials are read
from the environment (never from arguments, so they stay out of shell history), and
the signed-in part exercises the real Supabase connection by opening a machine page
and a photo.
"""
import os
import re
import sys
from http.cookies import SimpleCookie

import httpx

checks: list[tuple[bool, str]] = []


def check(condition: bool, message: str) -> None:
    checks.append((bool(condition), message))
    print(("PASS " if condition else "FAIL ") + message, flush=True)


def make_client(base: str) -> httpx.Client:
    client = httpx.Client(base_url=base, timeout=30)
    if not base.startswith("https"):
        # The app marks its cookies Secure. Browsers accept them on http://localhost, but
        # httpx would drop them and a local run could never sign in.
        def remember_cookies(response: httpx.Response) -> None:
            for header in response.headers.get_list("set-cookie"):
                for name, morsel in SimpleCookie(header).items():
                    client.cookies.delete(name)  # httpx may hold its own, unsendable, copy
                    client.cookies.set(name, morsel.value)

        client.event_hooks["response"].append(remember_cookies)
    return client


def public_checks(client: httpx.Client, base: str) -> None:
    health = client.get("/healthz")
    check(health.status_code == 200 and health.text.strip() == "ok", "healthz answers ok")

    login = client.get("/login/")
    check(login.status_code == 200 and 'name="password"' in login.text, "sign-in page loads")
    csp = login.headers.get("content-security-policy", "")
    check("default-src 'self'" in csp and "unsafe-inline" not in csp and "unsafe-eval" not in csp,
          "content security policy is strict")
    check(login.headers.get("x-frame-options") == "DENY" and "frame-ancestors 'none'" in csp, "cannot be framed")
    check(login.headers.get("x-content-type-options") == "nosniff", "nosniff is set")
    check("camera=(self)" in login.headers.get("permissions-policy", ""), "permissions policy allows only the camera")
    if base.startswith("https"):
        check("max-age" in login.headers.get("strict-transport-security", ""), "HSTS is set")
        insecure = httpx.get(base.replace("https://", "http://") + "/login/", follow_redirects=False, timeout=15)
        check(insecure.status_code in (301, 302, 308) and insecure.headers.get("location", "").startswith("https://"),
              "plain http is redirected to https")

    home = client.get("/", follow_redirects=False)
    check(home.status_code == 302 and "/login/" in home.headers.get("location", ""), "home needs a sign-in")
    for path in ("/report/", "/sync/", "/m/1/", "/thumb/1/iso.jpg", "/export/photo-audit.json", "/search/?q=a"):
        response = client.get(path, follow_redirects=False)
        check(response.status_code == 302, f"{path} needs a sign-in")
    api = client.post("/api/captures/", data={})
    check(api.status_code == 401 and api.headers["content-type"].startswith("application/json"),
          "the capture API refuses anonymous callers with JSON 401")
    check(client.get("/c/garbage/").status_code == 404 and client.get("/r/garbage/").status_code == 404,
          "forged confirmation and report links are refused")

    manifest = client.get("/manifest.webmanifest")
    data = manifest.json() if manifest.status_code == 200 else {}
    check(data.get("display") == "standalone" and data.get("start_url") == "/", "PWA manifest is installable")
    icons = [client.get(icon["src"]).status_code for icon in data.get("icons", [])]
    check(icons and all(code == 200 for code in icons), "every manifest icon loads")
    worker = client.get("/sw.js")
    check(worker.status_code == 200 and worker.headers.get("service-worker-allowed") == "/", "service worker has root scope")
    check(client.get("/offline/").status_code == 200, "offline page is served")
    for script in ("htmx-2.0.10.min.js", "queue.js", "capture.js", "camera.js", "arrows.js", "mark-rules.js"):
        check(client.get(f"/static/walkdown/{script}").status_code == 200, f"static {script} is served")


def signed_in_checks(client: httpx.Client) -> None:
    email, password = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not (email and password):
        check(False, "SMOKE_EMAIL and SMOKE_PASSWORD are needed for --signed-in")
        return
    page = client.get("/login/")
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', page.text).group(1)
    response = client.post("/login/", data={"email": email, "password": password, "csrfmiddlewaretoken": token},
                           headers={"Referer": str(client.base_url)}, follow_redirects=False)
    check(response.status_code == 302, "signing in with Supabase works")
    if response.status_code != 302:
        return
    home = client.get("/")
    check(home.status_code == 200 and "machines done" in home.text, "worklist loads from the local database")
    machine_link = re.search(r'href="(/d/[^"]+/)"', home.text)
    department = client.get(machine_link.group(1)) if machine_link else None
    check(department is not None and department.status_code == 200, "a department page loads (reads Supabase)")
    first = re.search(r'href="(/m/\d+/)"', department.text) if department is not None else None
    machine = client.get(first.group(1)) if first else None
    check(machine is not None and machine.status_code == 200 and "What to photograph" in machine.text,
          "a machine page loads with live photo data from Supabase")
    thumb = re.search(r'src="(/thumb/\d+/(?:equip|iso)\.jpg\?v=[0-9a-f]*)"', machine.text) if machine is not None else None
    photo = client.get(thumb.group(1)) if thumb else None
    check(photo is not None and photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg",
          "a photo is fetched from Supabase storage and resized")
    check(client.get("/report/").status_code == 200, "the client report builds")
    check(client.get("/export/photo-audit.json").status_code == 200, "the audit export builds")
    client.post("/logout/", data={"csrfmiddlewaretoken": client.cookies.get("csrftoken", "")},
                headers={"Referer": str(client.base_url)})
    after = client.get("/", follow_redirects=False)
    check(after.status_code == 302 and "/login/" in after.headers.get("location", ""), "signing out ends the session")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip("/")
    with make_client(base) as client:
        public_checks(client, base)
        if "--signed-in" in sys.argv:
            signed_in_checks(client)
    failed = [message for ok, message in checks if not ok]
    print(f"\n{len(checks) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
