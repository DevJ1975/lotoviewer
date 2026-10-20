import json

import pytest
from django.core.management import CommandError, call_command

from studio.importer import ImportRefused, import_seed_module
from studio.models import MediaJob


def touch_all_media(seed_dir):
    module = json.loads((seed_dir / "module.json").read_text())
    for block in module["content"]["blocks"]:
        if block.get("image"):
            (seed_dir / block["image"]["path"].split("/")[-1]).write_bytes(b"png")
        narration = block.get("narration") or {}
        for field in ("audio_path", "captions_path"):
            if narration.get(field):
                (seed_dir / narration[field].split("/")[-1]).write_bytes(b"x")
    return module


def test_refuses_when_media_is_missing(fake, seed_dir):
    with pytest.raises(ImportRefused, match="Media files missing"):
        import_seed_module(seed_dir, log=lambda _: None)
    assert fake.tables["strike_modules"] == []


def test_first_import_creates_global_module_draft_version_and_quiz(fake, seed_dir):
    module = touch_all_media(seed_dir)
    result = import_seed_module(seed_dir, log=lambda _: None)

    [row] = fake.tables["strike_modules"]
    assert row["library_scope"] == "global" and row["tenant_id"] is None
    assert row["status"] == "in_review" and row["slug"] == module["slug"]
    [version] = fake.tables["strike_module_versions"]
    assert version["status"] == "draft" and version["version_number"] == 1
    assert version["validity_days"] == 365 and version["locale"] == "en"
    first_image = version["content"]["blocks"][0]["image"]["path"]
    seed_image = module["content"]["blocks"][0]["image"]["path"]
    assert first_image == f"{module['media_prefix']}/{seed_image}"
    assert first_image in fake.uploads
    assert result.created_module and result.created_version
    assert len(fake.tables["strike_quiz_questions"]) == 10
    assert all(q["graded"] for q in fake.tables["strike_quiz_questions"])
    correct = [a for a in fake.tables["strike_quiz_answers"] if a["is_correct"]]
    assert len(correct) >= 10


TENANT = "ddddbce8-c7ab-4855-8bcd-821d080617ee"


def test_tenant_import_scopes_module_rows_and_media_to_that_tenant(fake, seed_dir):
    module = touch_all_media(seed_dir)
    import_seed_module(seed_dir, tenant_id=TENANT, log=lambda _: None)

    [row] = fake.tables["strike_modules"]
    assert row["library_scope"] == "tenant" and row["tenant_id"] == TENANT
    [version] = fake.tables["strike_module_versions"]
    assert version["library_scope"] == "tenant" and version["tenant_id"] == TENANT
    assert {q["tenant_id"] for q in fake.tables["strike_quiz_questions"]} == {TENANT}
    assert {a["tenant_id"] for a in fake.tables["strike_quiz_answers"]} == {TENANT}
    # The storage policy only lets a tenant read under its own top-level folder.
    first_image = version["content"]["blocks"][0]["image"]["path"]
    assert first_image.startswith(f"{TENANT}/{module['media_prefix'].split('/', 1)[1]}/")
    assert all(path.startswith(f"{TENANT}/") for path in fake.uploads)


def test_tenant_import_does_not_touch_the_global_module_with_the_same_slug(fake, seed_dir):
    touch_all_media(seed_dir)
    import_seed_module(seed_dir, log=lambda _: None)
    import_seed_module(seed_dir, tenant_id=TENANT, log=lambda _: None)
    assert sorted(m["library_scope"] for m in fake.tables["strike_modules"]) == ["global", "tenant"]
    assert len(fake.tables["strike_module_versions"]) == 2


def test_reimport_updates_the_same_draft_and_replaces_the_quiz(fake, seed_dir):
    touch_all_media(seed_dir)
    first = import_seed_module(seed_dir, log=lambda _: None)
    second = import_seed_module(seed_dir, log=lambda _: None)
    assert second.version_id == first.version_id
    assert not second.created_module and not second.created_version
    assert len(fake.tables["strike_module_versions"]) == 1
    assert len(fake.tables["strike_quiz_questions"]) == 10


def test_never_overwrites_a_published_version(fake, seed_dir):
    touch_all_media(seed_dir)
    slug = json.loads((seed_dir / "module.json").read_text())["slug"]
    module, version = fake.add_module(status="published", version_status="published",
                                      content={"blocks": ["original"]})
    module["slug"] = slug
    with pytest.raises(ImportRefused, match="Version 1 of .* is published"):
        import_seed_module(seed_dir, log=lambda _: None)
    assert version["content"] == {"blocks": ["original"]}
    assert fake.uploads == {}


def test_command_wraps_refusals_and_records_a_failed_job(fake, seed_dir, db):
    with pytest.raises(CommandError, match="Media files missing"):
        call_command("import_seed_module", str(seed_dir))
    job = MediaJob.objects.get()
    assert job.kind == "import" and job.status == "failed"


def test_command_allow_missing_imports_and_records_success(fake, seed_dir, db):
    call_command("import_seed_module", str(seed_dir), "--allow-missing")
    job = MediaJob.objects.get()
    assert job.status == "succeeded" and job.version_number == 1


@pytest.mark.django_db
def test_approve_media_cli_stamps_every_ai_asset_and_records_history(fake, seed_dir):
    from studio.models import AssetApproval
    touch_all_media(seed_dir)
    import_seed_module(seed_dir, tenant_id=TENANT, log=lambda _: None)

    call_command("approve_media", str(seed_dir), "--tenant", TENANT, "--approver", "reviewer@example.com")

    [version] = fake.tables["strike_module_versions"]
    stamped = [b.get("image") or b.get("narration") for b in version["content"]["blocks"]
               if b.get("image") or b.get("narration")]
    assert stamped and all(a["approved_by"] == "reviewer@example.com" and a["approved_at"] for a in stamped)
    assert AssetApproval.objects.filter(approved_by="reviewer@example.com").count() > 0


def test_approve_media_requires_a_named_approver(fake, seed_dir):
    with pytest.raises(CommandError):
        call_command("approve_media", str(seed_dir))
