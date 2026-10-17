"""The confirmation request email.

Sent through Django's email framework, so any SMTP provider works (Resend, SendGrid,
Google Workspace, Amazon SES, ...): which one is a matter of environment variables.
Everything a person types is kept out of the subject and headers: the subject is built
from the machine id only, and addresses are validated before they get here.
"""
import html
import logging
import smtplib
from urllib.parse import quote

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

logger = logging.getLogger(__name__)


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


def is_configured() -> bool:
    return bool(settings.EMAIL_HOST and settings.DEFAULT_FROM_EMAIL)


def send(*, to_email: str, subject: str, text: str, link: str, reply_to: str) -> None:
    if not is_configured():
        raise MailError("Email is not set up on the server.")
    message = EmailMultiAlternatives(subject, text, to=[to_email], reply_to=[reply_to])
    message.attach_alternative(html_for(text, link), "text/html")
    try:
        message.send()
    except smtplib.SMTPAuthenticationError as error:
        _log_failure(error)
        raise MailError("The email server rejected the sign-in.") from error
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as error:
        _log_failure(error)
        raise MailError("The email server refused the message.") from error
    except OSError as error:  # smtplib.SMTPException is an OSError, as are timeouts and TLS errors
        _log_failure(error)
        raise MailError("The email server could not be reached.") from error


def _log_failure(error: Exception) -> None:
    # The class and SMTP code say what went wrong; the server's own text can name
    # addresses, so it is not logged or shown.
    logger.warning("Confirmation email failed: %s (SMTP code %s)", type(error).__name__,
                   getattr(error, "smtp_code", "n/a"))
