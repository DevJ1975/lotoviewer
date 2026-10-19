from functools import partial
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from studio import elevenlabs
from studio.content import load_module
from studio.jobs import track_job
from studio.models import MediaJob
from studio.narration import narrate_module


class Command(BaseCommand):
    help = "Narrate every motion scene of a seed module with ElevenLabs (mp3 + WebVTT)."

    def add_arguments(self, parser):
        parser.add_argument("seed_dir", type=Path)
        parser.add_argument("--voice", default=settings.ELEVENLABS_DEFAULT_VOICE,
                            help="ElevenLabs voice id (default: ELEVENLABS_VOICE_ID)")
        parser.add_argument("--scene", default=None, help="Only narrate this scene key")

    def handle(self, *args, seed_dir: Path, voice: str, scene: str | None, **options):
        if not (seed_dir / "module.json").is_file():
            raise CommandError(f"{seed_dir} has no module.json")
        synthesize = partial(elevenlabs.synthesize, voice_id=voice,
                             api_key=settings.ELEVENLABS_API_KEY,
                             model_id=settings.ELEVENLABS_MODEL)
        slug = load_module(seed_dir)["slug"]
        try:
            with track_job(MediaJob.Kind.NARRATION, slug) as job:
                def log(line: str) -> None:
                    job.append(line)
                    self.stdout.write(line)

                done = narrate_module(seed_dir, voice_id=voice, synthesize=synthesize,
                                      scene_key=scene, log=log)
        except (elevenlabs.ElevenLabsError, ValueError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS(f"Narrated {len(done)} scene(s). "
                                             "Review and approve them in the studio."))
