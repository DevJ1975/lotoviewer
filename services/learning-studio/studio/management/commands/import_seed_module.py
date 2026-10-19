from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from studio import supabase
from studio.content import load_module
from studio.importer import ImportRefused, import_seed_module
from studio.jobs import track_job
from studio.models import MediaJob


class Command(BaseCommand):
    help = "Upload a seed module's media and upsert it into Supabase as a draft (never published)."

    def add_arguments(self, parser):
        parser.add_argument("seed_dir", type=Path)
        parser.add_argument("--allow-missing", action="store_true",
                            help="Import even if some referenced media files are not generated yet")

    def handle(self, *args, seed_dir: Path, allow_missing: bool, **options):
        if not (seed_dir / "module.json").is_file():
            raise CommandError(f"{seed_dir} has no module.json")
        slug = load_module(seed_dir)["slug"]
        try:
            with track_job(MediaJob.Kind.IMPORT, slug) as job:
                def log(line: str) -> None:
                    job.append(line)
                    self.stdout.write(line)

                result = import_seed_module(seed_dir, allow_missing=allow_missing, log=log)
                job.version_number = result.version_number
        except (ImportRefused, supabase.SupabaseError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS(
            f"Imported {slug} v{result.version_number} as draft "
            f"({result.uploaded} files, {result.questions} questions). "
            "Approve its media in the studio, then publish from the web app."))
