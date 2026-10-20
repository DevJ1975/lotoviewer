"""Local bookkeeping only. Modules, versions and media live in Supabase; this
database records what the studio did (jobs) and who signed off (approvals),
so a reviewer's decision is auditable even if content is later re-imported."""
from django.db import models


class MediaJob(models.Model):
    class Kind(models.TextChoices):
        NARRATION = "narration"
        IMAGE = "image"
        RENDER = "render"
        IMPORT = "import"

    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
        SUCCEEDED = "succeeded"
        FAILED = "failed"

    module_slug = models.CharField(max_length=80)
    version_number = models.PositiveIntegerField(null=True, blank=True)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    log = models.TextField(blank=True)
    created_by = models.CharField(max_length=254, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def append(self, line: str) -> None:
        self.log = f"{self.log}{line}\n"


class AssetApproval(models.Model):
    class Kind(models.TextChoices):
        IMAGE = "image"
        NARRATION = "narration"
        VIDEO = "video"

    class Decision(models.TextChoices):
        APPROVED = "approved"
        REJECTED = "rejected"

    module_slug = models.CharField(max_length=80)
    version_number = models.PositiveIntegerField()
    asset_path = models.CharField(max_length=512)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    decision = models.CharField(max_length=16, choices=Decision.choices)
    approved_by = models.CharField(max_length=254)
    approved_by_id = models.CharField(max_length=64, blank=True)
    approved_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-approved_at"]
