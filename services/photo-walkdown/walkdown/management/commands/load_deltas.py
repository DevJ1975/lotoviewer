import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from walkdown import sync
from walkdown.models import Machine


class Command(BaseCommand):
    help = ("Load the photo-audit worklist (machines with a photo delta) from the seed file. "
            "Safe to re-run: existing machines are updated, captures are never touched.")

    def add_arguments(self, parser):
        parser.add_argument("--seed", default=str(settings.SEED_FILE))
        parser.add_argument("--no-refresh", action="store_true",
                            help="Skip copying the live photo URLs from Supabase.")

    def handle(self, *args, **options):
        with open(options["seed"], encoding="utf-8") as handle:
            records = json.load(handle)["machines"]
        deltas = [r for r in records
                  if r["merged_iso_verdict"] != "match" or r["equip_photo"]["verdict"] != "match"]

        slugs: dict[str, str] = {}
        for record in deltas:
            clash = slugs.setdefault(slugify(record["department"]), record["department"])
            if clash != record["department"]:
                raise CommandError(f"Departments {clash!r} and {record['department']!r} "
                                   "share a URL slug; rename one in the seed.")

        with transaction.atomic():
            for order, record in enumerate(deltas, start=1):
                Machine.objects.update_or_create(
                    equipment_id=record["equipment_id"],
                    defaults={
                        "department": record["department"],
                        "description": record["description"],
                        "energy_codes": record["energy_codes"],
                        "equip_verdict": record["equip_photo"]["verdict"],
                        "iso_verdict": record["merged_iso_verdict"],
                        "equip_photo_note": record["equip_photo"]["notes"],
                        "iso_photo_note": record["iso_photo"]["notes"],
                        "recommended_fix": record["recommended_fix"],
                        "walk_order": order,
                        "audit": record,
                    })
        self.stdout.write(f"{len(deltas)} machines with photo deltas loaded "
                          f"({len(records) - len(deltas)} fully confirmed machines skipped).")

        if not options["no_refresh"]:
            machines = list(Machine.objects.all())
            sync.refresh_from_supabase(machines)
            self.stdout.write("Live photo URLs refreshed from Supabase.")
