"""Asking a maintenance supervisor to confirm what the photos show.

Two sides: signed-in staff create a request (and optionally email it), and the
supervisor answers on a public page reached by a signed link, with no account.
"""
import json
import re
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import Http404
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods

from . import mailer, sync
from .models import ConfirmationRequest, Decision, Machine, Slot
from .thumbnails import thumbnail_response

TOKEN_SALT = "confirm-request"
PHOTO_PX = 900
REQUESTS_PER_USER_PER_HOUR = 30
REQUESTS_PER_RECIPIENT_PER_DAY = 5
ANSWERS_PER_LINK_PER_HOUR = 20
NAME_MAX = 100
NOTE_MAX = 500
MESSAGE_MAX = 1000
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def link_token(confirmation: ConfirmationRequest) -> str:
    return signing.dumps({"r": str(confirmation.public_id)}, salt=TOKEN_SALT)


def load_confirmation(token: str) -> ConfirmationRequest:
    """The request a link points to, or 404 for anything forged, expired or unknown."""
    try:
        data = signing.loads(token, salt=TOKEN_SALT, max_age=settings.CONFIRM_LINK_DAYS * 86400)
        confirmation = ConfirmationRequest.objects.select_related("machine").get(public_id=data["r"])
    except (signing.BadSignature, KeyError, ValueError, ConfirmationRequest.DoesNotExist) as error:
        raise Http404("This link is not valid or has expired.") from error
    if confirmation.expires_at < timezone.now():
        raise Http404("This link is not valid or has expired.")
    return confirmation


def _clean_line(value: str, limit: int, field: str) -> str:
    value = value.strip()
    if _CONTROL.search(value):
        raise ValidationError(f"{field} cannot contain line breaks or control characters.")
    if len(value) > limit:
        raise ValidationError(f"{field} is limited to {limit} characters.")
    return value


# ── staff: create a request ────────────────────────────────────────────────


def _validate_request(post) -> dict:
    email = post.get("to_email", "").strip()
    try:
        validate_email(email)
    except ValidationError as error:
        raise ValidationError("Enter a valid email address.") from error
    if _CONTROL.search(email) or len(email) > 254:
        raise ValidationError("Enter a valid email address.")
    slots = [slot for slot in post.getlist("slots") if slot in {s.value for s in Slot}]
    if not slots:
        raise ValidationError("Choose at least one photo to confirm.")
    message = post.get("message", "").strip()
    if len(message) > MESSAGE_MAX:
        raise ValidationError(f"The note is limited to {MESSAGE_MAX} characters.")
    return {"to_email": email.lower(), "slots": slots, "message": message,
            "to_name": _clean_line(post.get("to_name", ""), NAME_MAX, "The name")}


def _check_sending_limits(user, to_email: str) -> None:
    now = timezone.now()
    if ConfirmationRequest.objects.filter(
            requested_by=user, created_at__gte=now - timedelta(hours=1)).count() >= REQUESTS_PER_USER_PER_HOUR:
        raise ValidationError("You have sent a lot of requests this hour. Try again later.")
    if ConfirmationRequest.objects.filter(
            to_email__iexact=to_email, created_at__gte=now - timedelta(days=1)).count() >= REQUESTS_PER_RECIPIENT_PER_DAY:
        raise ValidationError("That person has already been asked several times today.")


@require_http_methods(["GET", "POST"])
@ensure_csrf_cookie
@never_cache
def request_confirmation(request, pk):
    machine = get_object_or_404(Machine, pk=pk)
    context = {"machine": machine, "slots_all": list(Slot), "values": {}, "error": "",
               "confirm_days": settings.CONFIRM_LINK_DAYS,
               "previous": machine.confirmation_requests.all()[:5]}
    if request.method == "POST":
        context["values"] = request.POST
        try:
            fields = _validate_request(request.POST)
            _check_sending_limits(request.user, fields["to_email"])
        except ValidationError as error:
            context["error"] = error.messages[0]
            return render(request, "walkdown/confirm_request.html", context, status=400)
        confirmation = ConfirmationRequest.objects.create(
            machine=machine, requested_by=request.user,
            expires_at=timezone.now() + timedelta(days=settings.CONFIRM_LINK_DAYS), **fields)
        context["result"] = _deliver(request, confirmation)
        context["previous"] = machine.confirmation_requests.all()[:5]
    return render(request, "walkdown/confirm_request.html", context)


def _deliver(request, confirmation: ConfirmationRequest) -> dict:
    """Email the link if the server can; otherwise hand back a mailto: to send it."""
    link = request.build_absolute_uri(reverse("confirm_page", args=[link_token(confirmation)]))
    subject = mailer.subject_for(confirmation.machine.equipment_id)
    text = mailer.body_for(
        machine=confirmation.machine, link=link, slots=confirmation.slots,
        requester_email=request.user.email, message=confirmation.message,
        to_name=confirmation.to_name, expires_on=f"{confirmation.expires_at:%B %-d, %Y}")
    result = {"link": link, "to": confirmation.to_email, "sent": False, "error": "",
              "mailto": mailer.mailto_for(to_email=confirmation.to_email, subject=subject, body=text)}
    try:
        mailer.send(to_email=confirmation.to_email, subject=subject, text=text, link=link,
                    reply_to=request.user.email)
    except mailer.MailError as error:
        confirmation.send_error = str(error)[:300]
        confirmation.save(update_fields=["send_error"])
        result["error"] = str(error)
    else:
        confirmation.sent_at = timezone.now()
        confirmation.save(update_fields=["sent_at"])
        result["sent"] = True
    return result


# ── the supervisor: no account, a signed link ──────────────────────────────


def _private(response):
    """A capability link must not be indexed or kept by shared caches."""
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["Cache-Control"] = "private, no-store"
    return response


def _answer_context(confirmation, error="", values=None):
    slots = [Slot(value) for value in confirmation.slots]
    machine = confirmation.machine
    return {"confirmation": confirmation, "machine": machine, "token": link_token(confirmation),
            "values": values or {}, "error": error,
            "items": [{"slot": slot, "label": slot.label, "decision": confirmation.decision(slot),
                       "note": confirmation.note(slot),
                       "annotations_json": json.dumps(machine.annotations(slot)),
                       "has_photo": bool(machine.photo_url(slot)),
                       # What they had already chosen, so a mistake does not wipe the form.
                       "choice": (values or {}).get(f"{slot.value}_decision", ""),
                       "note_value": (values or {}).get(f"{slot.value}_note", "")}
                      for slot in slots]}


@require_http_methods(["GET", "POST"])
@ensure_csrf_cookie
@never_cache
def confirm_page(request, token):
    confirmation = load_confirmation(token)
    if request.method == "GET":
        sync.refresh_from_supabase([confirmation.machine])  # best effort: show what is on the placard now
        return _private(render(request, "walkdown/confirm_page.html", _answer_context(confirmation)))
    if confirmation.is_answered:
        return render(request, "walkdown/confirm_page.html",
                      _answer_context(confirmation, "This request has already been answered."), status=409)
    key = f"confirm-answers:{confirmation.public_id}:{timezone.now():%Y%m%d%H}"
    cache.add(key, 0, 3700)
    if cache.incr(key) > ANSWERS_PER_LINK_PER_HOUR:
        return render(request, "walkdown/confirm_page.html",
                      _answer_context(confirmation, "Too many attempts. Please try again later."), status=429)
    try:
        answers = _validate_answers(request.POST, confirmation)
    except ValidationError as error:
        return render(request, "walkdown/confirm_page.html",
                      _answer_context(confirmation, error.messages[0], request.POST), status=400)
    for field, value in answers.items():
        setattr(confirmation, field, value)
    confirmation.responded_at = timezone.now()
    confirmation.save()
    return render(request, "walkdown/confirm_page.html", _answer_context(confirmation))


def _validate_answers(post, confirmation: ConfirmationRequest) -> dict:
    answers = {"responder_name": _clean_line(post.get("name", ""), NAME_MAX, "Your name")}
    if not answers["responder_name"]:
        raise ValidationError("Please enter your name.")
    for value in confirmation.slots:
        slot = Slot(value)
        decision = post.get(f"{value}_decision", "")
        if decision not in {Decision.CONFIRMED, Decision.REJECTED}:
            raise ValidationError(f"Please answer for the {slot.label.lower()}.")
        note = post.get(f"{value}_note", "").strip()
        if len(note) > NOTE_MAX:
            raise ValidationError(f"Notes are limited to {NOTE_MAX} characters.")
        if decision == Decision.REJECTED and not note:
            raise ValidationError(f"Please say what is wrong with the {slot.label.lower()}.")
        answers[f"{value}_decision"] = decision
        answers[f"{value}_note"] = note
    return answers


@require_GET
def confirm_photo(request, token, slot):
    """The photo the link is about, only for the slots that were put to the supervisor."""
    confirmation = load_confirmation(token)
    if slot not in confirmation.slots:
        raise Http404("Not part of this request")
    response = thumbnail_response(confirmation.machine.photo_url(Slot(slot)), PHOTO_PX)
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response
