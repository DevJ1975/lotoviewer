from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from studio import supabase
from studio.content import load_module
from studio.jobs import track_job
from studio.models import MediaJob
from studio.render import probe_duration, render_module


class Command(BaseCommand):
    help = "Render a seed module to a 1080p MP4; --upload publishes it as the draft's download."

    def add_arguments(self, parser):
        parser.add_argument("seed_dir", type=Path)
        parser.add_argument("--out", type=Path, default=None)
        parser.add_argument("--burn-captions", action="store_true")
        parser.add_argument("--upload", action="store_true",
                            help="Upload to strike-media and set the draft version's download_path")

    def handle(self, *args, seed_dir: Path, out: Path | None, burn_captions: bool, upload: bool,
               **options):
        module = load_module(seed_dir)
        out = out or seed_dir / "module.mp4"
        with track_job(MediaJob.Kind.RENDER, module["slug"]) as job:
            def progress(done: int, total: int, key: str) -> None:
                line = f"[{done}/{total}] {key}"
                job.append(line)
                self.stdout.write(line)

            render_module(module, seed_dir, out, burn_captions=burn_captions, on_segment=progress)
            seconds = probe_duration(out)
            job.append(f"rendered {out} ({seconds:.1f}s)")
            self.stdout.write(self.style.SUCCESS(f"Rendered {out} ({seconds:.1f}s)"))

            if upload:
                self._upload(module, out, job)

    def _upload(self, module: dict, out: Path, job: MediaJob) -> None:
        existing = supabase.get_global_module_by_slug(module["slug"])
        versions = sorted((existing or {}).get("strike_module_versions") or [],
                          key=lambda v: v["version_number"])
        editable = [v for v in versions if v["status"] in supabase.EDITABLE_STATUSES]
        if not editable:
            raise CommandError("No draft version to attach the video to. Run import_seed_module "
                               "first (published versions cannot change).")
        path = f"{module['media_prefix'].strip('/')}/module.mp4"
        supabase.upload(path, out.read_bytes(), "video/mp4")
        supabase.update_editable_version(editable[-1]["id"], {"download_path": path})
        job.version_number = editable[-1]["version_number"]
        job.append(f"uploaded {path}")
        self.stdout.write(self.style.SUCCESS(f"Uploaded {path}"))
