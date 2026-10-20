from django.core.management.base import BaseCommand, CommandError

from walkdown import supabase, sync
from walkdown.models import Capture


class Command(BaseCommand):
    help = ("Put a machine's previous photo back on the placard. The replaced storage "
            "object is kept. Use --list to find capture ids.")

    def add_arguments(self, parser):
        parser.add_argument("capture_id", nargs="?", type=int)
        parser.add_argument("--list", action="store_true")
        parser.add_argument("--by", default="operator", help="Name recorded in the audit log.")

    def handle(self, *args, **options):
        if options["list"] or options["capture_id"] is None:
            for capture in Capture.objects.filter(kind="photo", reverted_at__isnull=True)[:50]:
                self.stdout.write(f"{capture.pk}\t{capture.machine.equipment_id}\t{capture.slot}\t"
                                  f"{capture.synced_at:%Y-%m-%d %H:%M}\t{capture.user.email}")
            return
        capture = Capture.objects.select_related("machine").filter(pk=options["capture_id"]).first()
        if capture is None:
            raise CommandError(f"No capture {options['capture_id']}")
        try:
            sync.revert(capture, options["by"])
        except (sync.CaptureRejected, supabase.SupabaseError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(f"Reverted {capture.machine.equipment_id} {capture.slot}; "
                          "the placard PDF rebuilds within about 5 minutes.")
