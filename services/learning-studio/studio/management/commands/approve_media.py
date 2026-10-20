from datetime import UTC, datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from studio import supabase
from studio.content import board_assets, load_module, set_approval
from studio.models import AssetApproval


class Command(BaseCommand):
    help = ("Approve every AI image and narration on a module's draft version — the CLI form of "
            "the media board's Approve button. The approver is recorded on each asset and in "
            "the approval history, so name the person who actually reviewed the media.")

    def add_arguments(self, parser):
        parser.add_argument("seed_dir", type=Path)
        parser.add_argument("--approver", required=True,
                            help="Email of the person who reviewed the media")
        parser.add_argument("--tenant", dest="tenant_id", default=None,
                            help="Tenant UUID of a tenant-owned module")

    def handle(self, *args, seed_dir: Path, approver: str, tenant_id: str | None, **options):
        module = load_module(seed_dir)
        existing = supabase.get_module_by_slug(module["slug"], tenant_id)
        drafts = sorted((v for v in (existing or {}).get("strike_module_versions") or []
                         if v["status"] in supabase.EDITABLE_STATUSES),
                        key=lambda v: v["version_number"])
        if not drafts:
            raise CommandError("No draft version to approve. Run import_seed_module first.")
        version = supabase.get_version(drafts[-1]["id"])
        content = version.get("content") or {"blocks": []}

        at = datetime.now(UTC).isoformat()
        pending = [a for a in board_assets(content) if not a.approved_at]
        for asset in pending:
            content, _ = set_approval(content, asset.path, approver, at)
        supabase.update_editable_version(version["id"], {"content": content})
        AssetApproval.objects.bulk_create([
            AssetApproval(module_slug=module["slug"], version_number=version["version_number"],
                          asset_path=asset.path, kind=asset.kind,
                          decision=AssetApproval.Decision.APPROVED, approved_by=approver,
                          notes="Approved via approve_media CLI")
            for asset in pending
        ])
        self.stdout.write(self.style.SUCCESS(
            f"Approved {len(pending)} asset(s) on {module['slug']} v{version['version_number']} "
            f"as {approver}."))
