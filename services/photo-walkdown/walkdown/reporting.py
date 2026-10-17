"""The progress report for the client.

Built only from the walkdown's own records (Captures), so it can be shown
to someone without a login and never touches Supabase. Reverted captures
are left out: the report says what is on the placards now.
"""
import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime, time

from django.conf import settings
from django.utils import timezone

from .models import Capture, CaptureKind, Machine, Slot

SLOT_NAME = {Slot.EQUIP: "equipment", Slot.ISO: "isolation"}


@dataclass
class UpdatedMachine:
    equipment_id: str
    description: str
    department: str
    actions: list[str]
    last_date: date
    placard_url: str
    confirmation: str = ""


@dataclass
class DepartmentProgress:
    name: str
    total: int
    done: int
    updated: int

    @property
    def remaining(self) -> int:
        return self.total - self.done


@dataclass
class Report:
    since: date | None
    until: date | None
    generated: datetime
    machines_total: int = 0
    machines_done: int = 0
    machines_updated: int = 0
    new_photos: int = 0
    confirmations: int = 0
    arrows_marked: int = 0
    confirmed_by_maintenance: int = 0
    departments: list[DepartmentProgress] = field(default_factory=list)
    updated: list[UpdatedMachine] = field(default_factory=list)

    @property
    def machines_remaining(self) -> int:
        return self.machines_total - self.machines_done


def placard_link(qr_token: str) -> str:
    return f"{settings.PLATFORM_URL}/qr/{qr_token}" if qr_token else ""


def _window(since: date | None, until: date | None) -> tuple[datetime | None, datetime | None]:
    zone = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(since, time.min), zone) if since else None
    end = timezone.make_aware(datetime.combine(until, time.max), zone) if until else None
    return start, end


def _actions(captures: list[Capture]) -> list[str]:
    actions = []
    for slot in Slot:
        mine = sorted((c for c in captures if c.slot == slot), key=lambda c: c.synced_at)
        if not mine:
            continue
        name = SLOT_NAME[slot]
        photos = [c for c in mine if c.kind == CaptureKind.PHOTO]
        evidence = [c for c in mine if c.kind != CaptureKind.ANNOTATE]  # photo or confirmation
        if photos:
            confirmed = evidence[-1].confirmed_at_machine
            actions.append(f"New {name} photo" + ("" if confirmed else " (awaiting confirmation)"))
        elif any(c.kind == CaptureKind.CONFIRM for c in mine):
            actions.append(f"{name.capitalize()} photo confirmed at the machine")
        if slot == Slot.ISO and mine[-1].new_annotations:
            actions.append("Isolation point marked with an arrow")
    return actions


def build_report(since: date | None = None, until: date | None = None) -> Report:
    machines = list(Machine.objects.prefetch_related("captures", "confirmation_requests"))
    report = Report(since=since, until=until, generated=timezone.now(),
                    machines_total=len(machines), machines_done=sum(m.is_done for m in machines))
    start, end = _window(since, until)

    by_department: dict[str, DepartmentProgress] = {}
    for machine in sorted(machines, key=lambda m: (m.department.casefold(), m.walk_order)):
        progress = by_department.setdefault(
            machine.department, DepartmentProgress(machine.department, 0, 0, 0))
        progress.total += 1
        progress.done += machine.is_done

        captures = [c for c in machine.captures.all() if c.reverted_at is None
                    and (start is None or c.synced_at >= start)
                    and (end is None or c.synced_at <= end)]
        answered = [r for r in machine.confirmation_requests.all() if r.is_answered
                    and (start is None or r.responded_at >= start)
                    and (end is None or r.responded_at <= end)]
        if not captures and not answered:
            continue
        progress.updated += 1
        report.confirmed_by_maintenance += bool(answered and answered[0].all_confirmed)
        report.new_photos += sum(c.kind == CaptureKind.PHOTO for c in captures)
        report.confirmations += sum(c.kind == CaptureKind.CONFIRM for c in captures)
        iso = [c for c in captures if c.slot == Slot.ISO]
        report.arrows_marked += bool(iso) and bool(max(iso, key=lambda c: c.synced_at).new_annotations)
        moments = [c.synced_at for c in captures] + [r.responded_at for r in answered]
        report.updated.append(UpdatedMachine(
            equipment_id=machine.equipment_id, description=machine.description,
            department=machine.department, actions=_actions(captures),
            last_date=timezone.localtime(max(moments)).date(),
            placard_url=placard_link(machine.qr_token),
            confirmation="; ".join(r.summary for r in answered)))
    report.machines_updated = len(report.updated)
    report.departments = list(by_department.values())
    return report


def report_csv(report: Report) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Equipment ID", "Description", "Department", "What was done", "Date",
                     "Maintenance confirmation", "Placard link"])
    for item in report.updated:
        writer.writerow([item.equipment_id, item.description, item.department,
                         "; ".join(item.actions), item.last_date.isoformat(), item.confirmation,
                         item.placard_url])
    return buffer.getvalue()
