import io
import json
import logging
import uuid
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from django.conf import settings
from django.contrib.auth import login, logout
from django.core import signing
from django.core.exceptions import ValidationError
from django.db.models import Prefetch
from django.http import (
    FileResponse,
    Http404,
    HttpResponse,
    HttpResponseNotAllowed,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.text import slugify
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from PIL import Image, UnidentifiedImageError

from . import auth, reporting, supabase, sync
from .annotations import InvalidAnnotations, parse_annotations
from .isolation_points import label_options, points_to_photograph, reviewer_note
from .models import Capture, Machine, Slot, photo_version
from .thumbnails import thumbnail_response

log = logging.getLogger(__name__)
THUMB_PX = 480
STATIC_DIR = Path(__file__).resolve().parent / "static" / "walkdown"
CHIP_LABEL = {"done": "Done", "confirm": "Confirm", "wrong": "Retake"}


def _worklist() -> list[Machine]:
    """Every machine, in walking order, with its captures prefetched so a
    page costs two queries however many machines it shows."""
    captures = Prefetch("captures", queryset=Capture.objects.filter(reverted_at__isnull=True))
    return list(Machine.objects.prefetch_related(captures))


def _departments(machines: list[Machine]) -> list[dict]:
    grouped: dict[str, list[Machine]] = defaultdict(list)
    for machine in machines:
        grouped[machine.department].append(machine)
    return [{"name": name, "slug": slugify(name), "total": len(items),
             "done": sum(m.is_done for m in items)}
            for name, items in sorted(grouped.items(), key=lambda kv: kv[0].casefold())]


# ── sign-in ────────────────────────────────────────────────────────────────


def _client_ip(request) -> str:
    # The proxy appends the address it saw to X-Forwarded-For, so the LAST entry
    # is the trustworthy one; anything to its left is whatever the client sent.
    forwarded = [hop.strip() for hop in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")]
    return forwarded[-1] or request.META.get("REMOTE_ADDR", "")


def login_view(request):
    if request.user.is_authenticated:
        return redirect("departments")
    error = ""
    if request.method == "POST":
        email = request.POST.get("email", "")
        try:
            user, supabase_user_id = auth.authenticate_supabase_user(
                email, request.POST.get("password", ""), _client_ip(request))
        except supabase.InvalidCredentials:
            error = "Email or password is incorrect."
        except auth.NotAuthorized:
            error = "This account is not set up to use the photo walkdown."
        except auth.TooManyAttempts:
            error = "Too many attempts. Wait 15 minutes and try again."
        except (supabase.SupabaseError, supabase.httpx.HTTPError):
            log.exception("Sign-in could not reach Supabase")
            error = "Could not reach the server. Check your signal and try again."
        else:
            login(request, user)
            request.session["supabase_user_id"] = supabase_user_id
            request.session["membership_checked_at"] = timezone.now().timestamp()
            target = request.GET.get("next", "")
            if not url_has_allowed_host_and_scheme(target, {request.get_host()}):
                target = reverse("departments")
            return redirect(target)
    return render(request, "walkdown/login.html", {"error": error})


@require_POST
def logout_view(request):
    logout(request)
    return redirect("login")


# ── worklist screens ───────────────────────────────────────────────────────


@ensure_csrf_cookie
@never_cache
def departments(request):
    machines = _worklist()
    return render(request, "walkdown/departments.html", {
        "departments": _departments(machines),
        "total": len(machines), "done": sum(m.is_done for m in machines)})


@ensure_csrf_cookie
@never_cache
def department(request, slug):
    machines = [m for m in _worklist() if slugify(m.department) == slug]
    if not machines:
        raise Http404("Unknown department")
    sync.refresh_from_supabase(machines)
    return render(request, "walkdown/department.html", {
        "department": machines[0].department, "slug": slug, "machines": machines,
        "done": sum(m.is_done for m in machines)})


@ensure_csrf_cookie
@never_cache
def machine(request, pk):
    machines = _worklist()
    current = next((m for m in machines if m.pk == pk), None)
    if current is None:
        raise Http404("Unknown machine")
    sync.refresh_from_supabase([current])
    siblings = [m for m in machines if m.department == current.department]
    index = siblings.index(current)
    return render(request, "walkdown/machine.html", {
        "machine": current, "slots": _slot_context(current),
        "points": points_to_photograph(current.energy_codes),
        "label_options_json": json.dumps(label_options(current.energy_codes)),
        "note": reviewer_note(current.recommended_fix),
        "previous": siblings[index - 1] if index else None,
        "next": siblings[index + 1] if index + 1 < len(siblings) else None,
        "confirmations": list(current.confirmation_requests.all()[:3]),
        "position": index + 1, "department_total": len(siblings),
        "department_slug": slugify(current.department)})


def _slot_context(machine: Machine) -> list[dict]:
    notes = {Slot.EQUIP: machine.equip_photo_note, Slot.ISO: machine.iso_photo_note}
    return [{"slot": slot.value, "title": slot.label, "state": machine.slot_state(slot),
             "audit_note": reviewer_note(notes[slot]),
             "version": photo_version(machine.photo_url(slot)),
             "annotations_json": json.dumps(machine.annotations(slot)),
             "is_iso": slot == Slot.ISO,
             "can_mark": (machine.can_mark(slot) and bool(machine.photo_url(slot))
                          and not (slot == Slot.ISO and machine.iso_photo_is_placeholder)),
             "has_photo": bool(machine.photo_url(slot)),
             "can_confirm": (bool(machine.photo_url(slot)) and machine.can_confirm(slot)
                             and not (slot == Slot.ISO and machine.iso_photo_is_placeholder))}
            for slot in Slot]


@require_GET
@never_cache
def machine_status(request, pk):
    """HTMX partial: the photo cards after a sync, without a page reload."""
    current = get_object_or_404(Machine.objects.prefetch_related(
        Prefetch("captures", queryset=Capture.objects.filter(reverted_at__isnull=True))), pk=pk)
    sync.refresh_from_supabase([current])
    return render(request, "walkdown/partials/slots.html", {
        "machine": current, "slots": _slot_context(current)})


@require_GET
def search(request):
    """HTMX partial: machine search across the whole plant."""
    query = request.GET.get("q", "").strip()
    results = []
    if len(query) >= 2:
        results = list(Machine.objects.filter(equipment_id__icontains=query)[:15]) or list(
            Machine.objects.filter(description__icontains=query)[:15])
    return render(request, "walkdown/partials/search_results.html",
                  {"results": results, "query": query})


@require_GET
@never_cache
def precache_manifest(request, slug):
    """URLs a phone fetches to make one department work with no signal."""
    machines = [m for m in Machine.objects.all() if slugify(m.department) == slug]
    if not machines:
        raise Http404("Unknown department")
    urls = [reverse("department", args=[slug])]
    for item in machines:
        urls.append(reverse("machine", args=[item.pk]))
        urls += [f"{reverse('thumb', args=[item.pk, slot.value])}"
                 f"?v={photo_version(item.photo_url(slot))}" for slot in Slot]
    return JsonResponse({"department": machines[0].department, "urls": urls})


# ── thumbnails ─────────────────────────────────────────────────────────────


@require_GET
def thumb(request, pk, slot):
    """A 480 px copy of the photo now on the placard."""
    if slot not in {s.value for s in Slot}:
        raise Http404("Unknown slot")
    item = get_object_or_404(Machine, pk=pk)
    return thumbnail_response(item.photo_url(Slot(slot)), THUMB_PX)


# ── capture API ────────────────────────────────────────────────────────────


def _validated_jpeg(upload) -> bytes:
    if upload is None:
        raise ValidationError("Attach the photo.")
    if upload.size > settings.MAX_UPLOAD_BYTES:
        raise ValidationError("Photo is larger than 2 MB.")
    data = upload.read()
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
            if image.format != "JPEG":
                raise ValidationError("Photo must be a JPEG.")
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise ValidationError("That file is not a valid image.") from error
    return data


def _parse_capture(request) -> dict:
    try:
        client_capture_id = uuid.UUID(request.POST.get("client_capture_id", ""))
    except ValueError as error:
        raise ValidationError("Missing capture id.") from error
    slot = request.POST.get("slot", "")
    if slot not in {s.value for s in Slot}:
        raise ValidationError("Unknown photo slot.")
    kind = request.POST.get("kind", "photo")
    if kind not in {"photo", "confirm", "annotate"}:
        raise ValidationError("Unknown capture kind.")
    try:
        # None (field absent) means "leave the placard's arrows alone".
        annotations = (parse_annotations(request.POST["annotations"])
                       if "annotations" in request.POST else None)
    except InvalidAnnotations as error:
        raise ValidationError(str(error)) from error
    try:
        captured_at = datetime.fromisoformat(request.POST.get("captured_at", ""))
    except ValueError:
        captured_at = timezone.now()
    if timezone.is_naive(captured_at):
        captured_at = timezone.make_aware(captured_at)
    try:
        for_capture = (uuid.UUID(request.POST["for_capture"])
                       if request.POST.get("for_capture") else None)
    except ValueError as error:
        raise ValidationError("Bad photo reference.") from error
    return {"client_capture_id": client_capture_id, "slot": Slot(slot), "kind": kind,
            "captured_at": captured_at, "confirmed": request.POST.get("confirmed") == "1",
            "annotations": annotations, "expect_version": request.POST.get("expect_version", ""),
            "for_capture": for_capture}


@require_POST
def api_capture(request):
    """Receive one queued capture from the phone.

    200 = applied (or already applied); 4xx = will never succeed, drop it;
    5xx = Supabase trouble, the phone retries with the same capture id.
    """
    try:
        fields = _parse_capture(request)
        item = Machine.objects.filter(pk=request.POST.get("machine")).first()
        if item is None:
            raise ValidationError("That machine is not on the worklist.")
        common = {"machine": item, "slot": fields["slot"],
                  "client_capture_id": fields["client_capture_id"],
                  "captured_at": fields["captured_at"], "user": request.user}
        if fields["kind"] == "photo":
            capture = sync.apply_photo(
                jpeg=_validated_jpeg(request.FILES.get("photo")),
                annotations=fields["annotations"] or [], confirmed=fields["confirmed"], **common)
        elif fields["kind"] == "confirm":
            capture = sync.apply_confirmation(annotations=fields["annotations"], **common)
        else:
            if fields["annotations"] is None:
                raise ValidationError("Mark at least one arrow, or clear them.")
            capture = sync.apply_annotation(annotations=fields["annotations"],
                                            expect_version=fields["expect_version"],
                                            for_capture=fields["for_capture"], **common)
    except (ValidationError, sync.CaptureRejected) as error:
        message = error.messages[0] if isinstance(error, ValidationError) else str(error)
        return JsonResponse({"ok": False, "error": message}, status=400)
    except (supabase.SupabaseError, supabase.httpx.HTTPError):
        log.exception("Capture sync failed")
        return JsonResponse({"ok": False, "error": "Could not reach the server; will retry."},
                            status=503)
    return JsonResponse({"ok": True, "capture_id": str(capture.client_capture_id),
                         "photo_status": capture.photo_status_after})


# ── sync screen, export, PWA plumbing ──────────────────────────────────────


@ensure_csrf_cookie
@never_cache
def sync_page(request):
    recent = Capture.objects.select_related("machine", "user")[:25]
    return render(request, "walkdown/sync.html", {"recent": recent})


@require_GET
def export_photo_audit(request):
    """The photo audit with finished machines marked, ready for
    make_placards.py --photo-audit so the Excel master stops stamping them."""
    from .exporting import build_photo_audit
    response = JsonResponse(build_photo_audit(), safe=False,
                            json_dumps_params={"ensure_ascii": False, "indent": 1})
    response["Content-Disposition"] = 'attachment; filename="photo_audit_reshot.json"'
    return response


# ── client report ──────────────────────────────────────────────────────────

REPORT_LINK_SALT = "client-report"
REPORT_LINK_DAYS = 90


def _report_range(params) -> tuple[date | None, date | None]:
    def parse(name):
        try:
            return date.fromisoformat(params.get(name, ""))
        except ValueError:
            return None
    return parse("since"), parse("until")


def _report_page(request, report, **context):
    return render(request, "walkdown/report.html", {"report": report, **context})


@ensure_csrf_cookie
@never_cache
def report(request):
    """Internal preview, with downloads and the link to send the client."""
    since, until = _report_range(request.GET)
    built = reporting.build_report(since, until)
    token = signing.dumps({"since": since.isoformat() if since else "",
                           "until": until.isoformat() if until else ""}, salt=REPORT_LINK_SALT)
    link = request.build_absolute_uri(reverse("client_report", args=[token]))
    return _report_page(request, built, internal=True, client_link=link,
                        link_days=REPORT_LINK_DAYS, since_value=since or "", until_value=until or "")


@require_GET
@never_cache
def report_download(request, fmt):
    if fmt not in {"csv", "html"}:
        raise Http404("Unknown report format")
    since, until = _report_range(request.GET)
    built = reporting.build_report(since, until)
    stamp = timezone.localdate().isoformat()
    if fmt == "csv":
        response = HttpResponse(reporting.report_csv(built), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="photo-walkdown-report-{stamp}.csv"'
        return response
    # A single file the client can open from an email: the stylesheet is inlined.
    css = (STATIC_DIR / "report.css").read_text(encoding="utf-8")
    response = render(request, "walkdown/report.html", {"report": built, "inline_css": css})
    response["Content-Disposition"] = f'attachment; filename="photo-walkdown-report-{stamp}.html"'
    return response


@require_GET
@never_cache
def client_report(request, token):
    """The same report, read-only, for the client. The signed token is the
    access control and expires; it exposes no staff names or emails."""
    try:
        window = signing.loads(token, salt=REPORT_LINK_SALT, max_age=REPORT_LINK_DAYS * 86400)
    except signing.BadSignature as error:  # includes SignatureExpired
        raise Http404("This report link is not valid or has expired.") from error
    since, until = _report_range(window)
    response = _report_page(request, reporting.build_report(since, until))
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response


def offline(request):
    return render(request, "walkdown/offline.html")


@require_GET
def service_worker(request):
    response = FileResponse((STATIC_DIR / "sw.js").open("rb"),
                            content_type="text/javascript")
    response["Service-Worker-Allowed"] = "/"
    response["Cache-Control"] = "no-cache"
    return response


@require_GET
def web_manifest(request):
    response = FileResponse((STATIC_DIR / "manifest.webmanifest").open("rb"),
                            content_type="application/manifest+json")
    response["Cache-Control"] = "no-cache"
    return response


def healthz(request):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    return HttpResponse("ok", content_type="text/plain")
