"""A local stand-in for Supabase, for the browser test only.

Serves just the endpoints the walkdown calls and keeps state in memory, so
a test can read back exactly what the app wrote.  Any equipment id resolves
to a row with generated photos, so the whole worklist works.

    python e2e/fake_supabase.py 54321
"""
import io
import json
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw

STATE = {"rows": {}, "uploads": {}, "patches": [], "hygiene": []}
PUBLIC = "/storage/v1/object/public/loto-photos/"


def picture(label: str, size=(960, 720)) -> bytes:
    image = Image.new("RGB", size, "#3b5b92")
    draw = ImageDraw.Draw(image)
    draw.rectangle((300, 260, 660, 460), outline="white", width=8)
    draw.text((20, 20), label, fill="white")
    buffer = io.BytesIO()
    image.save(buffer, "JPEG")
    return buffer.getvalue()


def row_for(host: str, equipment_id: str) -> dict:
    base = f"http://{host}{PUBLIC}"
    return STATE["rows"].setdefault(equipment_id, {
        "equipment_id": equipment_id, "equip_photo_url": f"{base}{equipment_id}_equip.jpg",
        "iso_photo_url": f"{base}{equipment_id}_iso.jpg", "needs_equip_photo": True,
        "needs_iso_photo": True, "iso_photo_is_placeholder": False,
        "equip_photo_provenance": "field", "iso_photo_provenance": "field",
        "annotations": [], "iso_annotations": [], "qr_token": f"tok-{equipment_id}",
        "photo_status": "complete"})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body=b"", content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, payload, status=200):
        self.send(status, json.dumps(payload).encode())

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0)))

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        host = self.headers["Host"]
        if url.path == "/rest/v1/loto_equipment":
            wanted = re.findall(r'"((?:[^"]|"")*)"', query["equipment_id"][0])
            return self.send_json([row_for(host, w.replace('""', '"')) for w in wanted])
        if url.path == "/rest/v1/tenant_memberships":
            return self.send_json([{"role": "admin"}])
        if url.path.startswith(PUBLIC):
            name = urllib.parse.unquote(url.path[len(PUBLIC):])
            return self.send(200, STATE["uploads"].get(name) or picture(name), "image/jpeg")
        if url.path == "/__state":
            return self.send_json({k: v for k, v in STATE.items() if k != "uploads"}
                                  | {"uploads": sorted(STATE["uploads"])})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/auth/v1/token":
            self.body()
            return self.send_json({"user": {"id": "user-1", "email": "tech@snakking.example"}})
        if url.path.startswith("/storage/v1/object/loto-photos/"):
            key = urllib.parse.unquote(url.path[len("/storage/v1/object/loto-photos/"):])
            STATE["uploads"][key] = self.body()
            return self.send_json({"Key": key})
        if url.path == "/rest/v1/loto_hygiene_log":
            body = json.loads(self.body())
            if not body.get("tenant_id"):  # NOT NULL in production, no active_tenant_id() here
                return self.send_json({"code": "23502", "message": "null value in tenant_id"}, 400)
            STATE["hygiene"].append(body)
            return self.send(201)
        self.send_json({"error": "not found"}, 404)

    def do_PATCH(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        equipment_id = query["equipment_id"][0].removeprefix("eq.")
        changes = json.loads(self.body())
        STATE["patches"].append({"equipment_id": equipment_id, **changes})
        row = row_for(self.headers["Host"], equipment_id)
        row.update(changes)
        self.send_json([row])


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
