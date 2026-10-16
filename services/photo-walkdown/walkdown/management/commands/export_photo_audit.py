import json

from django.core.management.base import BaseCommand

from walkdown.exporting import build_photo_audit


class Command(BaseCommand):
    help = ("Write the photo audit with finished machines marked, for "
            "scripts/make_placards.py --photo-audit.")

    def add_arguments(self, parser):
        parser.add_argument("output", help="File to write, e.g. photo_audit_reshot.json")

    def handle(self, *args, **options):
        audit = build_photo_audit()
        with open(options["output"], "w", encoding="utf-8") as handle:
            json.dump(audit, handle, ensure_ascii=False, indent=1)
        reshot = sum(1 for item in audit if item.get("reshot_on"))
        self.stdout.write(f"{len(audit)} machines written; {reshot} re-shot and confirmed.")
