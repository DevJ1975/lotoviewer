"""The confirmation request email.

Sent through Resend's HTTP API (the same service the platform uses). Everything a
person types is kept out of the subject and headers: the subject is built from the
machine id only, and addresses are validated before they get here.
"""
import html
from urllib.parse import quote

import httpx
from django.conf import settings

TIMEOUT = httpx.Timeout(20.0, connect=10.0)


class MailError(RuntimeError):
    """The email could not be sent; the message is safe to show the user."""


def subject_for(equipment_id: str) -> str:
    return f"Please confirm the LOTO photos for {equipment_id}"


def body_for(*, machine, link: str, slots: list[str], requester_email: str, message: str,
             expires_on: str, to_name: str) -> str:
    wanted = {"equip": "the equipment photo", "iso": "the isolation point photo (where the lock goes)"}
    what = " and ".join(wanted[slot] for slot in slots)
    intro = (f"Trainovations is finishing the lockout/tagout placards for Snak King and would "
             f"be grateful if you could confirm {what} for:")
    ask = ("It takes about a minute, there is nothing to log in to, and it works on a phone. "
           "Please check the photo against the machine and tell us if it is right or needs a change:")
    closing = (f"The link works until {expires_on}. Questions? Reply to this email "
               f"({requester_email}).")
    lines = [f"Hello{' ' + to_name if to_name else ''},", "", intro, "",
             f"    {machine.description}", f"    Department: {machine.department}", "", ask, "", link, ""]
    if message:
        lines += ["Note from the sender:", message, ""]
    lines += [closing, "", "Thank you,", "Trainovations"]
    return "\n".join(lines)


def html_for(text: str, link: str) -> str:
    """The plain text, escaped, with the link made clickable."""
    safe = html.escape(text).replace(html.escape(link), f'<a href="{html.escape(link)}">{html.escape(link)}</a>')
    return f'<div style="font:15px/1.5 system-ui,sans-serif;white-space:pre-wrap">{safe}</div>'


def mailto_for(*, to_email: str, subject: str, body: str) -> str:
    return f"mailto:{quote(to_email)}?subject={quote(subject)}&body={quote(body)}"


def send(*, to_email: str, subject: str, text: str, link: str, reply_to: str) -> None:
    if not settings.RESEND_API_KEY:
        raise MailError("Email is not set up on the server.")
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={"from": settings.WALKDOWN_FROM_EMAIL, "to": [to_email], "reply_to": reply_to,
                  "subject": subject, "text": text, "html": html_for(text, link)},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as error:
        raise MailError("The email service could not be reached.") from error
    if not response.is_success:
        # Resend's error body is short JSON and never echoes the key.
        raise MailError(f"The email service refused the message ({response.status_code}).")
