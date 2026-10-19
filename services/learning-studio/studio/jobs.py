from contextlib import contextmanager

from django.utils import timezone

from .models import MediaJob


@contextmanager
def track_job(kind: str, module_slug: str, *, version_number: int | None = None,
              created_by: str = "cli"):
    """Record a job row for the studio's jobs page; failures are logged, then re-raised."""
    job = MediaJob.objects.create(kind=kind, module_slug=module_slug,
                                  version_number=version_number, created_by=created_by,
                                  status=MediaJob.Status.RUNNING)
    try:
        yield job
    except Exception as error:
        job.append(f"FAILED: {error}")
        job.status = MediaJob.Status.FAILED
        raise
    else:
        job.status = MediaJob.Status.SUCCEEDED
    finally:
        job.finished_at = timezone.now()
        job.save()
